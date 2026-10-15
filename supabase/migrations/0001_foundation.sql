-- 0001 Foundation: tenancy, identity profiles, staff membership, capabilities, audit, idempotent command receipts.
-- Blueprint refs: BP14, BP28.1-28.2, BP31, BP32, BP34. Requirements: F01, F05, F24.
--
-- Conventions
--  * Tables that hold health/identity data live in `public` with RLS enabled and NO direct write grants.
--    All writes go through SECURITY DEFINER commands that authorize against live membership rows.
--  * Internal evidence (audit, receipts, settings) lives in the non-exposed `private` schema.
--  * Every SECURITY DEFINER function pins `search_path = ''` and schema-qualifies all references.
--  * Errors use stable SQLSTATEs: CV400 invalid, CV401 unauthenticated, CV403 forbidden,
--    CV404 not found / not visible, CV409 conflict, CV422 unprocessable.

create schema if not exists private;
revoke all on schema private from public, anon;
-- authenticated may resolve private.* names only to call explicitly-granted RLS helper functions; no private table is granted.
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Settings (deployment switches, never clinical rules)
-- ---------------------------------------------------------------------------------------------
create table private.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into private.settings(key, value) values
  ('require_staff_mfa', 'true'::jsonb),      -- staff capabilities need an aal2 session (BP32)
  ('demo_mode', 'false'::jsonb);              -- synthetic data + "DEMO - NOT FOR CLINICAL USE" banners

create function private.setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value)::text::boolean from private.settings where key = p_key), false)
$$;

-- ---------------------------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------------------------
create function private.touch_row() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;

create function private.forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'table % is append-only', tg_table_name using errcode = 'CV403';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Organizations, profiles, geography, clinics
-- ---------------------------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);
create trigger organizations_touch before update on public.organizations for each row execute function private.touch_row();

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null default '' ,
  locale text not null default 'en' check (locale in ('en','fil')),
  status text not null default 'active' check (status in ('active','suspended','deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_row();

-- Profile row is created by the server side of sign-up only; users cannot choose status/role (BP30).
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create table public.barangays (
  id uuid primary key default gen_random_uuid(),
  official_code text,
  name text not null,
  municipality text not null,
  province text not null
);
create unique index barangays_official_code_uq on public.barangays (official_code) where official_code is not null;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) > 0),
  barangay_id uuid references public.barangays (id),
  timezone text not null default 'Asia/Manila',
  contact_text text,
  address text not null default '',
  status text not null default 'active' check (status in ('active','suspended','closed')),
  operational_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id)
);
create index clinics_org_status_idx on public.clinics (organization_id, status);
create trigger clinics_touch before update on public.clinics for each row execute function private.touch_row();
-- Timezone must be a real IANA zone (local-date semantics depend on it); enforced by trigger because CHECK cannot query.
create function private.check_clinic_timezone() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.timezone) then
    raise exception 'invalid timezone %', new.timezone using errcode = 'CV422';
  end if;
  return new;
end $$;
create trigger clinics_timezone before insert or update of timezone on public.clinics for each row execute function private.check_clinic_timezone();

-- ---------------------------------------------------------------------------------------------
-- Capabilities and staff memberships (authoritative authorization source)
-- ---------------------------------------------------------------------------------------------
create function private.capability_vocab() returns text[] language sql immutable as $$
  select array[
    'child.search','child.register','child.read_clinical','guardian.verify',
    'appointment.manage','queue.manage','vaccination.record','evidence.verify',
    'correction.approve','inventory.manage','inventory.approve','rules.propose','rules.approve',
    'certificate.issue','review.resolve','admin.users','admin.config','grant.approve.clinical',
    'audit.read','report.run','export.identifiable','bhw.followup'
  ]
$$;

-- Capabilities whose grant requires clinical governance approval rather than technical-admin approval.
create function private.clinical_caps() returns text[] language sql immutable as $$
  select array[
    'child.read_clinical','vaccination.record','evidence.verify','correction.approve','inventory.approve',
    'rules.approve','certificate.issue','review.resolve','grant.approve.clinical','audit.read','export.identifiable'
  ]
$$;

create function private.role_preset(p_role text) returns text[] language sql immutable as $$
  select case p_role
    when 'assistant'      then array['child.search','child.register','guardian.verify','appointment.manage','queue.manage']
    when 'clinical_staff' then array['child.search','child.register','child.read_clinical','guardian.verify','appointment.manage',
                                     'queue.manage','vaccination.record','evidence.verify','rules.propose']
    when 'clinical_lead'  then array['child.search','child.register','child.read_clinical','guardian.verify','appointment.manage',
                                     'queue.manage','vaccination.record','evidence.verify','rules.propose','correction.approve',
                                     'rules.approve','review.resolve','certificate.issue','audit.read','export.identifiable',
                                     'inventory.approve','grant.approve.clinical','report.run']
    when 'inventory'      then array['inventory.manage']
    when 'bhw'            then array['bhw.followup']
    when 'tech_admin'     then array['admin.users','admin.config']
    else array[]::text[]
  end
$$;

create table public.staff_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  profile_id uuid not null references public.profiles (id),
  clinic_id uuid not null,
  role_code text not null check (role_code in ('assistant','clinical_staff','clinical_lead','inventory','bhw','tech_admin')),
  capabilities text[] not null default '{}' check (capabilities <@ private.capability_vocab()),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  status text not null default 'pending_approval' check (status in ('pending_approval','active','suspended','revoked','rejected')),
  requested_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  unique (organization_id, id),
  check (valid_until is null or valid_until > valid_from),
  -- Two-person control: an active grant needs an approver who is not the grantee.
  check (status <> 'active' or approved_by is not null),
  check (approved_by is null or approved_by <> profile_id)
);
create unique index staff_memberships_one_live_uq
  on public.staff_memberships (profile_id, clinic_id, role_code) where status in ('pending_approval','active');
create index staff_memberships_lookup_idx on public.staff_memberships (profile_id, status, clinic_id);
create trigger staff_memberships_touch before update on public.staff_memberships for each row execute function private.touch_row();

-- ---------------------------------------------------------------------------------------------
-- Audit and idempotent command receipts (append-only, non-exposed)
-- ---------------------------------------------------------------------------------------------
create table private.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  actor_id uuid references public.profiles (id),
  actor_capability text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  server_time timestamptz not null default clock_timestamp(),
  request_id uuid not null,
  device_id uuid,
  session_reference text,
  outcome text not null check (outcome in ('success','denied','failed')),
  system_job_id text,
  check (actor_id is not null or system_job_id is not null)
);
create index audit_entity_idx on private.audit_logs (entity_type, entity_id, server_time desc);
create index audit_actor_idx on private.audit_logs (actor_id, server_time desc);
create index audit_request_idx on private.audit_logs (request_id);
create trigger audit_logs_immutable before update or delete on private.audit_logs for each row execute function private.forbid_change();
create trigger audit_logs_no_truncate before truncate on private.audit_logs for each statement execute function private.forbid_change();

create function private.request_id() returns uuid language sql stable set search_path = '' as $$
  select coalesce(nullif(pg_catalog.current_setting('app.request_id', true), '')::uuid, gen_random_uuid())
$$;

create function private.audit(
  p_org uuid, p_capability text, p_action text, p_entity_type text, p_entity_id uuid,
  p_before jsonb, p_after jsonb, p_reason text, p_outcome text default 'success'
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into private.audit_logs (organization_id, actor_id, actor_capability, action, entity_type, entity_id,
                                  before, after, reason, request_id, outcome, system_job_id)
  values (p_org, auth.uid(), p_capability, p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason,
          private.request_id(), p_outcome, case when auth.uid() is null then 'system' end);
end $$;

create table private.command_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  operation_key uuid not null,
  actor_id uuid not null references public.profiles (id),
  device_id uuid,
  command_type text not null,
  payload_hash text not null,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  result jsonb,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organization_id, operation_key)
);
create function private.receipt_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'receipts cannot be deleted' using errcode = 'CV403'; end if;
  if old.status = 'completed' then raise exception 'completed receipts are immutable' using errcode = 'CV403'; end if;
  return new;
end $$;
create trigger command_receipts_guard before update or delete on private.command_receipts for each row execute function private.receipt_guard();

-- Returns the stored result when this operation already completed with the same payload (idempotent replay),
-- raises CV409 when the key is reused for a different payload or actor, and returns null for a new operation.
create function private.begin_command(p_org uuid, p_key uuid, p_type text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8')), 'hex');
  v_id uuid;
  r private.command_receipts;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if p_key is null then raise exception 'operation key is required' using errcode = 'CV400'; end if;
  insert into private.command_receipts (organization_id, operation_key, actor_id, command_type, payload_hash)
  values (p_org, p_key, auth.uid(), p_type, v_hash)
  on conflict (organization_id, operation_key) do nothing
  returning id into v_id;
  if v_id is not null then return null; end if;
  select * into r from private.command_receipts where organization_id = p_org and operation_key = p_key;
  if r.actor_id <> auth.uid() or r.command_type <> p_type or r.payload_hash <> v_hash then
    raise exception 'operation key reused with different content' using errcode = 'CV409';
  end if;
  return r.result;
end $$;

create function private.finish_command(p_org uuid, p_key uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update private.command_receipts set status = 'completed', result = p_result, completed_at = now()
   where organization_id = p_org and operation_key = p_key and actor_id = auth.uid();
  return p_result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Authorization helpers (authoritative membership checks; never trust client metadata)
-- ---------------------------------------------------------------------------------------------
create function private.session_ok() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
$$;

create function private.mfa_ok() returns boolean language sql stable security definer set search_path = '' as $$
  select not private.setting_bool('require_staff_mfa') or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create function private.has_capability(p_clinic uuid, p_cap text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.session_ok() and private.mfa_ok() and exists (
    select 1
      from public.staff_memberships m
      join public.clinics c on c.id = m.clinic_id and c.organization_id = m.organization_id
     where m.profile_id = auth.uid()
       and m.clinic_id = p_clinic
       and m.status = 'active'
       and c.status = 'active'
       and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
       and (p_cap = any (private.role_preset(m.role_code)) or p_cap = any (m.capabilities))
  )
$$;

create function private.clinics_with(p_cap text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.clinic_id
    from public.staff_memberships m
    join public.clinics c on c.id = m.clinic_id and c.organization_id = m.organization_id
   where private.session_ok() and private.mfa_ok()
     and m.profile_id = auth.uid() and m.status = 'active' and c.status = 'active'
     and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
     and (p_cap = any (private.role_preset(m.role_code)) or p_cap = any (m.capabilities))
$$;

create function private.require_capability(p_clinic uuid, p_cap text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.has_capability(p_clinic, p_cap) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Public read surface for this migration
-- ---------------------------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.barangays enable row level security;
alter table public.clinics enable row level security;
alter table public.staff_memberships enable row level security;

revoke all on public.organizations, public.profiles, public.barangays, public.clinics, public.staff_memberships from anon, authenticated;

-- Own profile: read, and edit only safe fields (no status/role escalation: column-level grant).
grant select on public.profiles to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;
create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and status = 'active') with check (id = auth.uid() and status = 'active');

-- Own memberships are visible to their holder (drives the UI's clinic/role context; not an authorization source).
grant select on public.staff_memberships to authenticated;
create policy memberships_read_own on public.staff_memberships for select to authenticated using (profile_id = auth.uid());

-- Reference geography is not sensitive.
grant select on public.barangays to anon, authenticated;
create policy barangays_read on public.barangays for select to anon, authenticated using (true);

-- Public service information (P01): a curated view exposes only non-sensitive clinic columns.
create view public.public_clinics as
  select id, name, address, contact_text, timezone from public.clinics where status = 'active';
revoke all on public.public_clinics from anon, authenticated;
grant select on public.public_clinics to anon, authenticated;

-- Caller context for the UI. Does not decide authorization; every command re-checks in the database.
create function public.get_my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profileId', p.id, 'displayName', p.display_name, 'locale', p.locale, 'status', p.status,
    'mfa', private.mfa_ok(),
    'demoMode', private.setting_bool('demo_mode'),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('membershipId', m.id, 'clinicId', m.clinic_id, 'clinicName', c.name, 'role', m.role_code,
                                          'status', m.status, 'validUntil', m.valid_until))
        from public.staff_memberships m join public.clinics c on c.id = m.clinic_id
       where m.profile_id = p.id and m.status in ('active','pending_approval')), '[]'::jsonb))
  from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.get_my_context() from public, anon, authenticated;
grant execute on function public.get_my_context() to authenticated;

-- Helper functions in `private` are not callable by API roles (schema usage revoked) but make that explicit:
revoke all on all functions in schema private from public, anon, authenticated;
-- RLS policy helpers must be executable by the querying role:
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok() to authenticated;
