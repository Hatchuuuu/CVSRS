-- 0015 Atomic administration recording, exception intake for already-given care, corrections and lot tracing.
-- Blueprint refs: BP18, BP19 (corrections vs physical stock), BP15.E, F09, F05, F15, T03-T08, T13-T16.
--
-- One normal recording = ONE transaction: identity + encounter + lot/stock + timing checks -> event + signed revision ->
-- stock issue -> encounter refs -> pinned schedule evaluation -> outbox -> audit -> receipt. Any failure rolls all of it back
-- (no partial clinical save). Actual care that fails the normal checks is never lost: it goes through the exception path.

alter table public.vaccination_revisions drop constraint vaccination_revisions_source_check;
alter table public.vaccination_revisions add constraint vaccination_revisions_source_check
  check (source in ('clinic_administered','clinic_exception','paper_reconciliation','external_documented','parent_reported','bhw_reported','historical_import'));

-- Capability check for ANOTHER profile (e.g. "vaccinated by" someone other than the signed-in recorder).
create function private.profile_has_cap(p_profile uuid, p_clinic uuid, p_cap text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_memberships m
      join public.clinics c on c.id = m.clinic_id and c.organization_id = m.organization_id
      join public.profiles p on p.id = m.profile_id and p.status = 'active'
     where m.profile_id = p_profile and m.clinic_id = p_clinic and m.status = 'active' and c.status = 'active'
       and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
       and (p_cap = any (private.role_preset(m.role_code)) or p_cap = any (m.capabilities)))
$$;

-- Would this dose, given on p_on, satisfy the approved schedule? Never an override: blocks are explained, exceptions use another path.
create function private.check_planned_dose(p_child uuid, p_product uuid, p_on date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.children; v_ver uuid; v_in jsonb; v_codes jsonb; v_pcode text; v_res jsonb; v_credited jsonb; v_flagged jsonb; v_blocking jsonb := '[]'::jsonb;
begin
  select * into c from public.children where id = p_child;
  v_ver := private.active_schedule_for(c.organization_id, 'routine', c.dob, p_on);
  if v_ver is null then return jsonb_build_object('evaluated', false, 'blocked', false, 'credited', '[]'::jsonb, 'reasons', '[]'::jsonb); end if;
  v_in := private.child_eval_inputs(p_child);
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

create function private.reasons_text(p jsonb) returns text language sql immutable set search_path = '' as $$
  select coalesce(string_agg(case when jsonb_typeof(r) = 'string' then trim(both '"' from r::text) else (r ->> 'requirement') || ': ' || (r ->> 'reason') end, '; '), '')
    from jsonb_array_elements(p) r
$$;

create function public.get_open_encounter(p_clinic_id uuid, p_child_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_canon uuid; e public.encounters;
begin
  perform private.require_any(p_clinic_id, array['vaccination.record','queue.manage','child.read_clinical']);
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  select * into e from public.encounters where child_id = v_canon and clinic_id = p_clinic_id and status = 'open' order by started_at desc nulls last limit 1;
  if not found then return null; end if;
  return jsonb_build_object('encounterId', e.id, 'serviceDate', e.service_date, 'startedAt', e.started_at, 'assessmentReference', e.assessment_reference, 'consentReference', e.consent_reference,
                            'administrations', (select count(*) from public.vaccination_events v where v.encounter_id = e.id));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Normal (planned) administration
-- ---------------------------------------------------------------------------------------------
create function public.record_administration(p_operation_key uuid, p_clinic_id uuid, p_encounter_id uuid, p_admin jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_tz text; v_prev jsonb; enc public.encounters; v_child uuid; c public.children; v_by uuid; v_at timestamptz; v_on date;
  v_lot public.vaccine_lots; v_prod public.vaccine_products; v_loc uuid; v_doses numeric; v_check jsonb; v_event uuid; v_rev uuid; v_tx uuid;
  v_route text; v_site text; v_res jsonb; v_credited jsonb; v_eval uuid; v_confirm boolean;
begin
  select organization_id, timezone into v_org, v_tz from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  -- Lock the encounter first (consistent order: encounter -> stock row), serialising concurrent recording for one visit.
  select * into enc from public.encounters where id = p_encounter_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_child := private.canonical_child(enc.child_id);
  if not private.child_in_clinic(v_child, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'vaccination.record', jsonb_build_object('c', p_clinic_id, 'enc', p_encounter_id, 'a', p_admin));
  if v_prev is not null then return v_prev; end if;
  if enc.status <> 'open' then raise exception 'the visit is not open' using errcode = 'CV409'; end if;
  select * into c from public.children where id = v_child;
  if c.record_status <> 'active' then raise exception 'confirm the child''s identity before recording care' using errcode = 'CV409'; end if;
  if p_admin is null or jsonb_typeof(p_admin) <> 'object' then raise exception 'administration details required' using errcode = 'CV400'; end if;

  begin
    v_by := coalesce(nullif(p_admin ->> 'administeredBy', '')::uuid, auth.uid());
    v_at := coalesce(nullif(p_admin ->> 'administeredAt', '')::timestamptz, now());
    v_loc := (p_admin ->> 'locationId')::uuid;
    v_doses := coalesce(nullif(p_admin ->> 'doses', '')::numeric, 1);
    v_confirm := coalesce((p_admin ->> 'confirmRepeat')::boolean, false);
    select * into v_lot from public.vaccine_lots where id = (p_admin ->> 'lotId')::uuid and organization_id = v_org;
  exception when others then raise exception 'administration details are invalid' using errcode = 'CV422';
  end;
  if v_lot.id is null or v_loc is null then raise exception 'choose the lot and stock location used' using errcode = 'CV422'; end if;
  select * into v_prod from public.vaccine_products where id = v_lot.product_id;
  if nullif(p_admin ->> 'productId', '') is not null and (p_admin ->> 'productId')::uuid <> v_prod.id then raise exception 'the lot belongs to a different product' using errcode = 'CV422'; end if;
  if v_by <> auth.uid() and not private.profile_has_cap(v_by, p_clinic_id, 'vaccination.record') then raise exception 'the named vaccinator is not authorised to vaccinate at this clinic' using errcode = 'CV422'; end if;
  if v_doses <> 1 then raise exception 'record one administration at a time (single-dose presentations)' using errcode = 'CV422'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'the administration time cannot be in the future' using errcode = 'CV422'; end if;
  v_on := (v_at at time zone v_tz)::date;
  v_route := nullif(left(btrim(coalesce(p_admin ->> 'route', '')), 40), '');
  v_site := nullif(left(btrim(coalesce(p_admin ->> 'site', '')), 40), '');

  -- Possible duplicate: same child + product + local date. A genuine repeat is allowed only when explicitly confirmed (BP39);
  -- it must then still satisfy the schedule below, otherwise it goes through the exception path (facts preserved, no credit).
  if not v_confirm and exists (
      select 1 from private.current_revisions cr where cr.child_id in (select private.child_ids_with_aliases(v_child)) and cr.product_id = v_prod.id
         and cr.event_status = 'active' and cr.verification_status <> 'rejected' and cr.administered_on = v_on) then
    raise exception 'a similar administration already exists for this child today; confirm only if this is a genuine repeat' using errcode = 'CV409';
  end if;
  -- Timing/eligibility per the APPROVED schedule (planned path). Explained, never silently overridden.
  v_check := private.check_planned_dose(v_child, v_prod.id, v_on);
  if (v_check ->> 'blocked')::boolean then
    raise exception 'not allowed by the approved schedule (%). If the vaccine was already given, use "record care already given".', private.reasons_text(v_check -> 'reasons') using errcode = 'CV422';
  end if;

  insert into public.vaccination_events (organization_id, original_child_id, encounter_id, origin, source_operation_id, created_by)
  values (v_org, v_child, enc.id, 'clinic_administered', p_operation_key, auth.uid()) returning id into v_event;
  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, administered_on, administered_at, date_precision, lot_id, expiry_snapshot,
                                             quantity, unit, route, site, administered_by, clinic_id, source, verification_status, signed_at, created_by)
  values (v_org, v_event, 1, v_child, v_prod.id, v_on, v_at, 'exact', v_lot.id, v_lot.expires_on, 1, 'dose', v_route, v_site, v_by, p_clinic_id, 'clinic_administered', 'verified', now(), auth.uid())
  returning id into v_rev;

  -- Stock in the SAME transaction: exactly one physical issue. Failure here rolls the clinical record back too (T04).
  v_tx := private.issue_for_administration(v_org, p_clinic_id, v_loc, v_lot.id, v_doses, v_event, p_operation_key);

  update public.encounters set assessment_reference = coalesce(nullif(left(btrim(coalesce(p_admin ->> 'assessmentReference', '')), 200), ''), assessment_reference),
         consent_reference = coalesce(nullif(left(btrim(coalesce(p_admin ->> 'consentReference', '')), 200), ''), consent_reference), updated_by = auth.uid() where id = enc.id;

  v_res := private.compute_child_schedule(v_child, private.local_today(p_clinic_id), true);
  v_eval := nullif(v_res ->> 'evaluationId', '')::uuid;
  select coalesce(jsonb_agg(x ->> 'requirement'), '[]'::jsonb) into v_credited from jsonb_array_elements(coalesce(v_res -> 'requirements', '[]'::jsonb)) x where x ->> 'creditedDoseId' = v_rev::text;

  perform private.enqueue(v_org, 'vaccination.recorded', 'vaccination_event', v_event, 'vax-recorded:' || v_event, jsonb_build_object('childId', v_child, 'clinicId', p_clinic_id));
  perform private.audit(v_org, 'vaccination.record', 'vaccination.recorded', 'vaccination_event', v_event, null,
                        jsonb_build_object('child', v_child, 'product', v_prod.code, 'lot', v_lot.manufacturer_lot, 'on', v_on, 'credited', v_credited, 'stockTransaction', v_tx), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', v_event, 'revisionId', v_rev, 'stockTransactionId', v_tx, 'evaluationId', v_eval,
      'creditedRequirements', v_credited, 'scheduleEvaluated', coalesce((v_check ->> 'evaluated')::boolean, false), 'administeredOn', v_on));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Exception intake: care ALREADY GIVEN that fails the normal checks. Facts preserved, credit withheld, stock never invented.
-- ---------------------------------------------------------------------------------------------
create function public.record_administration_exception(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_encounter_id uuid, p_admin jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_tz text; v_prev jsonb; v_child uuid; v_by uuid; v_at timestamptz; v_on date; v_lot public.vaccine_lots; v_prod public.vaccine_products; v_loc uuid;
  v_event uuid; v_rev uuid; v_case uuid; v_tx uuid; v_problems text[] := '{}'; v_check jsonb; v_stock_case uuid; v_text text; v_product_id uuid;
begin
  select organization_id, timezone into v_org, v_tz from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_child := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_child, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'explain why this could not be recorded normally' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'vaccination.exception', jsonb_build_object('c', p_clinic_id, 'child', p_child_id, 'enc', p_encounter_id, 'a', p_admin, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if p_encounter_id is not null and not exists (select 1 from public.encounters where id = p_encounter_id and clinic_id = p_clinic_id and child_id = v_child) then raise exception 'not found' using errcode = 'CV404'; end if;
  begin
    v_by := coalesce(nullif(p_admin ->> 'administeredBy', '')::uuid, auth.uid());
    v_at := (p_admin ->> 'administeredAt')::timestamptz;
    v_loc := nullif(p_admin ->> 'locationId', '')::uuid;
    v_product_id := nullif(p_admin ->> 'productId', '')::uuid;
    if nullif(p_admin ->> 'lotId', '') is not null then select * into v_lot from public.vaccine_lots where id = (p_admin ->> 'lotId')::uuid and organization_id = v_org; end if;
  exception when others then raise exception 'details are invalid' using errcode = 'CV422';
  end;
  v_text := nullif(left(btrim(coalesce(p_admin ->> 'productText', '')), 200), '');
  if v_at is null then raise exception 'the actual administration time is required' using errcode = 'CV422'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'the administration time cannot be in the future' using errcode = 'CV422'; end if;
  if v_lot.id is not null then v_product_id := v_lot.product_id; end if;
  if v_product_id is null and v_text is null then raise exception 'identify the vaccine (product or a description)' using errcode = 'CV422'; end if;
  if v_product_id is not null then select * into v_prod from public.vaccine_products where id = v_product_id and organization_id = v_org; if v_prod.id is null then raise exception 'unknown product' using errcode = 'CV422'; end if; end if;
  v_on := (v_at at time zone v_tz)::date;

  -- Why would the normal path have refused? (for the reviewer; none of these blocks the record)
  if v_prod.id is null then v_problems := array_append(v_problems, 'product_not_mapped'); end if;
  if v_lot.id is null then v_problems := array_append(v_problems, 'lot_unknown');
  elsif v_lot.global_disposition <> 'usable' then v_problems := array_append(v_problems, 'lot_' || v_lot.global_disposition);
  elsif private.lot_is_expired(v_lot.expires_on, v_on) then v_problems := array_append(v_problems, 'lot_expired'); end if;
  if v_prod.id is not null then
    v_check := private.check_planned_dose(v_child, v_prod.id, v_on);
    if (v_check ->> 'blocked')::boolean then v_problems := array_append(v_problems, 'timing_or_eligibility: ' || private.reasons_text(v_check -> 'reasons')); end if;
  end if;

  insert into public.vaccination_events (organization_id, original_child_id, encounter_id, origin, source_operation_id, created_by)
  values (v_org, v_child, p_encounter_id, 'clinic_administered', p_operation_key, auth.uid()) returning id into v_event;
  -- Pending verification: the engine credits only verified revisions, so no credit is possible until a reviewer accepts it.
  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, reported_product_text, administered_on, administered_at, date_precision, lot_id, reported_lot, expiry_snapshot,
                                             quantity, unit, route, site, administered_by, clinic_id, source, verification_status, reason, created_by)
  values (v_org, v_event, 1, v_child, v_prod.id, coalesce(v_text, v_prod.name), v_on, v_at, 'exact', v_lot.id, nullif(left(btrim(coalesce(p_admin ->> 'lotText', '')), 100), ''), v_lot.expires_on,
          1, 'dose', nullif(left(btrim(coalesce(p_admin ->> 'route', '')), 40), ''), nullif(left(btrim(coalesce(p_admin ->> 'site', '')), 40), ''), v_by, p_clinic_id, 'clinic_exception', 'pending_verification', p_reason, auth.uid())
  returning id into v_rev;

  -- Stock: post the issue ONLY if the lot is known, usable and stocked. Otherwise open a reconciliation item; never fake a lot or go negative.
  if v_lot.id is not null and v_loc is not null and v_prod.doses_per_container = 1 and not exists (select 1 from unnest(v_problems) pr where pr like 'lot_%' or pr = 'product_not_mapped') then
    begin
      v_tx := private.issue_for_administration(v_org, p_clinic_id, v_loc, v_lot.id, 1, v_event, p_operation_key);
    exception when others then
      v_problems := array_append(v_problems, 'stock_unavailable');
    end;
  else
    v_problems := array_append(v_problems, 'stock_not_posted');
  end if;
  if v_tx is null then
    insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, vaccination_event_id, reason, evidence, created_by, updated_by)
    values (v_org, p_clinic_id, 'stock', v_child, v_event, 'care was given but no stock issue could be posted; reconcile the lot and quantity',
            jsonb_build_object('eventId', v_event, 'lotId', v_lot.id, 'reportedLot', p_admin ->> 'lotText', 'problems', to_jsonb(v_problems)), auth.uid(), auth.uid()) returning id into v_stock_case;
  end if;
  insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, vaccination_event_id, reason, evidence, created_by, updated_by)
  values (v_org, p_clinic_id, 'clinical', v_child, v_event, left('administration recorded as an exception: ' || p_reason, 500),
          jsonb_build_object('problems', to_jsonb(v_problems), 'exception', true, 'stockPosted', v_tx is not null, 'stockCaseId', v_stock_case), auth.uid(), auth.uid()) returning id into v_case;
  perform private.audit(v_org, 'vaccination.record', 'vaccination.exception_recorded', 'vaccination_event', v_event, null,
                        jsonb_build_object('child', v_child, 'problems', to_jsonb(v_problems), 'stockPosted', v_tx is not null), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', v_event, 'revisionId', v_rev, 'reviewCaseId', v_case, 'stockPosted', v_tx is not null, 'problems', to_jsonb(v_problems),
                                'verificationStatus', 'pending_verification', 'credited', false));
end $$;

-- A clinical lead accepts or rejects an exception. Acceptance creates revision N+1 (verified); credit still follows the engine's rules.
create function public.resolve_administration_exception(p_operation_key uuid, p_clinic_id uuid, p_event_id uuid, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; cur public.vaccination_revisions; v_status text; v_eval jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'correction.approve');
  if p_decision not in ('accept','reject') or p_note is null or length(btrim(p_note)) < 3 then raise exception 'decision and note are required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'vaccination.exception_resolve', jsonb_build_object('c', p_clinic_id, 'e', p_event_id, 'd', p_decision, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  perform 1 from public.vaccination_events where id = p_event_id and organization_id = v_org for update;
  select * into cur from private.current_revisions where event_id = p_event_id;
  if cur.id is null or cur.source <> 'clinic_exception' or not private.child_in_clinic(private.canonical_child(cur.child_id), p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if cur.verification_status <> 'pending_verification' then raise exception 'already decided' using errcode = 'CV409'; end if;
  if cur.created_by = auth.uid() then raise exception 'the recorder cannot approve their own exception' using errcode = 'CV403'; end if;
  v_status := case when p_decision = 'accept' then 'verified' else 'rejected' end;
  if v_status = 'verified' and cur.product_id is null then raise exception 'map the exception to an approved product before accepting (edit via correction)' using errcode = 'CV422'; end if;
  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, reported_product_text, administered_on, administered_at, date_precision, lot_id, reported_lot, expiry_snapshot,
                                             quantity, unit, route, site, administered_by, clinic_id, source, verification_status, event_status, approved_by, signed_at, reason, created_by)
  values (v_org, cur.event_id, cur.revision_no + 1, cur.child_id, cur.product_id, cur.reported_product_text, cur.administered_on, cur.administered_at, cur.date_precision, cur.lot_id, cur.reported_lot, cur.expiry_snapshot,
          cur.quantity, cur.unit, cur.route, cur.site, cur.administered_by, cur.clinic_id, 'clinic_exception', v_status, case when v_status = 'rejected' then 'voided' else 'active' end, auth.uid(), now(), p_note, auth.uid());
  update public.record_review_cases set status = case when v_status = 'verified' then 'resolved' else 'rejected' end, resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', p_decision, 'note', p_note) where vaccination_event_id = cur.event_id and kind = 'clinical' and status in ('open','in_review');
  v_eval := private.compute_child_schedule(private.canonical_child(cur.child_id), private.local_today(p_clinic_id), true);
  perform private.audit(v_org, 'correction.approve', 'vaccination.exception_' || p_decision, 'vaccination_event', cur.event_id, jsonb_build_object('status', cur.verification_status), jsonb_build_object('status', v_status), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', cur.event_id, 'verificationStatus', v_status, 'revisionNo', cur.revision_no + 1, 'evaluationId', v_eval ->> 'evaluationId'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Corrections: propose (clinical staff) -> approve (different person with correction.approve)
-- ---------------------------------------------------------------------------------------------
create function public.request_correction(p_operation_key uuid, p_clinic_id uuid, p_event_id uuid, p_kind text, p_proposal jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; cur public.vaccination_revisions; v_case uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  if p_kind not in ('correct_details','reattribute_child','void_duplicate') then raise exception 'invalid correction type' using errcode = 'CV422'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'correction.request', jsonb_build_object('c', p_clinic_id, 'e', p_event_id, 'k', p_kind, 'p', p_proposal, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into cur from private.current_revisions where event_id = p_event_id and organization_id = v_org;
  if cur.id is null or not private.child_in_clinic(private.canonical_child(cur.child_id), p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if cur.event_status <> 'active' then raise exception 'this record is already voided' using errcode = 'CV409'; end if;
  if exists (select 1 from public.record_review_cases where vaccination_event_id = p_event_id and kind = 'correction' and status in ('open','in_review')) then raise exception 'a correction for this record is already waiting for review' using errcode = 'CV409'; end if;
  if p_kind = 'reattribute_child' and (nullif(p_proposal ->> 'toChildId', '') is null) then raise exception 'name the correct child' using errcode = 'CV422'; end if;
  if p_kind = 'void_duplicate' and coalesce(p_proposal ->> 'stockEffect', '') not in ('return_to_stock','wastage','none') then raise exception 'state what happened to the vaccine (return_to_stock, wastage or none)' using errcode = 'CV422'; end if;
  insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, vaccination_event_id, reason, evidence, created_by, updated_by)
  values (v_org, p_clinic_id, 'correction', cur.child_id, p_event_id, left(p_reason, 500), jsonb_build_object('kind', p_kind, 'proposal', p_proposal, 'baseRevision', cur.revision_no), auth.uid(), auth.uid()) returning id into v_case;
  perform private.audit(v_org, 'vaccination.record', 'correction.requested', 'vaccination_event', p_event_id, null, jsonb_build_object('kind', p_kind, 'caseId', v_case), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('caseId', v_case, 'status', 'open'));
end $$;

create function public.approve_correction(p_operation_key uuid, p_clinic_id uuid, p_case_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_prev jsonb; k public.record_review_cases; cur public.vaccination_revisions; v_kind text; v_prop jsonb; v_new_lot uuid; v_new_loc uuid; v_old_tx public.stock_transactions; v_old_mv public.stock_movements;
  v_lot public.vaccine_lots; v_child uuid := null; v_tx uuid; v_rev uuid; v_on date; v_at timestamptz; v_route text; v_site text; v_status text; v_stock jsonb := '[]'::jsonb; v_tz text; v_eval1 jsonb; v_eval2 jsonb;
  v_prod uuid; v_effect text; v_new_child uuid; v_ev_status text;
begin
  select organization_id, timezone into v_org, v_tz from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'correction.approve');
  select * into k from public.record_review_cases where id = p_case_id and organization_id = v_org and clinic_id = p_clinic_id and kind = 'correction' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'correction.approve', jsonb_build_object('c', p_clinic_id, 'case', p_case_id, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if k.status not in ('open','in_review') then raise exception 'already decided' using errcode = 'CV409'; end if;
  if k.created_by = auth.uid() then raise exception 'the proposer cannot approve their own correction' using errcode = 'CV403'; end if;
  perform 1 from public.vaccination_events where id = k.vaccination_event_id for update;
  select * into cur from private.current_revisions where event_id = k.vaccination_event_id;
  if cur.revision_no <> (k.evidence ->> 'baseRevision')::int then raise exception 'the record changed since this correction was requested; request it again' using errcode = 'CV409'; end if;
  v_kind := k.evidence ->> 'kind'; v_prop := k.evidence -> 'proposal';
  v_on := cur.administered_on; v_at := cur.administered_at; v_route := cur.route; v_site := cur.site; v_prod := cur.product_id; v_new_lot := cur.lot_id; v_status := cur.verification_status; v_ev_status := cur.event_status;
  v_new_child := cur.child_id;

  if v_kind = 'correct_details' then
    if nullif(v_prop ->> 'administeredAt', '') is not null then v_at := (v_prop ->> 'administeredAt')::timestamptz; v_on := (v_at at time zone v_tz)::date; end if;
    if v_at > now() + interval '5 minutes' then raise exception 'the administration time cannot be in the future' using errcode = 'CV422'; end if;
    if v_prop ? 'route' then v_route := nullif(left(btrim(v_prop ->> 'route'), 40), ''); end if;
    if v_prop ? 'site' then v_site := nullif(left(btrim(v_prop ->> 'site'), 40), ''); end if;
    if nullif(v_prop ->> 'lotId', '') is not null and (v_prop ->> 'lotId')::uuid <> cur.lot_id then
      -- The physical fact changed (a different vial was used): compensate the ledger, do not rewrite it (BP19).
      select * into v_lot from public.vaccine_lots where id = (v_prop ->> 'lotId')::uuid and organization_id = v_org;
      if v_lot.id is null then raise exception 'unknown lot' using errcode = 'CV422'; end if;
      v_new_loc := nullif(v_prop ->> 'locationId', '')::uuid;
      if v_new_loc is null then raise exception 'name the stock location of the correct lot' using errcode = 'CV422'; end if;
      select t.* into v_old_tx from public.stock_transactions t where t.event_id = cur.event_id and t.type = 'issue_administration' order by t.created_at limit 1;
      if v_old_tx.id is not null then
        select m.* into v_old_mv from public.stock_movements m where m.transaction_id = v_old_tx.id limit 1;
        insert into public.stock_transactions (organization_id, clinic_id, type, event_id, reason, approved_by, operation_id, reverses_id, created_by)
        values (v_org, p_clinic_id, 'reversal', cur.event_id, 'correction: wrong lot recorded', auth.uid(), p_operation_key, v_old_tx.id, auth.uid()) returning id into v_tx;
        perform private.post_movement(v_org, v_tx, v_old_mv.location_id, v_old_mv.lot_id, -v_old_mv.quantity_delta, 'corr-rev:' || p_operation_key);
        v_stock := v_stock || jsonb_build_object('reversed', v_old_tx.id);
      end if;
      v_tx := private.issue_for_administration(v_org, p_clinic_id, v_new_loc, v_lot.id, 1, cur.event_id, p_operation_key); -- refuses if the correct lot cannot supply it
      v_stock := v_stock || jsonb_build_object('issued', v_tx);
      v_new_lot := v_lot.id; v_prod := v_lot.product_id;
    end if;
  elsif v_kind = 'reattribute_child' then
    v_new_child := private.canonical_child((v_prop ->> 'toChildId')::uuid);
    if not private.child_in_clinic(v_new_child, p_clinic_id) or v_new_child = cur.child_id then raise exception 'the correct child must be a different child enrolled at this clinic' using errcode = 'CV422'; end if;
  else -- void_duplicate
    v_effect := v_prop ->> 'stockEffect';
    v_ev_status := 'voided';
    select t.* into v_old_tx from public.stock_transactions t where t.event_id = cur.event_id and t.type = 'issue_administration' order by t.created_at limit 1;
    if v_old_tx.id is not null and v_effect in ('return_to_stock','wastage') then
      select m.* into v_old_mv from public.stock_movements m where m.transaction_id = v_old_tx.id limit 1;
      insert into public.stock_transactions (organization_id, clinic_id, type, event_id, reason, approved_by, operation_id, reverses_id, created_by)
      values (v_org, p_clinic_id, 'reversal', cur.event_id, 'correction: duplicate record voided', auth.uid(), p_operation_key, v_old_tx.id, auth.uid()) returning id into v_tx;
      perform private.post_movement(v_org, v_tx, v_old_mv.location_id, v_old_mv.lot_id, -v_old_mv.quantity_delta, 'void-rev:' || p_operation_key);
      v_stock := v_stock || jsonb_build_object('reversed', v_old_tx.id);
      if v_effect = 'wastage' then
        -- The vial was physically used or spoiled: it is NOT returned to usable stock, it is reclassified as wastage.
        insert into public.stock_transactions (organization_id, clinic_id, type, event_id, reason, approved_by, operation_id, created_by)
        values (v_org, p_clinic_id, 'wastage', cur.event_id, 'duplicate record: dose physically lost', auth.uid(), p_operation_key, auth.uid()) returning id into v_tx;
        perform private.post_movement(v_org, v_tx, v_old_mv.location_id, v_old_mv.lot_id, v_old_mv.quantity_delta, 'void-waste:' || p_operation_key);
        v_stock := v_stock || jsonb_build_object('wastage', v_tx);
      end if;
    end if;
  end if;

  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, reported_product_text, administered_on, administered_at, date_precision, lot_id, reported_lot, expiry_snapshot,
                                             quantity, unit, route, site, administered_by, external_vaccinator, clinic_id, source, verification_status, event_status, approved_by, signed_at, reason, created_by)
  values (v_org, cur.event_id, cur.revision_no + 1, v_new_child, v_prod, cur.reported_product_text, v_on, v_at, cur.date_precision, v_new_lot,
          cur.reported_lot, coalesce((select expires_on from public.vaccine_lots where id = v_new_lot), cur.expiry_snapshot), cur.quantity, cur.unit, v_route, v_site, cur.administered_by, cur.external_vaccinator, cur.clinic_id,
          cur.source, cur.verification_status, v_ev_status, auth.uid(), now(), coalesce(p_note, k.reason), auth.uid()) returning id into v_rev;

  update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'approved', 'newRevision', cur.revision_no + 1, 'stock', v_stock, 'note', p_note) where id = k.id;
  -- Recalculate downstream credit for every child whose facts changed (T16); certificates are reviewed in the certificate module.
  v_eval1 := private.compute_child_schedule(private.canonical_child(cur.child_id), private.local_today(p_clinic_id), true);
  if v_new_child <> cur.child_id then v_eval2 := private.compute_child_schedule(v_new_child, private.local_today(p_clinic_id), true); end if;
  perform private.enqueue(v_org, 'certificate.review', 'vaccination_event', cur.event_id, 'cert-review:' || v_rev::text, jsonb_build_object('event', cur.event_id, 'revision', cur.revision_no + 1));
  perform private.audit(v_org, 'correction.approve', 'correction.approved', 'vaccination_event', cur.event_id,
                        jsonb_build_object('revision', cur.revision_no, 'lot', cur.lot_id, 'child', cur.child_id), jsonb_build_object('revision', cur.revision_no + 1, 'lot', v_new_lot, 'child', v_new_child, 'kind', v_kind, 'stock', v_stock), coalesce(p_note, k.reason));
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', cur.event_id, 'revisionNo', cur.revision_no + 1, 'kind', v_kind, 'stock', v_stock));
end $$;


create function public.reject_correction(p_operation_key uuid, p_clinic_id uuid, p_case_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; k public.record_review_cases;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'correction.approve');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  select * into k from public.record_review_cases where id = p_case_id and organization_id = v_org and clinic_id = p_clinic_id and kind = 'correction' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'correction.reject', jsonb_build_object('c', p_clinic_id, 'case', p_case_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if k.status not in ('open','in_review') then raise exception 'already decided' using errcode = 'CV409'; end if;
  update public.record_review_cases set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(), resolution = jsonb_build_object('decision', 'rejected', 'reason', p_reason) where id = k.id;
  perform private.audit(v_org, 'correction.approve', 'correction.rejected', 'vaccination_event', k.vaccination_event_id, null, null, p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('caseId', k.id, 'status', 'rejected'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Lot tracing (F15): which children received doses from a lot. Restricted, identifiable, audited.
-- ---------------------------------------------------------------------------------------------
create function public.trace_lot_use(p_clinic_id uuid, p_lot_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_res jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'inventory.approve');
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  select coalesce(jsonb_agg(jsonb_build_object('eventId', cr.event_id, 'childId', c.id, 'childName', c.display_name, 'recordNo', c.local_record_no, 'administeredOn', cr.administered_on,
      'status', cr.verification_status, 'eventStatus', cr.event_status, 'source', cr.source, 'revisionNo', cr.revision_no, 'clinicId', cr.clinic_id) order by cr.administered_on, c.display_name), '[]'::jsonb) into v_res
    from private.current_revisions cr join public.children c on c.id = private.canonical_child(cr.child_id)
   where cr.lot_id = p_lot_id and cr.organization_id = v_org;
  perform private.audit(v_org, 'inventory.approve', 'lot.traced', 'vaccine_lot', p_lot_id, null, jsonb_build_object('records', jsonb_array_length(v_res)), null);
  return v_res;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'get_open_encounter(uuid,uuid)', 'record_administration(uuid,uuid,uuid,jsonb)', 'record_administration_exception(uuid,uuid,uuid,uuid,jsonb,text)',
    'resolve_administration_exception(uuid,uuid,uuid,text,text)', 'request_correction(uuid,uuid,uuid,text,jsonb,text)', 'approve_correction(uuid,uuid,uuid,text)',
    'reject_correction(uuid,uuid,uuid,text)', 'trace_lot_use(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
