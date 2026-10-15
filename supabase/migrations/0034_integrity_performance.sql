-- 0034: integrity, isolation and performance fixes from the 2026-10 audit (docs/engineering/discovery/*.md).
--   DB-01  clinical holds survive a duplicate merge (alias-aware readers, re-point on merge, backfill)
--   SEC-05 merge_children resolves both records inside the caller's organization and clinic before locking or inspecting them
--   DB-02  child-scoped readers select revisions by the child's own events instead of the whole-table view; supporting indexes
--   FE-01  approve_stock_adjustment approves count proposals only
--   DB-03  privacy acknowledgements bind clinic + version + SHA-256 of the notice text; acknowledging creates no guardian row
--   DB-04  lot traces and audit search are limited to the caller's clinic (restrictive, reversible default)
--   DB-05  five commands raise CV404 instead of committing an in-progress receipt
--   DB-06  audit search index and (server_time, id) keyset
--   SUP-02 operator-only, audited, one-time bootstrap of the first organization, clinic and staff
-- Every replaced function keeps its signature and therefore its grants (create or replace), except public.search_audit, which
-- gains an optional trailing parameter and is re-granted below exactly as 0024 granted it.

-- ---------------------------------------------------------------------------------------------
-- Indexes (DB-02, DB-06)
-- ---------------------------------------------------------------------------------------------
create index if not exists children_merged_into_idx on public.children (merged_into_id) where merged_into_id is not null;
create index if not exists vaccination_revisions_lot_idx on public.vaccination_revisions (lot_id) where lot_id is not null;
create index if not exists audit_org_time_idx on private.audit_logs (organization_id, server_time desc, id desc);

-- ---------------------------------------------------------------------------------------------
-- DB-02: current revisions of one child's alias set, selected through that child's own events.
-- Same rows as `private.current_revisions where child_id = any(p_children)`: an event belongs to the set when its LATEST
-- revision names one of the ids, and every such event has at least one revision naming one of them.
-- ---------------------------------------------------------------------------------------------
create function private.child_current_revisions(p_children uuid[]) returns setof public.vaccination_revisions
language sql stable security definer set search_path = '' as $$
  select c.* from (
    select distinct on (r.event_id) r.*
      from public.vaccination_revisions r
     where r.event_id in (select x.event_id from public.vaccination_revisions x where x.child_id = any (p_children))
     order by r.event_id, r.revision_no desc
  ) c
  where c.child_id = any (p_children)
$$;

create or replace function private.child_eval_inputs(p_child uuid, p_as_of date) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dob date; v_prec text; v_doses jsonb; v_holds jsonb; v_pending int; v_ids uuid[];
begin
  select dob, birth_date_precision into v_dob, v_prec from public.children where id = p_child;
  v_ids := array(select private.child_ids_with_aliases(p_child));
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', cr.id::text,
      'revisionId', cr.id, 'eventId', cr.event_id,
      'product', p.code,
      'antigens', coalesce((select jsonb_agg(a.code order by a.code) from public.product_antigens pa join public.antigens a on a.id = pa.antigen_id where pa.product_id = cr.product_id), '[]'::jsonb),
      'on', case when cr.date_precision = 'exact' then cr.administered_on end,
      'unresolved', cr.date_precision <> 'exact' or cr.administered_on is null or cr.product_id is null)
    order by cr.administered_on nulls last, cr.id), '[]'::jsonb)
    into v_doses
    from private.child_current_revisions(v_ids) cr left join public.vaccine_products p on p.id = cr.product_id
   where cr.event_status = 'active' and cr.verification_status = 'verified'
     and (cr.administered_on is null or cr.administered_on <= p_as_of);
  -- DB-01: holds are read through the alias set, so a hold placed on a record that was later merged still applies.
  select coalesce(jsonb_agg(jsonb_build_object('ruleId', h.rule_id, 'reason', h.reason_code)), '[]'::jsonb) into v_holds
    from public.clinical_holds h where h.child_id = any (v_ids)
      and (h.starts_at at time zone coalesce((select c.timezone from public.clinics c where c.id = h.placed_clinic_id), 'UTC'))::date <= p_as_of
      and (h.resolved_at is null or (h.resolved_at at time zone coalesce((select c.timezone from public.clinics c where c.id = h.placed_clinic_id), 'UTC'))::date > p_as_of);
  -- Unverified/pending evidence is counted for staff visibility but NEVER credited (T09).
  select count(*) into v_pending from private.child_current_revisions(v_ids) cr
   where cr.event_status = 'active' and cr.verification_status = 'pending_verification' and (cr.administered_on is null or cr.administered_on <= p_as_of);
  return jsonb_build_object('dob', v_dob, 'dobExact', v_prec = 'exact' and v_dob is not null, 'doses', v_doses, 'holds', v_holds, 'pendingEvidence', v_pending);
end $$;

create or replace function public.list_child_history(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_canon uuid; v_res jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then
    perform private.audit(v_org, 'child.read_clinical', 'history.view', 'child', p_child_id, null, null, null, 'denied');
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', cr.event_id, 'revisionNo', cr.revision_no, 'origin', e.origin, 'source', cr.source, 'verificationStatus', cr.verification_status,
    'eventStatus', cr.event_status, 'administeredOn', cr.administered_on, 'datePrecision', cr.date_precision,
    'product', p.name, 'productCode', p.code, 'reportedProduct', cr.reported_product_text, 'reportedLot', cr.reported_lot, 'provider', cr.external_vaccinator,
    'amended', cr.revision_no > 1) order by cr.administered_on desc nulls last, cr.created_at desc), '[]'::jsonb) into v_res
    from private.child_current_revisions(array(select private.child_ids_with_aliases(v_canon))) cr
    join public.vaccination_events e on e.id = cr.event_id left join public.vaccine_products p on p.id = cr.product_id;
  perform private.audit(v_org, 'child.read_clinical', 'history.view', 'child', v_canon, null, null, null);
  return v_res;
end $$;

create or replace function public.guardian_child_history(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'eventId', cr.event_id, 'administeredOn', cr.administered_on, 'datePrecision', cr.date_precision, 'product', coalesce(p.name, cr.reported_product_text),
    -- Provenance stays visible: reported-elsewhere is never presented as a clinic-verified dose.
    'status', case when cr.verification_status = 'verified' then 'verified' when cr.verification_status = 'pending_verification' then 'pending_verification' else 'not_accepted' end,
    'source', case when cr.source = 'clinic_administered' then 'clinic' else 'recorded_elsewhere' end)
    order by cr.administered_on desc nulls last), '[]'::jsonb)
    from private.child_current_revisions(array(select private.child_ids_with_aliases(v_canon))) cr left join public.vaccine_products p on p.id = cr.product_id
   where cr.event_status = 'active');
end $$;

-- DB-02 + DB-05: certificate preparation reads the child's own events; a child outside the clinic is CV404 (no receipt kept).
create or replace function public.issue_certificate(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_replaces_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_prev jsonb; v_canon uuid; v_child public.children; v_clinic public.clinics; v_entries jsonb; v_snap jsonb; v_id uuid := gen_random_uuid(); v_no text; v_issuer text; old public.certificates;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'certificate.issue');
  v_prev := private.begin_command(v_org, p_operation_key, 'certificate.issue', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'rp', p_replaces_id));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_replaces_id is not null then
    select * into old from public.certificates where id = p_replaces_id and organization_id = v_org and child_id in (select private.child_ids_with_aliases(v_canon)) for update;
    if old.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
    if old.status = 'pending' then raise exception 'a certificate that is still pending cannot be replaced' using errcode = 'CV409'; end if;
    if exists (select 1 from public.certificates x where x.replaces_id = old.id and x.status <> 'revoked') then raise exception 'a replacement for this certificate is already in progress' using errcode = 'CV409'; end if;
  end if;
  select * into v_child from public.children where id = v_canon;
  select * into v_clinic from public.clinics where id = p_clinic_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', cr.event_id, 'revisionId', cr.id, 'revisionNo', cr.revision_no, 'administeredOn', cr.administered_on, 'datePrecision', cr.date_precision,
           'product', coalesce(p.name, cr.reported_product_text),
           'source', case when cr.source = 'clinic_administered' then 'clinic' else 'recorded_elsewhere' end,
           'lot', case when cr.source = 'clinic_administered' then coalesce(l.manufacturer_lot, cr.reported_lot) else null end,
           'provider', case when cr.source = 'clinic_administered' then null else cr.external_vaccinator end)
         order by cr.administered_on, cr.created_at), '[]'::jsonb) into v_entries
    from private.child_current_revisions(array(select private.child_ids_with_aliases(v_canon))) cr
    left join public.vaccine_products p on p.id = cr.product_id left join public.vaccine_lots l on l.id = cr.lot_id
   where cr.event_status = 'active' and cr.verification_status = 'verified' and cr.administered_on is not null;
  if jsonb_array_length(v_entries) = 0 then raise exception 'there are no verified vaccinations to certify yet' using errcode = 'CV422'; end if;
  select display_name into v_issuer from public.profiles where id = auth.uid();
  v_no := private.next_certificate_no(v_org);
  v_snap := jsonb_build_object('version', 1, 'certificateNo', v_no,
    'clinic', jsonb_build_object('name', v_clinic.name, 'address', v_clinic.address, 'contact', v_clinic.contact_text, 'timezone', v_clinic.timezone),
    'child', jsonb_build_object('displayName', v_child.display_name, 'dob', v_child.dob, 'datePrecision', v_child.birth_date_precision, 'recordNo', v_child.local_record_no),
    'entries', v_entries, 'issuedBy', coalesce(nullif(v_issuer, ''), 'Clinic staff'), 'preparedAt', now());
  insert into public.certificates (id, organization_id, clinic_id, child_id, certificate_no, snapshot, content_hash, issuer_id, replaces_id)
  values (v_id, v_org, p_clinic_id, v_canon, v_no, v_snap, encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex'), auth.uid(), p_replaces_id);
  insert into public.certificate_items (certificate_id, vaccination_revision_id)
  select v_id, (e ->> 'revisionId')::uuid from jsonb_array_elements(v_entries) e;
  perform private.audit(v_org, 'certificate.issue', 'certificate.prepared', 'certificate', v_id, null, jsonb_build_object('no', v_no, 'entries', jsonb_array_length(v_entries), 'replaces', p_replaces_id), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('certificateId', v_id, 'certificateNo', v_no, 'status', 'pending'));
end $$;

-- DB-02: pendingOutsideDoses is scoped through this clinic's enrollments first (was: every organization's revisions).
create or replace function public.report_backlog(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id); v_ids uuid[];
begin
  -- Every id whose canonical record is enrolled here (canonical records are the unmerged ones; aliases are their merged duplicates).
  v_ids := array(select a.id from public.child_clinic_enrollments e join public.children c on c.id = e.child_id and c.merged_into_id is null
                  cross join lateral private.child_ids_with_aliases(e.child_id) a(id)
                  where e.clinic_id = p_clinic_id and e.status in ('pending','active'));
  perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'backlog'), null);
  return jsonb_build_object('report', 'backlog', 'asOf', now(), 'definitions', jsonb_build_object('version', 'r1', 'terms', jsonb_build_object(
      'openReviewCases', 'Review cases still open or in review, by type.', 'pendingOutsideDoses', 'Doses reported as given elsewhere that staff have not yet verified or rejected.',
      'provisionalChildren', 'Children enrolled here whose identity has not been confirmed.', 'pendingGuardianLinks', 'Guardian links waiting for in-person verification.',
      'pendingCertificates', 'Certificates prepared but not yet issued (document not stored).', 'failedMessages', 'Notification jobs that failed permanently.',
      'openTemperatureExcursions', 'Fridge readings outside the approved limits that nobody has reviewed.', 'transfersNeedingDecision', 'Stock transfers that arrived short and still need a decision.',
      'transfersInTransit', 'Stock sent to or from this clinic that has not been received yet.',
      'plansAwaitingReview', 'Catch-up plans submitted and waiting for a second person.', 'openCheckins', 'Questions from families that no one has answered yet.')),
    'openReviewCases', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.record_review_cases where clinic_id = p_clinic_id and status in ('open','in_review') group by kind) k),
    'pendingOutsideDoses', (select count(*) from private.child_current_revisions(v_ids) cr where cr.verification_status = 'pending_verification' and cr.event_status = 'active'),
    'provisionalChildren', (select count(*) from public.children c join public.child_clinic_enrollments e on e.child_id = c.id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where c.record_status = 'provisional' and c.merged_into_id is null),
    'pendingGuardianLinks', (select count(*) from public.guardian_child_relationships r join public.child_clinic_enrollments e on e.child_id = r.child_id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where r.status = 'provisional'),
    'pendingCertificates', (select count(*) from public.certificates where clinic_id = p_clinic_id and status = 'pending'),
    'failedMessages', (select count(*) from private.outbox_jobs where organization_id = v_org and status = 'failed'),
    'openTemperatureExcursions', (select count(*) from public.temperature_readings r where r.clinic_id = p_clinic_id and r.status = 'excursion' and not exists (select 1 from public.temperature_reviews rv where rv.reading_id = r.id)),
    'transfersNeedingDecision', (select count(*) from public.stock_transfers where from_clinic_id = p_clinic_id and status = 'received_short'),
    'transfersInTransit', (select count(*) from public.stock_transfers where (from_clinic_id = p_clinic_id or to_clinic_id = p_clinic_id) and status = 'in_transit'),
    'plansAwaitingReview', (select count(*) from public.catchup_plans where clinic_id = p_clinic_id and status = 'submitted'),
    'openCheckins', (select count(*) from public.checkins where clinic_id = p_clinic_id and status = 'open'));
end $$;

-- DB-02: the repeat-dose guard on the recording path reads the child's own events. Body otherwise identical to 0015.
create or replace function public.record_administration(p_operation_key uuid, p_clinic_id uuid, p_encounter_id uuid, p_admin jsonb) returns jsonb
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
      select 1 from private.child_current_revisions(array(select private.child_ids_with_aliases(v_child))) cr where cr.product_id = v_prod.id
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
-- DB-01: clinical holds follow the record through a merge
-- ---------------------------------------------------------------------------------------------
create or replace function public.place_clinical_hold(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_reason_code text, p_restricted_note text default null, p_review_on date default null, p_rule_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_prev := private.begin_command(v_org, p_operation_key, 'hold.place', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'r', p_reason_code, 'n', p_restricted_note, 'd', p_review_on, 'rule', p_rule_id));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_reason_code is null or length(btrim(p_reason_code)) < 3 or length(p_reason_code) > 80 then raise exception 'name the reason for the hold (3 to 80 characters)' using errcode = 'CV422'; end if;
  if p_review_on is not null and p_review_on < private.local_today(p_clinic_id) then raise exception 'the review date cannot be in the past' using errcode = 'CV422'; end if;
  if p_rule_id is not null and not exists (select 1 from public.schedule_rules where id = p_rule_id and organization_id = v_org) then raise exception 'unknown schedule item' using errcode = 'CV422'; end if;
  if exists (select 1 from public.clinical_holds where child_id in (select private.child_ids_with_aliases(v_canon)) and status = 'active'
               and coalesce(rule_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_rule_id, '00000000-0000-0000-0000-000000000000')) then
    raise exception 'this hold already exists' using errcode = 'CV409';
  end if;
  insert into public.clinical_holds (organization_id, child_id, rule_id, reason_code, restricted_note, review_on, placed_clinic_id, created_by, updated_by)
  values (v_org, v_canon, p_rule_id, btrim(p_reason_code), left(nullif(btrim(coalesce(p_restricted_note, '')), ''), 500), p_review_on, p_clinic_id, auth.uid(), auth.uid()) returning id into v_id;
  perform private.audit(v_org, 'vaccination.record', 'hold.placed', 'child', v_canon, null, jsonb_build_object('holdId', v_id, 'rule', p_rule_id, 'reviewOn', p_review_on), p_reason_code);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('holdId', v_id, 'status', 'active'));
end $$;

-- release_clinical_hold is unchanged: it already authorises through private.canonical_child(h.child_id), which resolves a merged record.

create or replace function public.list_clinical_holds(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'status', h.status, 'reason', h.reason_code, 'note', h.restricted_note, 'reviewOn', h.review_on, 'startsAt', h.starts_at,
            'ruleRequirement', (select r.requirement_code from public.schedule_rules r where r.id = h.rule_id), 'resolvedAt', h.resolved_at, 'resolutionNote', h.resolution_note,
            'placedBy', (select display_name from public.profiles where id = h.created_by)) order by h.starts_at desc), '[]'::jsonb)
            from public.clinical_holds h where h.child_id in (select private.child_ids_with_aliases(v_canon)));
end $$;

-- Re-points active holds that still sit on a merged record to its surviving record (one audit row per hold). Used once below
-- for holds left behind by merges made before this migration; the merge wrapper does the same for new merges.
create function private.repoint_merged_holds() returns integer
language plpgsql security definer set search_path = '' as $$
declare h record; v_to uuid; n integer := 0;
begin
  for h in select ch.id, ch.organization_id, ch.child_id from public.clinical_holds ch join public.children c on c.id = ch.child_id
            where ch.status = 'active' and c.merged_into_id is not null for update of ch
  loop
    v_to := private.canonical_child(h.child_id);
    continue when v_to = h.child_id;
    update public.clinical_holds set child_id = v_to, updated_by = coalesce(auth.uid(), updated_by) where id = h.id;
    perform private.audit(h.organization_id, null, 'hold.merged', 'clinical_hold', h.id, jsonb_build_object('childId', h.child_id), jsonb_build_object('childId', v_to),
                          'hold moved to the surviving record of an earlier merge');
    n := n + 1;
  end loop;
  return n;
end $$;

-- SEC-05 + DB-01: ownership is resolved before any lock or state check; active holds move to the survivor with the merge.
create or replace function public.merge_children(p_operation_key uuid, p_clinic_id uuid, p_survivor uuid, p_duplicate uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_org uuid; v_replay jsonb; a record; h record;
begin
  perform private.require_capability(p_clinic_id, 'review.resolve');
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  v_replay := private.scheduling_replay(v_org, p_operation_key, 'child.merge', jsonb_build_object('clinic', p_clinic_id, 's', p_survivor, 'd', p_duplicate, 'reason', p_reason));
  if v_replay is not null then return v_replay; end if;
  -- Both records must be this organization's and enrolled at this clinic before anything about them is locked or inspected.
  if not exists (select 1 from public.children where id = p_survivor and organization_id = v_org)
     or not exists (select 1 from public.children where id = p_duplicate and organization_id = v_org)
     or not private.child_in_clinic(p_survivor, p_clinic_id) or not private.child_in_clinic(p_duplicate, p_clinic_id) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
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
  -- A clinician's hold keeps blocking: it moves to the surviving record (resolved holds stay where they were, read through aliases).
  for h in select id, child_id from public.clinical_holds where child_id in (select private.child_ids_with_aliases(p_duplicate)) and status = 'active' for update loop
    update public.clinical_holds set child_id = p_survivor, updated_by = auth.uid() where id = h.id;
    perform private.audit(v_org, 'review.resolve', 'hold.merged', 'clinical_hold', h.id, jsonb_build_object('childId', h.child_id), jsonb_build_object('childId', p_survivor), p_reason);
  end loop;
  perform private.audit(v_org, 'review.resolve', 'child.merge_scheduling', 'child', p_duplicate, null, jsonb_build_object('survivorId', p_survivor), p_reason);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- FE-01: only count proposals can be approved and posted
-- ---------------------------------------------------------------------------------------------
create or replace function public.approve_stock_adjustment(p_operation_key uuid, p_clinic_id uuid, p_case_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; k public.record_review_cases; v_book numeric; v_tx uuid; v_delta numeric; v_loc uuid; v_lot uuid;
begin
  select * into k from public.record_review_cases where id = p_case_id and organization_id = v_org and clinic_id = p_clinic_id and kind = 'stock' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.approve_adjustment', jsonb_build_object('c', p_clinic_id, 'case', p_case_id));
  if v_prev is not null then return v_prev; end if;
  if k.status not in ('open','in_review') then raise exception 'case already decided' using errcode = 'CV409'; end if;
  -- Short deliveries and care-without-stock cases are also kind 'stock' but carry no count: they are decided where they came from.
  if k.evidence ->> 'observed' is null or k.evidence ->> 'locationId' is null or k.evidence ->> 'lotId' is null then
    raise exception 'this stock case is not a count adjustment; decide it from the transfer or the visit record it came from' using errcode = 'CV409';
  end if;
  if k.created_by = auth.uid() then raise exception 'the proposer cannot approve their own adjustment' using errcode = 'CV403'; end if;
  v_loc := (k.evidence ->> 'locationId')::uuid; v_lot := (k.evidence ->> 'lotId')::uuid;
  -- Re-derive the delta from the observed count against the CURRENT book balance (stock may have moved since the proposal).
  select coalesce(on_hand, 0) into v_book from public.stock_balances where location_id = v_loc and lot_id = v_lot for update;
  v_book := coalesce(v_book, 0);
  v_delta := (k.evidence ->> 'observed')::numeric - v_book;
  if v_delta <> 0 then
    insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, approved_by, operation_id, created_by)
    values (v_org, p_clinic_id, 'adjustment', k.evidence ->> 'countReference', k.evidence ->> 'reason', auth.uid(), p_operation_key, k.created_by) returning id into v_tx;
    perform private.post_movement(v_org, v_tx, v_loc, v_lot, v_delta, 'adjust:' || p_operation_key);
  end if;
  update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'approved', 'postedDelta', v_delta, 'transactionId', v_tx) where id = k.id;
  perform private.audit(v_org, 'inventory.approve', 'stock.adjustment_approved', 'review_case', k.id, null, jsonb_build_object('delta', v_delta), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'posted', 'delta', v_delta, 'transactionId', v_tx));
end $$;

-- ---------------------------------------------------------------------------------------------
-- DB-05: a child outside the clinic is CV404 (the receipt rolls back) instead of `return null` after begin_command
-- ---------------------------------------------------------------------------------------------
create or replace function public.save_catchup_draft(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_plan_id uuid, p_rationale text, p_policy_reference text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; p public.catchup_plans;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_prev := private.begin_command(v_org, p_operation_key, 'catchup.save', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'p', p_plan_id, 'r', p_rationale, 'pr', p_policy_reference, 'i', p_items));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_rationale is null or length(btrim(p_rationale)) < 10 then raise exception 'explain why this plan is needed (at least a sentence)' using errcode = 'CV422'; end if;
  if p_policy_reference is null or length(btrim(p_policy_reference)) < 3 then raise exception 'name the clinical policy or advice this plan follows' using errcode = 'CV422'; end if;
  if p_plan_id is null then
    if exists (select 1 from public.catchup_plans where child_id = v_canon and status in ('draft','submitted')) then raise exception 'this child already has a plan being prepared' using errcode = 'CV409'; end if;
    insert into public.catchup_plans (organization_id, clinic_id, child_id, rationale, policy_reference, authored_by) values (v_org, p_clinic_id, v_canon, btrim(p_rationale), btrim(p_policy_reference), auth.uid()) returning * into p;
  else
    select * into p from public.catchup_plans where id = p_plan_id and organization_id = v_org and clinic_id = p_clinic_id and child_id = v_canon for update;
    if p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
    if p.status <> 'draft' then raise exception 'only a draft can be edited' using errcode = 'CV409'; end if;
    if p.authored_by <> auth.uid() then raise exception 'only the author can edit a draft' using errcode = 'CV403'; end if;
    update public.catchup_plans set rationale = btrim(p_rationale), policy_reference = btrim(p_policy_reference) where id = p.id;
    delete from public.catchup_plan_items where plan_id = p.id;
  end if;
  perform private.catchup_items_insert(v_org, p.id, p_items);
  perform private.audit(v_org, 'vaccination.record', 'catchup.drafted', 'catchup_plan', p.id, null, jsonb_build_object('child', v_canon, 'items', jsonb_array_length(p_items)), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('planId', p.id, 'status', 'draft'));
end $$;

create or replace function public.log_followup_attempt(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_outcome text, p_note text default null, p_next_try_on date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['bhw.followup','child.read_clinical']);
  v_prev := private.begin_command(v_org, p_operation_key, 'followup.attempt', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'o', p_outcome, 'n', p_note, 'd', p_next_try_on));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_outcome not in ('reached','no_answer','wrong_number','refused','will_visit','moved_away','other') then raise exception 'choose what happened' using errcode = 'CV422'; end if;
  if p_next_try_on is not null and (p_next_try_on <= private.local_today(p_clinic_id) or p_next_try_on > private.local_today(p_clinic_id) + 180) then raise exception 'choose a date within the next 6 months' using errcode = 'CV422'; end if;
  insert into public.followup_attempts (organization_id, clinic_id, child_id, outcome, note, next_try_on, recorded_by, operation_id)
  values (v_org, p_clinic_id, v_canon, p_outcome, left(nullif(btrim(coalesce(p_note, '')), ''), 300), p_next_try_on, auth.uid(), p_operation_key) returning id into v_id;
  perform private.audit(v_org, 'bhw.followup', 'followup.attempt', 'child', v_canon, null, jsonb_build_object('outcome', p_outcome), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('attemptId', v_id));
end $$;

create or replace function public.initiate_record_transfer_out(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_to_clinic_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'guardian.verify');
  v_prev := private.begin_command(v_org, p_operation_key, 'transfer.initiate_out', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'to', p_to_clinic_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not exists (select 1 from public.child_clinic_enrollments where child_id = v_canon and clinic_id = p_clinic_id and status = 'active') then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.transfer_target_ok(v_org, p_clinic_id, p_to_clinic_id);
  if not exists (select 1 from public.guardian_child_relationships where child_id = v_canon and status = 'active' and access_scope = 'full') then raise exception 'a verified guardian must ask for the transfer' using errcode = 'CV409'; end if;
  if exists (select 1 from public.record_transfers where child_id = v_canon and status in ('requested','ready')) then raise exception 'a transfer for this child is already in progress' using errcode = 'CV409'; end if;
  insert into public.record_transfers (organization_id, child_id, from_clinic_id, to_clinic_id, initiated_by, consent_method, reason)
  values (v_org, v_canon, p_clinic_id, p_to_clinic_id, auth.uid(), 'in_person', left(nullif(btrim(coalesce(p_reason, '')), ''), 300)) returning id into v_id;
  perform private.audit(v_org, 'guardian.verify', 'transfer.initiated', 'child', v_canon, null, jsonb_build_object('transferId', v_id, 'to', p_to_clinic_id), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', v_id, 'status', 'requested'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- DB-03: acknowledgements bind clinic + version + SHA-256 of the exact notice text, and belong to the signed-in person
-- (profile), so accepting a clinic's notice no longer creates a guardian identity in that clinic's organization.
-- ---------------------------------------------------------------------------------------------
alter table public.privacy_records
  add column clinic_id uuid,
  add column profile_id uuid references public.profiles (id),
  add column notice_sha256 text check (notice_sha256 is null or notice_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint privacy_records_org_clinic_fkey foreign key (organization_id, clinic_id) references public.clinics (organization_id, id);
alter table public.privacy_records drop constraint privacy_records_check;
alter table public.privacy_records add constraint privacy_records_subject_check check (guardian_id is not null or child_id is not null or profile_id is not null);
create index privacy_records_ack_idx on public.privacy_records (profile_id, clinic_id) where record_type = 'notice_acknowledgement';

create function private.notice_digest(p_text text) returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_text, 'UTF8')), 'hex')
$$;

-- True when the caller accepted exactly the notice this clinic shows now (same clinic, version label and text).
create function private.notice_acknowledged(p_clinic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clinics c join public.privacy_records pr on pr.clinic_id = c.id
     where c.id = p_clinic and pr.profile_id = auth.uid() and pr.record_type = 'notice_acknowledgement' and pr.decision = 'acknowledged'
       and pr.notice_version = c.operational_policy -> 'privacyNotice' ->> 'version'
       and pr.notice_sha256 = private.notice_digest(c.operational_policy -> 'privacyNotice' ->> 'text'))
$$;

create or replace function public.get_privacy_notice(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.clinics; v_n jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into c from public.clinics where id = p_clinic_id and status = 'active';
  if c.id is null then return null; end if;
  v_n := c.operational_policy -> 'privacyNotice';
  if v_n is null then return jsonb_build_object('configured', false, 'acknowledged', true); end if;
  return jsonb_build_object('configured', true, 'version', v_n ->> 'version', 'text', v_n ->> 'text', 'acknowledged', private.notice_acknowledged(c.id));
end $$;

create or replace function public.acknowledge_clinic_privacy_notice(p_operation_key uuid, p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.clinics; v_prev jsonb; v_ver text; v_text text; v_sha text; v_g uuid; v_id uuid;
begin
  if auth.uid() is null or not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into c from public.clinics where id = p_clinic_id and status = 'active';
  if c.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_ver := c.operational_policy -> 'privacyNotice' ->> 'version';
  v_text := c.operational_policy -> 'privacyNotice' ->> 'text';
  if v_ver is null or v_text is null then raise exception 'this clinic has no privacy notice to accept' using errcode = 'CV409'; end if;
  v_prev := private.begin_command(c.organization_id, p_operation_key, 'privacy.acknowledge_clinic', jsonb_build_object('c', p_clinic_id, 'v', v_ver));
  if v_prev is not null then return v_prev; end if;
  if not private.notice_acknowledged(c.id) then
    v_sha := private.notice_digest(v_text);
    -- Link the guardian identity only if one already exists; never create one just for reading a notice.
    select id into v_g from public.guardians where organization_id = c.organization_id and profile_id = auth.uid();
    insert into public.privacy_records (organization_id, guardian_id, clinic_id, profile_id, purpose, record_type, notice_version, notice_sha256, decision, created_by)
    values (c.organization_id, v_g, c.id, auth.uid(), 'care_records', 'notice_acknowledgement', v_ver, v_sha, 'acknowledged', auth.uid()) returning id into v_id;
    perform private.audit(c.organization_id, 'guardian', 'privacy.acknowledged', 'clinic', p_clinic_id, null, jsonb_build_object('version', v_ver, 'sha256', v_sha), null);
  end if;
  return private.finish_command(c.organization_id, p_operation_key, jsonb_build_object('version', v_ver, 'acknowledged', true));
end $$;

-- The older per-version command (0003) records the clinic too; the text digest is recorded only when the version named is
-- the clinic's current notice, so naming any other label never satisfies the gate.
create or replace function public.acknowledge_privacy_notice(p_operation_key uuid, p_clinic_id uuid, p_notice_version text, p_purpose text default 'care_records') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_g uuid; v_id uuid; v_n jsonb;
begin
  if auth.uid() is null or not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select organization_id, operational_policy -> 'privacyNotice' into v_org, v_n from public.clinics where id = p_clinic_id and status = 'active';
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'privacy.acknowledge', jsonb_build_object('clinic', p_clinic_id, 'v', p_notice_version, 'p', p_purpose));
  if v_prev is not null then return v_prev; end if;
  if p_notice_version is null or length(btrim(p_notice_version)) = 0 then raise exception 'notice version required' using errcode = 'CV422'; end if;
  select id into v_g from public.guardians where organization_id = v_org and profile_id = auth.uid();
  insert into public.privacy_records (organization_id, guardian_id, clinic_id, profile_id, purpose, record_type, notice_version, notice_sha256, decision, created_by)
  values (v_org, v_g, p_clinic_id, auth.uid(), left(p_purpose, 100), 'notice_acknowledgement', left(p_notice_version, 50),
          case when v_n ->> 'version' = p_notice_version and v_n ->> 'text' is not null then private.notice_digest(v_n ->> 'text') end,
          'acknowledged', auth.uid()) returning id into v_id;
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('privacyRecordId', v_id));
end $$;

create or replace function private.require_privacy_ack(p_clinic uuid) returns void language plpgsql stable security definer set search_path = '' as $$
declare c public.clinics; v_ver text;
begin
  select * into c from public.clinics where id = p_clinic;
  if c.id is null then return; end if;
  v_ver := c.operational_policy -> 'privacyNotice' ->> 'version';
  if v_ver is not null and auth.uid() is not null and not private.notice_acknowledged(c.id) then
    raise exception 'please read and accept the clinic''s privacy notice first' using errcode = 'CV409';
  end if;
end $$;

-- Same JSON shape as 0031 ([{clinicId, clinicName, version, text}]). Bounded to 100 notices; clinics where the family already
-- has a child come first. The list still covers other active clinics because the add-a-child and link forms let a family
-- choose any public clinic, and that clinic's notice must be accepted first. Once those forms show the chosen clinic's notice
-- inline (get_privacy_notice), this can be narrowed to related clinics only.
create or replace function public.get_pending_privacy_notices() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('clinicId', x.id, 'clinicName', x.name, 'version', x.ver, 'text', x.txt) order by x.mine desc, x.name, x.id), '[]'::jsonb)
    into v_res
    from (
      select c.id, c.name, c.operational_policy -> 'privacyNotice' ->> 'version' as ver, c.operational_policy -> 'privacyNotice' ->> 'text' as txt,
             exists (select 1 from public.guardians g
                       join public.guardian_child_relationships r on r.guardian_id = g.id and r.status in ('provisional','active','suspended')
                       join public.child_clinic_enrollments e on e.child_id = r.child_id and e.clinic_id = c.id and e.status in ('pending','active')
                      where g.profile_id = auth.uid()) as mine
        from public.clinics c
       where c.status = 'active'
         and c.operational_policy -> 'privacyNotice' ->> 'version' is not null and c.operational_policy -> 'privacyNotice' ->> 'text' is not null
         and not private.notice_acknowledged(c.id)
       order by mine desc, c.name, c.id
       limit 100) x;
  return v_res;
end $$;

drop function private.guardian_ack_version(uuid, text);

-- Binds acknowledgements written before this migration to the clinic their command receipt proves (receipt and record are
-- written in one transaction, so received_at = recorded_at, and the receipt's payload hash names the clinic). The digest is
-- recorded only when that clinic still shows the same version and its text was set before the acknowledgement. Rows that
-- cannot be attributed keep clinic_id null and no longer satisfy the gate: those families are asked to accept again.
create function private.backfill_privacy_acknowledgements() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  alter table public.privacy_records disable trigger privacy_records_immutable;
  with cand as (
    select distinct on (pr.id) pr.id, cl.id as clinic_id
      from public.privacy_records pr
      join private.command_receipts r on r.organization_id = pr.organization_id and r.actor_id = pr.created_by and r.received_at = pr.recorded_at
                                     and r.command_type in ('privacy.acknowledge_clinic', 'privacy.acknowledge')
      join public.clinics cl on cl.organization_id = pr.organization_id
     where pr.record_type = 'notice_acknowledgement' and pr.clinic_id is null
       and r.payload_hash = case r.command_type
             when 'privacy.acknowledge_clinic' then encode(sha256(convert_to(jsonb_build_object('c', cl.id, 'v', pr.notice_version)::text, 'UTF8')), 'hex')
             else encode(sha256(convert_to(jsonb_build_object('clinic', cl.id, 'v', pr.notice_version, 'p', pr.purpose)::text, 'UTF8')), 'hex') end
     order by pr.id, cl.id
  )
  update public.privacy_records pr
     set clinic_id = cand.clinic_id,
         notice_sha256 = case when cl.operational_policy -> 'privacyNotice' ->> 'version' = pr.notice_version
                                and cl.operational_policy -> 'privacyNotice' ->> 'text' is not null
                                and coalesce((cl.operational_policy -> 'privacyNotice' ->> 'setAt')::timestamptz, '-infinity'::timestamptz) <= pr.recorded_at
                              then private.notice_digest(cl.operational_policy -> 'privacyNotice' ->> 'text') end
    from cand join public.clinics cl on cl.id = cand.clinic_id
   where pr.id = cand.id;
  get diagnostics n = row_count;
  update public.privacy_records pr set profile_id = g.profile_id
    from public.guardians g where g.id = pr.guardian_id and pr.profile_id is null and pr.record_type = 'notice_acknowledgement';
  alter table public.privacy_records enable trigger privacy_records_immutable;
  return n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- DB-04: clinic-scoped visibility (restrictive, reversible default; see the handoff and known-limitations)
-- ---------------------------------------------------------------------------------------------
alter table private.audit_logs add column clinic_id uuid;

-- The clinic whose capability authorised the current command is remembered for the rest of the transaction, so audit rows
-- written by that command record it without changing the 126 private.audit call sites.
create or replace function private.require_capability(p_clinic uuid, p_cap text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.has_capability(p_clinic, p_cap) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  perform pg_catalog.set_config('cvsrs.audit_clinic', p_clinic::text, true);
end $$;

create or replace function private.require_any(p_clinic uuid, p_caps text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  foreach c in array p_caps loop
    if private.has_capability(p_clinic, c) then
      perform pg_catalog.set_config('cvsrs.audit_clinic', p_clinic::text, true);
      return;
    end if;
  end loop;
  raise exception 'forbidden' using errcode = 'CV403';
end $$;

create or replace function private.audit(
  p_org uuid, p_capability text, p_action text, p_entity_type text, p_entity_id uuid,
  p_before jsonb, p_after jsonb, p_reason text, p_outcome text default 'success'
) returns void language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid := nullif(pg_catalog.current_setting('cvsrs.audit_clinic', true), '')::uuid;
begin
  if v_clinic is not null and not exists (select 1 from public.clinics c where c.id = v_clinic and c.organization_id is not distinct from p_org) then
    v_clinic := null;
  end if;
  insert into private.audit_logs (organization_id, clinic_id, actor_id, actor_capability, action, entity_type, entity_id,
                                  before, after, reason, request_id, outcome, system_job_id)
  values (p_org, v_clinic, auth.uid(), p_capability, p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason,
          private.request_id(), p_outcome, case when auth.uid() is null then 'system' end);
end $$;

-- Whether an audit row belongs to a clinic: its recorded clinic when it has one; otherwise (rows written before this
-- migration, or by families) the clinic its entity resolves to. Organization-wide rows with no clinic belong to none:
-- no organization-level capability exists in the capability vocabulary, so nobody can search them through the API.
create function private.audit_row_in_clinic(p_clinic uuid, p_row_clinic uuid, p_entity_type text, p_entity_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_row_clinic is not null then p_row_clinic = p_clinic
    when p_entity_id is null then false
    when p_entity_type = 'clinic' then p_entity_id = p_clinic
    when p_entity_type = 'child' then private.child_in_clinic(private.canonical_child(p_entity_id), p_clinic)
    when p_entity_type = 'certificate' then exists (select 1 from public.certificates x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'review_case' then exists (select 1 from public.record_review_cases x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'staff_membership' then exists (select 1 from public.staff_memberships x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'appointment' then exists (select 1 from public.appointments x join public.clinic_sessions s on s.id = x.session_id where x.id = p_entity_id and s.clinic_id = p_clinic)
    when p_entity_type = 'queue_entry' then exists (select 1 from public.queue_entries x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'catchup_plan' then exists (select 1 from public.catchup_plans x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'checkin' then exists (select 1 from public.checkins x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'clinic_session' then exists (select 1 from public.clinic_sessions x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'stock_location' then exists (select 1 from public.stock_locations x where x.id = p_entity_id and x.clinic_id = p_clinic)
    when p_entity_type = 'stock_transfer' then exists (select 1 from public.stock_transfers x where x.id = p_entity_id and p_clinic in (x.from_clinic_id, x.to_clinic_id))
    when p_entity_type = 'clinical_hold' then exists (select 1 from public.clinical_holds x where x.id = p_entity_id and private.child_in_clinic(private.canonical_child(x.child_id), p_clinic))
    when p_entity_type = 'relationship' then exists (select 1 from public.guardian_child_relationships x where x.id = p_entity_id and private.child_in_clinic(private.canonical_child(x.child_id), p_clinic))
    when p_entity_type = 'vaccination_event' then exists (select 1 from public.vaccination_revisions x where x.event_id = p_entity_id
                                                           and (x.clinic_id = p_clinic or private.child_in_clinic(private.canonical_child(x.child_id), p_clinic)))
    else false
  end
$$;

-- Lot trace: identities only for children of this clinic; other clinics' uses are counted, never named.
create or replace function public.trace_lot_use(p_clinic_id uuid, p_lot_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_res jsonb; v_other jsonb; v_other_n bigint;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'inventory.approve');
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  with cur as (
    select distinct on (r.event_id) r.* from public.vaccination_revisions r
     where r.event_id in (select x.event_id from public.vaccination_revisions x where x.lot_id = p_lot_id and x.organization_id = v_org)
     order by r.event_id, r.revision_no desc
  ), t as materialized (
    select cr.event_id, cr.revision_no, k.canon, cr.administered_on, cr.verification_status, cr.event_status, cr.source, cr.clinic_id,
           private.child_in_clinic(k.canon, p_clinic_id) as here
      from cur cr cross join lateral (select private.canonical_child(cr.child_id) as canon) k
     where cr.lot_id = p_lot_id and cr.organization_id = v_org
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('scope', 'this_clinic', 'eventId', t.event_id, 'childId', c.id, 'childName', c.display_name, 'recordNo', c.local_record_no,
                    'administeredOn', t.administered_on, 'status', t.verification_status, 'eventStatus', t.event_status, 'source', t.source, 'revisionNo', t.revision_no, 'clinicId', t.clinic_id)
                    order by t.administered_on, c.display_name), '[]'::jsonb)
            from t join public.children c on c.id = t.canon where t.here),
         (select coalesce(jsonb_agg(jsonb_build_object('scope', 'other_clinic', 'clinicId', o.clinic_id, 'clinicName', o.name, 'records', o.n) order by o.name nulls last, o.clinic_id), '[]'::jsonb)
            from (select t.clinic_id, cl.name, count(*) n from t left join public.clinics cl on cl.id = t.clinic_id where not t.here group by t.clinic_id, cl.name) o),
         (select count(*) from t where not t.here)
    into v_res, v_other, v_other_n;
  perform private.audit(v_org, 'inventory.approve', 'lot.traced', 'vaccine_lot', p_lot_id, null,
                        jsonb_build_object('records', jsonb_array_length(v_res), 'otherClinicRecords', v_other_n), null);
  return v_res || v_other;
end $$;

-- DB-04 + DB-06: clinic-scoped rows, index-ordered newest first, keyset on (server_time, id). p_before_id is optional:
-- the original seven-argument call keeps its meaning (server_time < p_before); nextBeforeId is returned for gap-free paging.
drop function public.search_audit(uuid, text, uuid, timestamptz, timestamptz, timestamptz, integer);
create function public.search_audit(p_clinic_id uuid, p_action text default null, p_actor uuid default null, p_from timestamptz default null, p_to timestamptz default null,
                                    p_before timestamptz default null, p_limit integer default 50, p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 100); v_rows jsonb; v_last jsonb; v_kids uuid[];
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'audit.read');
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'the end of the period is before its start' using errcode = 'CV422'; end if;
  -- Children of this clinic (and their merged aliases), resolved once: rows without a recorded clinic about a child are matched
  -- against this set with a hashed lookup instead of a per-row enrollment check (same rule as private.audit_row_in_clinic).
  v_kids := array(select a.id from public.child_clinic_enrollments e join public.children c on c.id = e.child_id and c.merged_into_id is null
                   cross join lateral private.child_ids_with_aliases(e.child_id) a(id)
                   where e.clinic_id = p_clinic_id and e.status in ('pending','active'));
  select coalesce(jsonb_agg(x.j order by x.t desc, x.id desc), '[]'::jsonb) into v_rows from (
    select a.server_time t, a.id, jsonb_build_object('id', a.id, 'at', a.server_time, 'action', a.action, 'capability', a.actor_capability, 'entityType', a.entity_type, 'entityId', a.entity_id, 'outcome', a.outcome, 'reason', a.reason,
             'actor', (select display_name from public.profiles where id = a.actor_id), 'actorId', a.actor_id, 'system', a.system_job_id, 'before', a.before, 'after', a.after) j
      from private.audit_logs a
     where a.organization_id = v_org and (p_action is null or a.action like replace(replace(p_action, '%', ''), '_', '\_') || '%') and (p_actor is null or a.actor_id = p_actor)
       and (p_from is null or a.server_time >= p_from) and (p_to is null or a.server_time <= p_to)
       and (p_before is null or (p_before_id is null and a.server_time < p_before) or (p_before_id is not null and (a.server_time, a.id) < (p_before, p_before_id)))
       and (a.clinic_id = p_clinic_id
            or (a.clinic_id is null and (
                  (a.entity_type = 'clinic' and a.entity_id = p_clinic_id)
               or (a.entity_type = 'child' and a.entity_id in (select k.id from pg_catalog.unnest(v_kids) k(id)))
               or (a.entity_type not in ('clinic', 'child') and private.audit_row_in_clinic(p_clinic_id, null, a.entity_type, a.entity_id)))))
     order by a.server_time desc, a.id desc limit v_lim) x;
  perform private.audit(v_org, 'audit.read', 'audit.searched', 'clinic', p_clinic_id, null, jsonb_build_object('action', p_action, 'actor', p_actor, 'from', p_from, 'to', p_to, 'returned', jsonb_array_length(v_rows)), null);
  v_last := case when jsonb_array_length(v_rows) = v_lim then v_rows -> (v_lim - 1) end;
  return jsonb_build_object('rows', v_rows, 'nextBefore', v_last ->> 'at', 'nextBeforeId', v_last ->> 'id');
end $$;
revoke all on function public.search_audit(uuid, text, uuid, timestamptz, timestamptz, timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.search_audit(uuid, text, uuid, timestamptz, timestamptz, timestamptz, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- SUP-02: first organization, clinic and staff on an empty project. Run once by the operator in the SQL Editor (as postgres);
-- never callable through the API. Both people must already have signed up (so their profiles exist), and each approves the
-- other's grant, which satisfies the two-person check on staff_memberships.
-- ---------------------------------------------------------------------------------------------
create function private.bootstrap_initial_staff(p_org_name text, p_clinic_name text, p_timezone text, p_admin_email text, p_lead_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid; v_lead uuid; v_org uuid; v_clinic uuid; v_m_admin uuid; v_m_lead uuid;
begin
  lock table public.staff_memberships in share row exclusive mode;
  if exists (select 1 from public.staff_memberships where status in ('active','pending_approval')) then
    raise exception 'staff access already exists; grant further access with the in-app two-person process' using errcode = 'CV409';
  end if;
  if coalesce(btrim(p_org_name), '') = '' or coalesce(btrim(p_clinic_name), '') = '' then
    raise exception 'name the organization and its first clinic' using errcode = 'CV422';
  end if;
  select p.id into v_admin from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(btrim(p_admin_email)) and p.status = 'active';
  select p.id into v_lead from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(btrim(p_lead_email)) and p.status = 'active';
  if v_admin is null or v_lead is null or v_admin = v_lead then
    raise exception 'two different people who have already signed up are required' using errcode = 'CV422';
  end if;
  insert into public.organizations (name) values (btrim(p_org_name)) returning id into v_org;
  insert into public.clinics (organization_id, name, timezone) values (v_org, btrim(p_clinic_name), coalesce(nullif(btrim(p_timezone), ''), 'Asia/Manila')) returning id into v_clinic;
  insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, requested_by, approved_by)
  values (v_org, v_admin, v_clinic, 'tech_admin', 'active', v_lead, v_lead) returning id into v_m_admin;
  insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, requested_by, approved_by)
  values (v_org, v_lead, v_clinic, 'clinical_lead', 'active', v_admin, v_admin) returning id into v_m_lead;
  perform private.audit(v_org, null, 'staff.bootstrap', 'clinic', v_clinic, null,
                        jsonb_build_object('techAdmin', v_admin, 'clinicalLead', v_lead, 'memberships', jsonb_build_array(v_m_admin, v_m_lead)),
                        'operator bootstrap of the first organization, clinic and staff');
  return jsonb_build_object('organizationId', v_org, 'clinicId', v_clinic, 'techAdminMembershipId', v_m_admin, 'clinicalLeadMembershipId', v_m_lead);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants for the new private helpers: no API role may execute any of them.
-- ---------------------------------------------------------------------------------------------
revoke all on function private.child_current_revisions(uuid[]), private.repoint_merged_holds(), private.notice_digest(text), private.notice_acknowledged(uuid),
  private.backfill_privacy_acknowledgements(), private.audit_row_in_clinic(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function private.bootstrap_initial_staff(text, text, text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- One-time data repair for state written before this migration.
-- ---------------------------------------------------------------------------------------------
select private.repoint_merged_holds();
select private.backfill_privacy_acknowledgements();
