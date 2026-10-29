-- Assigned technical administrators receive an allowlisted projection, never raw audit payloads.
create function public.list_technical_audit(p_clinic_id uuid, p_limit integer default 50, p_before timestamptz default null, p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_items jsonb; v_more boolean; v_last jsonb;
begin
  perform private.require_capability(p_clinic_id, 'admin.users');
  if not exists (
    select 1 from public.staff_memberships m where m.clinic_id=p_clinic_id and m.profile_id=auth.uid()
      and m.role_code='tech_admin' and m.status='active' and m.valid_from<=now()
      and (m.valid_until is null or m.valid_until>now())
  ) then raise exception 'forbidden' using errcode='CV403'; end if;
  if p_limit is null or p_limit<1 or p_limit>100 or (p_before is null) <> (p_before_id is null) then
    raise exception 'use a limit from 1 to 100 and both cursor fields' using errcode='CV422';
  end if;
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  with selected as (
    select a.id, a.server_time, a.action, a.entity_type, a.outcome, p.display_name
      from private.audit_logs a left join public.profiles p on p.id=a.actor_id
     where a.organization_id=v_org
       and (
         (a.entity_type='clinic' and a.entity_id=p_clinic_id and a.action in ('clinic.profile_changed','ops.check_recorded','staff.profile_lookup'))
         or (a.entity_type='staff_membership' and a.action in ('staff_membership.requested','staff_membership.approved','staff_membership.revoked','staff.location_updated','staff.location_assigned')
           and exists(select 1 from public.staff_memberships m where m.id=a.entity_id and m.clinic_id=p_clinic_id))
         or (a.entity_type='staff_application' and a.action in ('staff_application.submitted','staff_application.withdrawn','staff_application.accepted','staff_application.rejected')
           and exists(select 1 from public.staff_applications s where s.id=a.entity_id and s.clinic_id=p_clinic_id))
         or (a.entity_type='profile' and a.action='staff_account.created' and a.after->>'clinicId'=p_clinic_id::text)
       )
       and (p_before is null or (a.server_time,a.id)<(p_before,p_before_id))
     order by a.server_time desc,a.id desc limit p_limit+1
  ), numbered as (select *,row_number() over(order by server_time desc,id desc) n from selected)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'actorName',display_name,'createdAt',server_time,'targetType',entity_type,'outcome',outcome) order by server_time desc,id desc) filter(where n<=p_limit),'[]'::jsonb),count(*)>p_limit
    into v_items,v_more from numbered;
  v_last:=v_items->(jsonb_array_length(v_items)-1);
  return jsonb_build_object('items',v_items,'nextCursor',case when v_more then jsonb_build_object('before',v_last->>'createdAt','beforeId',v_last->>'id') else null end);
end $$;
revoke all on function public.list_technical_audit(uuid,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.list_technical_audit(uuid,integer,timestamptz,uuid) to authenticated;

-- Historical revoked grants belong in the technical directory; clinical callers keep their current read.
create function public.list_technical_staff_memberships(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_capability(p_clinic_id, 'admin.users');
  if not exists (
    select 1 from public.staff_memberships m where m.clinic_id=p_clinic_id and m.profile_id=auth.uid()
      and m.role_code='tech_admin' and m.status='active' and m.valid_from<=now()
      and (m.valid_until is null or m.valid_until>now())
  ) then raise exception 'forbidden' using errcode='CV403'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'membershipId',m.id,'profileId',m.profile_id,'displayName',p.display_name,'role',m.role_code,
      'capabilities',to_jsonb(m.capabilities),'status',m.status,'version',m.version,'validUntil',m.valid_until,
      'requestedBy',m.requested_by,'approvedBy',m.approved_by,'createdAt',m.created_at,
      'requiresClinicalApproval',private.membership_is_clinical(m.role_code,m.capabilities),
      'barangay',m.barangay,'cityMunicipality',m.city_municipality
    ) order by m.created_at desc,m.id desc),'[]'::jsonb)
    from public.staff_memberships m join public.profiles p on p.id=m.profile_id
    where m.clinic_id=p_clinic_id
  );
end $$;
revoke all on function public.list_technical_staff_memberships(uuid) from public,anon,authenticated;
grant execute on function public.list_technical_staff_memberships(uuid) to authenticated;
