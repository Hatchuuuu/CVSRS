-- ---------------------------------------------------------------------------------------------
-- The one-time operator bootstrap (0034) now refuses a person whose email address is not confirmed, so the SQL Editor path
-- has the same protection as `npm run setup:first-staff`: an unconfirmed account could belong to someone who only typed
-- that address. Supabase records confirmation in auth.users.email_confirmed_at; the column is read through to_jsonb so the
-- function also compiles on the local test bootstrap, whose auth.users has no such column (the check is then skipped).
-- Everything else is unchanged from 0034.
-- ---------------------------------------------------------------------------------------------
create or replace function private.bootstrap_initial_staff(p_org_name text, p_clinic_name text, p_timezone text, p_admin_email text, p_lead_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_admin uuid; v_lead uuid; v_org uuid; v_clinic uuid; v_m_admin uuid; v_m_lead uuid;
begin
  lock table public.staff_memberships in share row exclusive mode;
  if exists (select 1 from public.staff_memberships where status in ('active','pending_approval')) then
    raise exception 'staff access already exists; grant further access with the in-app two-person process' using errcode = 'CV409';
  end if;
  if coalesce(btrim(p_org_name), '') = '' or coalesce(btrim(p_clinic_name), '') = '' then
    raise exception 'name the organization and its first clinic' using errcode = 'CV422';
  end if;
  select p.id into v_admin from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(btrim(p_admin_email)) and p.status = 'active';
  select p.id into v_lead from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = lower(btrim(p_lead_email)) and p.status = 'active';
  if v_admin is null or v_lead is null or v_admin = v_lead then
    raise exception 'two different people who have already signed up are required' using errcode = 'CV422';
  end if;
  if exists (select 1 from auth.users u
              where u.id in (v_admin, v_lead) and to_jsonb(u) ? 'email_confirmed_at' and (to_jsonb(u) ->> 'email_confirmed_at') is null) then
    raise exception 'both people must confirm their email address first' using errcode = 'CV422';
  end if;
  insert into public.organizations (name) values (btrim(p_org_name)) returning id into v_org;
  insert into public.clinics (organization_id, name, timezone) values (v_org, btrim(p_clinic_name), coalesce(nullif(btrim(p_timezone), ''), 'Asia/Manila')) returning id into v_clinic;
  insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, requested_by, approved_by)
  values (v_org, v_admin, v_clinic, 'tech_admin', 'active', v_lead, v_lead) returning id into v_m_admin;
  insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, requested_by, approved_by)
  values (v_org, v_lead, v_clinic, 'clinical_lead', 'active', v_admin, v_admin) returning id into v_m_lead;
  perform private.audit(v_org, null, 'staff.bootstrap', 'clinic', v_clinic, null,
                        jsonb_build_object('techAdmin', v_admin, 'clinicalLead', v_lead, 'memberships', jsonb_build_array(v_m_admin, v_m_lead)),
                        'operator bootstrap of the first organization, clinic and staff');
  return jsonb_build_object('organizationId', v_org, 'clinicId', v_clinic, 'techAdminMembershipId', v_m_admin, 'clinicalLeadMembershipId', v_m_lead);
end $$;

revoke all on function private.bootstrap_initial_staff(text, text, text, text, text) from public, anon, authenticated, service_role;
