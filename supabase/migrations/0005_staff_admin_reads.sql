-- 0005 Read/lookup commands for staff access administration (P33). Technical admins see membership metadata only.

create function public.list_staff_memberships(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_res jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if not (private.has_capability(p_clinic_id, 'admin.users') or private.has_capability(p_clinic_id, 'grant.approve.clinical')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'membershipId', m.id, 'profileId', m.profile_id, 'displayName', p.display_name, 'role', m.role_code,
      'capabilities', to_jsonb(m.capabilities), 'status', m.status, 'version', m.version, 'validUntil', m.valid_until,
      'requestedBy', m.requested_by, 'approvedBy', m.approved_by, 'createdAt', m.created_at,
      'requiresClinicalApproval', private.membership_is_clinical(m.role_code, m.capabilities))
    order by m.created_at desc), '[]'::jsonb)
    into v_res
    from public.staff_memberships m join public.profiles p on p.id = m.profile_id
   where m.clinic_id = p_clinic_id and m.status in ('pending_approval','active','suspended');
  return v_res;
end $$;

-- Exact-email lookup for an administrator adding staff. Audited; returns null (not an error) so the denial/miss is recorded.
create function public.find_profile_for_grant(p_clinic_id uuid, p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; r record;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if not (private.has_capability(p_clinic_id, 'admin.users') or private.has_capability(p_clinic_id, 'grant.approve.clinical')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  select p.id, p.display_name into r from auth.users u join public.profiles p on p.id = u.id
   where lower(u.email) = lower(btrim(coalesce(p_email, ''))) and p.status = 'active';
  perform private.audit(v_org, 'admin.users', 'staff.profile_lookup', 'clinic', p_clinic_id, null,
                        jsonb_build_object('found', r.id is not null), null);
  if r.id is null then return null; end if;
  return jsonb_build_object('profileId', r.id, 'displayName', r.display_name);
end $$;

revoke all on function public.list_staff_memberships(uuid) from public, anon, authenticated;
revoke all on function public.find_profile_for_grant(uuid, text) from public, anon, authenticated;
grant execute on function public.list_staff_memberships(uuid) to authenticated;
grant execute on function public.find_profile_for_grant(uuid, text) to authenticated;
