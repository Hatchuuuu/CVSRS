-- 0035: Staff applications. A person creating a staff account (or a signed-in person later) applies to one health center for a role.
-- An access administrator of that clinic accepts or rejects the application. Accepting does NOT grant access: it files the ordinary
-- staff-membership request (requested_by = the accepting administrator), which still needs independent approval by a different person
-- under 0002's two-person rule (clinical roles by a clinical lead). An application is a request, never an authorization source.

create table public.staff_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  clinic_id uuid not null,
  profile_id uuid not null references public.profiles (id),
  requested_role text not null check (requested_role in ('assistant','clinical_staff','clinical_lead','inventory','bhw','tech_admin')),
  position_title text check (position_title is null or length(btrim(position_title)) between 1 and 80),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or length(decision_reason) <= 500),
  membership_id uuid references public.staff_memberships (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  check (status = 'pending' or decided_at is not null),
  check (status <> 'accepted' or (membership_id is not null and decided_by is not null)),
  check (status <> 'rejected' or (decided_by is not null and decision_reason is not null)),
  -- Nobody decides their own application.
  check (decided_by is null or decided_by <> profile_id)
);
create trigger staff_applications_touch before update on public.staff_applications for each row execute function private.touch_row();
create unique index staff_applications_one_pending_uq on public.staff_applications (profile_id, clinic_id) where status = 'pending';
create index staff_applications_clinic_status_idx on public.staff_applications (clinic_id, status, created_at desc);
create index staff_applications_profile_idx on public.staff_applications (profile_id, created_at desc);

alter table public.staff_applications enable row level security;
revoke all on public.staff_applications from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Shared validation and insert (used by the sign-up trigger and by submit_staff_application)
-- ---------------------------------------------------------------------------------------------
create function private.create_staff_application(p_profile uuid, p_clinic uuid, p_role text, p_title text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_title text := nullif(btrim(coalesce(p_title, '')), ''); v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select organization_id into v_org from public.clinics where id = p_clinic and status = 'active';
  if v_org is null then raise exception 'That health center is not accepting staff applications.' using errcode = 'CV404'; end if;
  if p_role is null or p_role not in ('assistant','clinical_staff','clinical_lead','inventory','bhw','tech_admin') then
    raise exception 'Choose the role you are applying for.' using errcode = 'CV422';
  end if;
  if v_title is not null and length(v_title) > 80 then raise exception 'Keep the job title under 80 characters.' using errcode = 'CV422'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'Keep the note under 500 characters.' using errcode = 'CV422'; end if;
  if not exists (select 1 from public.profiles where id = p_profile and status = 'active') then
    raise exception 'This account cannot apply right now.' using errcode = 'CV422';
  end if;
  if exists (select 1 from public.staff_memberships m where m.profile_id = p_profile and m.clinic_id = p_clinic
              and m.status in ('active','pending_approval') and (m.valid_until is null or m.valid_until > now())) then
    raise exception 'You already have access, or an access request in progress, at this health center.' using errcode = 'CV409';
  end if;
  if exists (select 1 from public.staff_applications a where a.profile_id = p_profile and a.clinic_id = p_clinic and a.status = 'pending') then
    raise exception 'You already have an application waiting at this health center.' using errcode = 'CV409';
  end if;
  if (select count(*) from public.staff_applications a where a.profile_id = p_profile and a.status = 'pending') >= 5 then
    raise exception 'You have five applications waiting. Withdraw one before applying again.' using errcode = 'CV422';
  end if;

  insert into public.staff_applications (organization_id, clinic_id, profile_id, requested_role, position_title, note)
  values (v_org, p_clinic, p_profile, p_role, v_title, v_note)
  returning id into v_id;
  perform private.audit(v_org, null, 'staff_application.submitted', 'staff_application', v_id, null,
                        jsonb_build_object('clinic', p_clinic, 'profile', p_profile, 'role', p_role), null);
  return v_id;
end $$;

-- Sign-up: the profile row as before, plus the application a staff sign-up carries in its metadata. The application is a request only;
-- a bad or stale detail (for example a clinic closed since the form loaded) must never block account creation, so it is skipped with a
-- warning and the person applies again from the clinic workspace, which shows that no application exists.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_app jsonb := new.raw_user_meta_data -> 'staff_application';
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120))
  on conflict (id) do nothing;
  if jsonb_typeof(v_app) = 'object' then
    begin
      perform private.create_staff_application(new.id, (v_app ->> 'clinic_id')::uuid, v_app ->> 'role', v_app ->> 'position_title', v_app ->> 'note');
    exception when others then
      raise warning 'staff application from sign-up was not recorded: %', sqlerrm;
    end;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Applicant commands
-- ---------------------------------------------------------------------------------------------
create function public.submit_staff_application(p_operation_key uuid, p_clinic_id uuid, p_role text, p_position_title text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_id uuid;
begin
  if not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select organization_id into v_org from public.clinics where id = p_clinic_id and status = 'active';
  if v_org is null then raise exception 'That health center is not accepting staff applications.' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'staff_application.submit',
                                  jsonb_build_object('c', p_clinic_id, 'r', p_role, 't', p_position_title, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  v_id := private.create_staff_application(auth.uid(), p_clinic_id, p_role, p_position_title, p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('applicationId', v_id, 'status', 'pending'));
end $$;

create function public.withdraw_staff_application(p_operation_key uuid, p_application_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.staff_applications; v_prev jsonb;
begin
  if not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into a from public.staff_applications where id = p_application_id and profile_id = auth.uid() for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(a.organization_id, p_operation_key, 'staff_application.withdraw', jsonb_build_object('a', p_application_id));
  if v_prev is not null then return v_prev; end if;
  if a.status <> 'pending' then raise exception 'This application has already been decided.' using errcode = 'CV409'; end if;
  update public.staff_applications set status = 'withdrawn', decided_at = now() where id = a.id;
  perform private.audit(a.organization_id, null, 'staff_application.withdrawn', 'staff_application', a.id,
                        jsonb_build_object('status', a.status), jsonb_build_object('status', 'withdrawn'), null);
  return private.finish_command(a.organization_id, p_operation_key, jsonb_build_object('applicationId', a.id, 'status', 'withdrawn'));
end $$;

-- The caller's own applications, newest first, with the state of any access request an acceptance created.
create function public.my_staff_applications() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'applicationId', a.id, 'clinicId', a.clinic_id, 'clinicName', c.name, 'clinicTimezone', c.timezone, 'requestedRole', a.requested_role,
      'positionTitle', a.position_title, 'status', a.status, 'decisionReason', a.decision_reason,
      'createdAt', a.created_at, 'decidedAt', a.decided_at, 'membershipStatus', m.status, 'grantedRole', m.role_code)
    order by a.created_at desc), '[]'::jsonb)
    from public.staff_applications a
    join public.clinics c on c.id = a.clinic_id
    left join public.staff_memberships m on m.id = a.membership_id
   where private.session_ok() and a.profile_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------------------------
-- Administrator commands (admin.users or grant.approve.clinical at the application's clinic)
-- ---------------------------------------------------------------------------------------------
create function private.can_review_applications(p_clinic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_capability(p_clinic, 'admin.users') or private.has_capability(p_clinic, 'grant.approve.clinical')
$$;

-- p_view: 'pending' (default) or 'decided' (the 50 most recent accepted, rejected or withdrawn).
create function public.list_staff_applications(p_clinic_id uuid, p_view text default 'pending') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_res jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if not private.can_review_applications(p_clinic_id) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  if p_view not in ('pending','decided') then raise exception 'Unknown list.' using errcode = 'CV422'; end if;
  select coalesce(jsonb_agg(item order by sort_at desc), '[]'::jsonb) into v_res from (
    select jsonb_build_object(
        'applicationId', a.id, 'profileId', a.profile_id, 'displayName', p.display_name, 'email', u.email,
        -- Supabase records email confirmation; the local stand-in table has no such column, so the answer is unknown (null) there.
        'emailConfirmed', case when to_jsonb(u) ? 'email_confirmed_at' then (to_jsonb(u) ->> 'email_confirmed_at') is not null end,
        'requestedRole', a.requested_role, 'positionTitle', a.position_title, 'note', a.note, 'status', a.status, 'version', a.version,
        'createdAt', a.created_at, 'decidedAt', a.decided_at, 'decidedByName', d.display_name, 'decisionReason', a.decision_reason,
        'membershipId', a.membership_id, 'membershipStatus', m.status, 'grantedRole', m.role_code,
        'requiresClinicalApproval', private.membership_is_clinical(a.requested_role, '{}')) as item,
        coalesce(a.decided_at, a.created_at) as sort_at
      from public.staff_applications a
      join public.profiles p on p.id = a.profile_id
      join auth.users u on u.id = a.profile_id
      left join public.profiles d on d.id = a.decided_by
      left join public.staff_memberships m on m.id = a.membership_id
     where a.clinic_id = p_clinic_id
       and (case when p_view = 'pending' then a.status = 'pending' else a.status <> 'pending' end)
     order by coalesce(a.decided_at, a.created_at) desc
     limit case when p_view = 'pending' then 500 else 50 end
  ) s;
  return v_res;
end $$;

-- Accept: files the staff-membership request for the chosen role (default: the role applied for). The membership is pending until a
-- different person approves it (0002); this administrator cannot approve it themselves because they are its requester.
create function public.accept_staff_application(p_operation_key uuid, p_clinic_id uuid, p_application_id uuid, p_expected_version integer,
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
  perform private.audit(a.organization_id, case when private.has_capability(a.clinic_id, 'admin.users') then 'admin.users' else 'grant.approve.clinical' end,
                        'staff_application.accepted', 'staff_application', a.id, jsonb_build_object('status', a.status),
                        jsonb_build_object('status', 'accepted', 'role', v_role, 'membership', v_req ->> 'membershipId'), null);
  return private.finish_command(a.organization_id, p_operation_key, jsonb_build_object(
    'applicationId', a.id, 'status', 'accepted', 'membershipId', v_req ->> 'membershipId',
    'requiresClinicalApproval', (v_req ->> 'requiresClinicalApproval')::boolean));
end $$;

create function public.reject_staff_application(p_operation_key uuid, p_clinic_id uuid, p_application_id uuid, p_expected_version integer, p_reason text)
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
  perform private.audit(a.organization_id, case when private.has_capability(a.clinic_id, 'admin.users') then 'admin.users' else 'grant.approve.clinical' end,
                        'staff_application.rejected', 'staff_application', a.id, jsonb_build_object('status', a.status),
                        jsonb_build_object('status', 'rejected'), v_reason);
  return private.finish_command(a.organization_id, p_operation_key, jsonb_build_object('applicationId', a.id, 'status', 'rejected'));
end $$;

revoke all on function private.create_staff_application(uuid, uuid, text, text, text), private.can_review_applications(uuid) from public, anon, authenticated;
revoke all on function public.submit_staff_application(uuid, uuid, text, text, text), public.withdraw_staff_application(uuid, uuid),
  public.my_staff_applications(), public.list_staff_applications(uuid, text),
  public.accept_staff_application(uuid, uuid, uuid, integer, text, text[]), public.reject_staff_application(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.submit_staff_application(uuid, uuid, text, text, text), public.withdraw_staff_application(uuid, uuid),
  public.my_staff_applications(), public.list_staff_applications(uuid, text),
  public.accept_staff_application(uuid, uuid, uuid, integer, text, text[]), public.reject_staff_application(uuid, uuid, uuid, integer, text)
  to authenticated;
