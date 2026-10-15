-- 0014 Guardian child list also returns the child's clinic id (needed to offer that clinic's sessions).
create or replace function public.my_children() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'childId', c.id, 'displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob, 'dobPrecision', c.birth_date_precision,
    'recordStatus', c.record_status, 'relationshipStatus', r.status, 'accessScope', r.access_scope, 'relationship', r.relationship,
    'clinicId', (select e.clinic_id from public.child_clinic_enrollments e where e.child_id = c.id and e.status in ('pending','active') order by e.is_primary desc, e.created_at limit 1),
    'clinicName', (select cl.name from public.child_clinic_enrollments e join public.clinics cl on cl.id = e.clinic_id
                    where e.child_id = c.id and e.status in ('pending','active') order by e.is_primary desc, e.created_at limit 1)
  ) order by c.display_name), '[]'::jsonb)
  from public.guardian_child_relationships r
  join public.children c on c.id = r.child_id
  where r.guardian_id in (select private.my_guardian_ids()) and r.status in ('provisional','active') and c.record_status <> 'merged'
$$;
revoke all on function public.my_children() from public, anon, authenticated;
grant execute on function public.my_children() to authenticated;
