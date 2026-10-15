-- 0006 Clinical master data, schedule versions/rules, immutable vaccination history, evaluations.
-- Blueprint refs: BP28.3, BP16, F04, F06, F35; T07/T08/T09/T31 (engine + evidence part).
--
-- SAFETY: no clinical values live in this migration. Schedule content only ever enters through the reviewed
-- import/approval/activation commands (0007). Versions flagged is_demo can activate only when
-- private.settings.demo_mode = true, so fictional fixtures cannot become live clinical rules by accident.

-- ---------------------------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------------------------
create table public.antigens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  code text not null check (code ~ '^[A-Za-z0-9._-]{1,40}$'),
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id), unique (organization_id, code)
);
create trigger antigens_touch before update on public.antigens for each row execute function private.touch_row();

create table public.vaccine_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  code text not null check (code ~ '^[A-Za-z0-9._-]{1,40}$'),
  name text not null check (length(btrim(name)) > 0),
  manufacturer text,
  presentation text not null,
  stock_unit text not null,
  doses_per_container numeric not null check (doses_per_container > 0),
  administration_unit text not null,
  policy_reference text not null default '',
  status text not null default 'draft' check (status in ('draft','active','retired')),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id), unique (organization_id, code)
);
create trigger vaccine_products_touch before update on public.vaccine_products for each row execute function private.touch_row();

create table public.product_antigens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  product_id uuid not null, antigen_id uuid not null,
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, product_id) references public.vaccine_products (organization_id, id),
  foreign key (organization_id, antigen_id) references public.antigens (organization_id, id),
  unique (product_id, antigen_id)
);
-- A product's presentation/conversion must not change once used (BP28.3): enforced in 0007 by trigger once history references it.

-- ---------------------------------------------------------------------------------------------
-- Schedule versions and typed rules
-- ---------------------------------------------------------------------------------------------
create table public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  program_code text not null check (program_code ~ '^[A-Za-z0-9._-]{1,40}$'),
  version_label text not null check (length(btrim(version_label)) > 0),
  status text not null default 'draft' check (status in ('draft','clinical_review','approved','active','retired')),
  is_demo boolean not null default false,
  effective_from date, effective_to date,
  cohort_predicate jsonb not null default '{}'::jsonb,
  source_reference text not null default '',
  source_hash text,
  proposed_by uuid references public.profiles (id),
  reviewed_by uuid references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  supersedes_id uuid references public.schedule_versions (id),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  unique (organization_id, id), unique (organization_id, program_code, version_label),
  -- A retired version may end before it began (retired before its start date).
  check (status = 'retired' or effective_to is null or effective_from is null or effective_to >= effective_from),
  check (status not in ('approved','active') or (approved_by is not null and approved_at is not null)),
  check (status <> 'active' or effective_from is not null),
  -- Non-demo versions must cite their authority; demo versions must not pretend to.
  check (is_demo or status = 'draft' or length(btrim(source_reference)) > 0)
);
create trigger schedule_versions_touch before update on public.schedule_versions for each row execute function private.touch_row();
create unique index schedule_versions_one_live_uq on public.schedule_versions (organization_id, program_code) where status = 'active';

create table public.schedule_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  schedule_version_id uuid not null,
  sequence_no integer not null check (sequence_no > 0),
  requirement_code text not null check (requirement_code ~ '^[A-Za-z0-9._-]{1,60}$'),
  antigen_id uuid not null,
  series_code text not null,
  dose_ordinal integer not null check (dose_ordinal > 0),
  target_offset jsonb,       -- {"value":int,"unit":"days|weeks|months"} calendar-age offset from birth
  minimum_age jsonb,
  maximum_age jsonb,
  due_window jsonb,          -- {"start":{..},"end":{..}} ages; either bound optional
  review_conditions jsonb not null default '[]'::jsonb,
  accepted_products jsonb not null default '[]'::jsonb,   -- product codes; empty = any product mapped to the antigen
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, schedule_version_id) references public.schedule_versions (organization_id, id),
  foreign key (organization_id, antigen_id) references public.antigens (organization_id, id),
  unique (schedule_version_id, requirement_code), unique (schedule_version_id, sequence_no),
  unique (schedule_version_id, series_code, dose_ordinal),
  unique (organization_id, id)
);
create index schedule_rules_version_idx on public.schedule_rules (schedule_version_id, sequence_no);

create table public.schedule_rule_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  rule_id uuid not null, predecessor_rule_id uuid not null,
  minimum_interval_value integer not null check (minimum_interval_value >= 0),
  interval_unit text not null check (interval_unit in ('days','weeks','months')),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, rule_id) references public.schedule_rules (organization_id, id),
  foreign key (organization_id, predecessor_rule_id) references public.schedule_rules (organization_id, id),
  unique (rule_id, predecessor_rule_id), check (rule_id <> predecessor_rule_id)
);

-- Fixture cases that gate approval: hypothetical child + doses + as-of date + expected requirement statuses.
create table public.schedule_fixtures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  schedule_version_id uuid not null,
  name text not null,
  dob date not null,
  doses jsonb not null default '[]'::jsonb,   -- [{ "id": "d1", "antigens": ["CODE"], "product": "CODE", "on": "YYYY-MM-DD" }]
  as_of date not null,
  expected jsonb not null,                    -- { "REQ_CODE": "status", ... }
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, schedule_version_id) references public.schedule_versions (organization_id, id),
  unique (schedule_version_id, name)
);

-- Content of a version is frozen once it leaves draft (BP16: active version immutable).
create function private.freeze_schedule_content() returns trigger language plpgsql set search_path = '' as $$
declare v_status text; v_id uuid;
begin
  -- Separate statements: plpgsql resolves record fields at plan time, so one CASE over different row types would fail.
  if tg_table_name = 'schedule_rule_dependencies' then
    if tg_op = 'DELETE' then
      select r.schedule_version_id into v_id from public.schedule_rules r where r.id = old.rule_id;
    else
      select r.schedule_version_id into v_id from public.schedule_rules r where r.id = new.rule_id;
    end if;
  elsif tg_op = 'DELETE' then
    v_id := old.schedule_version_id;
  else
    v_id := new.schedule_version_id;
  end if;
  select status into v_status from public.schedule_versions where id = v_id;
  if v_status is distinct from 'draft' then
    raise exception 'schedule version content is frozen once it leaves draft' using errcode = 'CV409';
  end if;
  return coalesce(new, old);
end $$;
create trigger schedule_rules_freeze before insert or update or delete on public.schedule_rules for each row execute function private.freeze_schedule_content();
create trigger schedule_deps_freeze before insert or update or delete on public.schedule_rule_dependencies for each row execute function private.freeze_schedule_content();
create trigger schedule_fixtures_freeze before insert or update or delete on public.schedule_fixtures for each row execute function private.freeze_schedule_content();

create function private.schedule_version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'only draft schedule versions can be deleted' using errcode = 'CV409'; end if;
    return old;
  end if;
  if old.status in ('active','retired','approved') then
    -- Only lifecycle fields may change on a frozen version.
    if (new.program_code, new.version_label, new.is_demo, new.cohort_predicate, new.source_reference, new.source_hash)
       is distinct from (old.program_code, old.version_label, old.is_demo, old.cohort_predicate, old.source_reference, old.source_hash) then
      raise exception 'approved/active schedule versions are immutable' using errcode = 'CV409';
    end if;
  end if;
  return new;
end $$;
create trigger schedule_versions_guard before update or delete on public.schedule_versions for each row execute function private.schedule_version_guard();

-- ---------------------------------------------------------------------------------------------
-- Child program assignment
-- ---------------------------------------------------------------------------------------------
create table public.child_programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null, schedule_version_id uuid not null,
  program_code text not null,
  starts_on date not null, ends_on date,
  status text not null default 'active' check (status in ('active','ended')),
  assignment_reason text not null default 'automatic',
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, schedule_version_id) references public.schedule_versions (organization_id, id)
);
create unique index child_programs_one_active_uq on public.child_programs (child_id, program_code) where status = 'active';
create trigger child_programs_touch before update on public.child_programs for each row execute function private.touch_row();

create table public.clinical_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null, rule_id uuid,
  reason_code text not null check (length(btrim(reason_code)) > 0),
  restricted_note text,
  starts_at timestamptz not null default now(), review_on date,
  status text not null default 'active' check (status in ('active','resolved')),
  resolved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, rule_id) references public.schedule_rules (organization_id, id)
);
create index clinical_holds_child_idx on public.clinical_holds (child_id, status);
create trigger clinical_holds_touch before update on public.clinical_holds for each row execute function private.touch_row();

-- ---------------------------------------------------------------------------------------------
-- Immutable vaccination history: event (occurrence) + revisions (signed/corrected descriptions)
-- ---------------------------------------------------------------------------------------------
create table public.vaccination_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  original_child_id uuid not null,
  encounter_id uuid,           -- FK added with the visits module (M05)
  origin text not null check (origin in ('clinic_administered','paper_reconciliation','external','parent_reported','bhw_reported','historical_import')),
  external_provider text, external_reference text, paper_reference text,
  source_operation_id uuid,
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, original_child_id) references public.children (organization_id, id),
  unique (organization_id, id), unique (source_operation_id)
);
create index vaccination_events_child_idx on public.vaccination_events (original_child_id);

create table public.vaccination_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  event_id uuid not null,
  revision_no integer not null check (revision_no > 0),
  child_id uuid not null,
  product_id uuid,
  reported_product_text text,
  administered_on date,
  administered_at timestamptz,
  date_precision text not null default 'exact' check (date_precision in ('exact','month','year','unknown')),
  lot_id uuid,                 -- FK added with the inventory module (M04)
  reported_lot text,
  expiry_snapshot date,
  quantity numeric, unit text, route text, site text,
  administered_by uuid references public.profiles (id),
  external_vaccinator text,
  clinic_id uuid,
  source text not null check (source in ('clinic_administered','paper_reconciliation','external_documented','parent_reported','bhw_reported','historical_import')),
  verification_status text not null check (verification_status in ('verified','pending_verification','rejected')),
  event_status text not null default 'active' check (event_status in ('active','voided')),
  reason text,
  approved_by uuid references public.profiles (id),
  signed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, event_id) references public.vaccination_events (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, product_id) references public.vaccine_products (organization_id, id),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  unique (event_id, revision_no),
  -- Reported/pending doses can never be "verified" without a verifier (BP15.C, T09).
  check (verification_status <> 'verified' or (approved_by is not null or source = 'clinic_administered')),
  check (date_precision <> 'exact' or administered_on is not null),
  check (source <> 'clinic_administered' or (product_id is not null and administered_on is not null and administered_by is not null and clinic_id is not null))
);
create index vaccination_revisions_child_idx on public.vaccination_revisions (child_id, administered_on);
create trigger vaccination_events_immutable before update or delete on public.vaccination_events for each row execute function private.forbid_change();
create trigger vaccination_revisions_immutable before update or delete on public.vaccination_revisions for each row execute function private.forbid_change();

-- Current authoritative facts: the highest revision per event (only accepted revisions exist).
create view private.current_revisions as
  select distinct on (r.event_id) r.* from public.vaccination_revisions r order by r.event_id, r.revision_no desc;

create table public.schedule_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null, schedule_version_id uuid not null,
  as_of_date date not null, engine_version text not null, input_hash text not null,
  result jsonb not null,
  evaluated_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, schedule_version_id) references public.schedule_versions (organization_id, id),
  unique (child_id, schedule_version_id, as_of_date, engine_version, input_hash),
  unique (organization_id, id)
);
create index schedule_evaluations_child_idx on public.schedule_evaluations (child_id, evaluated_at desc);
create trigger schedule_evaluations_immutable before update or delete on public.schedule_evaluations for each row execute function private.forbid_change();

create table public.dose_credits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  evaluation_id uuid not null, rule_id uuid not null, vaccination_revision_id uuid not null,
  credit_status text not null check (credit_status in ('credited','not_credited')),
  reason text not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, evaluation_id) references public.schedule_evaluations (organization_id, id),
  foreign key (organization_id, rule_id) references public.schedule_rules (organization_id, id),
  foreign key (vaccination_revision_id) references public.vaccination_revisions (id),
  unique (evaluation_id, rule_id)
);
create trigger dose_credits_immutable before update or delete on public.dose_credits for each row execute function private.forbid_change();

-- Evidence files: metadata table only. Upload/download needs Storage (blocked_external until a Supabase project exists).
create table public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null, event_id uuid,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','application/pdf')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source text not null,
  verification_status text not null default 'pending_verification' check (verification_status in ('pending_verification','verified','rejected')),
  verified_by uuid references public.profiles (id),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, event_id) references public.vaccination_events (organization_id, id)
);
create trigger record_attachments_touch before update on public.record_attachments for each row execute function private.touch_row();

-- ---------------------------------------------------------------------------------------------
-- Security posture: RLS on, no direct grants. Reads and writes are commands (0007).
-- ---------------------------------------------------------------------------------------------
alter table public.antigens enable row level security;
alter table public.vaccine_products enable row level security;
alter table public.product_antigens enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.schedule_rules enable row level security;
alter table public.schedule_rule_dependencies enable row level security;
alter table public.schedule_fixtures enable row level security;
alter table public.child_programs enable row level security;
alter table public.clinical_holds enable row level security;
alter table public.vaccination_events enable row level security;
alter table public.vaccination_revisions enable row level security;
alter table public.schedule_evaluations enable row level security;
alter table public.dose_credits enable row level security;
alter table public.record_attachments enable row level security;

revoke all on public.antigens, public.vaccine_products, public.product_antigens, public.schedule_versions, public.schedule_rules,
              public.schedule_rule_dependencies, public.schedule_fixtures, public.child_programs, public.clinical_holds,
              public.vaccination_events, public.vaccination_revisions, public.schedule_evaluations, public.dose_credits,
              public.record_attachments from anon, authenticated;
revoke all on private.current_revisions from public, anon, authenticated;
