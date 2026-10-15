-- 0007 Deterministic schedule evaluation engine (pure function of rules + inputs) and child evaluation.
-- Blueprint refs: BP16 (evaluation sequence, status model), T07, T08, T09, T12(partly), T31.
--
-- The engine implements the SUPPORTED TYPED VOCABULARY only: calendar-age offsets, minimum/maximum age, per-predecessor
-- minimum intervals, accepted products, due windows. It contains no medical values. Interpretation of "valid dose"
-- is strictly what the approved rule text says (no grace periods, no invented catch-up branches): a dose outside the
-- rule limits is never credited automatically; it produces "staff review needed".

create function private.valid_age(p jsonb) returns boolean language sql immutable set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and (p ->> 'unit') in ('days','weeks','months')
    and (p ->> 'value') ~ '^[0-9]{1,4}$'
  )
$$;

-- Calendar arithmetic. Months are calendar months (PostgreSQL clamps to month end), never 30 days (BP16).
create function private.add_age(p_from date, p_age jsonb) returns date language sql stable set search_path = '' as $$
  select case
    when p_age is null or p_from is null then null
    when p_age ->> 'unit' = 'days'   then p_from + (p_age ->> 'value')::int
    when p_age ->> 'unit' = 'weeks'  then p_from + (p_age ->> 'value')::int * 7
    when p_age ->> 'unit' = 'months' then (p_from + make_interval(months => (p_age ->> 'value')::int))::date
  end
$$;

create function private.add_interval(p_from date, p_value integer, p_unit text) returns date language sql stable set search_path = '' as $$
  select private.add_age(p_from, jsonb_build_object('value', p_value, 'unit', p_unit))
$$;

-- p_doses: [{ "id": text, "antigens": [code], "product": code|null, "on": "YYYY-MM-DD" | null, "unresolved": bool }]
-- p_holds: [{ "ruleId": uuid|null, "reason": text }]
create function private.evaluate_rules(p_version uuid, p_dob date, p_dob_exact boolean, p_doses jsonb, p_holds jsonb, p_as_of date)
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
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_unresolved from jsonb_array_elements(p_doses) x where coalesce((x ->> 'unresolved')::boolean, false);

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

  return jsonb_build_object('engineVersion', 'plpgsql-1', 'versionId', p_version, 'asOf', p_as_of, 'birthDateExact', p_dob_exact,
                            'requirements', v_out, 'summary', v_summary, 'unresolvedHistory', v_unresolved);
end $$;

-- Runs the version's stored fixtures; used as an approval gate (BP16, BP38 P36).
create function private.run_fixtures(p_version uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f record; v_res jsonb; v_out jsonb := '[]'::jsonb; v_pass boolean; v_diff jsonb; e record;
begin
  for f in select * from public.schedule_fixtures where schedule_version_id = p_version order by name loop
    v_res := private.evaluate_rules(p_version, f.dob, true, f.doses, '[]'::jsonb, f.as_of);
    v_diff := '[]'::jsonb;
    for e in select key, value from jsonb_each_text(f.expected) loop
      if coalesce((select x ->> 'status' from jsonb_array_elements(v_res -> 'requirements') x where x ->> 'requirement' = e.key), '(missing)') <> e.value then
        v_diff := v_diff || jsonb_build_object('requirement', e.key, 'expected', e.value,
          'actual', coalesce((select x ->> 'status' from jsonb_array_elements(v_res -> 'requirements') x where x ->> 'requirement' = e.key), '(missing)'));
      end if;
    end loop;
    v_pass := jsonb_array_length(v_diff) = 0;
    v_out := v_out || jsonb_build_object('name', f.name, 'passed', v_pass, 'differences', v_diff);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Gathering child inputs and evaluating
-- ---------------------------------------------------------------------------------------------
create function private.local_today(p_clinic uuid) returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select c.timezone from public.clinics c where c.id = p_clinic), 'Asia/Manila'))::date
$$;

-- The child plus any records merged into it (aliases), bounded depth.
create function private.child_ids_with_aliases(p_child uuid) returns setof uuid language sql stable security definer set search_path = '' as $$
  with recursive t(id, depth) as (
    select p_child, 0
    union
    select c.id, t.depth + 1 from public.children c join t on c.merged_into_id = t.id where t.depth < 5
  ) select id from t
$$;

create function private.child_eval_inputs(p_child uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
     and cr.event_status = 'active' and cr.verification_status = 'verified';
  select coalesce(jsonb_agg(jsonb_build_object('ruleId', h.rule_id, 'reason', h.reason_code)), '[]'::jsonb) into v_holds
    from public.clinical_holds h where h.child_id = p_child and h.status = 'active';
  -- Unverified/pending evidence is counted for staff visibility but NEVER credited (T09).
  select count(*) into v_pending from private.current_revisions cr
   where cr.child_id in (select private.child_ids_with_aliases(p_child)) and cr.event_status = 'active' and cr.verification_status = 'pending_verification';
  return jsonb_build_object('dob', v_dob, 'dobExact', v_prec = 'exact' and v_dob is not null, 'doses', v_doses, 'holds', v_holds, 'pendingEvidence', v_pending);
end $$;

-- Which approved, active version applies to a child on a date. Cohort predicate supports only dobFrom/dobTo.
create function private.active_schedule_for(p_org uuid, p_program text, p_dob date, p_as_of date) returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from public.schedule_versions v
   -- Retired versions still govern dates inside their own effective window (e.g. superseded but not yet ended).
   where v.organization_id = p_org and v.program_code = p_program and v.status in ('active','retired')
     and v.effective_from is not null and v.effective_from <= p_as_of and (v.effective_to is null or v.effective_to >= p_as_of)
     and (v.cohort_predicate ->> 'dobFrom' is null or (p_dob is not null and p_dob >= (v.cohort_predicate ->> 'dobFrom')::date))
     and (v.cohort_predicate ->> 'dobTo' is null or (p_dob is not null and p_dob <= (v.cohort_predicate ->> 'dobTo')::date))
   order by v.effective_from desc nulls last limit 1
$$;

-- Computes (and optionally persists) the child's evaluation. Returns {status:'no_active_schedule'} when nothing is approved.
create function private.compute_child_schedule(p_child uuid, p_as_of date, p_persist boolean, p_program text default 'routine') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.children; v_ver uuid; v_in jsonb; v_res jsonb; v_hash text; v_eval uuid; sv public.schedule_versions; x jsonb; rr jsonb; v_dose jsonb;
begin
  select * into c from public.children where id = p_child;
  v_in := private.child_eval_inputs(p_child);
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
                                                          'version', v_ver, 'engine', 'plpgsql-1')::text, 'UTF8')), 'hex');
    insert into public.schedule_evaluations (organization_id, child_id, schedule_version_id, as_of_date, engine_version, input_hash, result, created_by)
    values (c.organization_id, p_child, v_ver, p_as_of, 'plpgsql-1', v_hash, v_res, auth.uid())
    on conflict (child_id, schedule_version_id, as_of_date, engine_version, input_hash) do nothing returning id into v_eval;
    if v_eval is null then
      select id into v_eval from public.schedule_evaluations
       where child_id = p_child and schedule_version_id = v_ver and as_of_date = p_as_of and engine_version = 'plpgsql-1' and input_hash = v_hash;
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
      -- Keep the child pointed at the version in force (old evaluations keep their own version reference).
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

-- Staff: evaluate and persist a pinned snapshot for a child in their clinic.
create function public.evaluate_child(p_clinic_id uuid, p_child_id uuid, p_as_of date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_canon uuid; v_res jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then
    perform private.audit(v_org, 'child.read_clinical', 'schedule.evaluate', 'child', p_child_id, null, null, null, 'denied');
    return null;
  end if;
  v_res := private.compute_child_schedule(v_canon, coalesce(p_as_of, private.local_today(p_clinic_id)), true);
  perform private.audit(v_org, 'child.read_clinical', 'schedule.evaluate', 'child', v_canon, null,
                        jsonb_build_object('status', v_res ->> 'status', 'evaluationId', v_res ->> 'evaluationId'), null);
  return v_res;
end $$;

-- Guardian with verified full access: computed for today, not persisted, limited projection (no internal reasons).
create function public.guardian_get_schedule(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid; v_res jsonb; v_clinic uuid; v_today date;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  select clinic_id into v_clinic from public.child_clinic_enrollments where child_id = v_canon and status in ('pending','active') order by is_primary desc, created_at limit 1;
  v_today := private.local_today(v_clinic);
  v_res := private.compute_child_schedule(v_canon, v_today, false);
  if v_res ->> 'status' <> 'evaluated' then return v_res; end if;
  return jsonb_build_object('status', 'evaluated', 'asOf', v_today, 'versionLabel', v_res ->> 'versionLabel', 'isDemo', (v_res ->> 'isDemo')::boolean,
    'pendingEvidence', v_res -> 'pendingEvidence',
    'requirements', (select coalesce(jsonb_agg(jsonb_build_object(
        'requirement', x ->> 'requirement', 'status', x ->> 'status', 'targetOn', x -> 'targetOn', 'recommendedOn', x -> 'recommendedOn',
        'windowStart', x -> 'windowStart', 'windowEnd', x -> 'windowEnd', 'creditedOn', x -> 'creditedOn') order by (x ->> 'ordinal')::int), '[]'::jsonb)
       from jsonb_array_elements(v_res -> 'requirements') x));
end $$;

revoke all on function public.evaluate_child(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.guardian_get_schedule(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_child(uuid, uuid, date) to authenticated;
grant execute on function public.guardian_get_schedule(uuid) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
