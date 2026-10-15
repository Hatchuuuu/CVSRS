-- 0013 Booking, check-in and queue commands + read models. See 0012 for the model and invariants.
-- Concurrency: the session row lock serialises bookings (T02); the counter row lock serialises ticket allocation;
-- FOR UPDATE SKIP LOCKED lets two stations call "next" without receiving the same patient.

-- ---------------------------------------------------------------------------------------------
-- Session reads and closure
-- ---------------------------------------------------------------------------------------------
create function public.list_sessions(p_clinic_id uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_from date; v_to date; v_res jsonb;
begin
  perform private.require_any(p_clinic_id, array['appointment.manage','queue.manage','child.search']);
  v_from := coalesce(p_from, private.local_today(p_clinic_id)); v_to := coalesce(p_to, v_from + 14);
  if v_to < v_from or v_to - v_from > 92 then raise exception 'date range must be 0-92 days' using errcode = 'CV422'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'sessionId', s.id, 'serviceDate', s.service_date, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'serviceCode', s.service_code, 'status', s.status,
      'totalCapacity', s.total_capacity, 'onlineCapacity', s.online_capacity, 'walkinCapacity', s.walkin_capacity,
      'booked', private.session_booked(s.id), 'remainingOnline', greatest(s.online_capacity - private.session_booked(s.id), 0)) order by s.starts_at), '[]'::jsonb)
    into v_res from public.clinic_sessions s where s.clinic_id = p_clinic_id and s.service_date between v_from and v_to;
  return v_res;
end $$;

-- Guardians (signed in, any verified child) see open sessions with room. No child or booking details are exposed.
create function public.guardian_list_sessions(p_clinic_id uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_from date; v_to date;
begin
  if auth.uid() is null or not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not exists (select 1 from public.clinics where id = p_clinic_id and status = 'active') then raise exception 'not found' using errcode = 'CV404'; end if;
  v_from := coalesce(p_from, private.local_today(p_clinic_id)); v_to := coalesce(p_to, v_from + 30);
  if v_to < v_from or v_to - v_from > 92 then raise exception 'date range must be 0-92 days' using errcode = 'CV422'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('sessionId', s.id, 'serviceDate', s.service_date, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'serviceCode', s.service_code,
        'hasRoom', private.session_booked(s.id) < s.online_capacity) order by s.starts_at)
      from public.clinic_sessions s where s.clinic_id = p_clinic_id and s.status = 'open' and s.ends_at > now() and s.service_date between v_from and v_to), '[]'::jsonb);
end $$;

-- Closing a session never silently cancels bookings: each confirmed appointment gets a follow-up case and an outbox notice.
create function public.cancel_session(p_operation_key uuid, p_clinic_id uuid, p_session_id uuid, p_reason text) returns jsonb
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
  for a in select * from public.appointments where session_id = s.id and status = 'confirmed' loop
    insert into public.record_review_cases (organization_id, clinic_id, kind, child_id, reason, evidence, created_by, updated_by)
    values (v_org, p_clinic_id, 'appointment', a.child_id, 'session cancelled: contact family to rebook', jsonb_build_object('appointmentId', a.id, 'sessionId', s.id, 'serviceDate', s.service_date), auth.uid(), auth.uid());
    perform private.enqueue(v_org, 'appointment.session_cancelled', 'appointment', a.id, 'appt-session-cancelled:' || a.id, jsonb_build_object('sessionId', s.id));
    v_n := v_n + 1;
  end loop;
  perform private.audit(v_org, 'appointment.manage', 'session.cancelled', 'clinic_session', s.id, jsonb_build_object('status', s.status), jsonb_build_object('status', 'cancelled', 'affectedBookings', v_n), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('sessionId', s.id, 'affectedBookings', v_n));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------------------------
create function public.book_appointment(p_operation_key uuid, p_child_id uuid, p_session_id uuid, p_reason text default null, p_rule_codes text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_canon uuid; s public.clinic_sessions; v_channel text; v_prev jsonb; v_id uuid; c public.children; v_ver uuid; v_code text; v_rule uuid; a public.appointments;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  -- Lock the session row first: this serialises every booking, cancellation and move touching this session.
  select * into s from public.clinic_sessions where id = p_session_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_channel := private.can_book_for(v_canon, s.clinic_id);
  if v_channel is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(s.organization_id, p_operation_key, 'appointment.book', jsonb_build_object('child', p_child_id, 'session', p_session_id, 'reason', p_reason, 'rules', to_jsonb(coalesce(p_rule_codes, '{}'))));
  if v_prev is not null then return v_prev; end if;
  select * into c from public.children where id = v_canon;
  if c.record_status not in ('provisional','active') then raise exception 'record is not open for booking' using errcode = 'CV409'; end if;
  if s.status <> 'open' or s.ends_at <= now() then raise exception 'this session is not open for booking' using errcode = 'CV409'; end if;
  if exists (select 1 from public.appointments where child_id = v_canon and session_id = s.id and status in ('confirmed','checked_in','fulfilled')) then
    raise exception 'this child already has an appointment in this session' using errcode = 'CV409';
  end if;
  if private.session_booked(s.id) >= s.online_capacity then raise exception 'this session is full' using errcode = 'CV409'; end if;

  insert into public.appointments (organization_id, child_id, session_id, booked_by, channel, reason, created_by, updated_by)
  values (s.organization_id, v_canon, s.id, auth.uid(), v_channel, left(p_reason, 300), auth.uid(), auth.uid()) returning id into v_id;

  -- Optional: which schedule requirements this visit is for. Must exist in the version in force; never implies clearance.
  if coalesce(array_length(p_rule_codes, 1), 0) > 0 then
    v_ver := private.active_schedule_for(s.organization_id, 'routine', c.dob, s.service_date);
    if v_ver is null then raise exception 'no approved schedule is in force for those requirements' using errcode = 'CV422'; end if;
    foreach v_code in array p_rule_codes loop
      select id into v_rule from public.schedule_rules where schedule_version_id = v_ver and requirement_code = v_code;
      if v_rule is null then raise exception 'unknown requirement %', v_code using errcode = 'CV422'; end if;
      insert into public.appointment_items (organization_id, appointment_id, rule_id) values (s.organization_id, v_id, v_rule) on conflict do nothing;
    end loop;
  end if;
  perform private.enqueue(s.organization_id, 'appointment.confirmation', 'appointment', v_id, 'appt-confirm:' || v_id, jsonb_build_object('sessionId', s.id));
  perform private.audit(s.organization_id, case when v_channel = 'online' then 'guardian' else 'appointment.manage' end, 'appointment.booked', 'appointment', v_id, null,
                        jsonb_build_object('session', s.id, 'channel', v_channel), p_reason);
  select * into a from public.appointments where id = v_id;
  return private.finish_command(s.organization_id, p_operation_key, private.appointment_json(a, s));
end $$;

create function public.cancel_appointment(p_operation_key uuid, p_appointment_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; s public.clinic_sessions; v_prev jsonb; v_channel text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select a0.* into a from public.appointments a0 where a0.id = p_appointment_id;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  select * into s from public.clinic_sessions where id = a.session_id for update;   -- session lock first (consistent ordering)
  select * into a from public.appointments where id = p_appointment_id for update;
  v_channel := private.can_book_for(a.child_id, s.clinic_id);
  if v_channel is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(a.organization_id, p_operation_key, 'appointment.cancel', jsonb_build_object('a', p_appointment_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if a.status <> 'confirmed' then raise exception 'only a confirmed appointment can be cancelled' using errcode = 'CV409'; end if;
  update public.appointments set status = 'cancelled', reason = coalesce(left(p_reason, 300), reason), updated_by = auth.uid() where id = a.id;
  -- obsolete unsent messages for this booking are withdrawn (BP22)
  update private.outbox_jobs set status = 'cancelled', updated_at = now() where organization_id = a.organization_id and status = 'queued' and (dedupe_key like 'appt-remind:' || a.id || '%' or dedupe_key = 'appt-confirm:' || a.id);
  perform private.enqueue(a.organization_id, 'appointment.cancellation', 'appointment', a.id, 'appt-cancel:' || a.id, '{}'::jsonb);
  perform private.audit(a.organization_id, case when v_channel = 'online' then 'guardian' else 'appointment.manage' end, 'appointment.cancelled', 'appointment', a.id, jsonb_build_object('status', 'confirmed'), jsonb_build_object('status', 'cancelled'), p_reason);
  return private.finish_command(a.organization_id, p_operation_key, jsonb_build_object('appointmentId', a.id, 'status', 'cancelled'));
end $$;

-- Atomic move: if the new session cannot take the child, the original booking is untouched (BP17).
create function public.reschedule_appointment(p_operation_key uuid, p_appointment_id uuid, p_new_session_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; so public.clinic_sessions; sn public.clinic_sessions; v_prev jsonb; v_channel text; v_new uuid; a2 public.appointments;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select a0.* into a from public.appointments a0 where a0.id = p_appointment_id;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  -- lock both sessions in a stable id order to avoid deadlocks between opposite moves
  perform 1 from public.clinic_sessions where id in (a.session_id, p_new_session_id) order by id for update;
  select * into so from public.clinic_sessions where id = a.session_id;
  select * into sn from public.clinic_sessions where id = p_new_session_id;
  if sn.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  select * into a from public.appointments where id = p_appointment_id for update;
  v_channel := private.can_book_for(a.child_id, so.clinic_id);
  if v_channel is null or sn.clinic_id <> so.clinic_id then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(a.organization_id, p_operation_key, 'appointment.reschedule', jsonb_build_object('a', p_appointment_id, 'n', p_new_session_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if a.status <> 'confirmed' then raise exception 'only a confirmed appointment can be moved' using errcode = 'CV409'; end if;
  if sn.id = so.id then raise exception 'choose a different session' using errcode = 'CV422'; end if;
  if sn.status <> 'open' or sn.ends_at <= now() then raise exception 'that session is not open for booking' using errcode = 'CV409'; end if;
  if exists (select 1 from public.appointments where child_id = a.child_id and session_id = sn.id and status in ('confirmed','checked_in','fulfilled')) then raise exception 'this child already has an appointment in that session' using errcode = 'CV409'; end if;
  if private.session_booked(sn.id) >= sn.online_capacity then raise exception 'that session is full' using errcode = 'CV409'; end if;
  update public.appointments set status = 'rescheduled', updated_by = auth.uid() where id = a.id;
  insert into public.appointments (organization_id, child_id, session_id, booked_by, channel, reason, replaces_id, created_by, updated_by)
  values (a.organization_id, a.child_id, sn.id, auth.uid(), v_channel, coalesce(left(p_reason, 300), a.reason), a.id, auth.uid(), auth.uid()) returning id into v_new;
  insert into public.appointment_items (organization_id, appointment_id, rule_id, purpose) select organization_id, v_new, rule_id, purpose from public.appointment_items where appointment_id = a.id;
  update private.outbox_jobs set status = 'cancelled', updated_at = now() where organization_id = a.organization_id and status = 'queued' and (dedupe_key like 'appt-remind:' || a.id || '%' or dedupe_key = 'appt-confirm:' || a.id);
  perform private.enqueue(a.organization_id, 'appointment.confirmation', 'appointment', v_new, 'appt-confirm:' || v_new, jsonb_build_object('sessionId', sn.id, 'rescheduledFrom', a.id));
  perform private.audit(a.organization_id, case when v_channel = 'online' then 'guardian' else 'appointment.manage' end, 'appointment.rescheduled', 'appointment', v_new,
                        jsonb_build_object('from', a.id, 'session', so.id), jsonb_build_object('session', sn.id), p_reason);
  select * into a2 from public.appointments where id = v_new;
  return private.finish_command(a.organization_id, p_operation_key, private.appointment_json(a2, sn) || jsonb_build_object('replaces', a.id));
end $$;

create function public.list_appointments(p_clinic_id uuid, p_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_org uuid;
begin
  perform private.require_any(p_clinic_id, array['appointment.manage','queue.manage']);
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  v_date := coalesce(p_date, private.local_today(p_clinic_id));
  perform private.audit(v_org, 'appointment.manage', 'appointments.view', 'clinic', p_clinic_id, null, jsonb_build_object('date', v_date), null);
  return coalesce((select jsonb_agg(jsonb_build_object('appointmentId', a.id, 'status', a.status, 'channel', a.channel, 'childId', c.id, 'childName', c.display_name, 'recordNo', c.local_record_no,
        'sessionId', s.id, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'serviceCode', s.service_code, 'reason', a.reason, 'version', a.version) order by s.starts_at, c.display_name)
      from public.appointments a join public.clinic_sessions s on s.id = a.session_id join public.children c on c.id = a.child_id
     where s.clinic_id = p_clinic_id and s.service_date = v_date), '[]'::jsonb);
end $$;

-- Guardian: appointments for children they hold verified access to.
create function public.my_appointments() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('appointmentId', a.id, 'status', a.status, 'childId', c.id, 'childName', c.display_name, 'sessionId', s.id,
      'serviceDate', s.service_date, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'clinicId', s.clinic_id, 'clinicName', cl.name, 'serviceCode', s.service_code, 'version', a.version)
      order by s.starts_at desc), '[]'::jsonb)
    from public.appointments a join public.clinic_sessions s on s.id = a.session_id join public.children c on c.id = a.child_id join public.clinics cl on cl.id = s.clinic_id
   where private.guardian_has_full_access(a.child_id) and a.status in ('confirmed','checked_in','fulfilled','no_show','cancelled','rescheduled') and s.service_date >= current_date - 60
$$;

-- ---------------------------------------------------------------------------------------------
-- Arrival queue
-- ---------------------------------------------------------------------------------------------
create function private.queue_event(p_entry public.queue_entries, p_from text, p_to text, p_station text, p_reason text) returns void
language sql security definer set search_path = '' as $$
  insert into public.queue_events (organization_id, queue_entry_id, from_status, to_status, station, reason, created_by)
  values (p_entry.organization_id, p_entry.id, p_from, p_to, p_station, p_reason, auth.uid())
$$;

create function public.check_in(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_appointment_id uuid default null, p_overflow_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_prev jsonb; v_canon uuid; v_today date; a public.appointments; s public.clinic_sessions; c public.children; e public.queue_entries;
  v_no int; v_walkin boolean := p_appointment_id is null; v_cap int; v_used int;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'queue.manage');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'queue.check_in', jsonb_build_object('c', p_clinic_id, 'child', p_child_id, 'a', p_appointment_id, 'o', p_overflow_reason));
  if v_prev is not null then return v_prev; end if;
  select * into c from public.children where id = v_canon;
  if c.record_status not in ('provisional','active') then raise exception 'record is not open for service' using errcode = 'CV409'; end if;
  v_today := private.local_today(p_clinic_id);
  if exists (select 1 from public.queue_entries where clinic_id = p_clinic_id and service_date = v_today and child_id = v_canon and status in ('waiting','called','in_service','held')) then
    raise exception 'this child is already in today''s queue' using errcode = 'CV409';
  end if;

  if not v_walkin then
    select a0.* into a from public.appointments a0 where a0.id = p_appointment_id and a0.child_id = v_canon;
    if not found then raise exception 'not found' using errcode = 'CV404'; end if;
    select * into s from public.clinic_sessions where id = a.session_id;
    if s.clinic_id <> p_clinic_id then raise exception 'not found' using errcode = 'CV404'; end if;
    select * into a from public.appointments where id = p_appointment_id for update;
    if a.status <> 'confirmed' then raise exception 'appointment is %', a.status using errcode = 'CV409'; end if;
    if s.service_date <> v_today then raise exception 'this appointment is not for today; reschedule it or check the child in as a walk-in' using errcode = 'CV409'; end if;
  else
    -- Walk-ins draw on the reserved allocation of today's open sessions. Overflow is a recorded staff decision, never silent.
    select coalesce(sum(walkin_capacity), 0) into v_cap from public.clinic_sessions where clinic_id = p_clinic_id and service_date = v_today and status = 'open';
    select count(*) into v_used from public.queue_entries where clinic_id = p_clinic_id and service_date = v_today and walk_in and status <> 'cancelled';
    if v_used >= v_cap and (p_overflow_reason is null or length(btrim(p_overflow_reason)) < 3) then
      raise exception 'the walk-in allocation for today is used up (or no session is open); record an overflow reason to continue' using errcode = 'CV409';
    end if;
  end if;

  v_no := private.allocate_ticket(p_clinic_id, v_today);
  insert into public.queue_entries (organization_id, child_id, clinic_id, service_date, appointment_id, ticket_no, walk_in, created_by, updated_by)
  values (v_org, v_canon, p_clinic_id, v_today, p_appointment_id, v_no, v_walkin, auth.uid(), auth.uid()) returning * into e;
  perform private.queue_event(e, null, 'waiting', null, case when v_walkin and p_overflow_reason is not null then 'overflow: ' || p_overflow_reason end);
  if not v_walkin then update public.appointments set status = 'checked_in', checked_in_at = now(), updated_by = auth.uid() where id = a.id; end if;
  perform private.audit(v_org, 'queue.manage', 'queue.checked_in', 'queue_entry', e.id, null, jsonb_build_object('ticket', v_no, 'walkIn', v_walkin, 'overflow', p_overflow_reason is not null), p_overflow_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('queueEntryId', e.id, 'ticketNo', v_no, 'ticket', private.ticket_label(v_today, v_no), 'walkIn', v_walkin, 'status', 'waiting', 'version', e.version));
end $$;

create function private.queue_next_allowed(p_from text, p_to text) returns boolean language sql immutable set search_path = '' as $$
  select (p_from, p_to) in (
    ('waiting','called'), ('waiting','left'), ('waiting','cancelled'),
    ('called','called'), ('called','in_service'), ('called','held'), ('called','left'), ('called','cancelled'),
    ('held','waiting'), ('held','left'), ('held','cancelled'),
    ('in_service','completed'), ('in_service','deferred'))
$$;

create function public.queue_transition(p_operation_key uuid, p_clinic_id uuid, p_entry_id uuid, p_to text, p_expected_version integer, p_station text default null, p_reason text default null, p_outcome text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_prev jsonb; e public.queue_entries; v_from text; v_enc uuid; v_now timestamptz := now(); v_today date;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'queue.manage');
  select * into e from public.queue_entries where id = p_entry_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'queue.transition', jsonb_build_object('c', p_clinic_id, 'e', p_entry_id, 'to', p_to, 'v', p_expected_version, 'st', p_station, 'r', p_reason, 'o', p_outcome));
  if v_prev is not null then return v_prev; end if;
  if e.version <> p_expected_version then raise exception 'stale version' using errcode = 'CV409'; end if;
  v_from := e.status;
  if not private.queue_next_allowed(v_from, p_to) then raise exception 'cannot move a ticket from % to %', v_from, p_to using errcode = 'CV409'; end if;
  if p_to in ('left','cancelled','held') and (p_reason is null or length(btrim(p_reason)) < 3) then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  v_today := e.service_date;

  if p_to = 'called' then
    update public.queue_entries set status = 'called', called_at = v_now, station = coalesce(p_station, station), updated_by = auth.uid() where id = e.id;
  elsif p_to = 'in_service' then
    if e.encounter_id is null then
      insert into public.encounters (organization_id, child_id, clinic_id, appointment_id, service_date, started_at, created_by, updated_by)
      values (v_org, e.child_id, p_clinic_id, e.appointment_id, e.service_date, v_now, auth.uid(), auth.uid()) returning id into v_enc;
    else v_enc := e.encounter_id; end if;
    update public.queue_entries set status = 'in_service', service_started_at = coalesce(service_started_at, v_now), station = coalesce(p_station, station), encounter_id = v_enc, updated_by = auth.uid() where id = e.id;
  elsif p_to = 'held' then
    update public.queue_entries set status = 'held', updated_by = auth.uid() where id = e.id;
  elsif p_to = 'waiting' then
    -- A returning patient keeps their ticket but re-joins the line behind those already waiting (published clinic policy).
    update public.queue_entries set status = 'waiting', queued_at = v_now, updated_by = auth.uid() where id = e.id;
  elsif p_to in ('left','cancelled') then
    update public.queue_entries set status = p_to, completed_at = v_now, updated_by = auth.uid() where id = e.id;
    -- the booking is not consumed: the family can be checked in again
    if e.appointment_id is not null then update public.appointments set status = 'confirmed', checked_in_at = null, updated_by = auth.uid() where id = e.appointment_id and status = 'checked_in'; end if;
  elsif p_to in ('completed','deferred') then
    p_outcome := coalesce(p_outcome, case when p_to = 'deferred' then 'deferred' end);
    if p_outcome is null or p_outcome not in ('vaccinated','deferred','referred','no_service') then raise exception 'record the visit outcome' using errcode = 'CV422'; end if;
    if p_to = 'deferred' and p_outcome not in ('deferred','referred') then raise exception 'a deferred visit ends as deferred or referred' using errcode = 'CV422'; end if;
    update public.queue_entries set status = p_to, completed_at = v_now, updated_by = auth.uid() where id = e.id;
    update public.encounters set status = 'completed', outcome = p_outcome, ended_at = v_now, updated_by = auth.uid() where id = e.encounter_id;
    -- Fulfilled = the planned encounter happened and has an outcome (it may be a deferral). It does not imply every planned dose was given.
    if e.appointment_id is not null then update public.appointments set status = 'fulfilled', updated_by = auth.uid() where id = e.appointment_id; end if;
  end if;
  select * into e from public.queue_entries where id = e.id;
  perform private.queue_event(e, v_from, p_to, coalesce(p_station, e.station), p_reason);
  perform private.audit(v_org, 'queue.manage', 'queue.' || p_to, 'queue_entry', e.id, jsonb_build_object('status', v_from), jsonb_build_object('status', p_to, 'outcome', p_outcome), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('queueEntryId', e.id, 'status', e.status, 'version', e.version, 'encounterId', e.encounter_id, 'ticket', private.ticket_label(e.service_date, e.ticket_no)));
end $$;

-- "Call next": priority first, then longest waiting. SKIP LOCKED means two stations never receive the same patient.
create function public.call_next(p_operation_key uuid, p_clinic_id uuid, p_station text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; e public.queue_entries; v_today date;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'queue.manage');
  v_prev := private.begin_command(v_org, p_operation_key, 'queue.call_next', jsonb_build_object('c', p_clinic_id, 's', p_station));
  if v_prev is not null then return v_prev; end if;
  v_today := private.local_today(p_clinic_id);
  select * into e from public.queue_entries
   where clinic_id = p_clinic_id and service_date = v_today and status = 'waiting'
   order by (priority_code = 'priority') desc, queued_at, ticket_no
   for update skip locked limit 1;
  if not found then return private.finish_command(v_org, p_operation_key, jsonb_build_object('called', false)); end if;
  update public.queue_entries set status = 'called', called_at = now(), station = left(p_station, 40), updated_by = auth.uid() where id = e.id;
  select * into e from public.queue_entries where id = e.id;
  perform private.queue_event(e, 'waiting', 'called', e.station, null);
  perform private.audit(v_org, 'queue.manage', 'queue.called', 'queue_entry', e.id, jsonb_build_object('status', 'waiting'), jsonb_build_object('status', 'called', 'station', e.station), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('called', true, 'queueEntryId', e.id, 'ticket', private.ticket_label(e.service_date, e.ticket_no), 'station', e.station, 'version', e.version));
end $$;

create function public.set_queue_priority(p_operation_key uuid, p_clinic_id uuid, p_entry_id uuid, p_priority text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; e public.queue_entries;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'queue.manage');
  if p_priority not in ('routine','priority') then raise exception 'invalid priority' using errcode = 'CV422'; end if;
  if p_priority = 'priority' and (p_reason is null or length(btrim(p_reason)) < 3) then raise exception 'a reason is required to prioritise a patient' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'queue.priority', jsonb_build_object('c', p_clinic_id, 'e', p_entry_id, 'p', p_priority, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into e from public.queue_entries where id = p_entry_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if e.status not in ('waiting','held') then raise exception 'only waiting tickets can be re-prioritised' using errcode = 'CV409'; end if;
  update public.queue_entries set priority_code = p_priority, priority_reason = case when p_priority = 'priority' then p_reason end, updated_by = auth.uid() where id = e.id;
  perform private.audit(v_org, 'queue.manage', 'queue.priority_changed', 'queue_entry', e.id, jsonb_build_object('priority', e.priority_code), jsonb_build_object('priority', p_priority), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('queueEntryId', e.id, 'priority', p_priority));
end $$;

create function public.list_queue(p_clinic_id uuid, p_date date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_date date; v_org uuid;
begin
  perform private.require_any(p_clinic_id, array['queue.manage','appointment.manage','child.search']);
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  v_date := coalesce(p_date, private.local_today(p_clinic_id));
  perform private.audit(v_org, 'queue.manage', 'queue.view', 'clinic', p_clinic_id, null, jsonb_build_object('date', v_date), null);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'queueEntryId', q.id, 'ticket', private.ticket_label(q.service_date, q.ticket_no), 'ticketNo', q.ticket_no, 'status', q.status, 'station', q.station, 'priority', q.priority_code,
      'priorityReason', q.priority_reason, 'walkIn', q.walk_in, 'childId', c.id, 'childName', c.display_name, 'recordNo', c.local_record_no,
      'arrivedAt', q.arrived_at, 'queuedAt', q.queued_at, 'calledAt', q.called_at, 'serviceStartedAt', q.service_started_at, 'encounterId', q.encounter_id, 'appointmentId', q.appointment_id, 'version', q.version)
      order by case q.status when 'in_service' then 0 when 'called' then 1 when 'waiting' then 2 when 'held' then 3 else 4 end, (q.priority_code = 'priority') desc, q.queued_at, q.ticket_no)
    from public.queue_entries q join public.children c on c.id = q.child_id where q.clinic_id = p_clinic_id and q.service_date = v_date), '[]'::jsonb);
end $$;

-- Waiting-room display: ticket numbers and stations only. No names, birth dates or vaccine information (BP17).
create function public.public_queue_display(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_today date;
begin
  if not exists (select 1 from public.clinics where id = p_clinic_id and status = 'active') then return null; end if;
  v_today := private.local_today(p_clinic_id);
  return jsonb_build_object(
    'asOf', now(),
    'nowCalling', coalesce((select jsonb_agg(jsonb_build_object('ticket', private.ticket_label(q.service_date, q.ticket_no), 'station', q.station) order by q.called_at) from public.queue_entries q
                             where q.clinic_id = p_clinic_id and q.service_date = v_today and q.status in ('called','in_service')), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(private.ticket_label(q.service_date, q.ticket_no) order by (q.priority_code = 'priority') desc, q.queued_at, q.ticket_no) from public.queue_entries q
                          where q.clinic_id = p_clinic_id and q.service_date = v_today and q.status = 'waiting'), '[]'::jsonb));
end $$;

-- Guardian: private status for their own child only. Shows people ahead; no time estimate without measured data (BP17).
create function public.guardian_queue_status(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid; e public.queue_entries; v_ahead int;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  select q.* into e from public.queue_entries q
   where q.child_id = v_canon and q.status in ('waiting','called','in_service','held') and q.service_date = private.local_today(q.clinic_id) order by q.created_at desc limit 1;
  if not found then return null; end if;
  select count(*) into v_ahead from public.queue_entries o
   where o.clinic_id = e.clinic_id and o.service_date = e.service_date and o.status = 'waiting' and o.id <> e.id
     and ((o.priority_code = 'priority' and e.priority_code <> 'priority') or (o.priority_code = e.priority_code and (o.queued_at, o.ticket_no) < (e.queued_at, e.ticket_no)));
  return jsonb_build_object('ticket', private.ticket_label(e.service_date, e.ticket_no), 'status', e.status, 'station', e.station, 'peopleAhead', case when e.status = 'waiting' then v_ahead end, 'updatedAt', e.updated_at);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_session(uuid,uuid,jsonb)', 'list_sessions(uuid,date,date)', 'guardian_list_sessions(uuid,date,date)', 'cancel_session(uuid,uuid,uuid,text)',
    'book_appointment(uuid,uuid,uuid,text,text[])', 'cancel_appointment(uuid,uuid,text)', 'reschedule_appointment(uuid,uuid,uuid,text)',
    'list_appointments(uuid,date)', 'my_appointments()', 'check_in(uuid,uuid,uuid,uuid,text)',
    'queue_transition(uuid,uuid,uuid,text,integer,text,text,text)', 'call_next(uuid,uuid,text)', 'set_queue_priority(uuid,uuid,uuid,text,text)',
    'list_queue(uuid,date)', 'guardian_queue_status(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.public_queue_display(uuid) from public, anon, authenticated;
grant execute on function public.public_queue_display(uuid) to anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
