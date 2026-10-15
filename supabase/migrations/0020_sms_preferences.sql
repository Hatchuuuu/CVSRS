-- 0020 Contact preferences, SMS consent and the SMS delivery pipeline (provider-neutral). Blueprint refs: F18, BP22, BP31, M09.
--  * A child can receive full service without a phone or working SMS: SMS is an optional extra, never the only channel.
--  * A phone number is only used after clinic staff have checked it in person AND the guardian has opted in; changing the number resets both.
--  * SMS text is fixed and minimal: no child name, no vaccine, no clinical guidance. Details stay in the app.
--  * The database owns the message state machine (queued -> sending -> sent -> delivered | failed | undeliverable). A provider adapter only
--    claims messages, sends them and reports back; provider webhooks are idempotent and can arrive out of order.
--  * No provider is called from a SQL function or a business transaction.

alter table public.guardians add column sms_opt_in boolean not null default false;
alter table public.guardians add column contact_verified_by uuid references public.profiles (id);

-- Changing the phone number invalidates the in-person check and the opt-in.
create function private.guardian_phone_changed() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contact_phone is distinct from old.contact_phone then
    new.contact_verified_at := null;
    new.contact_verified_by := null;
    new.contact_status := 'unverified';
    new.sms_opt_in := false;
  end if;
  return new;
end $$;
create trigger guardians_phone_changed before update of contact_phone on public.guardians for each row execute function private.guardian_phone_changed();

create table public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  guardian_id uuid not null,
  action text not null check (action in ('granted','withdrawn')),
  source text not null check (source in ('app','provider_reply','phone_changed')),
  recorded_by uuid references public.profiles (id),
  recorded_at timestamptz not null default now(),
  foreign key (organization_id, guardian_id) references public.guardians (organization_id, id)
);
create index sms_consents_guardian_idx on public.sms_consents (guardian_id, recorded_at desc);

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  guardian_id uuid not null,
  kind text not null,
  body text not null check (length(body) between 1 and 320),
  dedupe_key text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','failed','undeliverable','opted_out')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  provider text,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, guardian_id) references public.guardians (organization_id, id),
  unique (guardian_id, dedupe_key)
);
create index sms_messages_ready_idx on public.sms_messages (status, available_at);
create unique index sms_messages_provider_idx on public.sms_messages (provider, provider_message_id) where provider_message_id is not null;

create table public.sms_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  provider_message_id text,
  status text not null,
  occurred_at timestamptz not null,
  applied boolean not null default false,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create trigger sms_consents_immutable before update or delete on public.sms_consents for each row execute function private.forbid_change();
create trigger sms_consents_no_truncate before truncate on public.sms_consents for each statement execute function private.forbid_change();
create trigger sms_events_immutable before delete on public.sms_events for each row execute function private.forbid_change();
create trigger sms_events_no_truncate before truncate on public.sms_events for each statement execute function private.forbid_change();
alter table public.sms_consents enable row level security;
alter table public.sms_messages enable row level security;
alter table public.sms_events enable row level security;
revoke all on public.sms_consents, public.sms_messages, public.sms_events from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Guardian preferences
-- ---------------------------------------------------------------------------------------------
create function private.mask_phone(p text) returns text language sql immutable set search_path = '' as $$
  select case when p is null or length(p) < 4 then null else repeat('•', greatest(length(regexp_replace(p, '\D', '', 'g')) - 3, 0)) || right(regexp_replace(p, '\D', '', 'g'), 3) end
$$;

create function public.get_contact_preferences() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then return null; end if;
  return (select jsonb_build_object('guardianId', g.id, 'language', g.preferred_language, 'phoneMasked', private.mask_phone(g.contact_phone), 'hasPhone', g.contact_phone is not null,
            'phoneChecked', g.contact_verified_at is not null and g.contact_phone is not null, 'smsOptIn', g.sms_opt_in)
            from public.guardians g where g.profile_id = auth.uid() and g.deleted_at is null order by g.created_at limit 1);
end $$;

create function public.set_contact_preferences(p_operation_key uuid, p_language text default null, p_phone text default null, p_sms_opt_in boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.guardians; v_prev jsonb; v_phone text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then raise exception 'forbidden' using errcode = 'CV403'; end if;
  select * into g from public.guardians where profile_id = auth.uid() and deleted_at is null order by created_at limit 1 for update;
  if g.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(g.organization_id, p_operation_key, 'contact.preferences', jsonb_build_object('l', p_language, 'p', p_phone, 'o', p_sms_opt_in));
  if v_prev is not null then return v_prev; end if;
  if p_language is not null then
    if p_language not in ('en','fil') then raise exception 'unsupported language' using errcode = 'CV422'; end if;
    update public.guardians set preferred_language = p_language, updated_by = auth.uid() where id = g.id;
  end if;
  if p_phone is not null then
    v_phone := nullif(regexp_replace(btrim(p_phone), '[\s\-()]', '', 'g'), '');
    if v_phone is not null and v_phone !~ '^\+?[0-9]{7,15}$' then raise exception 'enter a phone number using digits only (for example 0917 123 4567)' using errcode = 'CV422'; end if;
    if v_phone is distinct from g.contact_phone then
      update public.guardians set contact_phone = v_phone, updated_by = auth.uid() where id = g.id;   -- trigger resets the check and the opt-in
      if g.sms_opt_in then
        insert into public.sms_consents (organization_id, guardian_id, action, source, recorded_by) values (g.organization_id, g.id, 'withdrawn', 'phone_changed', auth.uid());
      end if;
    end if;
  end if;
  select * into g from public.guardians where id = g.id;
  if p_sms_opt_in is not null and p_sms_opt_in is distinct from g.sms_opt_in then
    if p_sms_opt_in then
      if g.contact_phone is null or g.contact_verified_at is null then raise exception 'the clinic must check your phone number in person before text messages can be turned on' using errcode = 'CV422'; end if;
    end if;
    update public.guardians set sms_opt_in = p_sms_opt_in, updated_by = auth.uid() where id = g.id;
    insert into public.sms_consents (organization_id, guardian_id, action, source, recorded_by) values (g.organization_id, g.id, case when p_sms_opt_in then 'granted' else 'withdrawn' end, 'app', auth.uid());
    if not p_sms_opt_in then
      update public.sms_messages set status = 'undeliverable', last_error_code = 'opted_out', updated_at = now() where guardian_id = g.id and status = 'queued';
    end if;
  end if;
  perform private.audit(g.organization_id, 'guardian', 'contact.preferences_changed', 'guardian', g.id, null, jsonb_build_object('language', p_language, 'phoneChanged', p_phone is not null, 'smsOptIn', p_sms_opt_in), null);
  return private.finish_command(g.organization_id, p_operation_key, public.get_contact_preferences());
end $$;

-- Staff confirm, in person, that the number on file belongs to this guardian.
create function public.verify_guardian_contact(p_operation_key uuid, p_clinic_id uuid, p_guardian_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; g public.guardians;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'guardian.verify');
  v_prev := private.begin_command(v_org, p_operation_key, 'contact.verify', jsonb_build_object('c', p_clinic_id, 'g', p_guardian_id));
  if v_prev is not null then return v_prev; end if;
  select * into g from public.guardians where id = p_guardian_id and organization_id = v_org and deleted_at is null for update;
  if g.id is null or not exists (select 1 from public.guardian_child_relationships r join public.child_clinic_enrollments e on e.child_id = r.child_id and e.clinic_id = p_clinic_id and e.status in ('pending','active')
                                   where r.guardian_id = g.id and r.status in ('provisional','active')) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
  if g.contact_phone is null then raise exception 'there is no phone number on file to check' using errcode = 'CV422'; end if;
  update public.guardians set contact_verified_at = now(), contact_verified_by = auth.uid(), contact_status = 'verified', updated_by = auth.uid() where id = g.id;
  perform private.audit(v_org, 'guardian.verify', 'contact.verified', 'guardian', g.id, null, jsonb_build_object('phone', private.mask_phone(g.contact_phone)), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('guardianId', g.id, 'phoneChecked', true));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Queueing: an SMS is created next to the in-app message, only for guardians who opted in on a checked number.
-- ---------------------------------------------------------------------------------------------
drop function private.notify_guardians(uuid, uuid, text, text, text, text);
create function private.notify_guardians(p_org uuid, p_child uuid, p_kind text, p_title text, p_body text, p_dedupe text, p_sms text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.messages (organization_id, recipient_profile_id, child_id, kind, title, body, dedupe_key)
  select distinct p_org, g.profile_id, private.canonical_child(p_child), p_kind, p_title, p_body, p_dedupe
    from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id
   where r.child_id = private.canonical_child(p_child) and r.status = 'active' and r.access_scope = 'full' and (r.ends_at is null or r.ends_at > now())
     and g.profile_id is not null and g.deleted_at is null
  on conflict (recipient_profile_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  if p_sms is not null then
    insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key)
    select distinct p_org, g.id, p_kind, p_sms, p_dedupe
      from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id
     where r.child_id = private.canonical_child(p_child) and r.status = 'active' and r.access_scope = 'full' and (r.ends_at is null or r.ends_at > now())
       and g.deleted_at is null and g.sms_opt_in and g.contact_phone is not null and g.contact_verified_at is not null
    on conflict (guardian_id, dedupe_key) do nothing;
  end if;
  return v_n;
end $$;
revoke all on function private.notify_guardians(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Delivery pipeline (called by the worker connection, never by API roles)
-- ---------------------------------------------------------------------------------------------
create function private.claim_sms(p_limit integer default 20) returns table (id uuid, phone text, body text, attempt integer)
language plpgsql security definer set search_path = '' as $$
begin
  -- a message stuck in "sending" (worker died) becomes claimable again; providers must treat the message id as an idempotency key
  update public.sms_messages set status = 'queued', updated_at = now() where status = 'sending' and locked_until < now();
  return query
  with c as (
    select m.id from public.sms_messages m join public.guardians g on g.id = m.guardian_id
     where m.status = 'queued' and m.available_at <= now() and g.sms_opt_in and g.contact_phone is not null and g.contact_verified_at is not null
     order by m.available_at, m.created_at limit least(greatest(coalesce(p_limit, 20), 1), 100) for update of m skip locked)
  update public.sms_messages m set status = 'sending', attempt_count = m.attempt_count + 1, locked_until = now() + interval '2 minutes', updated_at = now()
    from c join public.guardians g2 on true where m.id = c.id and g2.id = m.guardian_id
  returning m.id, g2.contact_phone, m.body, m.attempt_count;
end $$;

create function private.mark_sms(p_id uuid, p_outcome text, p_provider text default null, p_provider_message_id text default null, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.sms_messages;
begin
  select * into m from public.sms_messages where id = p_id for update;
  if m.id is null or m.status <> 'sending' then return; end if;
  if p_outcome = 'sent' then
    update public.sms_messages set status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id, locked_until = null, last_error_code = null, updated_at = now() where id = m.id;
  elsif p_outcome = 'retry' and m.attempt_count < 5 then
    update public.sms_messages set status = 'queued', locked_until = null, last_error_code = left(p_error, 60), available_at = now() + make_interval(mins => power(2, m.attempt_count)::int), updated_at = now() where id = m.id;
  else
    update public.sms_messages set status = 'failed', locked_until = null, last_error_code = left(coalesce(p_error, 'failed'), 60), updated_at = now() where id = m.id;
  end if;
end $$;

-- Provider status callbacks: idempotent per (provider, event id), tolerant of out-of-order delivery (status only moves forward).
create function private.record_sms_event(p_provider text, p_event_id text, p_provider_message_id text, p_status text, p_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_new uuid; m public.sms_messages; v_rank_old int; v_rank_new int;
begin
  if p_status not in ('sent','delivered','failed','undeliverable','opted_out') then raise exception 'unknown status' using errcode = 'CV422'; end if;
  insert into public.sms_events (provider, provider_event_id, provider_message_id, status, occurred_at) values (p_provider, p_event_id, p_provider_message_id, p_status, coalesce(p_at, now()))
  on conflict (provider, provider_event_id) do nothing returning id into v_new;
  if v_new is null then return false; end if;       -- duplicate callback
  select * into m from public.sms_messages where provider = p_provider and provider_message_id = p_provider_message_id for update;
  if m.id is null then return false; end if;
  v_rank_old := case m.status when 'queued' then 0 when 'sending' then 1 when 'sent' then 2 when 'delivered' then 3 else 4 end;
  v_rank_new := case p_status when 'sent' then 2 when 'delivered' then 3 else 4 end;
  if p_status = 'opted_out' then
    update public.sms_messages set status = 'opted_out', updated_at = now() where id = m.id;
    update public.guardians set sms_opt_in = false where id = m.guardian_id and sms_opt_in;
    insert into public.sms_consents (organization_id, guardian_id, action, source) select m.organization_id, m.guardian_id, 'withdrawn', 'provider_reply' where not exists
      (select 1 from public.sms_consents c where c.guardian_id = m.guardian_id and c.action = 'withdrawn' and c.source = 'provider_reply' and c.recorded_at > now() - interval '1 minute');
    update public.sms_messages set status = 'undeliverable', last_error_code = 'opted_out', updated_at = now() where guardian_id = m.guardian_id and status = 'queued';
  elsif v_rank_new > v_rank_old and not (m.status = 'delivered' and p_status in ('failed','undeliverable')) then
    update public.sms_messages set status = p_status, last_error_code = case when p_status in ('failed','undeliverable') then p_status else last_error_code end, updated_at = now() where id = m.id;
  else
    return false;    -- late or stale event: recorded, not applied
  end if;
  update public.sms_events set applied = true where id = v_new;
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Message wording: the SMS never carries a child's name, a vaccine or clinical guidance.
-- ---------------------------------------------------------------------------------------------
create or replace function private.handle_outbox_job(j private.outbox_jobs) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; s public.clinic_sessions; c public.certificates; v_child public.children; v_clinic public.clinics; v_when text;
begin
  if j.job_type in ('appointment.confirmation','appointment.cancellation','appointment.session_cancelled') then
    select * into a from public.appointments where id = j.aggregate_id;
    if a.id is null then return 'cancelled'; end if;
    select * into s from public.clinic_sessions where id = a.session_id;
    select * into v_clinic from public.clinics where id = s.clinic_id;
    select * into v_child from public.children where id = a.child_id;
    v_when := to_char(s.starts_at at time zone v_clinic.timezone, 'FMDay, FMDD FMMonth YYYY "at" FMHH12:MI AM');
    if j.job_type = 'appointment.confirmation' then
      if a.status not in ('confirmed','checked_in','fulfilled') then return 'cancelled'; end if;
      perform private.notify_guardians(j.organization_id, a.child_id, 'appointment', case when j.payload ? 'rescheduledFrom' then 'Visit rescheduled' else 'Visit booked' end,
        format('%s: %s at %s.', v_child.display_name, v_when, v_clinic.name), j.dedupe_key,
        format('%s: a visit is booked for %s. Details are in the app.', v_clinic.name, v_when));
    elsif j.job_type = 'appointment.cancellation' then
      perform private.notify_guardians(j.organization_id, a.child_id, 'appointment', 'Visit cancelled', format('The visit for %s on %s was cancelled.', v_child.display_name, v_when), j.dedupe_key,
        format('%s: a visit on %s was cancelled. Open the app to book another time.', v_clinic.name, v_when));
    else
      perform private.notify_guardians(j.organization_id, a.child_id, 'appointment', 'Clinic session cancelled',
        format('The clinic session on %s was cancelled, so the visit for %s will not take place. Please book another time.', v_when, v_child.display_name), j.dedupe_key,
        format('%s: the session on %s was cancelled. Open the app to book another time.', v_clinic.name, v_when));
    end if;
    return 'done';
  elsif j.job_type = 'vaccination.recorded' then
    select * into v_child from public.children where id = (j.payload ->> 'childId')::uuid;
    if v_child.id is null then return 'cancelled'; end if;
    perform private.notify_guardians(j.organization_id, v_child.id, 'record', 'Vaccination recorded', format('A vaccination was recorded for %s. Open the record to see what was given.', v_child.display_name), j.dedupe_key);
    return 'done';
  elsif j.job_type in ('certificate.issued','certificate.revoked') then
    select * into c from public.certificates where id = j.aggregate_id;
    if c.id is null then return 'cancelled'; end if;
    select * into v_child from public.children where id = c.child_id;
    select * into v_clinic from public.clinics where id = c.clinic_id;
    if j.job_type = 'certificate.issued' then
      perform private.notify_guardians(j.organization_id, c.child_id, 'certificate', 'Certificate ready', format('Certificate %s for %s is ready to download.', c.certificate_no, v_child.display_name), j.dedupe_key,
        format('%s: a certificate is ready in the app.', v_clinic.name));
    else
      perform private.notify_guardians(j.organization_id, c.child_id, 'certificate', 'Certificate no longer valid',
        format('Certificate %s for %s is no longer valid.%s Please ask the clinic about a new one.', c.certificate_no, v_child.display_name, case when j.payload ? 'replacedBy' then ' It was replaced by ' || (j.payload ->> 'replacedBy') || '.' else '' end), j.dedupe_key);
    end if;
    return 'done';
  elsif j.job_type = 'certificate.review' then
    for c in select x.* from public.certificates x where x.status = 'issued' and x.review_needed and x.id in
             (select ci.certificate_id from public.certificate_items ci join public.vaccination_revisions r on r.id = ci.vaccination_revision_id where r.event_id = j.aggregate_id) loop
      select * into v_child from public.children where id = c.child_id;
      perform private.notify_guardians(j.organization_id, c.child_id, 'certificate', 'Certificate under review',
        format('A record shown on certificate %s for %s was corrected. The clinic is reviewing the certificate.', c.certificate_no, v_child.display_name), 'cert-review:' || c.id || ':' || j.dedupe_key);
    end loop;
    return 'done';
  end if;
  raise exception 'no handler for job type' using errcode = 'CV422';
end $$;

-- Waiting-for-a-person view for reports.
create or replace function private.sms_backlog(p_org uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('queued', count(*) filter (where status in ('queued','sending')), 'failed', count(*) filter (where status = 'failed'))
    from public.sms_messages where organization_id = p_org and created_at > now() - interval '30 days'
$$;

revoke all on function private.guardian_phone_changed(), private.mask_phone(text), private.claim_sms(integer), private.mark_sms(uuid, text, text, text, text),
  private.record_sms_event(text, text, text, text, timestamptz), private.handle_outbox_job(private.outbox_jobs), private.sms_backlog(uuid) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['get_contact_preferences()', 'set_contact_preferences(uuid,text,text,boolean)', 'verify_guardian_contact(uuid,uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Staff view of guardians' contact status for one child (masked number; no message content).
create function public.list_child_guardian_contacts(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  perform private.require_capability(p_clinic_id, 'guardian.verify');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('relationshipId', r.id, 'guardianId', g.id, 'phoneMasked', private.mask_phone(g.contact_phone), 'hasPhone', g.contact_phone is not null,
            'phoneChecked', g.contact_verified_at is not null and g.contact_phone is not null, 'smsOptIn', g.sms_opt_in) order by g.full_name), '[]'::jsonb)
            from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where r.child_id = v_canon and r.status in ('provisional','active') and g.deleted_at is null);
end $$;
revoke all on function public.list_child_guardian_contacts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_child_guardian_contacts(uuid, uuid) to authenticated;
