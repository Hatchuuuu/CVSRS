-- 0004 Public clinic listing as an RPC (P01) and request-id correlation via PostgREST's request.headers GUC.

create or replace function private.request_id() returns uuid language plpgsql stable set search_path = '' as $$
declare v text;
begin
  v := nullif(pg_catalog.current_setting('app.request_id', true), '');
  if v is null then
    -- PostgREST exposes request headers as JSON in request.headers; the app forwards x-request-id.
    begin
      v := nullif(nullif(pg_catalog.current_setting('request.headers', true), '')::json ->> 'x-request-id', '');
    exception when others then v := null;
    end;
  end if;
  begin
    return coalesce(v::uuid, gen_random_uuid());
  exception when others then
    return gen_random_uuid();
  end;
end $$;
revoke all on function private.request_id() from public, anon, authenticated;

create function public.list_public_clinics() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'address', address, 'contact', contact_text) order by name), '[]'::jsonb)
    from public.clinics where status = 'active'
$$;
revoke all on function public.list_public_clinics() from public, anon, authenticated;
grant execute on function public.list_public_clinics() to anon, authenticated;

-- Effective capabilities per membership let the UI show only relevant actions. This is presentation only:
-- every command still authorizes in the database.
create or replace function public.get_my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profileId', p.id, 'displayName', p.display_name, 'locale', p.locale, 'status', p.status,
    'mfa', private.mfa_ok(),
    'demoMode', private.setting_bool('demo_mode'),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('membershipId', m.id, 'clinicId', m.clinic_id, 'clinicName', c.name, 'role', m.role_code,
                                          'status', m.status, 'validUntil', m.valid_until,
                                          'capabilities', to_jsonb(private.role_preset(m.role_code) || m.capabilities)))
        from public.staff_memberships m join public.clinics c on c.id = m.clinic_id
       where m.profile_id = p.id and m.status in ('active','pending_approval')), '[]'::jsonb))
  from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.get_my_context() from public, anon, authenticated;
grant execute on function public.get_my_context() to authenticated;
