-- 0036: tell staff applicants about a decision in their in-app inbox. accept/reject keep 0035's signatures (and therefore their grants);
-- the only change is the message, written in the same transaction as the decision (no external delivery, like 0021's check-in replies).

create function private.staff_role_label(p_role text) returns text language sql immutable set search_path = '' as $$
  select case p_role
    when 'clinical_staff' then 'Clinical staff (nurse or midwife)'
    when 'assistant' then 'Registration assistant'
    when 'bhw' then 'Barangay health worker'
    when 'inventory' then 'Inventory clerk'
    when 'clinical_lead' then 'Clinical lead'
    when 'tech_admin' then 'Technical administrator'
    else replace(p_role, '_', ' ')
  end
$$;
revoke all on function private.staff_role_label(text) from public, anon, authenticated;

create or replace function public.accept_staff_application(p_operation_key uuid, p_clinic_id uuid, p_application_id uuid, p_expected_version integer,
                                                p_role text, p_capabilities text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.staff_applications; v_prev jsonb; v_req jsonb; v_role text := coalesce(nullif(p_role, ''), null);
begin
  select * into a from public.staff_applications where id = p_application_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if not private.can_review_applications(a.clinic_id) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  v_role := coalesce(v_role, a.requested_role);
  v_prev := private.begin_command(a.organization_id, p_operation_key, 'staff_application.accept',
                                  jsonb_build_object('a', p_application_id, 'v', p_expected_version, 'r', v_role, 'caps', to_jsonb(coalesce(p_capabilities, '{}'))));
  if v_prev is not null then return v_prev; end if;
  if a.status <> 'pending' then raise exception 'This application has already been decided.' using errcode = 'CV409'; end if;
  if a.version <> p_expected_version then raise exception 'This application changed while you were reviewing it. Reload and try again.' using errcode = 'CV409'; end if;
  if a.profile_id = auth.uid() then raise exception 'You cannot decide your own application.' using errcode = 'CV403'; end if;
  if v_role not in ('assistant','clinical_staff','clinical_lead','inventory','bhw','tech_admin') then
    raise exception 'Choose a role.' using errcode = 'CV422';
  end if;
  if exists (select 1 from public.staff_memberships m where m.profile_id = a.profile_id and m.clinic_id = a.clinic_id and m.role_code = v_role
              and m.status in ('active','pending_approval')) then
    raise exception 'This person already has this role, or a request for it, at this health center.' using errcode = 'CV409';
  end if;

  -- The ordinary request command: same checks (requester capability, active profile), same audit entry, same two-person approval.
  v_req := public.request_staff_membership(gen_random_uuid(), a.clinic_id, a.profile_id, v_role, coalesce(p_capabilities, '{}'), null);
  update public.staff_applications
     set status = 'accepted', decided_by = auth.uid(), decided_at = now(), membership_id = (v_req ->> 'membershipId')::uuid
   where id = a.id;
  -- Tell the applicant in their inbox (same transaction, no external delivery). The status page shows the same facts.
  insert into public.messages (organization_id, recipient_profile_id, child_id, kind, title, body, dedupe_key)
  select a.organization_id, a.profile_id, null, 'staff_application', 'Your staff application was accepted',
         left('Your application to ' || c.name || ' was accepted for the role ' || private.staff_role_label(v_role) ||
              '. A second person approves your access next; the clinic workspace opens once they do.', 600),
         'staff_application:' || a.id || ':accepted'
    from public.clinics c where c.id = a.clinic_id
  on conflict (recipient_profile_id, dedupe_key) do nothing;
  perform private.audit(a.organization_id, case when private.has_capability(a.clinic_id, 'admin.users') then 'admin.users' else 'grant.approve.clinical' end,
                        'staff_application.accepted', 'staff_application', a.id, jsonb_build_object('status', a.status),
                        jsonb_build_object('status', 'accepted', 'role', v_role, 'membership', v_req ->> 'membershipId'), null);
  return private.finish_command(a.organization_id, p_operation_key, jsonb_build_object(
    'applicationId', a.id, 'status', 'accepted', 'membershipId', v_req ->> 'membershipId',
    'requiresClinicalApproval', (v_req ->> 'requiresClinicalApproval')::boolean));
end $$;

create or replace function public.reject_staff_application(p_operation_key uuid, p_clinic_id uuid, p_application_id uuid, p_expected_version integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.staff_applications; v_prev jsonb; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into a from public.staff_applications where id = p_application_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if not private.can_review_applications(a.clinic_id) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  v_prev := private.begin_command(a.organization_id, p_operation_key, 'staff_application.reject',
                                  jsonb_build_object('a', p_application_id, 'v', p_expected_version, 'reason', v_reason));
  if v_prev is not null then return v_prev; end if;
  if length(v_reason) < 3 then raise exception 'Give the applicant a short reason.' using errcode = 'CV422'; end if;
  if length(v_reason) > 500 then raise exception 'Keep the reason under 500 characters.' using errcode = 'CV422'; end if;
  if a.status <> 'pending' then raise exception 'This application has already been decided.' using errcode = 'CV409'; end if;
  if a.version <> p_expected_version then raise exception 'This application changed while you were reviewing it. Reload and try again.' using errcode = 'CV409'; end if;
  if a.profile_id = auth.uid() then raise exception 'You cannot decide your own application.' using errcode = 'CV403'; end if;
  update public.staff_applications set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason where id = a.id;
  insert into public.messages (organization_id, recipient_profile_id, child_id, kind, title, body, dedupe_key)
  select a.organization_id, a.profile_id, null, 'staff_application', 'Your staff application was declined',
         left('Your application to ' || c.name || ' was declined. Reason: ' || v_reason || ' You can apply again from the clinic workspace.', 600),
         'staff_application:' || a.id || ':rejected'
    from public.clinics c where c.id = a.clinic_id
  on conflict (recipient_profile_id, dedupe_key) do nothing;
  perform private.audit(a.organization_id, case when private.has_capability(a.clinic_id, 'admin.users') then 'admin.users' else 'grant.approve.clinical' end,
                        'staff_application.rejected', 'staff_application', a.id, jsonb_build_object('status', a.status),
                        jsonb_build_object('status', 'rejected'), v_reason);
  return private.finish_command(a.organization_id, p_operation_key, jsonb_build_object('applicationId', a.id, 'status', 'rejected'));
end $$;
