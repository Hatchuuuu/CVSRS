-- 0003 Child & guardian registry, verified relationships, clinic enrollment, review cases, QR passes.
-- Blueprint refs: BP15.A/B, BP17, BP24(partly), BP28.2, BP30, F02, F03, T01, T10, T11(registry part), T22.
--
-- Invariants enforced here
--  * A phone/name/DOB never grants access to an existing child. Link requests create a review case only.
--  * A self-created child is provisional: the guardian sees identity they entered, nothing clinical, until staff verify.
--  * Staff see only children enrolled (pending/active) at a clinic where they hold the capability.
--  * Duplicate candidates are shown to staff only; twins are never merged automatically.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function private.norm_name(p text) returns text language sql stable set search_path = '' as $$
  select lower(extensions.unaccent(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')))
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  profile_id uuid references public.profiles (id),
  full_name text not null check (length(btrim(full_name)) > 0),
  preferred_language text not null default 'en' check (preferred_language in ('en','fil')),
  contact_phone text,
  contact_email text,
  contact_verified_at timestamptz,
  contact_status text not null default 'unverified' check (contact_status in ('unverified','verified','invalid')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id)
);
-- Contact is deliberately NOT unique: families share phones (BP28.2).
create unique index guardians_profile_uq on public.guardians (organization_id, profile_id) where profile_id is not null;
create trigger guardians_touch before update on public.guardians for each row execute function private.touch_row();

create table public.children (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  local_record_no text not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  given_names text,
  family_name text,
  search_name text not null default '',
  dob date,
  birth_date_precision text not null default 'unknown' check (birth_date_precision in ('exact','estimated','unknown')),
  estimated_birth_start date,
  estimated_birth_end date,
  sex_for_clinical_reference text not null default 'not_recorded' check (sex_for_clinical_reference in ('female','male','not_recorded')),
  barangay_id uuid references public.barangays (id),
  address_text text,
  birth_details jsonb,
  record_status text not null default 'provisional' check (record_status in ('provisional','active','merged','inactive')),
  merged_into_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id),
  unique (organization_id, local_record_no),
  foreign key (organization_id, merged_into_id) references public.children (organization_id, id),
  check (merged_into_id is null or merged_into_id <> id),
  check ((record_status = 'merged') = (merged_into_id is not null)),
  check (
    (birth_date_precision = 'exact' and dob is not null and estimated_birth_start is null and estimated_birth_end is null)
    or (birth_date_precision = 'estimated' and dob is null and estimated_birth_start is not null
        and estimated_birth_end is not null and estimated_birth_start <= estimated_birth_end)
    or (birth_date_precision = 'unknown' and dob is null and estimated_birth_start is null and estimated_birth_end is null)
  )
);
create index children_search_trgm_idx on public.children using gin (search_name extensions.gin_trgm_ops);
create index children_dob_idx on public.children (organization_id, dob);
create index children_status_idx on public.children (organization_id, record_status);

create function private.children_before_write() returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_name := private.norm_name(new.display_name);
  if new.dob is not null and (new.dob > current_date + 1 or new.dob < date '1900-01-01') then
    raise exception 'date of birth out of range' using errcode = 'CV422';
  end if;
  return new;
end $$;
create trigger children_write before insert or update on public.children for each row execute function private.children_before_write();
create trigger children_touch before update on public.children for each row execute function private.touch_row();

create table private.record_counters (organization_id uuid primary key, next_value bigint not null default 1);

create function private.next_record_no(p_org uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into private.record_counters (organization_id) values (p_org) on conflict (organization_id) do nothing;
  update private.record_counters set next_value = next_value + 1 where organization_id = p_org returning next_value - 1 into v;
  return 'CV-' || lpad(v::text, 6, '0');
end $$;

create table public.guardian_child_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  guardian_id uuid not null,
  child_id uuid not null,
  relationship text not null check (relationship in ('mother','father','grandparent','aunt_uncle','sibling','legal_guardian','other')),
  status text not null check (status in ('provisional','active','suspended','revoked','rejected')),
  access_scope text not null check (access_scope in ('identity_only','full')),
  verification_method text check (verification_method in ('in_person_id','clinic_record','invitation','court_document','other')),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, guardian_id) references public.guardians (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  unique (organization_id, id),
  -- Full access requires a recorded verification basis (BP28.2).
  check (status <> 'active' or (verified_by is not null and verified_at is not null and verification_method is not null and access_scope = 'full')),
  check (status <> 'provisional' or access_scope = 'identity_only')
);
create unique index gcr_one_live_pair_uq on public.guardian_child_relationships (guardian_id, child_id)
  where status in ('provisional','active','suspended');
create index gcr_child_idx on public.guardian_child_relationships (child_id, status);
create index gcr_guardian_idx on public.guardian_child_relationships (guardian_id, status);
create trigger gcr_touch before update on public.guardian_child_relationships for each row execute function private.touch_row();

create table public.child_clinic_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null,
  clinic_id uuid not null,
  status text not null check (status in ('pending','active','closed')),
  is_primary boolean not null default false,
  access_scope text not null default 'care' check (access_scope in ('care','review_only')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  basis text not null check (basis in ('guardian_self_registration','clinic_registration','transfer','merge')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  unique (organization_id, id)
);
create unique index enrollments_one_live_pair_uq on public.child_clinic_enrollments (child_id, clinic_id) where status in ('pending','active');
create unique index enrollments_one_primary_uq on public.child_clinic_enrollments (child_id) where status = 'active' and is_primary;
create index enrollments_clinic_idx on public.child_clinic_enrollments (clinic_id, status);
create trigger enrollments_touch before update on public.child_clinic_enrollments for each row execute function private.touch_row();

create table public.record_review_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  kind text not null check (kind in ('duplicate','link','identity_edit','correction','clinical','stock','sync')),
  child_id uuid,
  candidate_child_id uuid,
  guardian_id uuid,
  assigned_to uuid references public.profiles (id),
  status text not null default 'open' check (status in ('open','in_review','resolved','rejected')),
  reason text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  resolution jsonb,
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, candidate_child_id) references public.children (organization_id, id),
  foreign key (organization_id, guardian_id) references public.guardians (organization_id, id),
  unique (organization_id, id),
  check (kind <> 'duplicate' or (child_id is not null and candidate_child_id is not null and child_id <> candidate_child_id)),
  check (kind <> 'link' or guardian_id is not null),
  check (kind <> 'identity_edit' or child_id is not null),
  check (status not in ('resolved','rejected') or (resolved_by is not null and resolved_at is not null))
);
create index review_cases_scope_idx on public.record_review_cases (clinic_id, status, kind);
create unique index review_cases_dup_pair_uq on public.record_review_cases
  (least(child_id, candidate_child_id), greatest(child_id, candidate_child_id)) where kind = 'duplicate' and status in ('open','in_review');
create trigger review_cases_touch before update on public.record_review_cases for each row execute function private.touch_row();

create table public.qr_passes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id)
);
create unique index qr_one_active_uq on public.qr_passes (child_id) where status = 'active';
create trigger qr_touch before update on public.qr_passes for each row execute function private.touch_row();

create table public.privacy_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  guardian_id uuid,
  child_id uuid,
  purpose text not null,
  record_type text not null check (record_type in ('notice_acknowledgement','contact_preference','clinical_consent_evidence','lawful_basis_documentation','access_request','correction_request','deactivation_request')),
  notice_version text not null,
  decision text not null check (decision in ('acknowledged','granted','withdrawn','requested')),
  recorded_at timestamptz not null default now(),
  evidence_ref text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  foreign key (organization_id, guardian_id) references public.guardians (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  check (guardian_id is not null or child_id is not null)
);
create trigger privacy_records_immutable before update or delete on public.privacy_records for each row execute function private.forbid_change();

-- ---------------------------------------------------------------------------------------------
-- Access helpers (definer so RLS policies do not recurse; executable by authenticated for policy evaluation)
-- ---------------------------------------------------------------------------------------------
create function private.my_guardian_ids() returns setof uuid language sql stable security definer set search_path = '' as $$
  select g.id from public.guardians g where g.profile_id = auth.uid() and g.deleted_at is null and private.session_ok()
$$;

create function private.guardian_can_read_child(p_child uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guardian_child_relationships r
     where r.child_id = p_child and r.guardian_id in (select private.my_guardian_ids())
       and r.status in ('provisional','active') and (r.ends_at is null or r.ends_at > now())
  )
$$;

create function private.guardian_has_full_access(p_child uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.guardian_child_relationships r
     where r.child_id = p_child and r.guardian_id in (select private.my_guardian_ids())
       and r.status = 'active' and r.access_scope = 'full' and (r.ends_at is null or r.ends_at > now())
  )
$$;

create function private.child_in_clinic(p_child uuid, p_clinic uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.child_clinic_enrollments e
                  where e.child_id = p_child and e.clinic_id = p_clinic and e.status in ('pending','active'))
$$;

-- Follows merge pointers (bounded) so aliases resolve to the canonical child (T11).
create function private.canonical_child(p_child uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := p_child; nxt uuid; i int := 0;
begin
  loop
    select merged_into_id into nxt from public.children where id = v;
    exit when nxt is null or i >= 10;
    v := nxt; i := i + 1;
  end loop;
  return v;
end $$;

-- Validates and normalizes untrusted child input; returns typed-as-text jsonb or raises CV422.
create function private.clean_child_input(p jsonb) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_given text := nullif(left(btrim(coalesce(p ->> 'givenNames', '')), 120), '');
  v_family text := nullif(left(btrim(coalesce(p ->> 'familyName', '')), 120), '');
  v_display text := nullif(left(regexp_replace(btrim(coalesce(p ->> 'displayName', '')), '\s+', ' ', 'g'), 200), '');
  v_prec text := coalesce(p ->> 'dobPrecision', case when p ? 'dob' and nullif(p ->> 'dob', '') is not null then 'exact' else 'unknown' end);
  v_dob date; v_es date; v_ee date;
  v_sex text := coalesce(nullif(p ->> 'sex', ''), 'not_recorded');
  v_bar uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'child details required' using errcode = 'CV400'; end if;
  v_display := coalesce(v_display, nullif(btrim(concat_ws(' ', v_given, v_family)), ''));
  if v_display is null then raise exception 'child name is required' using errcode = 'CV422'; end if;
  if v_prec not in ('exact','estimated','unknown') then raise exception 'invalid dob precision' using errcode = 'CV422'; end if;
  begin
    if v_prec = 'exact' then v_dob := (p ->> 'dob')::date; end if;
    if v_prec = 'estimated' then v_es := (p ->> 'estimatedBirthStart')::date; v_ee := (p ->> 'estimatedBirthEnd')::date; end if;
    if p ->> 'barangayId' is not null and p ->> 'barangayId' <> '' then v_bar := (p ->> 'barangayId')::uuid; end if;
  exception when others then
    raise exception 'invalid date or identifier' using errcode = 'CV422';
  end;
  if v_prec = 'exact' and v_dob is null then raise exception 'date of birth required for exact precision' using errcode = 'CV422'; end if;
  if v_prec = 'estimated' and (v_es is null or v_ee is null or v_es > v_ee) then
    raise exception 'estimated birth range invalid' using errcode = 'CV422';
  end if;
  if v_sex not in ('female','male','not_recorded') then raise exception 'invalid sex code' using errcode = 'CV422'; end if;
  return jsonb_build_object(
    'displayName', v_display, 'givenNames', v_given, 'familyName', v_family, 'dobPrecision', v_prec,
    'dob', v_dob, 'estimatedBirthStart', v_es, 'estimatedBirthEnd', v_ee, 'sex', v_sex, 'barangayId', v_bar,
    'addressText', nullif(left(btrim(coalesce(p ->> 'addressText', '')), 500), ''));
end $$;

-- Candidate duplicates among children enrolled at the SAME clinic. Similar names on the same DOB (twins!) are
-- reported, never merged. Names are only a search aid, not identity (BP28.7).
create function private.child_candidates(p_clinic uuid, p_name text, p_dob date, p_exclude uuid default null)
returns table (child_id uuid, score real, same_dob boolean) language sql stable security definer set search_path = '' as $$
  select c.id, extensions.similarity(c.search_name, private.norm_name(p_name))::real,
         (p_dob is not null and c.dob = p_dob)
    from public.children c
   where c.record_status in ('provisional','active')
     and c.id is distinct from p_exclude
     and exists (select 1 from public.child_clinic_enrollments e where e.child_id = c.id and e.clinic_id = p_clinic and e.status in ('pending','active'))
     and ((p_dob is not null and c.dob = p_dob and extensions.similarity(c.search_name, private.norm_name(p_name)) >= 0.3)
          or extensions.similarity(c.search_name, private.norm_name(p_name)) >= 0.6)
   order by 2 desc, 1
   limit 5
$$;

create function private.ensure_guardian(p_org uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.guardians where organization_id = p_org and profile_id = auth.uid();
  if v is not null then return v; end if;
  insert into public.guardians (organization_id, profile_id, full_name, preferred_language, created_by, updated_by)
  select p_org, p.id, coalesce(nullif(btrim(p_name), ''), nullif(btrim(p.display_name), ''), 'Guardian'), p.locale, p.id, p.id
    from public.profiles p where p.id = auth.uid()
  returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Direct read policies (guardian-owned data only). Staff read identifiable data only via audited commands.
-- ---------------------------------------------------------------------------------------------
alter table public.guardians enable row level security;
alter table public.children enable row level security;
alter table public.guardian_child_relationships enable row level security;
alter table public.child_clinic_enrollments enable row level security;
alter table public.record_review_cases enable row level security;
alter table public.qr_passes enable row level security;
alter table public.privacy_records enable row level security;

revoke all on public.guardians, public.children, public.guardian_child_relationships, public.child_clinic_enrollments,
              public.record_review_cases, public.qr_passes, public.privacy_records from anon, authenticated;

grant select on public.guardians, public.children, public.guardian_child_relationships to authenticated;
create policy guardians_read_own on public.guardians for select to authenticated using (id in (select private.my_guardian_ids()));
create policy children_read_linked on public.children for select to authenticated using (private.guardian_can_read_child(id));
create policy gcr_read_own on public.guardian_child_relationships for select to authenticated using (guardian_id in (select private.my_guardian_ids()));

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------

-- Guardian self-service: a NEW provisional child. Never reveals whether a similar record exists (BP15.A, T10).
create function public.create_child_provisional(p_operation_key uuid, p_clinic_id uuid, p_child jsonb, p_relationship text default 'mother')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_clean jsonb; v_prev jsonb; v_child uuid; v_no text; v_guardian uuid; v_cand record;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then raise exception 'forbidden' using errcode = 'CV403'; end if;
  select organization_id into v_org from public.clinics where id = p_clinic_id and status = 'active';
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'child.create_provisional',
                                  jsonb_build_object('clinic', p_clinic_id, 'child', p_child, 'rel', p_relationship));
  if v_prev is not null then return v_prev; end if;
  v_clean := private.clean_child_input(p_child);
  v_guardian := private.ensure_guardian(v_org);
  v_no := private.next_record_no(v_org);

  insert into public.children (organization_id, local_record_no, display_name, given_names, family_name, dob, birth_date_precision,
                               estimated_birth_start, estimated_birth_end, sex_for_clinical_reference, barangay_id, address_text,
                               record_status, created_by, updated_by)
  values (v_org, v_no, v_clean ->> 'displayName', v_clean ->> 'givenNames', v_clean ->> 'familyName', (v_clean ->> 'dob')::date,
          v_clean ->> 'dobPrecision', (v_clean ->> 'estimatedBirthStart')::date, (v_clean ->> 'estimatedBirthEnd')::date,
          v_clean ->> 'sex', (v_clean ->> 'barangayId')::uuid, v_clean ->> 'addressText', 'provisional', auth.uid(), auth.uid())
  returning id into v_child;

  insert into public.guardian_child_relationships (organization_id, guardian_id, child_id, relationship, status, access_scope, created_by, updated_by)
  values (v_org, v_guardian, v_child, p_relationship, 'provisional', 'identity_only', auth.uid(), auth.uid());
  insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, is_primary, access_scope, basis, created_by, updated_by)
  values (v_org, v_child, p_clinic_id, 'pending', false, 'review_only', 'guardian_self_registration', auth.uid(), auth.uid());

  for v_cand in select * from private.child_candidates(p_clinic_id, v_clean ->> 'displayName', (v_clean ->> 'dob')::date, v_child) loop
    insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, candidate_child_id, reason, evidence, created_by, updated_by)
    values (v_org, p_clinic_id, 'duplicate', v_child, v_cand.child_id, 'possible duplicate on guardian self-registration',
            jsonb_build_object('score', v_cand.score, 'sameDob', v_cand.same_dob), auth.uid(), auth.uid())
    on conflict do nothing;
  end loop;

  perform private.audit(v_org, 'guardian', 'child.created_provisional', 'child', v_child, null,
                        jsonb_build_object('localRecordNo', v_no, 'status', 'provisional'), null);
  -- Identical shape whether or not candidates exist: no matching-record oracle for unverified users.
  return private.finish_command(v_org, p_operation_key, jsonb_build_object(
    'childId', v_child, 'localRecordNo', v_no, 'recordStatus', 'provisional', 'verificationPending', true));
end $$;

-- Staff registration (walk-in, assisted). Returns duplicate candidates first unless the registrar confirms none applies.
create function public.register_child_staff(
  p_operation_key uuid, p_clinic_id uuid, p_child jsonb, p_guardian jsonb default null,
  p_confirmed_distinct boolean default false, p_identity_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_clean jsonb; v_prev jsonb; v_child uuid; v_no text; v_guardian uuid; v_status text;
  v_cands jsonb; v_gname text; v_rel text; v_verified boolean;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.register');
  v_prev := private.begin_command(v_org, p_operation_key, 'child.register_staff',
    jsonb_build_object('clinic', p_clinic_id, 'child', p_child, 'guardian', p_guardian, 'distinct', p_confirmed_distinct, 'idc', p_identity_confirmed));
  if v_prev is not null then return v_prev; end if;
  v_clean := private.clean_child_input(p_child);

  select coalesce(jsonb_agg(jsonb_build_object('childId', c.id, 'displayName', c.display_name, 'localRecordNo', c.local_record_no,
                                               'dob', c.dob, 'score', k.score, 'sameDob', k.same_dob)), '[]'::jsonb)
    into v_cands
    from private.child_candidates(p_clinic_id, v_clean ->> 'displayName', (v_clean ->> 'dob')::date) k
    join public.children c on c.id = k.child_id;
  if jsonb_array_length(v_cands) > 0 and not p_confirmed_distinct then
    return private.finish_command(v_org, p_operation_key, jsonb_build_object('created', false, 'candidates', v_cands));
  end if;

  v_no := private.next_record_no(v_org);
  v_status := case when p_identity_confirmed then 'active' else 'provisional' end;
  insert into public.children (organization_id, local_record_no, display_name, given_names, family_name, dob, birth_date_precision,
                               estimated_birth_start, estimated_birth_end, sex_for_clinical_reference, barangay_id, address_text,
                               record_status, created_by, updated_by)
  values (v_org, v_no, v_clean ->> 'displayName', v_clean ->> 'givenNames', v_clean ->> 'familyName', (v_clean ->> 'dob')::date,
          v_clean ->> 'dobPrecision', (v_clean ->> 'estimatedBirthStart')::date, (v_clean ->> 'estimatedBirthEnd')::date,
          v_clean ->> 'sex', (v_clean ->> 'barangayId')::uuid, v_clean ->> 'addressText', v_status, auth.uid(), auth.uid())
  returning id into v_child;
  insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, is_primary, access_scope, basis, created_by, updated_by)
  values (v_org, v_child, p_clinic_id, case when p_identity_confirmed then 'active' else 'pending' end, p_identity_confirmed,
          case when p_identity_confirmed then 'care' else 'review_only' end, 'clinic_registration', auth.uid(), auth.uid());

  -- Accompanying adult (no account needed). Relationship is 'active' only if the registrar verified authority in person.
  if p_guardian is not null and nullif(btrim(p_guardian ->> 'fullName'), '') is not null then
    v_gname := left(btrim(p_guardian ->> 'fullName'), 200);
    v_rel := coalesce(nullif(p_guardian ->> 'relationship', ''), 'other');
    v_verified := coalesce((p_guardian ->> 'verifiedInPerson')::boolean, false);
    insert into public.guardians (organization_id, full_name, contact_phone, contact_email, created_by, updated_by)
    values (v_org, v_gname, nullif(left(btrim(coalesce(p_guardian ->> 'phone', '')), 40), ''), nullif(left(btrim(coalesce(p_guardian ->> 'email', '')), 200), ''), auth.uid(), auth.uid())
    returning id into v_guardian;
    if v_verified then
      insert into public.guardian_child_relationships (organization_id, guardian_id, child_id, relationship, status, access_scope,
                                                       verification_method, verified_by, verified_at, created_by, updated_by)
      values (v_org, v_guardian, v_child, v_rel, 'active', 'full', 'in_person_id', auth.uid(), now(), auth.uid(), auth.uid());
    else
      insert into public.guardian_child_relationships (organization_id, guardian_id, child_id, relationship, status, access_scope, created_by, updated_by)
      values (v_org, v_guardian, v_child, v_rel, 'provisional', 'identity_only', auth.uid(), auth.uid());
    end if;
  end if;

  if jsonb_array_length(v_cands) > 0 then
    insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, candidate_child_id, reason, evidence, created_by, updated_by)
    select v_org, p_clinic_id, 'duplicate', v_child, (x ->> 'childId')::uuid, 'registrar confirmed distinct despite candidate',
           jsonb_build_object('score', x -> 'score', 'sameDob', x -> 'sameDob', 'registrarConfirmedDistinct', true), auth.uid(), auth.uid()
      from jsonb_array_elements(v_cands) x;
  end if;
  perform private.audit(v_org, 'child.register', 'child.registered', 'child', v_child, null,
                        jsonb_build_object('localRecordNo', v_no, 'status', v_status, 'candidates', jsonb_array_length(v_cands)), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('created', true, 'childId', v_child,
                                'localRecordNo', v_no, 'recordStatus', v_status, 'candidates', v_cands));
end $$;

-- Clinic-scoped search: bounded, audited (query text is never stored), never crosses clinics.
create function public.staff_search_children(p_clinic_id uuid, p_query text, p_dob date default null, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_q text := private.norm_name(p_query); v_like text; v_res jsonb; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 25);
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'forbidden' using errcode = 'CV403'; end if;
  perform private.require_capability(p_clinic_id, 'child.search');
  if length(v_q) < 2 and p_dob is null then raise exception 'query too short' using errcode = 'CV422'; end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(x order by (x ->> 'rank')::real desc, x ->> 'displayName'), '[]'::jsonb) into v_res from (
    select jsonb_build_object('childId', c.id, 'displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob,
                              'dobPrecision', c.birth_date_precision, 'recordStatus', c.record_status,
                              'rank', greatest(extensions.similarity(c.search_name, v_q), case when c.search_name like v_like then 0.9 else 0 end,
                                               case when upper(btrim(p_query)) = c.local_record_no then 1 else 0 end)) x
      from public.children c
     where c.record_status in ('provisional','active')
       and exists (select 1 from public.child_clinic_enrollments e where e.child_id = c.id and e.clinic_id = p_clinic_id and e.status in ('pending','active'))
       and (p_dob is null or c.dob = p_dob)
       and (length(v_q) < 2 or c.search_name like v_like or extensions.similarity(c.search_name, v_q) >= 0.3 or upper(btrim(p_query)) = c.local_record_no)
     limit v_lim) s;
  perform private.audit(v_org, 'child.search', 'child.search', 'clinic', p_clinic_id, null,
                        jsonb_build_object('queryLength', length(v_q), 'withDob', p_dob is not null, 'results', jsonb_array_length(v_res)), null);
  return v_res;
end $$;

create function public.staff_get_child(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; c public.children; v_canon uuid; v_can_verify boolean; v_out jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.search');
  v_canon := private.canonical_child(p_child_id);
  select * into c from public.children where id = v_canon and organization_id = v_org;
  -- Same response for "does not exist" and "not in your clinic": no existence oracle.
  if not found or not private.child_in_clinic(v_canon, p_clinic_id) then
    -- Return null instead of raising: an exception would roll back the denial audit row. The API maps null to 404.
    perform private.audit(v_org, 'child.search', 'child.open', 'child', p_child_id, null, null, null, 'denied');
    return null;
  end if;
  v_can_verify := private.has_capability(p_clinic_id, 'guardian.verify');
  select jsonb_build_object(
    'childId', c.id, 'requestedChildId', p_child_id, 'aliasResolved', c.id <> p_child_id,
    'localRecordNo', c.local_record_no, 'displayName', c.display_name, 'givenNames', c.given_names, 'familyName', c.family_name,
    'dob', c.dob, 'dobPrecision', c.birth_date_precision, 'estimatedBirthStart', c.estimated_birth_start, 'estimatedBirthEnd', c.estimated_birth_end,
    'sex', c.sex_for_clinical_reference, 'addressText', c.address_text, 'recordStatus', c.record_status, 'version', c.version,
    'guardians', coalesce((select jsonb_agg(jsonb_build_object(
        'relationshipId', r.id, 'name', g.full_name, 'relationship', r.relationship, 'status', r.status, 'hasAccount', g.profile_id is not null,
        'phone', case when v_can_verify then g.contact_phone end, 'email', case when v_can_verify then g.contact_email end))
      from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id
      where r.child_id = c.id and r.status in ('provisional','active','suspended')), '[]'::jsonb),
    'enrollments', coalesce((select jsonb_agg(jsonb_build_object('clinicId', e.clinic_id, 'status', e.status, 'primary', e.is_primary))
      from public.child_clinic_enrollments e where e.child_id = c.id and e.clinic_id = p_clinic_id and e.status in ('pending','active')), '[]'::jsonb))
    into v_out;
  perform private.audit(v_org, 'child.search', 'child.open', 'child', c.id, null, null, null);
  return v_out;
end $$;

create function public.confirm_child_identity(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_expected_version integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; c public.children; v_prev jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.register');
  v_prev := private.begin_command(v_org, p_operation_key, 'child.confirm_identity',
                                  jsonb_build_object('clinic', p_clinic_id, 'child', p_child_id, 'v', p_expected_version));
  if v_prev is not null then return v_prev; end if;
  select * into c from public.children where id = p_child_id and organization_id = v_org for update;
  if not found or not private.child_in_clinic(p_child_id, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if c.version <> p_expected_version then raise exception 'stale version' using errcode = 'CV409'; end if;
  if c.record_status <> 'provisional' then raise exception 'child is not provisional' using errcode = 'CV409'; end if;
  update public.children set record_status = 'active', updated_by = auth.uid() where id = c.id;
  update public.child_clinic_enrollments set status = 'active', access_scope = 'care', updated_by = auth.uid()
   where child_id = c.id and clinic_id = p_clinic_id and status = 'pending';
  -- The first activated enrollment becomes primary if the child has none.
  update public.child_clinic_enrollments set is_primary = true
   where child_id = c.id and clinic_id = p_clinic_id and status = 'active'
     and not exists (select 1 from public.child_clinic_enrollments x where x.child_id = c.id and x.status = 'active' and x.is_primary);
  perform private.audit(v_org, 'child.register', 'child.identity_confirmed', 'child', c.id,
                        jsonb_build_object('recordStatus', c.record_status), jsonb_build_object('recordStatus', 'active'), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('childId', c.id, 'recordStatus', 'active'));
end $$;

-- Staff identity edits: optimistic versioning, reason for identity-defining fields, before/after audited.
create function public.update_child_identity(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_expected_version integer, p_patch jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; c public.children; v_prev jsonb; v_merged jsonb; v_clean jsonb; v_sensitive boolean;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.register');
  v_prev := private.begin_command(v_org, p_operation_key, 'child.update_identity',
                                  jsonb_build_object('clinic', p_clinic_id, 'child', p_child_id, 'v', p_expected_version, 'patch', p_patch, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into c from public.children where id = p_child_id and organization_id = v_org for update;
  if not found or not private.child_in_clinic(p_child_id, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if c.version <> p_expected_version then raise exception 'stale version' using errcode = 'CV409'; end if;
  if c.record_status = 'merged' then raise exception 'record is merged' using errcode = 'CV409'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'empty patch' using errcode = 'CV400'; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in
      ('displayName','givenNames','familyName','dob','dobPrecision','estimatedBirthStart','estimatedBirthEnd','sex','barangayId','addressText')) then
    raise exception 'patch contains fields that cannot be edited here' using errcode = 'CV422';
  end if;
  v_sensitive := p_patch ?| array['displayName','givenNames','familyName','dob','dobPrecision','estimatedBirthStart','estimatedBirthEnd','sex'];
  if v_sensitive and (p_reason is null or length(btrim(p_reason)) < 3) then raise exception 'reason required for identity changes' using errcode = 'CV422'; end if;

  -- Merge the patch over current values, then re-validate as a whole.
  v_merged := jsonb_build_object('displayName', c.display_name, 'givenNames', c.given_names, 'familyName', c.family_name,
    'dob', c.dob, 'dobPrecision', c.birth_date_precision, 'estimatedBirthStart', c.estimated_birth_start,
    'estimatedBirthEnd', c.estimated_birth_end, 'sex', c.sex_for_clinical_reference, 'barangayId', c.barangay_id, 'addressText', c.address_text) || p_patch;
  -- Changing precision must clear the fields that no longer apply.
  if p_patch ? 'dobPrecision' then
    if (p_patch ->> 'dobPrecision') <> 'exact' then v_merged := v_merged || jsonb_build_object('dob', null); end if;
    if (p_patch ->> 'dobPrecision') <> 'estimated' then v_merged := v_merged || jsonb_build_object('estimatedBirthStart', null, 'estimatedBirthEnd', null); end if;
  end if;
  v_clean := private.clean_child_input(v_merged);
  update public.children set display_name = v_clean ->> 'displayName', given_names = v_clean ->> 'givenNames', family_name = v_clean ->> 'familyName',
    dob = (v_clean ->> 'dob')::date, birth_date_precision = v_clean ->> 'dobPrecision',
    estimated_birth_start = (v_clean ->> 'estimatedBirthStart')::date, estimated_birth_end = (v_clean ->> 'estimatedBirthEnd')::date,
    sex_for_clinical_reference = v_clean ->> 'sex', barangay_id = (v_clean ->> 'barangayId')::uuid, address_text = v_clean ->> 'addressText',
    updated_by = auth.uid()
   where id = c.id;
  perform private.audit(v_org, 'child.register', 'child.identity_updated', 'child', c.id,
    jsonb_build_object('displayName', c.display_name, 'dob', c.dob, 'dobPrecision', c.birth_date_precision, 'sex', c.sex_for_clinical_reference, 'addressText', c.address_text),
    v_clean, p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('childId', c.id, 'version', c.version + 1));
end $$;

-- Guardian asks for a correction; staff decide. No direct guardian write to identity.
create function public.request_child_edit(p_operation_key uuid, p_child_id uuid, p_patch jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_clinic uuid; v_prev jsonb; v_case uuid; v_guardian uuid;
begin
  if not private.guardian_can_read_child(p_child_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  select organization_id into v_org from public.children where id = p_child_id;
  select clinic_id into v_clinic from public.child_clinic_enrollments where child_id = p_child_id and status in ('pending','active') order by is_primary desc, created_at limit 1;
  if v_clinic is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'child.request_edit', jsonb_build_object('child', p_child_id, 'patch', p_patch, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'patch required' using errcode = 'CV400'; end if;
  select id into v_guardian from public.guardians where organization_id = v_org and profile_id = auth.uid();
  insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, guardian_id, reason, evidence, created_by, updated_by)
  values (v_org, v_clinic, 'identity_edit', p_child_id, v_guardian, left(coalesce(p_reason, ''), 500), jsonb_build_object('patch', p_patch), auth.uid(), auth.uid())
  returning id into v_case;
  perform private.audit(v_org, 'guardian', 'child.edit_requested', 'child', p_child_id, null, jsonb_build_object('caseId', v_case), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('caseId', v_case, 'status', 'open'));
end $$;

-- Guardian asks to be linked to an EXISTING child. The request never touches the child record and returns no matches.
create function public.request_guardian_link(p_operation_key uuid, p_clinic_id uuid, p_descriptor jsonb, p_relationship text default 'other')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_g uuid; v_case uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then raise exception 'forbidden' using errcode = 'CV403'; end if;
  select organization_id into v_org from public.clinics where id = p_clinic_id and status = 'active';
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'guardian.request_link',
                                  jsonb_build_object('clinic', p_clinic_id, 'descriptor', p_descriptor, 'rel', p_relationship));
  if v_prev is not null then return v_prev; end if;
  if p_descriptor is null or jsonb_typeof(p_descriptor) <> 'object' or nullif(btrim(p_descriptor ->> 'childName'), '') is null then
    raise exception 'child name is required' using errcode = 'CV422';
  end if;
  if p_relationship not in ('mother','father','grandparent','aunt_uncle','sibling','legal_guardian','other') then raise exception 'invalid relationship' using errcode = 'CV422'; end if;
  v_g := private.ensure_guardian(v_org);
  insert into public.record_review_cases (organization_id, clinic_id, kind, guardian_id, reason, evidence, created_by, updated_by)
  values (v_org, p_clinic_id, 'link', v_g, 'guardian requests link to existing record',
          jsonb_build_object('childName', left(btrim(p_descriptor ->> 'childName'), 200), 'dob', left(coalesce(p_descriptor ->> 'dob', ''), 10),
                             'relationship', p_relationship, 'note', left(coalesce(p_descriptor ->> 'note', ''), 500)), auth.uid(), auth.uid())
  returning id into v_case;
  perform private.audit(v_org, 'guardian', 'guardian.link_requested', 'review_case', v_case, null, jsonb_build_object('clinic', p_clinic_id), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('caseId', v_case, 'status', 'open'));
end $$;

-- Staff decision on a link request. Approval requires the child to be in the reviewer's clinic scope.
create function public.resolve_link_case(p_operation_key uuid, p_case_id uuid, p_decision text, p_child_id uuid default null,
                                         p_method text default 'in_person_id', p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_case public.record_review_cases; v_prev jsonb; v_rel text; v_existing uuid;
begin
  select * into v_case from public.record_review_cases where id = p_case_id and kind = 'link' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(v_case.clinic_id, 'guardian.verify');
  v_prev := private.begin_command(v_case.organization_id, p_operation_key, 'guardian.resolve_link',
    jsonb_build_object('case', p_case_id, 'decision', p_decision, 'child', p_child_id, 'method', p_method, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  if v_case.status not in ('open','in_review') then raise exception 'case already resolved' using errcode = 'CV409'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid decision' using errcode = 'CV422'; end if;
  if p_decision = 'reject' then
    if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
    update public.record_review_cases set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
           resolution = jsonb_build_object('decision', 'reject', 'reason', p_reason) where id = v_case.id;
    perform private.audit(v_case.organization_id, 'guardian.verify', 'guardian.link_rejected', 'review_case', v_case.id, null, null, p_reason);
    return private.finish_command(v_case.organization_id, p_operation_key, jsonb_build_object('caseId', v_case.id, 'status', 'rejected'));
  end if;
  if p_child_id is null or not private.child_in_clinic(p_child_id, v_case.clinic_id) then raise exception 'child not in clinic scope' using errcode = 'CV404'; end if;
  p_child_id := private.canonical_child(p_child_id);
  if p_method not in ('in_person_id','clinic_record','invitation','court_document','other') then raise exception 'invalid verification method' using errcode = 'CV422'; end if;
  v_rel := coalesce(v_case.evidence ->> 'relationship', 'other');
  select id into v_existing from public.guardian_child_relationships
   where guardian_id = v_case.guardian_id and child_id = p_child_id and status in ('provisional','active','suspended') for update;
  if v_existing is not null then
    update public.guardian_child_relationships set status = 'active', access_scope = 'full', verification_method = p_method,
           verified_by = auth.uid(), verified_at = now(), updated_by = auth.uid() where id = v_existing and status <> 'suspended';
  else
    insert into public.guardian_child_relationships (organization_id, guardian_id, child_id, relationship, status, access_scope, verification_method, verified_by, verified_at, created_by, updated_by)
    values (v_case.organization_id, v_case.guardian_id, p_child_id, v_rel, 'active', 'full', p_method, auth.uid(), now(), auth.uid(), auth.uid());
  end if;
  update public.record_review_cases set status = 'resolved', child_id = p_child_id, resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'approve', 'method', p_method) where id = v_case.id;
  perform private.audit(v_case.organization_id, 'guardian.verify', 'guardian.link_approved', 'child', p_child_id, null,
                        jsonb_build_object('guardian', v_case.guardian_id, 'method', p_method), p_reason);
  return private.finish_command(v_case.organization_id, p_operation_key, jsonb_build_object('caseId', v_case.id, 'status', 'resolved', 'childId', p_child_id));
end $$;

create function public.verify_relationship(p_operation_key uuid, p_clinic_id uuid, p_relationship_id uuid, p_method text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.guardian_child_relationships; v_org uuid; v_prev jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'guardian.verify');
  v_prev := private.begin_command(v_org, p_operation_key, 'relationship.verify', jsonb_build_object('clinic', p_clinic_id, 'rel', p_relationship_id, 'method', p_method));
  if v_prev is not null then return v_prev; end if;
  select * into r from public.guardian_child_relationships where id = p_relationship_id and organization_id = v_org for update;
  if not found or not private.child_in_clinic(r.child_id, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if r.status <> 'provisional' then raise exception 'relationship is not provisional' using errcode = 'CV409'; end if;
  if p_method not in ('in_person_id','clinic_record','invitation','court_document','other') then raise exception 'invalid verification method' using errcode = 'CV422'; end if;
  update public.guardian_child_relationships set status = 'active', access_scope = 'full', verification_method = p_method,
         verified_by = auth.uid(), verified_at = now(), updated_by = auth.uid() where id = r.id;
  perform private.audit(v_org, 'guardian.verify', 'relationship.verified', 'relationship', r.id, jsonb_build_object('status', r.status), jsonb_build_object('status', 'active'), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('relationshipId', r.id, 'status', 'active'));
end $$;

-- Suspend (dispute) or revoke access without touching the care record or anyone else's relationship (BP41).
create function public.set_relationship_status(p_operation_key uuid, p_clinic_id uuid, p_relationship_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.guardian_child_relationships; v_org uuid; v_prev jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'guardian.verify');
  if p_status not in ('suspended','revoked','active') then raise exception 'invalid status' using errcode = 'CV422'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'relationship.set_status', jsonb_build_object('clinic', p_clinic_id, 'rel', p_relationship_id, 'status', p_status, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into r from public.guardian_child_relationships where id = p_relationship_id and organization_id = v_org for update;
  if not found or not private.child_in_clinic(r.child_id, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if r.status not in ('active','suspended','provisional') then raise exception 'relationship is closed' using errcode = 'CV409'; end if;
  if p_status = 'active' and r.verified_by is null then raise exception 'verify the relationship instead' using errcode = 'CV409'; end if;
  update public.guardian_child_relationships set status = p_status, ends_at = case when p_status = 'revoked' then now() else null end, updated_by = auth.uid() where id = r.id;
  perform private.audit(v_org, 'guardian.verify', 'relationship.status_changed', 'relationship', r.id, jsonb_build_object('status', r.status), jsonb_build_object('status', p_status), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('relationshipId', r.id, 'status', p_status));
end $$;

-- Merge a confirmed duplicate into a survivor. Names/DOB alone never trigger this; a reviewer decides (T10/T11).
create function public.merge_children(p_operation_key uuid, p_clinic_id uuid, p_survivor uuid, p_duplicate uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; s public.children; d public.children; rel record;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'review.resolve');
  if p_survivor = p_duplicate then raise exception 'cannot merge a record into itself' using errcode = 'CV422'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'child.merge', jsonb_build_object('clinic', p_clinic_id, 's', p_survivor, 'd', p_duplicate, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  -- Lock in a stable order to avoid deadlocks between concurrent merges.
  perform 1 from public.children where id in (p_survivor, p_duplicate) order by id for update;
  select * into s from public.children where id = p_survivor and organization_id = v_org;
  select * into d from public.children where id = p_duplicate and organization_id = v_org;
  if s.id is null or d.id is null or not private.child_in_clinic(s.id, p_clinic_id) or not private.child_in_clinic(d.id, p_clinic_id) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
  if s.record_status = 'merged' or d.record_status = 'merged' then raise exception 'record already merged' using errcode = 'CV409'; end if;

  -- Move relationships: keep the strongest status when the survivor already has the guardian.
  for rel in select * from public.guardian_child_relationships where child_id = d.id and status in ('provisional','active','suspended') for update loop
    if exists (select 1 from public.guardian_child_relationships x where x.child_id = s.id and x.guardian_id = rel.guardian_id and x.status in ('provisional','active','suspended')) then
      update public.guardian_child_relationships set status = 'revoked', ends_at = now(), updated_by = auth.uid() where id = rel.id;
    else
      update public.guardian_child_relationships set child_id = s.id, updated_by = auth.uid() where id = rel.id;
    end if;
  end loop;
  -- Enrollments: survivor inherits the clinic enrollment if missing; the duplicate's are closed.
  insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, is_primary, access_scope, basis, created_by, updated_by)
  select v_org, s.id, e.clinic_id, case when s.record_status = 'active' then 'active' else 'pending' end, false,
         case when s.record_status = 'active' then 'care' else 'review_only' end, 'merge', auth.uid(), auth.uid()
    from public.child_clinic_enrollments e
   where e.child_id = d.id and e.status in ('pending','active')
     and not exists (select 1 from public.child_clinic_enrollments y where y.child_id = s.id and y.clinic_id = e.clinic_id and y.status in ('pending','active'));
  update public.child_clinic_enrollments set status = 'closed', is_primary = false, ends_at = now(), updated_by = auth.uid()
   where child_id = d.id and status in ('pending','active');
  update public.qr_passes set status = 'revoked', revoked_at = now(), updated_by = auth.uid() where child_id = d.id and status = 'active';
  update public.children set record_status = 'merged', merged_into_id = s.id, updated_by = auth.uid() where id = d.id;
  update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'merged', 'survivor', s.id, 'duplicate', d.id)
   where kind = 'duplicate' and status in ('open','in_review') and least(child_id, candidate_child_id) = least(s.id, d.id) and greatest(child_id, candidate_child_id) = greatest(s.id, d.id);
  perform private.audit(v_org, 'review.resolve', 'child.merged', 'child', d.id,
                        jsonb_build_object('localRecordNo', d.local_record_no), jsonb_build_object('mergedInto', s.id, 'survivorRecordNo', s.local_record_no), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('survivorId', s.id, 'mergedId', d.id));
end $$;

-- Reviewer decides two records are distinct (e.g. twins). Both remain; the pair is not re-flagged automatically.
create function public.resolve_review_case(p_operation_key uuid, p_case_id uuid, p_outcome text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_case public.record_review_cases; v_prev jsonb;
begin
  select * into v_case from public.record_review_cases where id = p_case_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(v_case.clinic_id, case v_case.kind when 'link' then 'guardian.verify' when 'duplicate' then 'review.resolve' when 'identity_edit' then 'child.register' else 'review.resolve' end);
  if v_case.kind = 'link' then raise exception 'use resolve_link_case' using errcode = 'CV422'; end if;
  if p_outcome not in ('not_duplicate','rejected','no_action') then raise exception 'invalid outcome' using errcode = 'CV422'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_case.organization_id, p_operation_key, 'review.resolve', jsonb_build_object('case', p_case_id, 'outcome', p_outcome, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  if v_case.status not in ('open','in_review') then raise exception 'case already resolved' using errcode = 'CV409'; end if;
  update public.record_review_cases set status = case when p_outcome = 'not_duplicate' then 'resolved' else 'rejected' end,
         resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(), resolution = jsonb_build_object('outcome', p_outcome, 'reason', p_reason)
   where id = v_case.id;
  perform private.audit(v_case.organization_id, 'review.resolve', 'review_case.resolved', 'review_case', v_case.id, null, jsonb_build_object('outcome', p_outcome), p_reason);
  return private.finish_command(v_case.organization_id, p_operation_key, jsonb_build_object('caseId', v_case.id, 'outcome', p_outcome));
end $$;

create function public.list_review_cases(p_clinic_id uuid, p_status text default 'open', p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  if not (private.has_capability(p_clinic_id, 'guardian.verify') or private.has_capability(p_clinic_id, 'review.resolve')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  select coalesce(jsonb_agg(x order by x ->> 'createdAt'), '[]'::jsonb) into v_res from (
    select jsonb_build_object('caseId', k.id, 'kind', k.kind, 'status', k.status, 'reason', k.reason, 'createdAt', k.created_at, 'version', k.version,
             'evidence', k.evidence, 'childId', k.child_id, 'candidateChildId', k.candidate_child_id,
             'child', (select jsonb_build_object('displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob) from public.children c where c.id = k.child_id),
             'candidate', (select jsonb_build_object('displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob) from public.children c where c.id = k.candidate_child_id
                             and private.child_in_clinic(c.id, p_clinic_id)),
             'guardianName', (select g.full_name from public.guardians g where g.id = k.guardian_id)) x
      from public.record_review_cases k
     where k.clinic_id = p_clinic_id and k.status = p_status
     order by k.created_at limit least(greatest(coalesce(p_limit, 50), 1), 100)) s;
  return v_res;
end $$;

-- QR: opaque, hashed, revocable locator. Only the issuing response ever contains the token.
create function public.issue_qr_pass(p_operation_key uuid, p_child_id uuid, p_clinic_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_token text; v_id uuid; v_canon uuid; v_cap text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  select organization_id into v_org from public.children where id = v_canon;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_clinic_id is not null then
    if not (private.has_capability(p_clinic_id, 'child.register') and private.child_in_clinic(v_canon, p_clinic_id)) then raise exception 'not found' using errcode = 'CV404'; end if;
    v_cap := 'child.register';
  else
    if not private.guardian_has_full_access(v_canon) then raise exception 'not found' using errcode = 'CV404'; end if;
    v_cap := 'guardian';
  end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'qr.issue', jsonb_build_object('child', p_child_id, 'clinic', p_clinic_id));
  if v_prev is not null then return v_prev; end if;  -- replay returns the original token once more: same key + same actor only
  update public.qr_passes set status = 'revoked', revoked_at = now(), updated_by = auth.uid() where child_id = v_canon and status = 'active';
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  insert into public.qr_passes (organization_id, child_id, token_hash, created_by, updated_by)
  values (v_org, v_canon, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid(), auth.uid()) returning id into v_id;
  perform private.audit(v_org, v_cap, 'qr.issued', 'child', v_canon, null, jsonb_build_object('passId', v_id), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('passId', v_id, 'token', v_token));
end $$;

create function public.revoke_qr_pass(p_operation_key uuid, p_child_id uuid, p_clinic_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_n int; v_canon uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  select organization_id into v_org from public.children where id = v_canon;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_clinic_id is not null then
    if not (private.has_capability(p_clinic_id, 'child.register') and private.child_in_clinic(v_canon, p_clinic_id)) then raise exception 'not found' using errcode = 'CV404'; end if;
  elsif not private.guardian_has_full_access(v_canon) then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'qr.revoke', jsonb_build_object('child', p_child_id, 'clinic', p_clinic_id));
  if v_prev is not null then return v_prev; end if;
  update public.qr_passes set status = 'revoked', revoked_at = now(), updated_by = auth.uid() where child_id = v_canon and status = 'active';
  get diagnostics v_n = row_count;
  perform private.audit(v_org, 'qr', 'qr.revoked', 'child', v_canon, null, jsonb_build_object('revoked', v_n), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('revoked', v_n));
end $$;

-- Staff QR resolution: generic null for every failure so a copied/expired/foreign token reveals nothing (T22).
create function public.resolve_qr(p_clinic_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; q public.qr_passes; c public.children;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null or not private.has_capability(p_clinic_id, 'child.search') then raise exception 'forbidden' using errcode = 'CV403'; end if;
  select * into q from public.qr_passes where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     and status = 'active' and (expires_at is null or expires_at > now());
  if found then
    select * into c from public.children where id = q.child_id and organization_id = v_org and record_status in ('provisional','active');
  end if;
  if c.id is null or not private.child_in_clinic(c.id, p_clinic_id) then
    perform private.audit(v_org, 'child.search', 'qr.resolve', 'clinic', p_clinic_id, null, null, null, 'denied');
    return null;
  end if;
  perform private.audit(v_org, 'child.search', 'qr.resolve', 'child', c.id, null, null, null);
  return jsonb_build_object('childId', c.id, 'displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob, 'dobPrecision', c.birth_date_precision);
end $$;

create function public.acknowledge_privacy_notice(p_operation_key uuid, p_clinic_id uuid, p_notice_version text, p_purpose text default 'care_records')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_g uuid; v_id uuid;
begin
  if auth.uid() is null or not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select organization_id into v_org from public.clinics where id = p_clinic_id and status = 'active';
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'privacy.acknowledge', jsonb_build_object('clinic', p_clinic_id, 'v', p_notice_version, 'p', p_purpose));
  if v_prev is not null then return v_prev; end if;
  if p_notice_version is null or length(btrim(p_notice_version)) = 0 then raise exception 'notice version required' using errcode = 'CV422'; end if;
  v_g := private.ensure_guardian(v_org);
  insert into public.privacy_records (organization_id, guardian_id, purpose, record_type, notice_version, decision, created_by)
  values (v_org, v_g, left(p_purpose, 100), 'notice_acknowledgement', left(p_notice_version, 50), 'acknowledged', auth.uid()) returning id into v_id;
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('privacyRecordId', v_id));
end $$;

-- Guardian home data (D1/P03): only children this account is linked to, with relationship state.
create function public.my_children() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'childId', c.id, 'displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob, 'dobPrecision', c.birth_date_precision,
    'recordStatus', c.record_status, 'relationshipStatus', r.status, 'accessScope', r.access_scope, 'relationship', r.relationship,
    'clinicName', (select cl.name from public.child_clinic_enrollments e join public.clinics cl on cl.id = e.clinic_id
                    where e.child_id = c.id and e.status in ('pending','active') order by e.is_primary desc, e.created_at limit 1)
  ) order by c.display_name), '[]'::jsonb)
  from public.guardian_child_relationships r
  join public.children c on c.id = r.child_id
  where r.guardian_id in (select private.my_guardian_ids()) and r.status in ('provisional','active') and c.record_status <> 'merged'
$$;

-- Grants: commands are callable only by signed-in users; each re-authorizes internally.
do $$
declare f text;
begin
  foreach f in array array[
    'create_child_provisional(uuid,uuid,jsonb,text)',
    'register_child_staff(uuid,uuid,jsonb,jsonb,boolean,boolean)',
    'staff_search_children(uuid,text,date,integer)',
    'staff_get_child(uuid,uuid)',
    'confirm_child_identity(uuid,uuid,uuid,integer,text)',
    'update_child_identity(uuid,uuid,uuid,integer,jsonb,text)',
    'request_child_edit(uuid,uuid,jsonb,text)',
    'request_guardian_link(uuid,uuid,jsonb,text)',
    'resolve_link_case(uuid,uuid,text,uuid,text,text)',
    'verify_relationship(uuid,uuid,uuid,text)',
    'set_relationship_status(uuid,uuid,uuid,text,text)',
    'merge_children(uuid,uuid,uuid,uuid,text)',
    'resolve_review_case(uuid,uuid,text,text)',
    'list_review_cases(uuid,text,integer)',
    'issue_qr_pass(uuid,uuid,uuid)',
    'revoke_qr_pass(uuid,uuid,uuid)',
    'resolve_qr(uuid,text)',
    'acknowledge_privacy_notice(uuid,uuid,text,text)',
    'my_children()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
