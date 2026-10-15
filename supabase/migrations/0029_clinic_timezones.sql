-- Read-only timezone metadata for existing authorized views. Calendar dates remain dates.
create or replace function public.get_my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profileId', p.id, 'displayName', p.display_name, 'locale', p.locale, 'status', p.status,
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

create or replace function public.my_children() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'childId', c.id, 'displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob, 'dobPrecision', c.birth_date_precision,
    'recordStatus', c.record_status, 'relationshipStatus', r.status, 'accessScope', r.access_scope, 'relationship', r.relationship,
    'clinicId', (select e.clinic_id from public.child_clinic_enrollments e where e.child_id = c.id and e.status in ('pending','active') order by e.is_primary desc, e.created_at limit 1),
    'clinicName', (select cl.name from public.child_clinic_enrollments e join public.clinics cl on cl.id = e.clinic_id
                    where e.child_id = c.id and e.status in ('pending','active') order by e.is_primary desc, e.created_at limit 1),
    'clinicTimezone', (select cl.timezone from public.child_clinic_enrollments e join public.clinics cl on cl.id = e.clinic_id
                    where e.child_id = c.id and e.status in ('pending','active') order by e.is_primary desc, e.created_at limit 1)
  ) order by c.display_name), '[]'::jsonb)
  from public.guardian_child_relationships r join public.children c on c.id = r.child_id
  where r.guardian_id in (select private.my_guardian_ids()) and r.status in ('provisional','active') and c.record_status <> 'merged'
$$;

create or replace function public.my_appointments() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('appointmentId', a.id, 'status', a.status, 'childId', c.id, 'childName', c.display_name, 'sessionId', s.id,
      'serviceDate', s.service_date, 'startsAt', s.starts_at, 'endsAt', s.ends_at, 'clinicId', s.clinic_id, 'clinicName', cl.name,
      'clinicTimezone', cl.timezone, 'serviceCode', s.service_code, 'version', a.version) order by s.starts_at desc), '[]'::jsonb)
    from public.appointments a join public.clinic_sessions s on s.id = a.session_id join public.children c on c.id = a.child_id join public.clinics cl on cl.id = s.clinic_id
   where private.guardian_has_full_access(a.child_id) and a.status in ('confirmed','checked_in','fulfilled','no_show','cancelled','rescheduled') and s.service_date >= current_date - 60
$$;

-- Existing grants on replaced functions are preserved by CREATE OR REPLACE.

create or replace function public.my_record_transfers(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  return jsonb_build_object(
    'transfers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'toClinic', dst.name, 'fromClinic', src.name,
                  'fromClinicTimezone', src.timezone, 'requestedAt', t.created_at, 'completedAt', t.completed_at, 'note', t.decision_note) order by t.created_at desc)
      from public.record_transfers t join public.clinics src on src.id = t.from_clinic_id join public.clinics dst on dst.id = t.to_clinic_id
      where t.child_id = v_canon), '[]'::jsonb),
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name) from public.clinics x where x.organization_id = (select organization_id from public.children where id = v_canon) and x.status = 'active'
                          and x.id not in (select clinic_id from public.child_clinic_enrollments where child_id = v_canon and status in ('pending','active'))), '[]'::jsonb));
end $$;
