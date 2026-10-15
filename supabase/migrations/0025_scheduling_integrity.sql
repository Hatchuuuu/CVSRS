-- Serialize child scheduling with transfer/merge. Retain the original command bodies
-- as private-to-the-API implementation functions so existing receipts and audits stay intact.
alter function public.book_appointment(uuid,uuid,uuid,text,text[]) rename to book_appointment_prev;
alter function public.reschedule_appointment(uuid,uuid,uuid,text) rename to reschedule_appointment_prev;
alter function public.check_in(uuid,uuid,uuid,uuid,text) rename to check_in_prev;
alter function public.merge_children(uuid,uuid,uuid,uuid,text) rename to merge_children_prev;
alter function public.accept_record_transfer(uuid,uuid,uuid) rename to accept_record_transfer_prev;
alter function public.queue_transition(uuid,uuid,uuid,text,integer,text,text,text) rename to queue_transition_prev;

create function private.scheduling_replay(p_org uuid, p_key uuid, p_type text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r private.command_receipts; v_hash text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into r from private.command_receipts where organization_id = p_org and operation_key = p_key;
  if r.id is null then return null; end if;
  v_hash := encode(sha256(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8')), 'hex');
  if r.actor_id <> auth.uid() or r.command_type <> p_type or r.payload_hash <> v_hash then
    raise exception 'operation key reused with different content' using errcode = 'CV409';
  end if;
  return r.result;
end $$;

create function public.book_appointment(p_operation_key uuid, p_child_id uuid, p_session_id uuid, p_reason text default null, p_rule_codes text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_child uuid; v_clinic uuid; v_org uuid; v_replay jsonb;
begin
  select organization_id, clinic_id into v_org, v_clinic from public.clinic_sessions where id = p_session_id;
  v_child := private.canonical_child(p_child_id);
  if private.can_book_for(v_child, v_clinic) is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_replay := private.scheduling_replay(v_org, p_operation_key, 'appointment.book', jsonb_build_object('child', p_child_id, 'session', p_session_id, 'reason', p_reason, 'rules', to_jsonb(coalesce(p_rule_codes, '{}'))));
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.children where id = v_child for update;
  if private.guardian_has_full_access(v_child) and not private.child_in_clinic(v_child, v_clinic) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
  return public.book_appointment_prev(p_operation_key, p_child_id, p_session_id, p_reason, p_rule_codes);
end $$;

create function public.reschedule_appointment(p_operation_key uuid, p_appointment_id uuid, p_new_session_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_child uuid; v_clinic uuid; v_org uuid; v_replay jsonb;
begin
  select a.child_id, a.organization_id, s.clinic_id into v_child, v_org, v_clinic from public.appointments a join public.clinic_sessions s on s.id = a.session_id where a.id = p_appointment_id;
  if private.can_book_for(v_child, v_clinic) is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_replay := private.scheduling_replay(v_org, p_operation_key, 'appointment.reschedule', jsonb_build_object('a', p_appointment_id, 'n', p_new_session_id, 'r', p_reason));
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.children where id = v_child for update;
  if v_child is not null and not private.child_in_clinic(v_child, v_clinic) then raise exception 'not found' using errcode = 'CV404'; end if;
  return public.reschedule_appointment_prev(p_operation_key, p_appointment_id, p_new_session_id, p_reason);
end $$;

create function public.check_in(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_appointment_id uuid default null, p_overflow_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_child uuid; v_session uuid; v_status text; v_today date; v_org uuid; v_replay jsonb;
begin
  perform private.require_capability(p_clinic_id, 'queue.manage');
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  v_replay := private.scheduling_replay(v_org, p_operation_key, 'queue.check_in', jsonb_build_object('c', p_clinic_id, 'child', p_child_id, 'a', p_appointment_id, 'o', p_overflow_reason));
  if v_replay is not null then return v_replay; end if;
  v_child := private.canonical_child(p_child_id);
  perform 1 from public.children where id = v_child for update;
  if p_appointment_id is not null then
    select a.session_id into v_session from public.appointments a where a.id = p_appointment_id and a.child_id = v_child;
    if v_session is not null then
      select status into v_status from public.clinic_sessions where id = v_session for update;
      if v_status = 'cancelled' then raise exception 'this session was cancelled' using errcode = 'CV409'; end if;
    end if;
  else
    v_today := private.local_today(p_clinic_id);
    -- All stations at this clinic/date hold the same lock through capacity check and insertion.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clinic_id::text || ':' || v_today::text, 0));
  end if;
  return public.check_in_prev(p_operation_key, p_clinic_id, p_child_id, p_appointment_id, p_overflow_reason);
end $$;

create function public.queue_transition(p_operation_key uuid, p_clinic_id uuid, p_entry_id uuid, p_to text, p_expected_version integer, p_station text default null, p_reason text default null, p_outcome text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_child uuid;
begin
  perform private.require_capability(p_clinic_id, 'queue.manage');
  select child_id into v_child from public.queue_entries where id = p_entry_id and clinic_id = p_clinic_id;
  perform 1 from public.children where id = v_child for update;
  return public.queue_transition_prev(p_operation_key, p_clinic_id, p_entry_id, p_to, p_expected_version, p_station, p_reason, p_outcome);
end $$;

create function public.accept_record_transfer(p_operation_key uuid, p_clinic_id uuid, p_transfer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_child uuid; v_org uuid; v_replay jsonb;
begin
  perform private.require_capability(p_clinic_id, 'child.register');
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  v_replay := private.scheduling_replay(v_org, p_operation_key, 'transfer.accept', jsonb_build_object('c', p_clinic_id, 't', p_transfer_id));
  if v_replay is not null then return v_replay; end if;
  select child_id into v_child from public.record_transfers where id = p_transfer_id and to_clinic_id = p_clinic_id;
  perform 1 from public.children where id = v_child for update;
  return public.accept_record_transfer_prev(p_operation_key, p_clinic_id, p_transfer_id);
end $$;

create function public.merge_children(p_operation_key uuid, p_clinic_id uuid, p_survivor uuid, p_duplicate uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_org uuid; v_replay jsonb; a record;
begin
  perform private.require_capability(p_clinic_id, 'review.resolve');
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  v_replay := private.scheduling_replay(v_org, p_operation_key, 'child.merge', jsonb_build_object('clinic', p_clinic_id, 's', p_survivor, 'd', p_duplicate, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.children where id in (p_survivor, p_duplicate) order by id for update;
  if exists (select 1 from public.encounters where child_id in (p_survivor, p_duplicate) and status = 'open') then
    raise exception 'finish active visits before merging records' using errcode = 'CV409';
  end if;
  if exists (
    select 1 from public.queue_entries d join public.queue_entries s on s.child_id = p_survivor and s.clinic_id = d.clinic_id and s.service_date = d.service_date
     where d.child_id = p_duplicate and d.status in ('waiting','called','in_service','held') and s.status in ('waiting','called','in_service','held')
  ) then raise exception 'both records have an active ticket; resolve arrivals before merging' using errcode = 'CV409'; end if;
  if exists (
    select 1 from public.appointments d join public.appointments s on s.child_id = p_survivor and s.session_id = d.session_id
     where d.child_id = p_duplicate and d.status = 'checked_in' and s.status in ('confirmed','checked_in','fulfilled')
  ) then raise exception 'both records have an active booking; resolve arrivals before merging' using errcode = 'CV409'; end if;

  v_result := public.merge_children_prev(p_operation_key, p_clinic_id, p_survivor, p_duplicate, p_reason);
  -- Preserve one usable booking per session. The cancelled duplicate stays as an
  -- auditable historical row, while its queued confirmation is withdrawn.
  for a in select d.id from public.appointments d where d.child_id = p_duplicate and d.status = 'confirmed'
    and exists (select 1 from public.appointments s where s.child_id = p_survivor and s.session_id = d.session_id and s.status in ('confirmed','checked_in','fulfilled'))
  loop
    update public.appointments set status = 'cancelled', reason = 'duplicate child record merged with existing booking', updated_by = auth.uid() where id = a.id;
    update private.outbox_jobs set status = 'cancelled', updated_at = now() where organization_id = v_org and status = 'queued' and dedupe_key = 'appt-confirm:' || a.id;
    perform private.audit(v_org, 'review.resolve', 'appointment.merge_collision', 'appointment', a.id, null, jsonb_build_object('survivorChildId', p_survivor), p_reason);
  end loop;
  update public.appointments set child_id = p_survivor, updated_by = auth.uid() where child_id = p_duplicate and status in ('confirmed','checked_in');
  update public.queue_entries set child_id = p_survivor, updated_by = auth.uid() where child_id = p_duplicate and status in ('waiting','called','in_service','held');
  perform private.audit(v_org, 'review.resolve', 'child.merge_scheduling', 'child', p_duplicate, null, jsonb_build_object('survivorId', p_survivor), p_reason);
  return v_result;
end $$;

-- The old command bodies remain definer-only; the public signatures retain their grants.
revoke all on function public.book_appointment_prev(uuid,uuid,uuid,text,text[]), public.reschedule_appointment_prev(uuid,uuid,uuid,text),
  public.check_in_prev(uuid,uuid,uuid,uuid,text), public.merge_children_prev(uuid,uuid,uuid,uuid,text),
  public.accept_record_transfer_prev(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.queue_transition_prev(uuid,uuid,uuid,text,integer,text,text,text), private.scheduling_replay(uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.book_appointment(uuid,uuid,uuid,text,text[]), public.reschedule_appointment(uuid,uuid,uuid,text),
  public.check_in(uuid,uuid,uuid,uuid,text), public.merge_children(uuid,uuid,uuid,uuid,text),
  public.accept_record_transfer(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.queue_transition(uuid,uuid,uuid,text,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.book_appointment(uuid,uuid,uuid,text,text[]), public.reschedule_appointment(uuid,uuid,uuid,text),
  public.check_in(uuid,uuid,uuid,uuid,text), public.merge_children(uuid,uuid,uuid,uuid,text),
  public.accept_record_transfer(uuid,uuid,uuid) to authenticated;
grant execute on function public.queue_transition(uuid,uuid,uuid,text,integer,text,text,text) to authenticated;

-- The same effective-date inputs are used for evaluation and backdated planned-dose checks.
create or replace function private.evaluate_rules(p_version uuid, p_dob date, p_dob_exact boolean, p_doses jsonb, p_holds jsonb, p_as_of date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r record; dep record; d record;
  v_state jsonb := '{}'::jsonb;         -- rule id -> {creditedOn, earliestEligibleOn}
  v_used text[] := '{}';
  v_flagged text[] := '{}';           -- doses already reported as outside limits: flagged once, at the first rule that rejects them
  v_out jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_unresolved jsonb := '[]'::jsonb;
  v_min_on date; v_max_on date; v_earliest date; v_cand date; v_projected boolean; v_pred_pending boolean;
  v_target date; v_ws date; v_we date; v_credit_id text; v_credit_on date; v_unval jsonb; v_status text; v_reasons jsonb;
  v_has_hold boolean; v_antigen text; v_dose_on date; v_bad text; v_recommended date; v_st jsonb;
begin
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_unresolved from jsonb_array_elements(p_doses) x where coalesce((x ->> 'unresolved')::boolean, false) and (x ->> 'on' is null or (x ->> 'on')::date <= p_as_of);

  for r in
    select sr.*, a.code as antigen_code from public.schedule_rules sr join public.antigens a on a.id = sr.antigen_id
     where sr.schedule_version_id = p_version order by sr.sequence_no
  loop
    v_reasons := '[]'::jsonb; v_unval := '[]'::jsonb; v_credit_id := null; v_credit_on := null;
    v_min_on := null; v_max_on := null; v_earliest := null; v_projected := false; v_pred_pending := false;
    v_target := null; v_ws := null; v_we := null; v_recommended := null;

    if p_dob_exact then
      v_min_on := private.add_age(p_dob, r.minimum_age);
      v_max_on := private.add_age(p_dob, r.maximum_age);
      v_earliest := v_min_on;
      for dep in select dd.*, dd.predecessor_rule_id as pid from public.schedule_rule_dependencies dd where dd.rule_id = r.id loop
        v_st := v_state -> dep.pid::text;
        if v_st ->> 'creditedOn' is not null then
          v_cand := private.add_interval((v_st ->> 'creditedOn')::date, dep.minimum_interval_value, dep.interval_unit);
        else
          v_pred_pending := true; v_projected := true;
          v_cand := private.add_interval((v_st ->> 'earliestEligibleOn')::date, dep.minimum_interval_value, dep.interval_unit);
        end if;
        v_earliest := greatest(v_earliest, v_cand);
      end loop;

      -- Credit the earliest unused dose that satisfies every limit of this rule.
      for d in
        select x.value as dose, (x.value ->> 'id') as did, (x.value ->> 'on')::date as don
          from jsonb_array_elements(p_doses) as x(value)
         where not coalesce((x.value ->> 'unresolved')::boolean, false)
           and (x.value ->> 'on')::date <= p_as_of
           and (x.value -> 'antigens') ? r.antigen_code
           and (jsonb_array_length(r.accepted_products) = 0 or r.accepted_products ? (x.value ->> 'product'))
         order by (x.value ->> 'on')::date, x.value ->> 'id'
      loop
        -- One physical dose may credit one requirement per antigen it contains (combination products, T08), never the same antigen twice.
        continue when (d.did || ':' || r.antigen_code) = any (v_used);
        v_bad := null;
        if v_pred_pending then v_bad := 'predecessor_not_credited';
        elsif v_min_on is not null and d.don < v_min_on then v_bad := 'given_before_minimum_age';
        elsif v_earliest is not null and d.don < v_earliest then v_bad := 'given_before_minimum_interval';
        elsif v_max_on is not null and d.don > v_max_on then v_bad := 'given_after_maximum_age';
        end if;
        if v_bad is null then
          v_credit_id := d.did; v_credit_on := d.don; v_used := v_used || (d.did || ':' || r.antigen_code);
          exit;
        else
          if not ((d.did || ':' || r.antigen_code) = any (v_flagged)) then
            v_unval := v_unval || jsonb_build_object('doseId', d.did, 'on', d.don, 'reason', v_bad);
            v_flagged := v_flagged || (d.did || ':' || r.antigen_code);
          end if;
        end if;
      end loop;

      v_target := private.add_age(p_dob, r.target_offset);
      v_ws := coalesce(private.add_age(p_dob, r.due_window -> 'start'), v_target);
      v_we := private.add_age(p_dob, r.due_window -> 'end');
      v_recommended := greatest(v_target, v_earliest);
    end if;

    v_state := v_state || jsonb_build_object(r.id::text, jsonb_build_object('creditedOn', v_credit_on, 'earliestEligibleOn', v_earliest));

    select exists (select 1 from jsonb_array_elements(p_holds) h where h ->> 'ruleId' is null or (h ->> 'ruleId') = r.id::text) into v_has_hold;

    if v_credit_id is not null then
      v_status := 'completed';
      v_reasons := jsonb_build_array(jsonb_build_object('code', 'credited_by_verified_dose', 'doseId', v_credit_id, 'on', v_credit_on));
    elsif not p_dob_exact then
      v_status := 'staff_review_needed'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'birth_date_not_exact'));
    elsif v_has_hold then
      v_status := 'staff_review_needed'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'clinical_hold'));
    elsif jsonb_array_length(v_unval) > 0 then
      v_status := 'staff_review_needed'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'dose_outside_rule_limits', 'doses', v_unval));
    elsif exists (select 1 from jsonb_array_elements(v_unresolved) u where (u -> 'antigens') ? r.antigen_code) then
      v_status := 'staff_review_needed'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'unresolved_history'));
    elsif r.review_conditions <> '[]'::jsonb then
      v_status := 'staff_review_needed'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'rule_requires_review', 'conditions', r.review_conditions));
    elsif v_max_on is not null and p_as_of > v_max_on then
      v_status := 'staff_review_needed'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'beyond_maximum_age', 'on', v_max_on));
    elsif v_pred_pending then
      v_status := 'not_yet_eligible'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'predecessor_pending'));
    elsif v_earliest is not null and p_as_of < v_earliest then
      v_status := 'not_yet_eligible'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'before_earliest_eligible', 'on', v_earliest));
    elsif v_we is not null and p_as_of > v_we then
      v_status := 'overdue'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'after_due_window', 'on', v_we));
    elsif v_target is not null and p_as_of = v_target then
      v_status := 'due_today'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'target_date_is_today'));
    elsif v_ws is not null and v_we is not null and p_as_of >= v_ws then
      v_status := 'due_now'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'within_due_window'));
    elsif v_target is not null and p_as_of > v_target then
      -- No approved overdue threshold: never invent one (BP16). "Past recommended date — review with clinic".
      v_status := 'past_recommended_date'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'past_target_without_overdue_threshold', 'on', v_target));
    elsif v_ws is not null and p_as_of >= v_ws then
      v_status := 'due_now'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'window_open'));
    elsif v_target is null and v_ws is null then
      v_status := 'due_now'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'eligible_no_timing_guidance'));
    else
      v_status := 'upcoming'; v_reasons := jsonb_build_array(jsonb_build_object('code', 'target_in_future'));
    end if;

    v_summary := v_summary || jsonb_build_object(v_status, coalesce((v_summary ->> v_status)::int, 0) + 1);
    v_out := v_out || jsonb_build_object(
      'ruleId', r.id, 'requirement', r.requirement_code, 'antigen', r.antigen_code, 'series', r.series_code, 'ordinal', r.dose_ordinal,
      'status', v_status, 'reasons', v_reasons, 'earliestEligibleOn', v_earliest, 'projected', v_projected,
      'targetOn', v_target, 'recommendedOn', v_recommended, 'windowStart', v_ws, 'windowEnd', v_we, 'maximumAgeOn', v_max_on,
      'creditedDoseId', v_credit_id, 'creditedOn', v_credit_on);
  end loop;

  return jsonb_build_object('engineVersion', 'plpgsql-2', 'versionId', p_version, 'asOf', p_as_of, 'birthDateExact', p_dob_exact,
                            'requirements', v_out, 'summary', v_summary, 'unresolvedHistory', v_unresolved);
end $$;

create or replace function private.child_eval_inputs(p_child uuid, p_as_of date) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dob date; v_prec text; v_doses jsonb; v_holds jsonb; v_pending int; v_rev jsonb;
begin
  select dob, birth_date_precision into v_dob, v_prec from public.children where id = p_child;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', cr.id::text,
      'revisionId', cr.id, 'eventId', cr.event_id,
      'product', p.code,
      'antigens', coalesce((select jsonb_agg(a.code order by a.code) from public.product_antigens pa join public.antigens a on a.id = pa.antigen_id where pa.product_id = cr.product_id), '[]'::jsonb),
      'on', case when cr.date_precision = 'exact' then cr.administered_on end,
      'unresolved', cr.date_precision <> 'exact' or cr.administered_on is null or cr.product_id is null)
    order by cr.administered_on nulls last, cr.id), '[]'::jsonb)
    into v_doses
    from private.current_revisions cr left join public.vaccine_products p on p.id = cr.product_id
   where cr.child_id in (select private.child_ids_with_aliases(p_child))
     and cr.event_status = 'active' and cr.verification_status = 'verified'
     and (cr.administered_on is null or cr.administered_on <= p_as_of);
  select coalesce(jsonb_agg(jsonb_build_object('ruleId', h.rule_id, 'reason', h.reason_code)), '[]'::jsonb) into v_holds
    from public.clinical_holds h where h.child_id = p_child
      and (h.starts_at at time zone coalesce((select c.timezone from public.clinics c where c.id = h.placed_clinic_id), 'UTC'))::date <= p_as_of
      and (h.resolved_at is null or (h.resolved_at at time zone coalesce((select c.timezone from public.clinics c where c.id = h.placed_clinic_id), 'UTC'))::date > p_as_of);
  -- Unverified/pending evidence is counted for staff visibility but NEVER credited (T09).
  select count(*) into v_pending from private.current_revisions cr
   where cr.child_id in (select private.child_ids_with_aliases(p_child)) and cr.event_status = 'active' and cr.verification_status = 'pending_verification' and (cr.administered_on is null or cr.administered_on <= p_as_of);
  return jsonb_build_object('dob', v_dob, 'dobExact', v_prec = 'exact' and v_dob is not null, 'doses', v_doses, 'holds', v_holds, 'pendingEvidence', v_pending);
end $$;

create or replace function private.compute_child_schedule(p_child uuid, p_as_of date, p_persist boolean, p_program text default 'routine') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.children; v_ver uuid; v_in jsonb; v_res jsonb; v_hash text; v_eval uuid; sv public.schedule_versions; x jsonb; rr jsonb; v_dose jsonb;
begin
  select * into c from public.children where id = p_child;
  v_in := private.child_eval_inputs(p_child, p_as_of);
  v_ver := private.active_schedule_for(c.organization_id, p_program, c.dob, p_as_of);
  if v_ver is null then
    return jsonb_build_object('status', 'no_active_schedule', 'pendingEvidence', v_in -> 'pendingEvidence');
  end if;
  select * into sv from public.schedule_versions where id = v_ver;
  v_res := private.evaluate_rules(v_ver, c.dob, (v_in ->> 'dobExact')::boolean, v_in -> 'doses', v_in -> 'holds', p_as_of);
  v_res := v_res || jsonb_build_object('status', 'evaluated', 'versionLabel', sv.version_label, 'programCode', sv.program_code, 'isDemo', sv.is_demo,
                                       'pendingEvidence', v_in -> 'pendingEvidence', 'childId', p_child, 'dob', c.dob);
  if p_persist then
    v_hash := encode(sha256(convert_to(jsonb_build_object('dob', c.dob, 'exact', v_in -> 'dobExact', 'doses', v_in -> 'doses', 'holds', v_in -> 'holds',
                                                          'version', v_ver, 'engine', 'plpgsql-2')::text, 'UTF8')), 'hex');
    insert into public.schedule_evaluations (organization_id, child_id, schedule_version_id, as_of_date, engine_version, input_hash, result, created_by)
    values (c.organization_id, p_child, v_ver, p_as_of, 'plpgsql-2', v_hash, v_res, auth.uid())
    on conflict (child_id, schedule_version_id, as_of_date, engine_version, input_hash) do nothing returning id into v_eval;
    if v_eval is null then
      select id into v_eval from public.schedule_evaluations
       where child_id = p_child and schedule_version_id = v_ver and as_of_date = p_as_of and engine_version = 'plpgsql-2' and input_hash = v_hash;
    else
      for rr in select * from jsonb_array_elements(v_res -> 'requirements') loop
        if rr ->> 'creditedDoseId' is not null then
          insert into public.dose_credits (organization_id, evaluation_id, rule_id, vaccination_revision_id, credit_status, reason)
          values (c.organization_id, v_eval, (rr ->> 'ruleId')::uuid, (rr ->> 'creditedDoseId')::uuid, 'credited', 'credited_by_verified_dose');
        elsif jsonb_array_length(coalesce(rr -> 'reasons' -> 0 -> 'doses', '[]'::jsonb)) > 0 then
          v_dose := rr -> 'reasons' -> 0 -> 'doses' -> 0;
          insert into public.dose_credits (organization_id, evaluation_id, rule_id, vaccination_revision_id, credit_status, reason)
          values (c.organization_id, v_eval, (rr ->> 'ruleId')::uuid, (v_dose ->> 'doseId')::uuid, 'not_credited', v_dose ->> 'reason');
        end if;
      end loop;
    end if;
      -- Historical/future snapshots must not change the child's current assignment.
      -- A preview may already have persisted today's evaluation: assignment must
      -- also reconcile when the INSERT reuses that cached snapshot.
      if p_as_of = coalesce((select private.local_today(e.clinic_id) from public.child_clinic_enrollments e
                             where e.child_id = p_child and e.status = 'active'
                             order by e.is_primary desc, e.created_at limit 1), current_date) then
        update public.child_programs set status = 'ended', ends_on = p_as_of, updated_by = auth.uid()
         where child_id = p_child and program_code = sv.program_code and status = 'active' and schedule_version_id <> v_ver;
        insert into public.child_programs (organization_id, child_id, schedule_version_id, program_code, starts_on, assignment_reason, created_by, updated_by)
        values (c.organization_id, p_child, v_ver, sv.program_code, p_as_of, 'automatic', auth.uid(), auth.uid())
        on conflict do nothing;
      end if;
    v_res := v_res || jsonb_build_object('evaluationId', v_eval, 'inputHash', v_hash);
  end if;
  return v_res;
end $$;

create or replace function private.check_planned_dose(p_child uuid, p_product uuid, p_on date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.children; v_ver uuid; v_in jsonb; v_codes jsonb; v_pcode text; v_res jsonb; v_credited jsonb; v_flagged jsonb; v_blocking jsonb := '[]'::jsonb;
begin
  select * into c from public.children where id = p_child;
  v_ver := private.active_schedule_for(c.organization_id, 'routine', c.dob, p_on);
  if v_ver is null then return jsonb_build_object('evaluated', false, 'blocked', false, 'credited', '[]'::jsonb, 'reasons', '[]'::jsonb); end if;
  v_in := private.child_eval_inputs(p_child, p_on);
  if exists (select 1 from jsonb_array_elements(v_in -> 'holds') h) then
    return jsonb_build_object('evaluated', true, 'blocked', true, 'credited', '[]'::jsonb, 'reasons', jsonb_build_array('clinical_hold'));
  end if;
  if not (v_in ->> 'dobExact')::boolean then
    return jsonb_build_object('evaluated', true, 'blocked', true, 'credited', '[]'::jsonb, 'reasons', jsonb_build_array('birth_date_not_exact'));
  end if;
  select coalesce(jsonb_agg(a.code order by a.code), '[]'::jsonb), max(p.code) into v_codes, v_pcode
    from public.vaccine_products p left join public.product_antigens pa on pa.product_id = p.id left join public.antigens a on a.id = pa.antigen_id where p.id = p_product;
  v_res := private.evaluate_rules(v_ver, c.dob, true, (v_in -> 'doses') || jsonb_build_array(jsonb_build_object('id', 'new', 'antigens', v_codes, 'product', v_pcode, 'on', p_on, 'unresolved', false)), v_in -> 'holds', p_on);
  select coalesce(jsonb_agg(x ->> 'requirement'), '[]'::jsonb) into v_credited from jsonb_array_elements(v_res -> 'requirements') x where x ->> 'creditedDoseId' = 'new';
  select coalesce(jsonb_agg(jsonb_build_object('requirement', x ->> 'requirement', 'reason', d ->> 'reason')), '[]'::jsonb) into v_flagged
    from jsonb_array_elements(v_res -> 'requirements') x, jsonb_array_elements(coalesce(x -> 'reasons' -> 0 -> 'doses', '[]'::jsonb)) d where d ->> 'doseId' = 'new';
  return jsonb_build_object('evaluated', true, 'blocked', jsonb_array_length(v_flagged) > 0, 'credited', v_credited, 'reasons', v_flagged);
end $$;

create or replace function private.child_eval_inputs(p_child uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.child_eval_inputs(p_child, coalesce(
    (select private.local_today(e.clinic_id) from public.child_clinic_enrollments e
      where e.child_id = p_child and e.status = 'active' order by e.is_primary desc, e.created_at limit 1),
    current_date))
$$;

revoke all on function private.evaluate_rules(uuid,date,boolean,jsonb,jsonb,date), private.child_eval_inputs(uuid,date),
  private.child_eval_inputs(uuid), private.compute_child_schedule(uuid,date,boolean,text), private.check_planned_dose(uuid,uuid,date)
  from public, anon, authenticated;
