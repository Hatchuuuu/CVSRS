-- 0038 Only today's visit is "open" for recording.
--
-- Until a past day is closed (0037), an encounter from an earlier day can still have status 'open'. get_open_encounter returned
-- it, so the child page offered "Give a vaccine" against yesterday's visit and the exception form attached care to it, which the
-- 0037 guard then refused with a conflict. A visit belongs to the clinic's current day; earlier care is recorded as care already
-- given (late entry), which needs no visit.
create or replace function public.get_open_encounter(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid; e public.encounters;
begin
  perform private.require_any(p_clinic_id, array['vaccination.record','queue.manage','child.read_clinical']);
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  select * into e from public.encounters
   where child_id = v_canon and clinic_id = p_clinic_id and status = 'open' and service_date = private.local_today(p_clinic_id)
   order by started_at desc nulls last limit 1;
  if not found then return null; end if;
  return jsonb_build_object('encounterId', e.id, 'serviceDate', e.service_date, 'startedAt', e.started_at, 'assessmentReference', e.assessment_reference, 'consentReference', e.consent_reference,
                            'administrations', (select count(*) from public.vaccination_events v where v.encounter_id = e.id));
end $$;

-- Today reads the last week's day closures on every refresh. Day closures are rare rows in a large, fast-growing audit log, so they
-- get their own small index, and the read filters on the indexed columns.
create index audit_day_closed_idx on private.audit_logs (entity_id, server_time desc) where action = 'day.closed';

create or replace function public.service_day_backlog(p_clinic_id uuid) returns jsonb
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
      from (select * from private.audit_logs a
             where a.action = 'day.closed' and a.entity_id = p_clinic_id and a.entity_type = 'clinic' and a.server_time > now() - interval '7 days'
             order by a.server_time desc limit 14) l), '[]'::jsonb));
end $$;
