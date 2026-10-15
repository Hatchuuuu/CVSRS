-- 0012 Sessions, appointments, arrival queue, encounters, and the durable outbox.
-- Blueprint refs: BP17, BP28.4, F07, F08, T02, T26 (partly). Booking, arrival and clinical completion are DIFFERENT facts:
--  * an appointment reserves capacity; it never proves eligibility or vaccination;
--  * a queue entry is an arrival; numbers are allocated per clinic per local day and never reused;
--  * an encounter is the clinical visit; it starts when service starts.

-- ---------------------------------------------------------------------------------------------
-- Durable outbox (private): business transactions enqueue; a bounded worker (M07) delivers. No external calls here.
-- ---------------------------------------------------------------------------------------------
create table private.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','processing','done','failed','cancelled')),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  locked_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index outbox_ready_idx on private.outbox_jobs (status, available_at);

create function private.enqueue(p_org uuid, p_type text, p_agg_type text, p_agg uuid, p_dedupe text, p_payload jsonb, p_available timestamptz default now()) returns void
language sql security definer set search_path = '' as $$
  insert into private.outbox_jobs (organization_id, job_type, aggregate_type, aggregate_id, dedupe_key, payload, available_at)
  values (p_org, p_type, p_agg_type, p_agg, p_dedupe, coalesce(p_payload, '{}'::jsonb), p_available)
  on conflict (organization_id, dedupe_key) do nothing
$$;

-- ---------------------------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------------------------
create table public.clinic_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  service_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  service_code text not null default 'immunization' check (length(btrim(service_code)) between 1 and 40),
  total_capacity integer not null check (total_capacity >= 0),
  online_capacity integer not null check (online_capacity >= 0),
  walkin_capacity integer not null check (walkin_capacity >= 0),
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  unique (organization_id, id),
  check (ends_at > starts_at),
  check (online_capacity + walkin_capacity <= total_capacity)
);
create index clinic_sessions_lookup_idx on public.clinic_sessions (clinic_id, service_date, status);
create trigger clinic_sessions_touch before update on public.clinic_sessions for each row execute function private.touch_row();

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null, session_id uuid not null,
  booked_by uuid not null references public.profiles (id),
  channel text not null check (channel in ('online','assisted')),
  status text not null default 'confirmed' check (status in ('confirmed','checked_in','fulfilled','cancelled','no_show','rescheduled')),
  reason text,
  replaces_id uuid references public.appointments (id),
  checked_in_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, session_id) references public.clinic_sessions (organization_id, id),
  unique (organization_id, id)
);
create unique index appointments_one_active_uq on public.appointments (child_id, session_id) where status in ('confirmed','checked_in','fulfilled');
create index appointments_session_idx on public.appointments (session_id, status);
create index appointments_child_idx on public.appointments (child_id, status);
create trigger appointments_touch before update on public.appointments for each row execute function private.touch_row();

create table public.appointment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  appointment_id uuid not null, rule_id uuid,
  purpose text not null default 'care',
  created_at timestamptz not null default now(),
  foreign key (organization_id, appointment_id) references public.appointments (organization_id, id),
  foreign key (organization_id, rule_id) references public.schedule_rules (organization_id, id)
);
create unique index appointment_items_uq on public.appointment_items (appointment_id, rule_id) where rule_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Encounters and queue
-- ---------------------------------------------------------------------------------------------
create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null, clinic_id uuid not null, appointment_id uuid,
  service_date date not null,
  started_at timestamptz, ended_at timestamptz,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  outcome text check (outcome in ('vaccinated','deferred','referred','no_service','left')),
  assessment_reference text, consent_reference text,
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, appointment_id) references public.appointments (organization_id, id),
  unique (organization_id, id),
  check (status <> 'completed' or outcome is not null)
);
create index encounters_clinic_idx on public.encounters (clinic_id, service_date, status);
create trigger encounters_touch before update on public.encounters for each row execute function private.touch_row();
alter table public.vaccination_events add foreign key (organization_id, encounter_id) references public.encounters (organization_id, id);

create table private.queue_counters (clinic_id uuid not null, service_date date not null, next_no integer not null default 1, primary key (clinic_id, service_date));

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  child_id uuid not null, clinic_id uuid not null, service_date date not null,
  appointment_id uuid, encounter_id uuid,
  ticket_no integer not null check (ticket_no > 0),
  station text,
  status text not null default 'waiting' check (status in ('waiting','called','in_service','completed','held','left','cancelled','deferred')),
  walk_in boolean not null default false,
  priority_code text not null default 'routine' check (priority_code in ('routine','priority')),
  priority_reason text,
  queued_at timestamptz not null default now(),
  arrived_at timestamptz not null default now(),
  called_at timestamptz, service_started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, appointment_id) references public.appointments (organization_id, id),
  foreign key (organization_id, encounter_id) references public.encounters (organization_id, id),
  unique (organization_id, id),
  unique (clinic_id, service_date, ticket_no),
  check (priority_code = 'routine' or (priority_reason is not null and length(btrim(priority_reason)) >= 3))
);
create unique index queue_one_active_uq on public.queue_entries (clinic_id, service_date, child_id) where status in ('waiting','called','in_service','held');
create index queue_order_idx on public.queue_entries (clinic_id, service_date, status, priority_code, queued_at);
create trigger queue_entries_touch before update on public.queue_entries for each row execute function private.touch_row();

create table public.queue_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  queue_entry_id uuid not null,
  from_status text, to_status text not null,
  station text, reason text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, queue_entry_id) references public.queue_entries (organization_id, id)
);
create index queue_events_entry_idx on public.queue_events (queue_entry_id, occurred_at);
create trigger queue_events_immutable before update or delete on public.queue_events for each row execute function private.forbid_change();
create trigger queue_events_no_truncate before truncate on public.queue_events for each statement execute function private.forbid_change();

-- Follow-up work for closures/needs-recheck (BP17: closure never silently cancels bookings).
alter table public.record_review_cases drop constraint record_review_cases_kind_check;
alter table public.record_review_cases add constraint record_review_cases_kind_check check (kind in ('duplicate','link','identity_edit','correction','clinical','stock','sync','appointment'));

alter table public.clinic_sessions enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_items enable row level security;
alter table public.encounters enable row level security;
alter table public.queue_entries enable row level security;
alter table public.queue_events enable row level security;
revoke all on public.clinic_sessions, public.appointments, public.appointment_items, public.encounters, public.queue_entries, public.queue_events from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function private.session_booked(p_session uuid) returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.appointments where session_id = p_session and status in ('confirmed','checked_in','fulfilled')
$$;

create function private.allocate_ticket(p_clinic uuid, p_date date) returns integer language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  -- The upsert takes the counter row's lock, so concurrent check-ins are serialised and numbers are unique and gapless.
  insert into private.queue_counters (clinic_id, service_date, next_no) values (p_clinic, p_date, 2)
  on conflict (clinic_id, service_date) do update set next_no = private.queue_counters.next_no + 1
  returning next_no - 1 into v;
  return v;
end $$;

create function private.ticket_label(p_date date, p_no int) returns text language sql immutable set search_path = '' as $$
  select to_char(p_date, 'MMDD') || '-' || lpad(p_no::text, 3, '0')
$$;

create function private.appointment_json(a public.appointments, s public.clinic_sessions) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('appointmentId', a.id, 'childId', a.child_id, 'sessionId', a.session_id, 'status', a.status, 'channel', a.channel,
    'serviceDate', s.service_date, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'serviceCode', s.service_code, 'reason', a.reason, 'version', a.version)
$$;

-- Guardian (verified) or clinic staff acting on a child
create function private.can_book_for(p_child uuid, p_clinic uuid) returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if private.guardian_has_full_access(p_child) then return 'online'; end if;
  if private.has_capability(p_clinic, 'appointment.manage') and private.child_in_clinic(p_child, p_clinic) then return 'assisted'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Session commands
-- ---------------------------------------------------------------------------------------------
create function public.create_session(p_operation_key uuid, p_clinic_id uuid, p_session jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_tz text; v_prev jsonb; v_id uuid; v_date date; v_start timestamptz; v_end timestamptz; v_total int; v_online int; v_walk int; v_code text;
begin
  select organization_id, timezone into v_org, v_tz from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'appointment.manage');
  v_prev := private.begin_command(v_org, p_operation_key, 'session.create', jsonb_build_object('c', p_clinic_id, 's', p_session));
  if v_prev is not null then return v_prev; end if;
  begin
    v_date := (p_session ->> 'serviceDate')::date;
    v_start := ((p_session ->> 'serviceDate') || ' ' || (p_session ->> 'startTime'))::timestamp at time zone v_tz;
    v_end := ((p_session ->> 'serviceDate') || ' ' || (p_session ->> 'endTime'))::timestamp at time zone v_tz;
    v_total := (p_session ->> 'totalCapacity')::int; v_online := (p_session ->> 'onlineCapacity')::int; v_walk := (p_session ->> 'walkinCapacity')::int;
  exception when others then raise exception 'invalid session details' using errcode = 'CV422';
  end;
  v_code := coalesce(nullif(btrim(p_session ->> 'serviceCode'), ''), 'immunization');
  if v_end <= v_start then raise exception 'the session must end after it starts' using errcode = 'CV422'; end if;
  if v_total < 0 or v_online < 0 or v_walk < 0 or v_online + v_walk > v_total then raise exception 'online plus walk-in capacity cannot exceed total capacity' using errcode = 'CV422'; end if;
  insert into public.clinic_sessions (organization_id, clinic_id, service_date, starts_at, ends_at, service_code, total_capacity, online_capacity, walkin_capacity, created_by, updated_by)
  values (v_org, p_clinic_id, v_date, v_start, v_end, v_code, v_total, v_online, v_walk, auth.uid(), auth.uid()) returning id into v_id;
  perform private.audit(v_org, 'appointment.manage', 'session.created', 'clinic_session', v_id, null, jsonb_build_object('date', v_date, 'online', v_online, 'walkin', v_walk, 'total', v_total), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('sessionId', v_id));
end $$;
