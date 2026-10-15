-- 0024 Clinic profile settings, reviewed care information, audit search and operations status.
-- Blueprint refs: P01, P13, P34, P37, P39, P40, F19, F23.
--  * Clinic contact details and opening hours are typed in by the clinic; the public pages show exactly that, or say nothing was configured.
--  * Care information is written by the clinic and approved by a second person before families can see it. The system ships none.
--  * The audit search is read-only and organization-wide for holders of audit.read; every search is itself audited.
--  * Operations status only reports facts that were recorded: an unknown health stays "unknown", never "ok".

-- ---------------------------------------------------------------------------------------------
-- Clinic profile
-- ---------------------------------------------------------------------------------------------
alter table public.clinics add column hours_text text check (hours_text is null or length(hours_text) <= 500);

create or replace function public.list_public_clinics() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'address', address, 'contact', contact_text, 'hours', hours_text) order by name), '[]'::jsonb)
    from public.clinics where status = 'active'
$$;

create function public.update_clinic_profile(p_operation_key uuid, p_clinic_id uuid, p_name text, p_address text, p_contact text, p_hours text, p_timezone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; c public.clinics;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'admin.config');
  v_prev := private.begin_command(v_org, p_operation_key, 'clinic.profile', jsonb_build_object('c', p_clinic_id, 'n', p_name, 'a', p_address, 'ct', p_contact, 'h', p_hours, 'tz', p_timezone));
  if v_prev is not null then return v_prev; end if;
  if p_name is null or length(btrim(p_name)) = 0 or length(p_name) > 120 then raise exception 'enter the clinic name' using errcode = 'CV422'; end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'choose a valid time zone (for example Asia/Manila)' using errcode = 'CV422'; end if;
  if length(coalesce(p_address, '')) > 300 or length(coalesce(p_contact, '')) > 300 or length(coalesce(p_hours, '')) > 500 then raise exception 'one of the texts is too long' using errcode = 'CV422'; end if;
  select * into c from public.clinics where id = p_clinic_id for update;
  update public.clinics set name = btrim(p_name), address = btrim(coalesce(p_address, '')), contact_text = nullif(btrim(coalesce(p_contact, '')), ''), hours_text = nullif(btrim(coalesce(p_hours, '')), ''), timezone = p_timezone, updated_by = auth.uid()
   where id = p_clinic_id;
  perform private.audit(v_org, 'admin.config', 'clinic.profile_changed', 'clinic', p_clinic_id,
    jsonb_build_object('name', c.name, 'address', c.address, 'contact', c.contact_text, 'hours', c.hours_text, 'timezone', c.timezone),
    jsonb_build_object('name', btrim(p_name), 'address', btrim(coalesce(p_address, '')), 'contact', nullif(btrim(coalesce(p_contact, '')), ''), 'hours', nullif(btrim(coalesce(p_hours, '')), ''), 'timezone', p_timezone), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('clinicId', p_clinic_id));
end $$;

create function public.get_clinic_profile(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_capability(p_clinic_id, 'admin.config');
  return (select jsonb_build_object('name', name, 'address', address, 'contact', contact_text, 'hours', hours_text, 'timezone', timezone) from public.clinics where id = p_clinic_id);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reviewed care information (P13, P37)
-- ---------------------------------------------------------------------------------------------
create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,58}$'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  unique (clinic_id, code),
  unique (organization_id, id)
);
create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  item_id uuid not null,
  language text not null check (language in ('en','fil')),
  title text not null check (length(btrim(title)) between 3 and 150),
  body text not null check (length(btrim(body)) between 20 and 4000),
  source_reference text not null check (length(btrim(source_reference)) >= 3),
  status text not null default 'draft' check (status in ('draft','submitted','active','rejected','retired')),
  authored_by uuid not null references public.profiles (id),
  reviewed_by uuid references public.profiles (id),
  review_note text,
  reviewed_on date,
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, item_id) references public.content_items (organization_id, id),
  check (reviewed_by is null or reviewed_by <> authored_by)
);
create unique index content_one_active_uq on public.content_versions (item_id, language) where status = 'active';
create index content_versions_item_idx on public.content_versions (item_id, status);
create function private.content_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'care information cannot be deleted' using errcode = 'CV403'; end if;
  if old.status <> 'draft' and (new.title, new.body, new.source_reference, new.language) is distinct from (old.title, old.body, old.source_reference, old.language) then
    raise exception 'submitted or published wording cannot be edited' using errcode = 'CV403';
  end if;
  return new;
end $$;
create trigger content_versions_guard before update or delete on public.content_versions for each row execute function private.content_guard();
create trigger content_versions_no_truncate before truncate on public.content_versions for each statement execute function private.forbid_change();
create trigger content_items_no_truncate before truncate on public.content_items for each statement execute function private.forbid_change();
alter table public.content_items enable row level security;
alter table public.content_versions enable row level security;
revoke all on public.content_items, public.content_versions from anon, authenticated;

create function public.save_content_draft(p_operation_key uuid, p_clinic_id uuid, p_code text, p_language text, p_title text, p_body text, p_source text, p_version_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_item uuid; v_ver public.content_versions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if not (private.has_capability(p_clinic_id, 'admin.config') or private.has_capability(p_clinic_id, 'rules.propose')) then perform private.require_capability(p_clinic_id, 'admin.config'); end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'content.save', jsonb_build_object('c', p_clinic_id, 'code', p_code, 'l', p_language, 't', p_title, 'b', p_body, 's', p_source, 'v', p_version_id));
  if v_prev is not null then return v_prev; end if;
  if p_language not in ('en','fil') then raise exception 'choose a language' using errcode = 'CV422'; end if;
  if p_title is null or length(btrim(p_title)) < 3 or p_body is null or length(btrim(p_body)) < 20 then raise exception 'write a title and the full text (at least 20 characters)' using errcode = 'CV422'; end if;
  if p_source is null or length(btrim(p_source)) < 3 then raise exception 'name where this information comes from' using errcode = 'CV422'; end if;
  if p_version_id is null then
    if p_code is null or p_code !~ '^[a-z0-9][a-z0-9-]{1,58}$' then raise exception 'use a short code of lowercase letters, numbers and dashes' using errcode = 'CV422'; end if;
    insert into public.content_items (organization_id, clinic_id, code, created_by) values (v_org, p_clinic_id, p_code, auth.uid()) on conflict (clinic_id, code) do nothing;
    select id into v_item from public.content_items where clinic_id = p_clinic_id and code = p_code;
    if exists (select 1 from public.content_versions where item_id = v_item and language = p_language and status in ('draft','submitted')) then raise exception 'a version in this language is already being prepared' using errcode = 'CV409'; end if;
    insert into public.content_versions (organization_id, item_id, language, title, body, source_reference, authored_by) values (v_org, v_item, p_language, btrim(p_title), btrim(p_body), btrim(p_source), auth.uid()) returning * into v_ver;
  else
    select v.* into v_ver from public.content_versions v join public.content_items i on i.id = v.item_id where v.id = p_version_id and i.clinic_id = p_clinic_id for update of v;
    if v_ver.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
    if v_ver.status <> 'draft' then raise exception 'only a draft can be edited' using errcode = 'CV409'; end if;
    if v_ver.authored_by <> auth.uid() then raise exception 'only the author can edit a draft' using errcode = 'CV403'; end if;
    update public.content_versions set language = p_language, title = btrim(p_title), body = btrim(p_body), source_reference = btrim(p_source) where id = v_ver.id returning * into v_ver;
  end if;
  perform private.audit(v_org, 'admin.config', 'content.drafted', 'content_version', v_ver.id, null, jsonb_build_object('language', p_language), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', v_ver.id, 'status', 'draft'));
end $$;

create function public.submit_content(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v public.content_versions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select cv.* into v from public.content_versions cv join public.content_items i on i.id = cv.item_id where cv.id = p_version_id and i.clinic_id = p_clinic_id for update of cv;
  if v.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if v.authored_by <> auth.uid() then raise exception 'only the author can submit' using errcode = 'CV403'; end if;
  perform private.require_any(p_clinic_id, array['admin.config','rules.propose']);
  v_prev := private.begin_command(v_org, p_operation_key, 'content.submit', jsonb_build_object('c', p_clinic_id, 'v', p_version_id));
  if v_prev is not null then return v_prev; end if;
  if v.status <> 'draft' then raise exception 'only a draft can be submitted' using errcode = 'CV409'; end if;
  update public.content_versions set status = 'submitted' where id = v.id;
  perform private.audit(v_org, 'admin.config', 'content.submitted', 'content_version', v.id, null, null, null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', v.id, 'status', 'submitted'));
end $$;

create function public.review_content(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v public.content_versions; v_status text;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.approve');
  select cv.* into v from public.content_versions cv join public.content_items i on i.id = cv.item_id where cv.id = p_version_id and i.clinic_id = p_clinic_id for update of cv;
  if v.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'content.review', jsonb_build_object('c', p_clinic_id, 'v', p_version_id, 'd', p_decision, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if p_decision not in ('approve','reject') then raise exception 'choose approve or reject' using errcode = 'CV422'; end if;
  if p_decision = 'reject' and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'say why it is rejected' using errcode = 'CV422'; end if;
  if v.status <> 'submitted' then raise exception 'only a submitted version can be reviewed' using errcode = 'CV409'; end if;
  if v.authored_by = auth.uid() then raise exception 'the author cannot approve their own wording' using errcode = 'CV403'; end if;
  v_status := case when p_decision = 'approve' then 'active' else 'rejected' end;
  if v_status = 'active' then
    update public.content_versions set status = 'retired' where item_id = v.item_id and language = v.language and status = 'active' and id <> v.id;
  end if;
  update public.content_versions set status = v_status, reviewed_by = auth.uid(), reviewed_on = (now() at time zone (select timezone from public.clinics where id = p_clinic_id))::date, review_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300) where id = v.id;
  perform private.audit(v_org, 'rules.approve', 'content.' || v_status, 'content_version', v.id, jsonb_build_object('status', 'submitted'), jsonb_build_object('status', v_status), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', v.id, 'status', v_status));
end $$;

create function public.retire_content(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v public.content_versions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.approve');
  select cv.* into v from public.content_versions cv join public.content_items i on i.id = cv.item_id where cv.id = p_version_id and i.clinic_id = p_clinic_id for update of cv;
  if v.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'content.retire', jsonb_build_object('c', p_clinic_id, 'v', p_version_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  if v.status <> 'active' then raise exception 'only published information can be withdrawn' using errcode = 'CV409'; end if;
  update public.content_versions set status = 'retired', review_note = left(btrim(p_reason), 300) where id = v.id;
  perform private.audit(v_org, 'rules.approve', 'content.retired', 'content_version', v.id, null, null, p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', v.id, 'status', 'retired'));
end $$;

create function public.list_content(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_any(p_clinic_id, array['admin.config','rules.propose','rules.approve']);
  return (select coalesce(jsonb_agg(jsonb_build_object('versionId', v.id, 'code', i.code, 'language', v.language, 'title', v.title, 'body', v.body, 'source', v.source_reference, 'status', v.status,
            'authoredBy', (select display_name from public.profiles where id = v.authored_by), 'authoredById', v.authored_by, 'reviewedBy', (select display_name from public.profiles where id = v.reviewed_by), 'reviewedOn', v.reviewed_on, 'reviewNote', v.review_note)
            order by i.code, v.language, v.created_at desc), '[]'::jsonb)
            from public.content_versions v join public.content_items i on i.id = v.item_id where i.clinic_id = p_clinic_id);
end $$;

-- Families see only ACTIVE (approved) information of the clinics their children belong to, in their language, with the English version marked as a fallback.
create function public.guardian_care_content() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_lang text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then return null; end if;
  select coalesce((select preferred_language from public.guardians where profile_id = auth.uid() and deleted_at is null order by created_at limit 1), 'en') into v_lang;
  return (select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'title', x.title, 'body', x.body, 'source', x.source_reference, 'reviewedOn', x.reviewed_on, 'clinic', x.clinic, 'language', x.language, 'fallback', x.language <> v_lang) order by x.clinic, x.code), '[]'::jsonb)
    from (select distinct on (i.id) i.code, v.title, v.body, v.source_reference, v.reviewed_on, v.language, c.name clinic
            from public.content_items i join public.clinics c on c.id = i.clinic_id join public.content_versions v on v.item_id = i.id and v.status = 'active'
           where i.clinic_id in (select e.clinic_id from public.child_clinic_enrollments e join public.guardian_child_relationships r on r.child_id = e.child_id join public.guardians g on g.id = r.guardian_id
                                  where g.profile_id = auth.uid() and e.status in ('pending','active') and r.status = 'active' and r.access_scope = 'full')
           order by i.id, (v.language = v_lang) desc, v.reviewed_on desc) x);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Audit search (P39)
-- ---------------------------------------------------------------------------------------------
create function public.search_audit(p_clinic_id uuid, p_action text default null, p_actor uuid default null, p_from timestamptz default null, p_to timestamptz default null, p_before timestamptz default null, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 100); v_rows jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'audit.read');
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'the end of the period is before its start' using errcode = 'CV422'; end if;
  select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into v_rows from (
    select a.server_time t, jsonb_build_object('id', a.id, 'at', a.server_time, 'action', a.action, 'capability', a.actor_capability, 'entityType', a.entity_type, 'entityId', a.entity_id, 'outcome', a.outcome, 'reason', a.reason,
             'actor', (select display_name from public.profiles where id = a.actor_id), 'actorId', a.actor_id, 'system', a.system_job_id, 'before', a.before, 'after', a.after) j
      from private.audit_logs a
     where a.organization_id = v_org and (p_action is null or a.action like replace(replace(p_action, '%', ''), '_', '\_') || '%') and (p_actor is null or a.actor_id = p_actor)
       and (p_from is null or a.server_time >= p_from) and (p_to is null or a.server_time <= p_to) and (p_before is null or a.server_time < p_before)
     order by a.server_time desc limit v_lim) x;
  perform private.audit(v_org, 'audit.read', 'audit.searched', 'clinic', p_clinic_id, null, jsonb_build_object('action', p_action, 'actor', p_actor, 'from', p_from, 'to', p_to, 'returned', jsonb_array_length(v_rows)), null);
  return jsonb_build_object('rows', v_rows, 'nextBefore', case when jsonb_array_length(v_rows) = v_lim then (v_rows -> (v_lim - 1)) ->> 'at' end);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Operations status (P40): only recorded facts
-- ---------------------------------------------------------------------------------------------
create table public.ops_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  kind text not null check (kind in ('restore_drill','database_backup','file_backup')),
  result text not null check (result in ('passed','failed')),
  performed_on date not null check (performed_on <= current_date + 1),
  evidence text not null check (length(btrim(evidence)) >= 5),
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null default now()
);
create trigger ops_checks_immutable before update or delete on public.ops_checks for each row execute function private.forbid_change();
create trigger ops_checks_no_truncate before truncate on public.ops_checks for each statement execute function private.forbid_change();
alter table public.ops_checks enable row level security;
revoke all on public.ops_checks from anon, authenticated;

create function public.record_ops_check(p_operation_key uuid, p_clinic_id uuid, p_kind text, p_result text, p_performed_on date, p_evidence text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'admin.config');
  v_prev := private.begin_command(v_org, p_operation_key, 'ops.check', jsonb_build_object('c', p_clinic_id, 'k', p_kind, 'r', p_result, 'd', p_performed_on, 'e', p_evidence));
  if v_prev is not null then return v_prev; end if;
  if p_kind not in ('restore_drill','database_backup','file_backup') or p_result not in ('passed','failed') then raise exception 'choose what was checked and the result' using errcode = 'CV422'; end if;
  if p_performed_on is null or p_performed_on > private.local_today(p_clinic_id) then raise exception 'the date cannot be in the future' using errcode = 'CV422'; end if;
  if p_evidence is null or length(btrim(p_evidence)) < 5 then raise exception 'say where the evidence is (a ticket, log or document reference)' using errcode = 'CV422'; end if;
  insert into public.ops_checks (organization_id, kind, result, performed_on, evidence, recorded_by) values (v_org, p_kind, p_result, p_performed_on, left(btrim(p_evidence), 300), auth.uid()) returning id into v_id;
  perform private.audit(v_org, 'admin.config', 'ops.check_recorded', 'clinic', p_clinic_id, null, jsonb_build_object('kind', p_kind, 'result', p_result), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('checkId', v_id));
end $$;

create function public.get_ops_status(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; k text; v_checks jsonb := '{}'::jsonb; r public.ops_checks;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['admin.config','audit.read']);
  foreach k in array array['restore_drill','database_backup','file_backup'] loop
    select * into r from public.ops_checks where organization_id = v_org and kind = k order by performed_on desc, recorded_at desc limit 1;
    v_checks := v_checks || jsonb_build_object(k, case when r.id is null then null else jsonb_build_object('result', r.result, 'performedOn', r.performed_on, 'evidence', r.evidence, 'daysAgo', private.local_today(p_clinic_id) - r.performed_on) end);
  end loop;
  return jsonb_build_object('checks', v_checks,
    'jobs', jsonb_build_object('queued', (select count(*) from private.outbox_jobs where organization_id = v_org and status = 'queued'), 'processing', (select count(*) from private.outbox_jobs where organization_id = v_org and status = 'processing'),
      'failed', (select count(*) from private.outbox_jobs where organization_id = v_org and status = 'failed'), 'oldestQueuedMinutes', (select extract(epoch from (now() - min(available_at)))::int / 60 from private.outbox_jobs where organization_id = v_org and status = 'queued' and available_at <= now())),
    'sms', private.sms_backlog(v_org),
    'lastAudit', (select max(server_time) from private.audit_logs where organization_id = v_org));
end $$;

revoke all on function private.content_guard() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'update_clinic_profile(uuid,uuid,text,text,text,text,text)', 'get_clinic_profile(uuid)', 'save_content_draft(uuid,uuid,text,text,text,text,text,uuid)', 'submit_content(uuid,uuid,uuid)', 'review_content(uuid,uuid,uuid,text,text)',
    'retire_content(uuid,uuid,uuid,text)', 'list_content(uuid)', 'guardian_care_content()', 'search_audit(uuid,text,uuid,timestamptz,timestamptz,timestamptz,integer)', 'record_ops_check(uuid,uuid,text,text,date,text)', 'get_ops_status(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
