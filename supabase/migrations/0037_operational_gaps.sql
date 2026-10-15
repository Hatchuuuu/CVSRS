-- 0037 Operational gaps found by the 2026-10-04 whole-system audit (docs/audit/2026-10-04-capstone-production-audit.md, F40-F50).
--
--  F40 A service day closes: unfinished tickets and visits reach a final state, missed bookings become no-shows, sessions close.
--      Staff close past days from Today; the worker closes them automatically (private.run_daily_maintenance).
--      A vaccination can no longer be recorded against an open visit from an earlier day.
--  F41 Staff read a child's bookings (list_child_appointments); booking, moving and cancelling reuse the existing commands.
--  F42 A cancelled session cancels its bookings (families already got the message); capacity can be changed; staff see who is booked.
--  F43 A schedule under clinical review can be sent back to draft (reviewer) or withdrawn (proposer).
--  F44 A stock count awaiting approval can be rejected.
--  F45 Families are told when the clinic verifies, pauses, restores or ends their access, and when a link request, an edit
--      request or a reported vaccine is decided.
--  F46 Reminders: the day before a booked visit, and once a week while a vaccine is due or overdue.
--  F47 People can correct their own name and language (update_my_profile).
--  F48 The phone number and language entered at sign-up are kept and become the guardian's (unverified) contact.
--  F49 An account created without a name is asked for one; the name falls back to the email's local part meanwhile.
--  F50 Real-world end states: a child marked inactive (moved, died), a guardian phone marked not working, a stock location
--      closed, and an operator-only account status change.
--
-- Conventions as in 0001: SECURITY DEFINER with an empty search_path, idempotent commands keyed by p_operation_key, stable
-- SQLSTATEs (CV4xx), one audit row per decision, explicit grants.

-- ---------------------------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------------------------
alter table public.profiles add column needs_name boolean not null default false;
alter table public.profiles add column signup_phone text check (signup_phone is null or length(signup_phone) <= 20);

alter table public.children add column inactive_reason text check (inactive_reason is null or inactive_reason in ('moved','deceased','other'));
alter table public.children add column inactive_note text check (inactive_note is null or length(inactive_note) <= 300);
alter table public.children add column inactive_at timestamptz;

-- When the daily jobs last ran (at most every ten minutes) and which children were checked for due reminders today.
create table private.maintenance_runs (
  job text primary key,
  last_run_at timestamptz not null
);
create table private.reminder_checks (
  child_id uuid primary key references public.children (id) on delete restrict,
  checked_on date not null
);
revoke all on private.maintenance_runs, private.reminder_checks from public, anon, authenticated;

-- Day closure scans only rows that are still open.
create index encounters_open_idx on public.encounters (clinic_id, service_date) where status = 'open';
create index clinic_sessions_open_idx on public.clinic_sessions (clinic_id, service_date) where status = 'open';
-- Guardian lookups by account (my_guardian_ids, contact preferences, care content) filter by profile_id alone.
create index guardians_profile_idx on public.guardians (profile_id) where deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- F40 Day closure
-- ---------------------------------------------------------------------------------------------
create function private.close_service_day_core(p_clinic uuid, p_date date, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; q public.queue_entries; v_done boolean;
  v_left int := 0; v_completed int := 0; v_unserved int := 0; v_no_show int := 0; v_cancelled int := 0; v_sessions int := 0; v_encounters int := 0;
begin
  select organization_id into v_org from public.clinics where id = p_clinic;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_date is null or p_date >= private.local_today(p_clinic) then raise exception 'only a past service day can be closed' using errcode = 'CV422'; end if;
  perform pg_catalog.set_config('cvsrs.audit_clinic', p_clinic::text, true);

  for q in select * from public.queue_entries where clinic_id = p_clinic and service_date = p_date and status in ('waiting','called','held','in_service')
            order by ticket_no for update loop
    if q.status = 'in_service' then
      -- A visit in service ends as vaccinated only when a vaccination was actually recorded in it; otherwise it ends unserved.
      v_done := q.encounter_id is not null and exists (select 1 from public.vaccination_events v where v.encounter_id = q.encounter_id);
      if v_done then
        update public.queue_entries set status = 'completed', completed_at = now(), updated_by = auth.uid() where id = q.id;
        update public.encounters set status = 'completed', outcome = 'vaccinated', ended_at = coalesce(ended_at, now()), updated_by = auth.uid()
         where id = q.encounter_id and status = 'open';
        if q.appointment_id is not null then
          update public.appointments set status = 'fulfilled', updated_by = auth.uid() where id = q.appointment_id and status in ('confirmed','checked_in');
        end if;
        perform private.queue_event(q, q.status, 'completed', q.station, p_reason);
        v_completed := v_completed + 1;
      else
        update public.queue_entries set status = 'left', completed_at = now(), updated_by = auth.uid() where id = q.id;
        update public.encounters set status = 'cancelled', outcome = 'left', ended_at = coalesce(ended_at, now()), updated_by = auth.uid()
         where id = q.encounter_id and status = 'open';
        perform private.queue_event(q, q.status, 'left', q.station, p_reason);
        v_unserved := v_unserved + 1;
      end if;
    else
      update public.queue_entries set status = 'left', completed_at = now(), updated_by = auth.uid() where id = q.id;
      perform private.queue_event(q, q.status, 'left', q.station, p_reason);
      v_left := v_left + 1;
    end if;
  end loop;

  -- Any other visit still open on that day (for example one opened before a ticket was cancelled elsewhere).
  with closed as (
    update public.encounters e
       set status = case when exists (select 1 from public.vaccination_events v where v.encounter_id = e.id) then 'completed' else 'cancelled' end,
           outcome = case when exists (select 1 from public.vaccination_events v where v.encounter_id = e.id) then 'vaccinated' else 'left' end,
           ended_at = coalesce(e.ended_at, now()), updated_by = auth.uid()
     where e.clinic_id = p_clinic and e.service_date = p_date and e.status = 'open'
    returning 1)
  select count(*) into v_encounters from closed;

  -- Bookings in a session the clinic cancelled were never missed by the family.
  with c as (
    update public.appointments a set status = 'cancelled', updated_by = auth.uid()
      from public.clinic_sessions s
     where s.id = a.session_id and s.clinic_id = p_clinic and s.service_date = p_date and s.status = 'cancelled' and a.status = 'confirmed'
    returning 1)
  select count(*) into v_cancelled from c;
  -- A booking that never arrived is a no-show. An arrival that was not served keeps its 'checked_in' status: the family came.
  with n as (
    update public.appointments a set status = 'no_show', updated_by = auth.uid()
      from public.clinic_sessions s
     where s.id = a.session_id and s.clinic_id = p_clinic and s.service_date = p_date and a.status = 'confirmed'
    returning 1)
  select count(*) into v_no_show from n;
  with s as (
    update public.clinic_sessions set status = 'closed', updated_by = auth.uid()
     where clinic_id = p_clinic and service_date = p_date and status = 'open'
    returning 1)
  select count(*) into v_sessions from s;

  if v_left + v_completed + v_unserved + v_no_show + v_cancelled + v_sessions + v_encounters > 0 then
    perform private.audit(v_org, 'queue.manage', 'day.closed', 'clinic', p_clinic, null,
      jsonb_build_object('date', p_date, 'ticketsLeft', v_left, 'visitsCompleted', v_completed, 'visitsUnserved', v_unserved + v_encounters,
                         'noShows', v_no_show, 'bookingsCancelled', v_cancelled, 'sessionsClosed', v_sessions), p_reason);
  end if;
  return jsonb_build_object('serviceDate', p_date, 'ticketsLeft', v_left, 'visitsCompleted', v_completed, 'visitsUnserved', v_unserved + v_encounters,
                            'noShows', v_no_show, 'bookingsCancelled', v_cancelled, 'sessionsClosed', v_sessions);
end $$;

create function public.close_service_day(p_operation_key uuid, p_clinic_id uuid, p_service_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'queue.manage');
  v_prev := private.begin_command(v_org, p_operation_key, 'day.close', jsonb_build_object('c', p_clinic_id, 'd', p_service_date));
  if v_prev is not null then return v_prev; end if;
  return private.finish_command(v_org, p_operation_key, private.close_service_day_core(p_clinic_id, p_service_date, 'Day closed by staff'));
end $$;

-- What is still open from earlier days, and what was closed in the last week (staff review it on Today).
create function public.service_day_backlog(p_clinic_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  perform private.require_any(p_clinic_id, array['queue.manage','appointment.manage']);
  v_today := private.local_today(p_clinic_id);
  return jsonb_build_object(
    'open', coalesce((select jsonb_agg(jsonb_build_object('serviceDate', d.service_date,
        'openTickets', (select count(*) from public.queue_entries q where q.clinic_id = p_clinic_id and q.service_date = d.service_date and q.status in ('waiting','called','held','in_service')),
        'openVisits', (select count(*) from public.encounters e where e.clinic_id = p_clinic_id and e.service_date = d.service_date and e.status = 'open'),
        'unconfirmedBookings', (select count(*) from public.appointments a join public.clinic_sessions s on s.id = a.session_id
                                 where s.clinic_id = p_clinic_id and s.service_date = d.service_date and a.status = 'confirmed'),
        'openSessions', (select count(*) from public.clinic_sessions s where s.clinic_id = p_clinic_id and s.service_date = d.service_date and s.status = 'open'))
        order by d.service_date desc)
      from (select distinct service_date from (
              select q.service_date from public.queue_entries q where q.clinic_id = p_clinic_id and q.service_date < v_today and q.status in ('waiting','called','held','in_service')
              union select e.service_date from public.encounters e where e.clinic_id = p_clinic_id and e.service_date < v_today and e.status = 'open'
              union select s.service_date from public.clinic_sessions s where s.clinic_id = p_clinic_id and s.service_date < v_today and s.status = 'open') x
            order by service_date desc limit 30) d), '[]'::jsonb),
    'recentlyClosed', coalesce((select jsonb_agg(jsonb_build_object('closedAt', l.server_time, 'automatic', l.actor_id is null, 'summary', l.after) order by l.server_time desc)
      from (select * from private.audit_logs a where a.clinic_id = p_clinic_id and a.action = 'day.closed' and a.server_time > now() - interval '7 days'
            order by a.server_time desc limit 14) l), '[]'::jsonb));
end $$;

-- Worker: closes every past day still open, oldest first, a bounded number per run.
create function private.auto_close_service_days(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  for r in
    select x.clinic_id, x.service_date from (
      select q.clinic_id, q.service_date from public.queue_entries q where q.status in ('waiting','called','held','in_service')
      union select e.clinic_id, e.service_date from public.encounters e where e.status = 'open'
      union select s.clinic_id, s.service_date from public.clinic_sessions s where s.status = 'open') x
    join public.clinics c on c.id = x.clinic_id and c.status = 'active'
    where x.service_date < private.local_today(x.clinic_id)
    order by x.service_date, x.clinic_id
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
  loop
    perform private.close_service_day_core(r.clinic_id, r.service_date, 'Day closed automatically');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('daysClosed', v_n);
end $$;

-- A vaccination belongs to today's visit. Care given on an earlier day is recorded as care already given (late entry).
create function private.vaccination_on_current_visit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare e public.encounters;
begin
  if new.encounter_id is null then return new; end if;
  select * into e from public.encounters where id = new.encounter_id;
  if e.id is not null and e.service_date <> private.local_today(e.clinic_id) then
    raise exception 'this visit belongs to an earlier day; record the vaccination as care already given' using errcode = 'CV409';
  end if;
  return new;
end $$;
create trigger vaccination_events_current_visit before insert on public.vaccination_events
  for each row when (new.origin = 'clinic_administered') execute function private.vaccination_on_current_visit();

-- ---------------------------------------------------------------------------------------------
-- F41 / F42 Bookings and sessions for staff
-- ---------------------------------------------------------------------------------------------
create function public.list_child_appointments(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_canon uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['appointment.manage','queue.manage']);
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  perform private.audit(v_org, 'appointment.manage', 'appointments.view', 'child', v_canon, null, null, null);
  return coalesce((select jsonb_agg(jsonb_build_object('appointmentId', a.id, 'status', a.status, 'channel', a.channel, 'sessionId', s.id,
      'serviceDate', s.service_date, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'sessionStatus', s.status, 'reason', a.reason, 'version', a.version)
      order by s.starts_at desc)
    from public.appointments a join public.clinic_sessions s on s.id = a.session_id
   where a.child_id in (select private.child_ids_with_aliases(v_canon)) and s.clinic_id = p_clinic_id
     and s.service_date >= private.local_today(p_clinic_id) - 30), '[]'::jsonb);
end $$;

create function public.list_session_roster(p_clinic_id uuid, p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; s public.clinic_sessions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['appointment.manage','queue.manage']);
  select * into s from public.clinic_sessions where id = p_session_id and clinic_id = p_clinic_id;
  if s.id is null then return null; end if;
  perform private.audit(v_org, 'appointment.manage', 'appointments.view', 'clinic_session', s.id, null, null, null);
  return coalesce((select jsonb_agg(jsonb_build_object('appointmentId', a.id, 'status', a.status, 'channel', a.channel, 'childId', c.id,
      'childName', c.display_name, 'recordNo', c.local_record_no) order by c.display_name)
    from public.appointments a join public.children c on c.id = a.child_id
   where a.session_id = s.id and a.status in ('confirmed','checked_in','fulfilled','no_show')), '[]'::jsonb);
end $$;

-- Same checks as create_session, and never below the families already booked.
create function public.update_session_capacity(p_operation_key uuid, p_clinic_id uuid, p_session_id uuid, p_expected_version integer,
                                               p_total integer, p_online integer, p_walkin integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; s public.clinic_sessions; v_booked int;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'appointment.manage');
  v_prev := private.begin_command(v_org, p_operation_key, 'session.capacity',
    jsonb_build_object('c', p_clinic_id, 's', p_session_id, 'v', p_expected_version, 't', p_total, 'o', p_online, 'w', p_walkin));
  if v_prev is not null then return v_prev; end if;
  select * into s from public.clinic_sessions where id = p_session_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if s.version <> p_expected_version then raise exception 'the session changed; reload and try again' using errcode = 'CV409'; end if;
  if s.status <> 'open' or s.ends_at <= now() then raise exception 'only an open, upcoming session can be changed' using errcode = 'CV409'; end if;
  if p_total is null or p_online is null or p_walkin is null or p_total < 0 or p_online < 0 or p_walkin < 0 or p_online + p_walkin > p_total then
    raise exception 'online plus walk-in capacity cannot exceed total capacity' using errcode = 'CV422';
  end if;
  v_booked := private.session_booked(s.id);
  if p_online < v_booked then
    raise exception '% families are already booked; bookable places cannot go below that', v_booked using errcode = 'CV409';
  end if;
  update public.clinic_sessions set total_capacity = p_total, online_capacity = p_online, walkin_capacity = p_walkin, updated_by = auth.uid() where id = s.id;
  perform private.audit(v_org, 'appointment.manage', 'session.capacity_changed', 'clinic_session', s.id,
    jsonb_build_object('total', s.total_capacity, 'online', s.online_capacity, 'walkin', s.walkin_capacity),
    jsonb_build_object('total', p_total, 'online', p_online, 'walkin', p_walkin), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('sessionId', s.id, 'booked', v_booked));
end $$;

-- list_sessions also returns the version, so capacity changes are made against the row the person saw.
create or replace function public.list_sessions(p_clinic_id uuid, p_from date default null::date, p_to date default null::date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_from date; v_to date; v_res jsonb;
begin
  perform private.require_any(p_clinic_id, array['appointment.manage','queue.manage','child.search']);
  v_from := coalesce(p_from, private.local_today(p_clinic_id)); v_to := coalesce(p_to, v_from + 14);
  if v_to < v_from or v_to - v_from > 92 then raise exception 'date range must be 0-92 days' using errcode = 'CV422'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'sessionId', s.id, 'serviceDate', s.service_date, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'serviceCode', s.service_code, 'status', s.status,
      'totalCapacity', s.total_capacity, 'onlineCapacity', s.online_capacity, 'walkinCapacity', s.walkin_capacity, 'version', s.version,
      'booked', private.session_booked(s.id), 'remainingOnline', greatest(s.online_capacity - private.session_booked(s.id), 0)) order by s.starts_at), '[]'::jsonb)
    into v_res from public.clinic_sessions s where s.clinic_id = p_clinic_id and s.service_date between v_from and v_to;
  return v_res;
end $$;

-- A cancelled session now cancels its bookings, so families no longer see them as booked (they are told by message, as before).
create or replace function public.cancel_session(p_operation_key uuid, p_clinic_id uuid, p_session_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; s public.clinic_sessions; a record; v_n int := 0;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'appointment.manage');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'session.cancel', jsonb_build_object('c', p_clinic_id, 's', p_session_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into s from public.clinic_sessions where id = p_session_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if s.status <> 'open' then raise exception 'session is not open' using errcode = 'CV409'; end if;
  update public.clinic_sessions set status = 'cancelled', cancel_reason = p_reason, updated_by = auth.uid() where id = s.id;
  for a in select * from public.appointments where session_id = s.id and status = 'confirmed' for update loop
    update public.appointments set status = 'cancelled', reason = left('Session cancelled: ' || btrim(p_reason), 300), updated_by = auth.uid() where id = a.id;
    update private.outbox_jobs set status = 'cancelled', updated_at = now()
     where organization_id = v_org and status = 'queued' and (dedupe_key like 'appt-remind:' || a.id || '%' or dedupe_key = 'appt-confirm:' || a.id);
    insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, reason, evidence, created_by, updated_by)
    values (v_org, p_clinic_id, 'appointment', a.child_id, 'session cancelled: contact family to rebook', jsonb_build_object('appointmentId', a.id, 'sessionId', s.id, 'serviceDate', s.service_date), auth.uid(), auth.uid());
    perform private.enqueue(v_org, 'appointment.session_cancelled', 'appointment', a.id, 'appt-session-cancelled:' || a.id, jsonb_build_object('sessionId', s.id));
    v_n := v_n + 1;
  end loop;
  perform private.audit(v_org, 'appointment.manage', 'session.cancelled', 'clinic_session', s.id, jsonb_build_object('status', s.status), jsonb_build_object('status', 'cancelled', 'affectedBookings', v_n), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('sessionId', s.id, 'affectedBookings', v_n));
end $$;

-- ---------------------------------------------------------------------------------------------
-- F43 Send a schedule under review back to draft
-- ---------------------------------------------------------------------------------------------
create function public.return_schedule_to_draft(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; sv public.schedule_versions; v_reviewer boolean;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['rules.approve','rules.propose']);
  v_prev := private.begin_command(v_org, p_operation_key, 'schedule.return', jsonb_build_object('c', p_clinic_id, 'v', p_version_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if sv.status <> 'clinical_review' then raise exception 'only a schedule awaiting review can be sent back' using errcode = 'CV409'; end if;
  v_reviewer := private.has_capability(p_clinic_id, 'rules.approve') and sv.proposed_by is distinct from auth.uid();
  if not v_reviewer and sv.proposed_by is distinct from auth.uid() then
    raise exception 'only a reviewer or the person who submitted it can send it back' using errcode = 'CV403';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  update public.schedule_versions set status = 'draft', reviewed_by = case when v_reviewer then auth.uid() else reviewed_by end, updated_by = auth.uid() where id = sv.id;
  perform private.audit(v_org, case when v_reviewer then 'rules.approve' else 'rules.propose' end, case when v_reviewer then 'schedule.returned' else 'schedule.withdrawn' end,
                        'schedule_version', sv.id, jsonb_build_object('status', sv.status), jsonb_build_object('status', 'draft'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', sv.id, 'status', 'draft'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- F44 Reject a stock count awaiting approval
-- ---------------------------------------------------------------------------------------------
create function public.reject_stock_adjustment(p_operation_key uuid, p_clinic_id uuid, p_case_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; k public.record_review_cases;
begin
  select * into k from public.record_review_cases where id = p_case_id and organization_id = v_org and clinic_id = p_clinic_id and kind = 'stock' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.reject_adjustment', jsonb_build_object('c', p_clinic_id, 'case', p_case_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if k.status not in ('open','in_review') then raise exception 'case already decided' using errcode = 'CV409'; end if;
  if k.evidence ->> 'observed' is null then
    raise exception 'this stock case is not a count adjustment; decide it from the transfer or the visit record it came from' using errcode = 'CV409';
  end if;
  if k.created_by = auth.uid() then raise exception 'the person who counted cannot decide their own count' using errcode = 'CV403'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  update public.record_review_cases set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'rejected', 'reason', left(btrim(p_reason), 500)) where id = k.id;
  perform private.audit(v_org, 'inventory.approve', 'stock.adjustment_rejected', 'review_case', k.id, null, null, p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'rejected'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- F45 / F46 Family notifications and reminders
-- ---------------------------------------------------------------------------------------------
-- One in-app message to one account (for people who are not yet verified guardians, such as a declined link request).
create function private.notify_profile(p_org uuid, p_profile uuid, p_child uuid, p_kind text, p_title text, p_body text, p_dedupe text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_profile is null then return 0; end if;
  insert into public.messages (organization_id, recipient_profile_id, child_id, kind, title, body, dedupe_key)
  select p_org, p.id, p_child, p_kind, p_title, p_body, p_dedupe from public.profiles p where p.id = p_profile and p.status = 'active'
  on conflict (recipient_profile_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Messages about a child marked inactive (moved away or died) are never sent.
create or replace function private.notify_guardians(p_org uuid, p_child uuid, p_kind text, p_title text, p_body text, p_dedupe text, p_sms text default null::text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if exists (select 1 from public.children c where c.id = private.canonical_child(p_child) and c.record_status = 'inactive') then return 0; end if;
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

-- Access decisions are queued when the relationship row changes, whichever command changed it.
create function private.relationship_status_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_type text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' then v_type := 'relationship.verified'; end if;
  elsif new.status is distinct from old.status then
    v_type := case
      when new.status = 'active' and old.status = 'provisional' then 'relationship.verified'
      when new.status = 'active' and old.status = 'suspended' then 'relationship.restored'
      when new.status = 'suspended' then 'relationship.paused'
      when new.status in ('revoked','rejected') then 'relationship.ended'
    end;
  end if;
  if v_type is not null then
    perform private.enqueue(new.organization_id, v_type, 'relationship', new.id, v_type || ':' || new.id || ':' || new.version, '{}'::jsonb);
  end if;
  return null;
end $$;
create trigger guardian_child_relationships_notify after insert or update of status on public.guardian_child_relationships
  for each row execute function private.relationship_status_notify();

create function private.review_case_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.guardian_id is null or old.status not in ('open','in_review') or new.status not in ('resolved','rejected') then return null; end if;
  if (new.kind = 'link' and new.status = 'rejected') or new.kind = 'identity_edit' or (new.kind = 'clinical' and new.vaccination_event_id is not null) then
    perform private.enqueue(new.organization_id, 'family_request.decided', 'review_case', new.id, 'case-decided:' || new.id, '{}'::jsonb);
  end if;
  return null;
end $$;
create trigger record_review_cases_notify after update of status on public.record_review_cases
  for each row execute function private.review_case_notify();

create or replace function private.handle_outbox_job(j private.outbox_jobs) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_child public.children; v_clinic text; r public.guardian_child_relationships; g public.guardians; k public.record_review_cases;
  a public.appointments; s public.clinic_sessions; cl public.clinics; v_when text; v_name text;
begin
  if j.job_type = 'record.transferred' then
    select * into v_child from public.children where id = (j.payload ->> 'childId')::uuid;
    select name into v_clinic from public.clinics where id = (j.payload ->> 'toClinicId')::uuid;
    if v_child.id is null or v_clinic is null then return 'cancelled'; end if;
    perform private.notify_guardians(j.organization_id, v_child.id, 'record', 'Record moved to another clinic', format('%s''s record now belongs to %s. Book any new visits there.', v_child.display_name, v_clinic), j.dedupe_key,
      format('%s: your child''s record moved here. Details are in the app.', v_clinic));
    return 'done';
  end if;

  if j.job_type in ('relationship.verified','relationship.restored','relationship.paused','relationship.ended') then
    select * into r from public.guardian_child_relationships where id = j.aggregate_id;
    if r.id is null then return 'cancelled'; end if;
    select * into g from public.guardians where id = r.guardian_id and deleted_at is null;
    select * into v_child from public.children where id = r.child_id;
    -- Merges retire the duplicate's relationships; the family keeps access on the surviving record, so nothing is said.
    if g.profile_id is null or v_child.id is null or v_child.record_status in ('merged','inactive') then return 'cancelled'; end if;
    perform private.notify_profile(j.organization_id, g.profile_id, case when j.job_type = 'relationship.ended' then null else v_child.id end, 'access',
      case j.job_type when 'relationship.verified' then 'Access verified' when 'relationship.restored' then 'Access restored'
                      when 'relationship.paused' then 'Access paused' else 'Access ended' end,
      case j.job_type
        when 'relationship.verified' then format('The clinic verified you as %s''s guardian. You can now see the vaccination history and book visits.', v_child.display_name)
        when 'relationship.restored' then format('Your access to %s''s record is available again.', v_child.display_name)
        when 'relationship.paused' then format('The clinic paused your access to %s''s record. Contact the clinic if you think this is a mistake.', v_child.display_name)
        else format('Your access to %s''s record has ended. Contact the clinic if you have questions.', v_child.display_name) end,
      j.dedupe_key);
    return 'done';
  end if;

  if j.job_type = 'family_request.decided' then
    select * into k from public.record_review_cases where id = j.aggregate_id;
    if k.id is null then return 'cancelled'; end if;
    select * into g from public.guardians where id = k.guardian_id and deleted_at is null;
    if g.profile_id is null then return 'cancelled'; end if;
    if k.child_id is not null then select * into v_child from public.children where id = private.canonical_child(k.child_id); end if;
    if v_child.id is not null and v_child.record_status = 'inactive' then return 'cancelled'; end if;
    if k.kind = 'link' then
      v_name := coalesce(nullif(btrim(k.evidence ->> 'childName'), ''), 'your child');
      perform private.notify_profile(j.organization_id, g.profile_id, null, 'access', 'Link request not approved',
        format('The clinic could not match your request to link %s. Bring the child''s Immunization Card and a valid ID to the health center so staff can help.', v_name), j.dedupe_key);
    elsif k.kind = 'identity_edit' then
      perform private.notify_profile(j.organization_id, g.profile_id, v_child.id, 'record', 'Change request reviewed',
        format('The clinic reviewed your request to correct %s''s details. Open the record to see the details as they are now.', coalesce(v_child.display_name, 'your child')), j.dedupe_key);
    else
      perform private.notify_profile(j.organization_id, g.profile_id, v_child.id, 'record',
        case when k.status = 'resolved' then 'Reported vaccine verified' else 'Reported vaccine not verified' end,
        case when k.status = 'resolved'
          then format('The clinic verified the vaccine you reported for %s. It now counts in the schedule.', coalesce(v_child.display_name, 'your child'))
          else format('The clinic could not verify the vaccine you reported for %s. Bring the Immunization Card on your next visit.', coalesce(v_child.display_name, 'your child')) end,
        j.dedupe_key);
    end if;
    return 'done';
  end if;

  if j.job_type = 'appointment.reminder' then
    select * into a from public.appointments where id = j.aggregate_id;
    if a.id is null or a.status <> 'confirmed' then return 'cancelled'; end if;
    select * into s from public.clinic_sessions where id = a.session_id;
    if s.status <> 'open' then return 'cancelled'; end if;
    select * into cl from public.clinics where id = s.clinic_id;
    select * into v_child from public.children where id = a.child_id;
    v_when := to_char(s.starts_at at time zone cl.timezone, 'FMDay, FMDD FMMonth "at" FMHH12:MI AM');
    perform private.notify_guardians(j.organization_id, a.child_id, 'appointment', 'Visit tomorrow',
      format('Reminder: %s has a visit on %s at %s. Bring the Immunization Card.', v_child.display_name, v_when, cl.name), j.dedupe_key,
      format('%s: reminder of a visit on %s. Bring the Immunization Card.', cl.name, v_when));
    return 'done';
  end if;

  if j.job_type = 'dose.due' then
    select * into v_child from public.children where id = j.aggregate_id;
    if v_child.id is null or v_child.record_status <> 'active' then return 'cancelled'; end if;
    select * into cl from public.clinics where id = (j.payload ->> 'clinicId')::uuid;
    perform private.notify_guardians(j.organization_id, v_child.id, 'record', 'A vaccine is due',
      format('%s has a vaccine due or overdue. Open the record to see which one, then book a visit or walk in at %s.', v_child.display_name, coalesce(cl.name, 'the health center')), j.dedupe_key,
      format('%s: a vaccine is due for your child. Details are in the app.', coalesce(cl.name, 'Health center')));
    return 'done';
  end if;

  return private.handle_outbox_job_prev(j);
end $$;

-- Day-before visit reminders, and a weekly due-vaccine reminder per child, checked once per clinic-local day in bounded batches.
create function private.enqueue_daily_reminders(p_limit integer default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_res jsonb; v_today date; v_appt int := 0; v_due int := 0; v_checked int := 0;
begin
  for r in
    select a.id, a.organization_id from public.appointments a
      join public.clinic_sessions s on s.id = a.session_id and s.status = 'open'
      join public.clinics c on c.id = s.clinic_id and c.status = 'active'
     where a.status = 'confirmed' and s.service_date = private.local_today(s.clinic_id) + 1
       and not exists (select 1 from private.outbox_jobs o where o.organization_id = a.organization_id and o.dedupe_key = 'appt-remind:' || a.id)
     limit 1000
  loop
    perform private.enqueue(r.organization_id, 'appointment.reminder', 'appointment', r.id, 'appt-remind:' || r.id, '{}'::jsonb);
    v_appt := v_appt + 1;
  end loop;

  for r in
    select c.id, c.organization_id, e.clinic_id from public.children c
      join public.child_clinic_enrollments e on e.child_id = c.id and e.status = 'active' and e.is_primary
      join public.clinics cl on cl.id = e.clinic_id and cl.status = 'active'
      left join private.reminder_checks k on k.child_id = c.id
     where c.record_status = 'active' and c.merged_into_id is null and c.deleted_at is null
       and (k.child_id is null or k.checked_on < private.local_today(e.clinic_id))
       and exists (select 1 from public.guardian_child_relationships gr join public.guardians g on g.id = gr.guardian_id
                    where gr.child_id = c.id and gr.status = 'active' and gr.access_scope = 'full' and g.profile_id is not null and g.deleted_at is null)
     order by k.checked_on nulls first
     limit least(greatest(coalesce(p_limit, 300), 1), 2000)
  loop
    v_today := private.local_today(r.clinic_id);
    v_res := private.compute_child_schedule(r.id, v_today, false);
    if v_res ->> 'status' = 'evaluated' and exists (select 1 from jsonb_array_elements(coalesce(v_res -> 'requirements', '[]'::jsonb)) x
                                                     where x ->> 'status' in ('due_today','due_now','overdue')) then
      perform private.enqueue(r.organization_id, 'dose.due', 'child', r.id, 'dose-due:' || r.id || ':' || to_char(v_today, 'IYYY-IW'), jsonb_build_object('clinicId', r.clinic_id));
      v_due := v_due + 1;
    end if;
    insert into private.reminder_checks (child_id, checked_on) values (r.id, v_today)
    on conflict (child_id) do update set checked_on = excluded.checked_on;
    v_checked := v_checked + 1;
  end loop;
  return jsonb_build_object('visitReminders', v_appt, 'childrenChecked', v_checked, 'dueReminders', v_due);
end $$;

-- Called by the worker on every pass; does real work at most every ten minutes.
create function private.run_daily_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ran boolean;
begin
  insert into private.maintenance_runs (job, last_run_at) values ('daily', now())
  on conflict (job) do update set last_run_at = excluded.last_run_at where private.maintenance_runs.last_run_at < now() - interval '10 minutes'
  returning true into v_ran;
  if not coalesce(v_ran, false) then return jsonb_build_object('skipped', true); end if;
  return private.auto_close_service_days(50) || private.enqueue_daily_reminders(300);
end $$;

-- ---------------------------------------------------------------------------------------------
-- F47 / F48 / F49 Accounts
-- ---------------------------------------------------------------------------------------------
-- A phone number as people type it: digits with optional +, spaces and dashes. Anything else is not kept.
create function private.clean_signup_phone(p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p_phone, '')) ~ '^\+?[0-9][0-9 -]{6,18}$' then btrim(p_phone) end
$$;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_app jsonb := new.raw_user_meta_data -> 'staff_application';
  v_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 120);
begin
  insert into public.profiles (id, display_name, locale, needs_name, signup_phone)
  values (new.id,
          case when v_name <> '' then v_name else left(split_part(coalesce(new.email, ''), '@', 1), 120) end,
          case when new.raw_user_meta_data ->> 'preferred_language' = 'fil' then 'fil' else 'en' end,
          v_name = '',
          private.clean_signup_phone(new.raw_user_meta_data ->> 'phone'))
  on conflict (id) do nothing;
  if jsonb_typeof(v_app) = 'object' then
    begin
      perform private.create_staff_application(new.id, (v_app ->> 'clinic_id')::uuid, v_app ->> 'role', v_app ->> 'position_title', v_app ->> 'note');
    exception when others then
      raise warning 'staff application from sign-up was not recorded: %', sqlerrm;
    end;
  end if;
  return new;
end $$;

-- The guardian created for an online family starts with the phone they gave at sign-up, unverified until the clinic checks it.
create or replace function private.ensure_guardian(p_org uuid, p_name text default null::text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.guardians where organization_id = p_org and profile_id = auth.uid();
  if v is not null then return v; end if;
  insert into public.guardians (organization_id, profile_id, full_name, preferred_language, contact_phone, created_by, updated_by)
  select p_org, p.id, coalesce(nullif(btrim(p_name), ''), nullif(btrim(p.display_name), ''), 'Guardian'), p.locale, p.signup_phone, p.id, p.id
    from public.profiles p where p.id = auth.uid()
  returning id into v;
  return v;
end $$;

create or replace function public.get_my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profileId', p.id, 'displayName', p.display_name, 'locale', p.locale, 'status', p.status, 'needsName', p.needs_name,
    'mfa', private.mfa_ok(), 'demoMode', private.setting_bool('demo_mode'),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('membershipId', m.id, 'clinicId', m.clinic_id, 'clinicName', c.name,
        'clinicTimezone', c.timezone, 'role', m.role_code, 'status', m.status, 'validUntil', m.valid_until,
        'capabilities', to_jsonb(private.role_preset(m.role_code) || m.capabilities)))
      from public.staff_memberships m join public.clinics c on c.id = m.clinic_id and c.organization_id = m.organization_id
      where m.profile_id = p.id and c.status = 'active'
        and (m.status = 'pending_approval' or (m.status = 'active' and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())))), '[]'::jsonb))
  from public.profiles p where p.id = auth.uid() and p.status = 'active'
$$;

-- The account holder's own name and language. The name on a verified guardian record stays as the clinic recorded it.
create function public.update_my_profile(p_display_name text, p_locale text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; v_name text := left(btrim(coalesce(p_display_name, '')), 121);
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'enter your full name (up to 120 characters)' using errcode = 'CV422'; end if;
  if p_locale is null or p_locale not in ('en','fil') then raise exception 'choose English or Filipino' using errcode = 'CV422'; end if;
  select * into p from public.profiles where id = auth.uid() and status = 'active' for update;
  if p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if (p.display_name, p.locale, p.needs_name) is distinct from (v_name, p_locale, false) then
    update public.profiles set display_name = v_name, locale = p_locale, needs_name = false where id = p.id;
    update public.guardians set preferred_language = p_locale, updated_by = auth.uid() where profile_id = p.id and deleted_at is null and preferred_language <> p_locale;
    perform private.audit(null, 'self', 'profile.updated', 'profile', p.id,
      jsonb_build_object('displayName', p.display_name, 'locale', p.locale), jsonb_build_object('displayName', v_name, 'locale', p_locale), null);
  end if;
  return jsonb_build_object('displayName', v_name, 'locale', p_locale);
end $$;

-- ---------------------------------------------------------------------------------------------
-- F50 Real-world end states
-- ---------------------------------------------------------------------------------------------
create function public.set_child_record_status(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_status text, p_reason text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; c public.children; v_canon uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'review.resolve');
  v_prev := private.begin_command(v_org, p_operation_key, 'child.record_status', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 's', p_status, 'r', p_reason, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  select * into c from public.children where id = v_canon for update;
  if p_status = 'inactive' then
    if c.record_status <> 'active' then raise exception 'only a confirmed, active record can be marked inactive' using errcode = 'CV409'; end if;
    if p_reason is null or p_reason not in ('moved','deceased','other') then raise exception 'choose why the record is inactive' using errcode = 'CV422'; end if;
    if p_reason = 'other' and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'describe the reason' using errcode = 'CV422'; end if;
    if exists (select 1 from public.encounters e where e.child_id = v_canon and e.status = 'open') then
      raise exception 'a visit is in progress; finish it first' using errcode = 'CV409';
    end if;
    update public.children set record_status = 'inactive', inactive_reason = p_reason, inactive_note = nullif(left(btrim(coalesce(p_note, '')), 300), ''),
           inactive_at = now(), updated_by = auth.uid() where id = c.id;
    -- Future bookings are cancelled without telling the family (they may be bereaved); staff see them in the audit trail.
    update public.appointments a set status = 'cancelled', reason = 'Record marked inactive', updated_by = auth.uid()
      from public.clinic_sessions s where s.id = a.session_id and a.child_id = c.id and a.status = 'confirmed' and s.ends_at > now();
    update private.outbox_jobs o set status = 'cancelled', updated_at = now()
     where o.organization_id = v_org and o.status = 'queued' and o.aggregate_id in (select a.id from public.appointments a where a.child_id = c.id);
  elsif p_status = 'active' then
    if c.record_status <> 'inactive' then raise exception 'the record is not inactive' using errcode = 'CV409'; end if;
    update public.children set record_status = 'active', inactive_reason = null, inactive_note = null, inactive_at = null, updated_by = auth.uid() where id = c.id;
  else
    raise exception 'unknown status' using errcode = 'CV422';
  end if;
  perform private.audit(v_org, 'review.resolve', case when p_status = 'inactive' then 'child.marked_inactive' else 'child.reactivated' end, 'child', c.id,
    jsonb_build_object('status', c.record_status), jsonb_build_object('status', p_status, 'reason', p_reason), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('childId', c.id, 'recordStatus', p_status));
end $$;

create function public.mark_guardian_contact_invalid(p_operation_key uuid, p_clinic_id uuid, p_guardian_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; g public.guardians;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['guardian.verify','bhw.followup']);
  v_prev := private.begin_command(v_org, p_operation_key, 'contact.invalid', jsonb_build_object('c', p_clinic_id, 'g', p_guardian_id, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  select * into g from public.guardians where id = p_guardian_id and organization_id = v_org and deleted_at is null for update;
  if g.id is null or not exists (select 1 from public.guardian_child_relationships r join public.child_clinic_enrollments e on e.child_id = r.child_id and e.clinic_id = p_clinic_id and e.status in ('pending','active')
                                   where r.guardian_id = g.id and r.status in ('provisional','active','suspended')) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
  if g.contact_phone is null then raise exception 'there is no phone number on file' using errcode = 'CV422'; end if;
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'say what happened when you called' using errcode = 'CV422'; end if;
  update public.guardians set contact_status = 'invalid', contact_verified_at = null, contact_verified_by = null, sms_opt_in = false, updated_by = auth.uid() where id = g.id;
  perform private.audit(v_org, 'guardian.verify', 'contact.marked_invalid', 'guardian', g.id, jsonb_build_object('status', g.contact_status),
    jsonb_build_object('status', 'invalid', 'phone', private.mask_phone(g.contact_phone)), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('guardianId', g.id, 'contactStatus', 'invalid'));
end $$;

-- Staff see whether a number was found not to work (contactStatus).
create or replace function public.list_child_guardian_contacts(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  perform private.require_capability(p_clinic_id, 'guardian.verify');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('relationshipId', r.id, 'guardianId', g.id, 'phoneMasked', private.mask_phone(g.contact_phone), 'hasPhone', g.contact_phone is not null,
            'phoneChecked', g.contact_verified_at is not null and g.contact_phone is not null, 'smsOptIn', g.sms_opt_in, 'contactStatus', g.contact_status) order by g.full_name), '[]'::jsonb)
            from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where r.child_id = v_canon and r.status in ('provisional','active') and g.deleted_at is null);
end $$;

create function public.close_stock_location(p_operation_key uuid, p_clinic_id uuid, p_location_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.manage'); v_prev jsonb; l public.stock_locations;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.location_close', jsonb_build_object('c', p_clinic_id, 'l', p_location_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into l from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if l.status <> 'active' then raise exception 'the location is already closed' using errcode = 'CV409'; end if;
  if l.kind = 'in_transit' then raise exception 'the transit location is managed by the system' using errcode = 'CV409'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  if exists (select 1 from public.stock_balances b where b.location_id = l.id and (b.on_hand <> 0 or b.allocated <> 0)) then
    raise exception 'move or record all stock at this location before closing it' using errcode = 'CV409';
  end if;
  if exists (select 1 from public.stock_transfers t where (t.from_location_id = l.id or t.to_location_id = l.id) and t.status = 'in_transit') then
    raise exception 'a transfer to or from this location is still in transit' using errcode = 'CV409';
  end if;
  update public.stock_locations set status = 'closed', updated_by = auth.uid() where id = l.id;
  perform private.audit(v_org, 'inventory.manage', 'stock.location_closed', 'stock_location', l.id, jsonb_build_object('status', 'active'), jsonb_build_object('status', 'closed'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('locationId', l.id, 'status', 'closed'));
end $$;

-- Operator-only (database owner, from a maintenance connection): suspend, deactivate or reactivate an account.
-- A non-active profile has no session (private.session_ok) and therefore no capability anywhere.
create function private.set_profile_status(p_profile uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if p_status not in ('active','suspended','deactivated') then raise exception 'unknown status' using errcode = 'CV422'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  select * into p from public.profiles where id = p_profile for update;
  if p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  update public.profiles set status = p_status where id = p.id;
  perform private.audit(null, 'operator', 'profile.status_changed', 'profile', p.id, jsonb_build_object('status', p.status), jsonb_build_object('status', p_status), p_reason);
  return jsonb_build_object('profileId', p.id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants. Private helpers stay private; the worker may run the daily jobs.
-- ---------------------------------------------------------------------------------------------
revoke all on function
  private.close_service_day_core(uuid, date, text), private.auto_close_service_days(integer), private.vaccination_on_current_visit(),
  private.notify_profile(uuid, uuid, uuid, text, text, text, text), private.relationship_status_notify(), private.review_case_notify(),
  private.enqueue_daily_reminders(integer), private.run_daily_maintenance(), private.clean_signup_phone(text), private.set_profile_status(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.run_daily_maintenance() to cvsrs_outbox_worker;

revoke all on function
  public.close_service_day(uuid, uuid, date), public.service_day_backlog(uuid), public.list_child_appointments(uuid, uuid),
  public.list_session_roster(uuid, uuid), public.update_session_capacity(uuid, uuid, uuid, integer, integer, integer, integer),
  public.return_schedule_to_draft(uuid, uuid, uuid, text), public.reject_stock_adjustment(uuid, uuid, uuid, text),
  public.update_my_profile(text, text), public.set_child_record_status(uuid, uuid, uuid, text, text, text),
  public.mark_guardian_contact_invalid(uuid, uuid, uuid, text), public.close_stock_location(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.close_service_day(uuid, uuid, date), public.service_day_backlog(uuid), public.list_child_appointments(uuid, uuid),
  public.list_session_roster(uuid, uuid), public.update_session_capacity(uuid, uuid, uuid, integer, integer, integer, integer),
  public.return_schedule_to_draft(uuid, uuid, uuid, text), public.reject_stock_adjustment(uuid, uuid, uuid, text),
  public.update_my_profile(text, text), public.set_child_record_status(uuid, uuid, uuid, text, text, text),
  public.mark_guardian_contact_invalid(uuid, uuid, uuid, text), public.close_stock_location(uuid, uuid, uuid, text)
  to authenticated;
