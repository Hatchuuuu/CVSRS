-- Reminders are facts about the current clinic-local day and current schedule.
-- Recheck after queueing, both when creating messages and when claiming SMS.
create function private.reminder_is_current(j private.outbox_jobs) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_clinic uuid; v_schedule jsonb;
begin
  if j.job_type = 'appointment.reminder' then
    return exists (
      select 1 from public.appointments a
        join public.clinic_sessions s on s.id = a.session_id
        join public.clinics c on c.id = s.clinic_id
       where a.id = j.aggregate_id and a.organization_id = j.organization_id
         and a.status = 'confirmed' and s.status = 'open' and c.status = 'active'
         and s.service_date = private.local_today(s.clinic_id) + 1
    );
  elsif j.job_type = 'dose.due' then
    select e.clinic_id into v_clinic
      from public.children c
      join public.child_clinic_enrollments e on e.child_id = c.id and e.status = 'active' and e.is_primary
      join public.clinics cl on cl.id = e.clinic_id and cl.status = 'active'
     where c.id = j.aggregate_id and c.organization_id = j.organization_id
       and c.record_status = 'active' and c.merged_into_id is null and c.deleted_at is null
       and e.clinic_id = (j.payload ->> 'clinicId')::uuid;
    if v_clinic is null then return false; end if;
    v_schedule := private.compute_child_schedule(j.aggregate_id, private.local_today(v_clinic), false);
    return v_schedule ->> 'status' = 'evaluated' and exists (
      select 1 from jsonb_array_elements(coalesce(v_schedule -> 'requirements', '[]'::jsonb)) r
       where r ->> 'status' in ('due_today','due_now','overdue')
    );
  end if;
  return true;
end $$;

-- Preserve the existing dispatch bodies and their notification wording.
alter function private.handle_outbox_job(private.outbox_jobs) rename to handle_outbox_job_before_reminder_freshness;
create function private.handle_outbox_job(j private.outbox_jobs) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not private.reminder_is_current(j) then return 'cancelled'; end if;
  return private.handle_outbox_job_before_reminder_freshness(j);
end $$;

create or replace function private.claim_sms(p_limit integer default 20)
returns table (id uuid, phone text, body text, attempt integer)
language plpgsql security definer set search_path = '' as $$
declare m public.sms_messages; g public.guardians; j private.outbox_jobs;
begin
  update public.sms_messages set status = 'queued', updated_at = now()
   where status = 'sending' and locked_until < now();
  -- Only the bounded, claimable batch is evaluated. The outbox's unique dedupe
  -- key supplies structured reminder context without parsing phone-message text.
  for m in
    select sms.* from public.sms_messages sms join public.guardians guardian on guardian.id = sms.guardian_id
     where sms.status = 'queued' and sms.available_at <= now() and guardian.sms_opt_in
       and guardian.contact_phone is not null and guardian.contact_verified_at is not null
     order by sms.available_at, sms.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100) for update of sms skip locked
  loop
    select o.* into j from private.outbox_jobs o
     where o.organization_id = m.organization_id and o.dedupe_key = m.dedupe_key
       and o.job_type in ('appointment.reminder','dose.due');
    if j.id is not null and not private.reminder_is_current(j) then
      update public.sms_messages sms set status = 'undeliverable', locked_until = null,
             last_error_code = 'stale_reminder', updated_at = now() where sms.id = m.id;
      continue;
    end if;
    select guardian.* into g from public.guardians guardian where guardian.id = m.guardian_id;
    update public.sms_messages sms
       set status = 'sending', attempt_count = sms.attempt_count + 1,
           locked_until = now() + interval '2 minutes', updated_at = now()
     where sms.id = m.id returning sms.id, g.contact_phone, sms.body, sms.attempt_count into id, phone, body, attempt;
    return next;
  end loop;
end $$;

revoke all on function private.reminder_is_current(private.outbox_jobs),
  private.handle_outbox_job_before_reminder_freshness(private.outbox_jobs),
  private.handle_outbox_job(private.outbox_jobs), private.claim_sms(integer) from public, anon, authenticated;
grant execute on function private.claim_sms(integer) to cvsrs_outbox_worker;
