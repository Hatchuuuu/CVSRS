-- A server-side signup and its clinic access request are retried under one administrator-owned operation.
create table private.staff_account_creations (
  operation_key uuid primary key,
  clinic_id uuid not null references public.clinics(id),
  created_by uuid not null references public.profiles(id),
  email text not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now()
);
revoke all on private.staff_account_creations from public,anon,authenticated;

create function public.prepare_staff_account_creation(p_operation_key uuid,p_clinic_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_prev jsonb; v_email text:=lower(btrim(p_payload->>'email')); v_profile uuid; v_saved private.staff_account_creations;
begin
  perform private.require_capability(p_clinic_id,'admin.users');
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  if char_length(coalesce(v_email,'')) not between 3 and 200 or position('@' in v_email)=0 or char_length(btrim(coalesce(p_payload->>'fullName',''))) not between 1 and 120
    or p_payload->>'role' not in ('assistant','clinical_staff','clinical_lead','inventory','bhw','tech_admin') or coalesce(p_payload->>'passwordHash','') !~ '^[a-f0-9]{64}$' then raise exception 'check the account details' using errcode='CV422'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-create:'||v_email,0));
  v_prev:=private.begin_command(v_org,p_operation_key,'staff_account.create',jsonb_build_object('clinic',p_clinic_id,'payload',p_payload));
  if v_prev is not null then return v_prev; end if;
  select * into v_saved from private.staff_account_creations where operation_key=p_operation_key;
  if found and (v_saved.created_by<>auth.uid() or v_saved.clinic_id<>p_clinic_id) then raise exception 'operation key reused' using errcode='CV409'; end if;
  select id into v_profile from auth.users where lower(email)=v_email;
  if v_profile is not null and not exists(select 1 from auth.users where id=v_profile and raw_user_meta_data->>'staff_creation_key'=p_operation_key::text) then raise exception 'that email already has an account; use Staff access for existing accounts' using errcode='CV409'; end if;
  insert into private.staff_account_creations(operation_key,clinic_id,created_by,email,payload) values(p_operation_key,p_clinic_id,auth.uid(),v_email,p_payload) on conflict(operation_key) do nothing;
  return jsonb_build_object('profileId',v_profile,'status','creating');
end $$;

create function public.complete_staff_account_creation(p_operation_key uuid,p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.staff_account_creations; v_profile uuid; a public.staff_applications; v_result jsonb; v_org uuid;
begin
  perform private.require_capability(p_clinic_id,'admin.users');
  select * into c from private.staff_account_creations where operation_key=p_operation_key and clinic_id=p_clinic_id and created_by=auth.uid() for update;
  if not found then raise exception 'not found' using errcode='CV404'; end if;
  if c.result is not null then return c.result; end if;
  select id into v_profile from auth.users where lower(email)=c.email and raw_user_meta_data->>'staff_creation_key'=p_operation_key::text;
  if v_profile is null then raise exception 'account creation is not yet confirmed; retry with the same details' using errcode='CV409'; end if;
  select * into a from public.staff_applications where clinic_id=p_clinic_id and profile_id=v_profile and status='pending' order by created_at desc limit 1;
  if not found then raise exception 'the account exists but its staff application is unavailable; check Staff applications' using errcode='CV409'; end if;
  v_result:=public.accept_staff_application(gen_random_uuid(),p_clinic_id,a.id,a.version,c.payload->>'role','{}'::text[]);
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  v_result:=v_result||jsonb_build_object('email',c.email,'role',c.payload->>'role','status','pending_approval','applicationStatus','accepted','mfaRequired',true);
  update private.staff_account_creations set result=v_result where operation_key=p_operation_key;
  perform private.audit(v_org,'admin.users','staff_account.created','profile',v_profile,null,jsonb_build_object('clinicId',p_clinic_id,'role',c.payload->>'role','membershipId',v_result->>'membershipId'),null);
  return private.finish_command(v_org,p_operation_key,v_result);
end $$;
revoke all on function public.prepare_staff_account_creation(uuid,uuid,jsonb),public.complete_staff_account_creation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_staff_account_creation(uuid,uuid,jsonb),public.complete_staff_account_creation(uuid,uuid) to authenticated;
