-- 0023 Record transfer between clinics of the same organization. Blueprint refs: F26, BP17, BP33.
--  * A family that moves can have the child's record (enrollment) moved from one clinic to another. It needs three things, in order:
--    the guardian's consent (in the app, or recorded by staff who checked them in person), release by a clinical lead of the current
--    clinic, and acceptance by staff of the receiving clinic. Nothing moves before the last step.
--  * Nothing is copied or deleted: the record is one child in one organization. Access follows the enrollment, so the old clinic
--    loses access and the new clinic gains it at the moment of acceptance. History, certificates and audit stay as they are.
--  * Transfers between different organizations need a data-exchange agreement and are NOT supported (see external-validation.md).

create table public.record_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null,
  from_clinic_id uuid not null,
  to_clinic_id uuid not null,
  status text not null default 'requested' check (status in ('requested','ready','completed','declined','cancelled')),
  initiated_by uuid not null references public.profiles (id),
  consent_method text not null check (consent_method in ('app','in_person')),
  consent_at timestamptz not null default now(),
  consent_guardian_id uuid,
  reason text check (reason is null or length(reason) <= 300),
  release_by uuid references public.profiles (id),
  release_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  completed_by uuid references public.profiles (id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, from_clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, to_clinic_id) references public.clinics (organization_id, id),
  check (from_clinic_id <> to_clinic_id)
);
create unique index record_transfers_one_open_uq on public.record_transfers (child_id) where status in ('requested','ready');
create index record_transfers_from_idx on public.record_transfers (from_clinic_id, status);
create index record_transfers_to_idx on public.record_transfers (to_clinic_id, status);
create trigger record_transfers_no_delete before delete on public.record_transfers for each row execute function private.forbid_change();
create trigger record_transfers_no_truncate before truncate on public.record_transfers for each statement execute function private.forbid_change();
alter table public.record_transfers enable row level security;
revoke all on public.record_transfers from anon, authenticated;

create function private.transfer_target_ok(p_org uuid, p_from uuid, p_to uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_to is null or p_to = p_from or not exists (select 1 from public.clinics where id = p_to and organization_id = p_org and status = 'active') then
    raise exception 'choose another active clinic in this organization' using errcode = 'CV422';
  end if;
end $$;

-- Guardian asks for their child's record to move (their request is their consent).
create function public.request_record_transfer_guardian(p_operation_key uuid, p_child_id uuid, p_to_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid; v_org uuid; v_from uuid; v_prev jsonb; v_id uuid; v_g uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then raise exception 'not found' using errcode = 'CV404'; end if;
  select organization_id into v_org from public.children where id = v_canon;
  select clinic_id into v_from from public.child_clinic_enrollments where child_id = v_canon and status = 'active' order by is_primary desc, created_at limit 1;
  if v_from is null then raise exception 'this child is not enrolled at a clinic yet' using errcode = 'CV409'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'transfer.request_guardian', jsonb_build_object('ch', v_canon, 'to', p_to_clinic_id));
  if v_prev is not null then return v_prev; end if;
  perform private.transfer_target_ok(v_org, v_from, p_to_clinic_id);
  if exists (select 1 from public.record_transfers where child_id = v_canon and status in ('requested','ready')) then raise exception 'a transfer for this child is already in progress' using errcode = 'CV409'; end if;
  select id into v_g from public.guardians where profile_id = auth.uid() and organization_id = v_org and deleted_at is null order by created_at limit 1;
  insert into public.record_transfers (organization_id, child_id, from_clinic_id, to_clinic_id, initiated_by, consent_method, consent_guardian_id)
  values (v_org, v_canon, v_from, p_to_clinic_id, auth.uid(), 'app', v_g) returning id into v_id;
  perform private.audit(v_org, 'guardian', 'transfer.requested', 'child', v_canon, null, jsonb_build_object('transferId', v_id, 'from', v_from, 'to', p_to_clinic_id), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', v_id, 'status', 'requested'));
end $$;

-- Staff of the CURRENT clinic record that the guardian, checked in person, asked to move the record.
create function public.initiate_record_transfer_out(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_to_clinic_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'guardian.verify');
  v_prev := private.begin_command(v_org, p_operation_key, 'transfer.initiate_out', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'to', p_to_clinic_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not exists (select 1 from public.child_clinic_enrollments where child_id = v_canon and clinic_id = p_clinic_id and status = 'active') then return null; end if;
  perform private.transfer_target_ok(v_org, p_clinic_id, p_to_clinic_id);
  if not exists (select 1 from public.guardian_child_relationships where child_id = v_canon and status = 'active' and access_scope = 'full') then raise exception 'a verified guardian must ask for the transfer' using errcode = 'CV409'; end if;
  if exists (select 1 from public.record_transfers where child_id = v_canon and status in ('requested','ready')) then raise exception 'a transfer for this child is already in progress' using errcode = 'CV409'; end if;
  insert into public.record_transfers (organization_id, child_id, from_clinic_id, to_clinic_id, initiated_by, consent_method, reason)
  values (v_org, v_canon, p_clinic_id, p_to_clinic_id, auth.uid(), 'in_person', left(nullif(btrim(coalesce(p_reason, '')), ''), 300)) returning id into v_id;
  perform private.audit(v_org, 'guardian.verify', 'transfer.initiated', 'child', v_canon, null, jsonb_build_object('transferId', v_id, 'to', p_to_clinic_id), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', v_id, 'status', 'requested'));
end $$;

-- A clinical lead of the current clinic releases the record.
create function public.approve_record_transfer_release(p_operation_key uuid, p_clinic_id uuid, p_transfer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; t public.record_transfers;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'review.resolve');
  select * into t from public.record_transfers where id = p_transfer_id and organization_id = v_org and from_clinic_id = p_clinic_id for update;
  if t.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'transfer.release', jsonb_build_object('c', p_clinic_id, 't', p_transfer_id));
  if v_prev is not null then return v_prev; end if;
  if t.status <> 'requested' then raise exception 'this transfer is not waiting for release' using errcode = 'CV409'; end if;
  update public.record_transfers set status = 'ready', release_by = auth.uid(), release_at = now() where id = t.id;
  perform private.audit(v_org, 'review.resolve', 'transfer.released', 'child', t.child_id, jsonb_build_object('status', 'requested'), jsonb_build_object('status', 'ready'), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', t.id, 'status', 'ready'));
end $$;

-- Staff of the RECEIVING clinic accept a released transfer. This is the moment access moves.
create function public.accept_record_transfer(p_operation_key uuid, p_clinic_id uuid, p_transfer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; t public.record_transfers; v_cancelled int; a record;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.register');
  select * into t from public.record_transfers where id = p_transfer_id and organization_id = v_org and to_clinic_id = p_clinic_id for update;
  if t.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'transfer.accept', jsonb_build_object('c', p_clinic_id, 't', p_transfer_id));
  if v_prev is not null then return v_prev; end if;
  if t.status <> 'ready' then raise exception 'this transfer has not been released by the current clinic' using errcode = 'CV409'; end if;
  if exists (select 1 from public.encounters where child_id = t.child_id and clinic_id = t.from_clinic_id and status = 'open') then raise exception 'a visit is in progress at the current clinic; finish it first' using errcode = 'CV409'; end if;
  update public.child_clinic_enrollments set status = 'closed', ends_at = now(), is_primary = false, updated_by = auth.uid() where child_id = t.child_id and clinic_id = t.from_clinic_id and status in ('pending','active');
  update public.child_clinic_enrollments set is_primary = false, updated_by = auth.uid() where child_id = t.child_id and status = 'active';
  insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, is_primary, basis, created_by, updated_by)
  values (v_org, t.child_id, t.to_clinic_id, 'active', true, 'transfer', auth.uid(), auth.uid());
  -- Future bookings at the old clinic no longer apply; the family is told through the normal cancellation message.
  for a in select ap.id, ap.organization_id from public.appointments ap join public.clinic_sessions s on s.id = ap.session_id where ap.child_id = t.child_id and s.clinic_id = t.from_clinic_id and ap.status = 'confirmed' loop
    update public.appointments set status = 'cancelled', reason = 'record transferred to another clinic', updated_by = auth.uid() where id = a.id;
    update private.outbox_jobs set status = 'cancelled', updated_at = now() where organization_id = a.organization_id and status = 'queued' and dedupe_key = 'appt-confirm:' || a.id;
    perform private.enqueue(a.organization_id, 'appointment.cancellation', 'appointment', a.id, 'appt-cancel:' || a.id, '{}'::jsonb);
  end loop;
  get diagnostics v_cancelled = row_count;
  update public.record_transfers set status = 'completed', completed_by = auth.uid(), completed_at = now() where id = t.id;
  perform private.enqueue(v_org, 'record.transferred', 'record_transfer', t.id, 'record-transferred:' || t.id, jsonb_build_object('childId', t.child_id, 'toClinicId', t.to_clinic_id));
  perform private.audit(v_org, 'child.register', 'transfer.completed', 'child', t.child_id, jsonb_build_object('clinic', t.from_clinic_id), jsonb_build_object('clinic', t.to_clinic_id), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', t.id, 'status', 'completed', 'childId', t.child_id));
end $$;

-- Either clinic (before completion) or the guardian may stop it.
create function public.decline_record_transfer(p_operation_key uuid, p_clinic_id uuid, p_transfer_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; t public.record_transfers;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  select * into t from public.record_transfers where id = p_transfer_id and organization_id = v_org and p_clinic_id in (from_clinic_id, to_clinic_id) for update;
  if t.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_clinic_id = t.from_clinic_id then perform private.require_capability(p_clinic_id, 'review.resolve'); else perform private.require_capability(p_clinic_id, 'child.register'); end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'transfer.decline', jsonb_build_object('c', p_clinic_id, 't', p_transfer_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  if t.status not in ('requested','ready') then raise exception 'this transfer is already closed' using errcode = 'CV409'; end if;
  update public.record_transfers set status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = left(btrim(p_reason), 300) where id = t.id;
  perform private.audit(v_org, 'review.resolve', 'transfer.declined', 'child', t.child_id, jsonb_build_object('status', t.status), jsonb_build_object('status', 'declined'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', t.id, 'status', 'declined'));
end $$;

create function public.cancel_record_transfer_guardian(p_operation_key uuid, p_transfer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_prev jsonb; t public.record_transfers;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into t from public.record_transfers where id = p_transfer_id for update;
  if t.id is null or not private.guardian_has_full_access(t.child_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(t.organization_id, p_operation_key, 'transfer.cancel', jsonb_build_object('t', p_transfer_id));
  if v_prev is not null then return v_prev; end if;
  if t.status not in ('requested','ready') then raise exception 'this transfer is already closed' using errcode = 'CV409'; end if;
  update public.record_transfers set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), decision_note = 'cancelled by the guardian' where id = t.id;
  perform private.audit(t.organization_id, 'guardian', 'transfer.cancelled', 'child', t.child_id, jsonb_build_object('status', t.status), jsonb_build_object('status', 'cancelled'), null);
  return private.finish_command(t.organization_id, p_operation_key, jsonb_build_object('transferId', t.id, 'status', 'cancelled'));
end $$;

create function public.list_record_transfers(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['guardian.verify','review.resolve','child.register']);
  return jsonb_build_object(
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'childId', t.child_id, 'childName', c.display_name, 'recordNo', c.local_record_no, 'toClinic', (select name from public.clinics where id = t.to_clinic_id),
                  'consent', t.consent_method, 'requestedAt', t.created_at, 'releasedAt', t.release_at, 'note', t.decision_note) order by t.created_at desc)
               from public.record_transfers t join public.children c on c.id = t.child_id where t.from_clinic_id = p_clinic_id and t.created_at > now() - interval '90 days'), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'fromClinic', (select name from public.clinics where id = t.from_clinic_id), 'requestedAt', t.created_at, 'releasedAt', t.release_at, 'consent', t.consent_method,
                  'childName', case when t.status in ('ready','completed') then c.display_name end, 'recordNo', case when t.status in ('ready','completed') then c.local_record_no end,
                  'childId', case when t.status = 'completed' then t.child_id end) order by t.created_at desc)
               from public.record_transfers t join public.children c on c.id = t.child_id where t.to_clinic_id = p_clinic_id and t.created_at > now() - interval '90 days'), '[]'::jsonb),
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name) from public.clinics x where x.organization_id = v_org and x.status = 'active' and x.id <> p_clinic_id), '[]'::jsonb));
end $$;

create function public.my_record_transfers(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  return jsonb_build_object(
    'transfers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'toClinic', (select name from public.clinics where id = t.to_clinic_id), 'fromClinic', (select name from public.clinics where id = t.from_clinic_id),
                  'requestedAt', t.created_at, 'completedAt', t.completed_at, 'note', t.decision_note) order by t.created_at desc) from public.record_transfers t where t.child_id = v_canon), '[]'::jsonb),
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name) from public.clinics x where x.organization_id = (select organization_id from public.children where id = v_canon) and x.status = 'active'
                          and x.id not in (select clinic_id from public.child_clinic_enrollments where child_id = v_canon and status in ('pending','active'))), '[]'::jsonb));
end $$;

-- Outbox: tell the family when the move is complete (wrapper keeps earlier handlers intact).
alter function private.handle_outbox_job(private.outbox_jobs) rename to handle_outbox_job_prev;
create function private.handle_outbox_job(j private.outbox_jobs) returns text
language plpgsql security definer set search_path = '' as $$
declare v_child public.children; v_clinic text;
begin
  if j.job_type = 'record.transferred' then
    select * into v_child from public.children where id = (j.payload ->> 'childId')::uuid;
    select name into v_clinic from public.clinics where id = (j.payload ->> 'toClinicId')::uuid;
    if v_child.id is null or v_clinic is null then return 'cancelled'; end if;
    perform private.notify_guardians(j.organization_id, v_child.id, 'record', 'Record moved to another clinic', format('%s''s record now belongs to %s. Book any new visits there.', v_child.display_name, v_clinic), j.dedupe_key,
      format('%s: your child''s record moved here. Details are in the app.', v_clinic));
    return 'done';
  end if;
  return private.handle_outbox_job_prev(j);
end $$;

revoke all on function private.transfer_target_ok(uuid, uuid, uuid), private.handle_outbox_job(private.outbox_jobs), private.handle_outbox_job_prev(private.outbox_jobs) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'request_record_transfer_guardian(uuid,uuid,uuid)', 'initiate_record_transfer_out(uuid,uuid,uuid,uuid,text)', 'approve_record_transfer_release(uuid,uuid,uuid)', 'accept_record_transfer(uuid,uuid,uuid)',
    'decline_record_transfer(uuid,uuid,uuid,text)', 'cancel_record_transfer_guardian(uuid,uuid)', 'list_record_transfers(uuid)', 'my_record_transfers(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
