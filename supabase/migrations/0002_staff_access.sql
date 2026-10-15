-- 0002 Staff access lifecycle: request -> independent approval -> revoke. Blueprint refs: BP14, BP32, F01, T32.
-- A technical administrator can request any grant, but grants that carry clinical capability need approval from a
-- different person holding grant.approve.clinical. Nobody approves their own grant.

create function private.membership_is_clinical(p_role text, p_caps text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_role in ('clinical_staff','clinical_lead')
      or (private.role_preset(p_role) || coalesce(p_caps, '{}')) && private.clinical_caps()
$$;

create function public.request_staff_membership(
  p_operation_key uuid, p_clinic_id uuid, p_profile_id uuid, p_role text, p_capabilities text[] default '{}',
  p_valid_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_payload jsonb := jsonb_build_object('clinic', p_clinic_id, 'profile', p_profile_id, 'role', p_role,
                                        'caps', to_jsonb(coalesce(p_capabilities, '{}')), 'until', p_valid_until);
  v_prev jsonb;
  v_id uuid;
  v_result jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if not (private.has_capability(p_clinic_id, 'admin.users') or private.has_capability(p_clinic_id, 'grant.approve.clinical')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'staff_membership.request', v_payload);
  if v_prev is not null then return v_prev; end if;

  if not exists (select 1 from public.profiles where id = p_profile_id and status = 'active') then
    raise exception 'profile is not active' using errcode = 'CV422';
  end if;
  if p_valid_until is not null and p_valid_until <= now() then
    raise exception 'valid_until must be in the future' using errcode = 'CV422';
  end if;

  insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, capabilities, valid_until,
                                        status, requested_by, created_by, updated_by)
  values (v_org, p_profile_id, p_clinic_id, p_role, coalesce(p_capabilities, '{}'), p_valid_until,
          'pending_approval', auth.uid(), auth.uid(), auth.uid())
  returning id into v_id;

  perform private.audit(v_org, 'admin.users', 'staff_membership.requested', 'staff_membership', v_id, null,
                        jsonb_build_object('profile', p_profile_id, 'role', p_role, 'capabilities', p_capabilities,
                                           'clinical', private.membership_is_clinical(p_role, p_capabilities)), null);
  v_result := jsonb_build_object('membershipId', v_id, 'status', 'pending_approval',
                                 'requiresClinicalApproval', private.membership_is_clinical(p_role, p_capabilities));
  return private.finish_command(v_org, p_operation_key, v_result);
end $$;

create function public.approve_staff_membership(p_operation_key uuid, p_membership_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.staff_memberships;
  v_prev jsonb;
  v_clinical boolean;
  v_needed text;
begin
  select * into m from public.staff_memberships where id = p_membership_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_clinical := private.membership_is_clinical(m.role_code, m.capabilities);
  v_needed := case when v_clinical then 'grant.approve.clinical' else 'admin.users' end;
  if not private.has_capability(m.clinic_id, v_needed) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  v_prev := private.begin_command(m.organization_id, p_operation_key, 'staff_membership.approve',
                                  jsonb_build_object('membership', p_membership_id, 'v', p_expected_version));
  if v_prev is not null then return v_prev; end if;

  if m.status <> 'pending_approval' then raise exception 'membership is not pending' using errcode = 'CV409'; end if;
  if m.version <> p_expected_version then raise exception 'stale version' using errcode = 'CV409'; end if;
  if m.profile_id = auth.uid() then raise exception 'cannot approve own grant' using errcode = 'CV403'; end if;
  if m.requested_by = auth.uid() then raise exception 'approver must differ from requester' using errcode = 'CV403'; end if;

  update public.staff_memberships set status = 'active', approved_by = auth.uid(), updated_by = auth.uid(), valid_from = now()
   where id = m.id;
  perform private.audit(m.organization_id, v_needed, 'staff_membership.approved', 'staff_membership', m.id,
                        jsonb_build_object('status', m.status), jsonb_build_object('status', 'active'), null);
  return private.finish_command(m.organization_id, p_operation_key, jsonb_build_object('membershipId', m.id, 'status', 'active'));
end $$;

create function public.revoke_staff_membership(p_operation_key uuid, p_membership_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.staff_memberships;
  v_prev jsonb;
  v_needed text;
begin
  select * into m from public.staff_memberships where id = p_membership_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_needed := case when private.membership_is_clinical(m.role_code, m.capabilities) then 'grant.approve.clinical' else 'admin.users' end;
  if not private.has_capability(m.clinic_id, v_needed) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(m.organization_id, p_operation_key, 'staff_membership.revoke',
                                  jsonb_build_object('membership', p_membership_id, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  if m.status not in ('active','pending_approval','suspended') then raise exception 'already closed' using errcode = 'CV409'; end if;
  update public.staff_memberships set status = 'revoked', updated_by = auth.uid() where id = m.id;
  perform private.audit(m.organization_id, v_needed, 'staff_membership.revoked', 'staff_membership', m.id,
                        jsonb_build_object('status', m.status), jsonb_build_object('status', 'revoked'), p_reason);
  return private.finish_command(m.organization_id, p_operation_key, jsonb_build_object('membershipId', m.id, 'status', 'revoked'));
end $$;

revoke all on function public.request_staff_membership(uuid, uuid, uuid, text, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.approve_staff_membership(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.revoke_staff_membership(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.request_staff_membership(uuid, uuid, uuid, text, text[], timestamptz) to authenticated;
grant execute on function public.approve_staff_membership(uuid, uuid, integer) to authenticated;
grant execute on function public.revoke_staff_membership(uuid, uuid, text) to authenticated;
revoke all on function private.membership_is_clinical(text, text[]) from public, anon, authenticated;
