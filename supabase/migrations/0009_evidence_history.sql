-- 0009 Outside-vaccination evidence, verification (as an immutable revision), and history reads.
-- Blueprint refs: BP15.C, BP18 (provenance), F04, T09. A parent/BHW report NEVER becomes a credited dose until a
-- clinician with evidence.verify maps it to an approved product and confirms the date; that confirmation is a new revision.

alter table public.record_review_cases add column vaccination_event_id uuid;
alter table public.record_review_cases add foreign key (organization_id, vaccination_event_id) references public.vaccination_events (organization_id, id);

-- Product presentation/conversion may not change once history references the product (BP28.3).
create function private.product_immutable_when_used() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.code, new.presentation, new.stock_unit, new.doses_per_container, new.administration_unit)
     is distinct from (old.code, old.presentation, old.stock_unit, old.doses_per_container, old.administration_unit)
     and exists (select 1 from public.vaccination_revisions r where r.product_id = old.id) then
    raise exception 'product presentation is immutable once used; create a new product record' using errcode = 'CV409';
  end if;
  return new;
end $$;
create trigger vaccine_products_immutable_when_used before update on public.vaccine_products for each row execute function private.product_immutable_when_used();

create function private.clean_outside_dose(p jsonb) returns jsonb language plpgsql stable set search_path = '' as $$
declare v_on date; v_prec text; v_text text := nullif(left(btrim(coalesce(p ->> 'productText', '')), 200), '');
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'dose details required' using errcode = 'CV400'; end if;
  if v_text is null then raise exception 'describe the vaccine that was given' using errcode = 'CV422'; end if;
  begin v_on := nullif(p ->> 'administeredOn', '')::date; exception when others then raise exception 'invalid date' using errcode = 'CV422'; end;
  v_prec := coalesce(nullif(p ->> 'precision', ''), case when v_on is null then 'unknown' else 'exact' end);
  if v_prec not in ('exact','month','year','unknown') then raise exception 'invalid date precision' using errcode = 'CV422'; end if;
  if v_prec = 'exact' and v_on is null then raise exception 'an exact date is required (or choose a less precise option)' using errcode = 'CV422'; end if;
  if v_prec = 'unknown' then v_on := null; end if;
  if v_on is not null and v_on > current_date + 1 then raise exception 'an administration date cannot be in the future' using errcode = 'CV422'; end if;
  return jsonb_build_object('productText', v_text, 'administeredOn', v_on, 'precision', v_prec,
    'provider', nullif(left(btrim(coalesce(p ->> 'provider', '')), 200), ''), 'lotText', nullif(left(btrim(coalesce(p ->> 'lotText', '')), 100), ''),
    'reference', nullif(left(btrim(coalesce(p ->> 'reference', '')), 200), ''));
end $$;

-- Guardian (verified, full access) reports a dose given elsewhere. Pending evidence only; no credit, no stock effect.
create function public.report_outside_dose(p_operation_key uuid, p_child_id uuid, p_dose jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_canon uuid; v_prev jsonb; v_clean jsonb; v_ev uuid; v_clinic uuid; v_g uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then raise exception 'not found' using errcode = 'CV404'; end if;
  select organization_id into v_org from public.children where id = v_canon;
  v_prev := private.begin_command(v_org, p_operation_key, 'evidence.report', jsonb_build_object('child', p_child_id, 'dose', p_dose));
  if v_prev is not null then return v_prev; end if;
  v_clean := private.clean_outside_dose(p_dose);
  select clinic_id into v_clinic from public.child_clinic_enrollments where child_id = v_canon and status in ('pending','active') order by is_primary desc, created_at limit 1;
  select id into v_g from public.guardians where organization_id = v_org and profile_id = auth.uid();
  insert into public.vaccination_events (organization_id, original_child_id, origin, external_provider, external_reference, source_operation_id, created_by)
  values (v_org, v_canon, 'parent_reported', v_clean ->> 'provider', v_clean ->> 'reference', p_operation_key, auth.uid()) returning id into v_ev;
  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, reported_product_text, administered_on, date_precision, reported_lot,
                                             external_vaccinator, clinic_id, source, verification_status, created_by)
  values (v_org, v_ev, 1, v_canon, v_clean ->> 'productText', (v_clean ->> 'administeredOn')::date, v_clean ->> 'precision', v_clean ->> 'lotText',
          v_clean ->> 'provider', v_clinic, 'parent_reported', 'pending_verification', auth.uid());
  insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, guardian_id, vaccination_event_id, reason, evidence, created_by, updated_by)
  values (v_org, v_clinic, 'clinical', v_canon, v_g, v_ev, 'outside vaccination evidence awaiting clinician verification',
          jsonb_build_object('reportedProduct', v_clean ->> 'productText', 'reportedDate', v_clean ->> 'administeredOn'), auth.uid(), auth.uid());
  perform private.audit(v_org, 'guardian', 'evidence.reported', 'vaccination_event', v_ev, null, jsonb_build_object('status', 'pending_verification'), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', v_ev, 'verificationStatus', 'pending_verification'));
end $$;

-- Staff enters an outside/historical dose, optionally verified on the spot against a document they have seen.
create function public.record_outside_dose_staff(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_dose jsonb, p_product_id uuid default null, p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_canon uuid; v_prev jsonb; v_clean jsonb; v_ev uuid; v_status text;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'evidence.verify');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'evidence.record_staff',
                                  jsonb_build_object('c', p_clinic_id, 'child', p_child_id, 'dose', p_dose, 'p', p_product_id, 'v', p_verified));
  if v_prev is not null then return v_prev; end if;
  v_clean := private.clean_outside_dose(p_dose);
  if p_verified then
    if p_product_id is null or not exists (select 1 from public.vaccine_products where id = p_product_id and organization_id = v_org and status = 'active') then
      raise exception 'verification needs an active approved product' using errcode = 'CV422';
    end if;
    if v_clean ->> 'precision' <> 'exact' then raise exception 'verification needs an exact date' using errcode = 'CV422'; end if;
  end if;
  v_status := case when p_verified then 'verified' else 'pending_verification' end;
  insert into public.vaccination_events (organization_id, original_child_id, origin, external_provider, external_reference, source_operation_id, created_by)
  values (v_org, v_canon, 'external', v_clean ->> 'provider', v_clean ->> 'reference', p_operation_key, auth.uid()) returning id into v_ev;
  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, reported_product_text, administered_on, date_precision, reported_lot,
                                             external_vaccinator, clinic_id, source, verification_status, approved_by, signed_at, created_by)
  values (v_org, v_ev, 1, v_canon, case when p_verified then p_product_id end, v_clean ->> 'productText', (v_clean ->> 'administeredOn')::date, v_clean ->> 'precision',
          v_clean ->> 'lotText', v_clean ->> 'provider', p_clinic_id, 'external_documented', v_status, case when p_verified then auth.uid() end, case when p_verified then now() end, auth.uid());
  perform private.audit(v_org, 'evidence.verify', 'evidence.recorded_by_staff', 'vaccination_event', v_ev, null, jsonb_build_object('status', v_status), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', v_ev, 'verificationStatus', v_status));
end $$;

-- Verification/rejection = a NEW immutable revision, attributed to the verifier. The original report stays recoverable.
create function public.verify_outside_dose(p_operation_key uuid, p_clinic_id uuid, p_event_id uuid, p_decision text, p_product_id uuid default null,
                                           p_administered_on date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; cur public.vaccination_revisions; v_on date; v_status text;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'evidence.verify');
  if p_decision not in ('verify','reject') then raise exception 'invalid decision' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'evidence.verify', jsonb_build_object('c', p_clinic_id, 'e', p_event_id, 'd', p_decision, 'p', p_product_id, 'on', p_administered_on, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  perform 1 from public.vaccination_events where id = p_event_id and organization_id = v_org for update;
  select * into cur from private.current_revisions where event_id = p_event_id;
  if cur.id is null or not private.child_in_clinic(private.canonical_child(cur.child_id), p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if cur.verification_status <> 'pending_verification' then raise exception 'evidence is not awaiting verification' using errcode = 'CV409'; end if;
  if p_decision = 'reject' then
    if p_note is null or length(btrim(p_note)) < 3 then raise exception 'a reason is required to reject evidence' using errcode = 'CV422'; end if;
    v_status := 'rejected';
  else
    if p_product_id is null or not exists (select 1 from public.vaccine_products where id = p_product_id and organization_id = v_org and status = 'active') then
      raise exception 'map the report to an active approved product' using errcode = 'CV422';
    end if;
    v_on := coalesce(p_administered_on, case when cur.date_precision = 'exact' then cur.administered_on end);
    if v_on is null then raise exception 'confirm an exact administration date' using errcode = 'CV422'; end if;
    if v_on > current_date + 1 then raise exception 'an administration date cannot be in the future' using errcode = 'CV422'; end if;
    v_status := 'verified';
  end if;
  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, reported_product_text, administered_on, date_precision, reported_lot,
                                             external_vaccinator, clinic_id, source, verification_status, approved_by, signed_at, reason, created_by)
  values (v_org, cur.event_id, cur.revision_no + 1, cur.child_id, case when v_status = 'verified' then p_product_id else cur.product_id end, cur.reported_product_text,
          case when v_status = 'verified' then v_on else cur.administered_on end, case when v_status = 'verified' then 'exact' else cur.date_precision end,
          cur.reported_lot, cur.external_vaccinator, coalesce(cur.clinic_id, p_clinic_id), cur.source, v_status, auth.uid(), now(), p_note, auth.uid());
  update public.record_review_cases set status = case when v_status = 'verified' then 'resolved' else 'rejected' end, resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', p_decision, 'note', p_note)
   where vaccination_event_id = cur.event_id and status in ('open','in_review');
  perform private.audit(v_org, 'evidence.verify', 'evidence.' || p_decision, 'vaccination_event', cur.event_id,
                        jsonb_build_object('status', cur.verification_status, 'revision', cur.revision_no), jsonb_build_object('status', v_status, 'revision', cur.revision_no + 1), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', cur.event_id, 'verificationStatus', v_status, 'revisionNo', cur.revision_no + 1));
end $$;

create function public.list_child_history(p_clinic_id uuid, p_child_id uuid) returns jsonb
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
    from private.current_revisions cr join public.vaccination_events e on e.id = cr.event_id left join public.vaccine_products p on p.id = cr.product_id
   where cr.child_id in (select private.child_ids_with_aliases(v_canon));
  perform private.audit(v_org, 'child.read_clinical', 'history.view', 'child', v_canon, null, null, null);
  return v_res;
end $$;

create function public.guardian_child_history(p_child_id uuid) returns jsonb
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
    from private.current_revisions cr left join public.vaccine_products p on p.id = cr.product_id
   where cr.child_id in (select private.child_ids_with_aliases(v_canon)) and cr.event_status = 'active');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'report_outside_dose(uuid,uuid,jsonb)', 'record_outside_dose_staff(uuid,uuid,uuid,jsonb,uuid,boolean)',
    'verify_outside_dose(uuid,uuid,uuid,text,uuid,date,text)', 'list_child_history(uuid,uuid)', 'guardian_child_history(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
