-- Staff work assignment is clinic-membership metadata, not a permission or home address.
alter table public.staff_memberships add column barangay text, add column city_municipality text;
alter table public.staff_memberships add constraint staff_location_valid check (
 (barangay is null and city_municipality is null) or
 (char_length(btrim(barangay)) between 1 and 120 and char_length(btrim(city_municipality)) between 1 and 120 and barangay is not null and city_municipality is not null)
);

alter function public.list_staff_memberships(uuid) set schema private;
alter function private.list_staff_memberships(uuid) rename to list_staff_memberships_location_base;
revoke all on function private.list_staff_memberships_location_base(uuid) from public,anon,authenticated;
create function public.list_staff_memberships(p_clinic_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;
begin
 v_rows:=private.list_staff_memberships_location_base(p_clinic_id);
 return coalesce((select jsonb_agg(r.value||jsonb_build_object('barangay',m.barangay,'cityMunicipality',m.city_municipality) order by r.ordinality)
 from jsonb_array_elements(v_rows) with ordinality r(value,ordinality) join public.staff_memberships m on m.id=(r.value->>'membershipId')::uuid),'[]'::jsonb);
end $$;

create function public.update_staff_location(p_operation_key uuid,p_clinic_id uuid,p_membership_id uuid,p_expected_version integer,p_barangay text,p_city_municipality text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.staff_memberships; v_prev jsonb; v_barangay text:=nullif(btrim(p_barangay),''); v_city text:=nullif(btrim(p_city_municipality),'');
begin
 perform private.require_capability(p_clinic_id,'admin.users');
 if (v_barangay is null)<>(v_city is null) or char_length(v_barangay)>120 or char_length(v_city)>120 then raise exception 'Enter both barangay and city/municipality, or clear both.' using errcode='CV422'; end if;
 select * into m from public.staff_memberships where id=p_membership_id and clinic_id=p_clinic_id for update;
 if not found then raise exception 'not found' using errcode='CV404'; end if;
 v_prev:=private.begin_command(m.organization_id,p_operation_key,'staff.location',jsonb_build_object('membership',p_membership_id,'version',p_expected_version,'barangay',v_barangay,'city',v_city));
 if v_prev is not null then return v_prev; end if;
 if p_expected_version is null or m.version<>p_expected_version then raise exception 'Staff details changed; reload and try again.' using errcode='CV409'; end if;
 update public.staff_memberships set barangay=v_barangay,city_municipality=v_city,version=version+1 where id=m.id;
 perform private.audit(m.organization_id,'admin.users','staff.location_updated','staff_membership',m.id,jsonb_build_object('barangay',m.barangay,'cityMunicipality',m.city_municipality),jsonb_build_object('barangay',v_barangay,'cityMunicipality',v_city),null);
 return private.finish_command(m.organization_id,p_operation_key,jsonb_build_object('membershipId',m.id,'version',m.version+1,'barangay',v_barangay,'cityMunicipality',v_city));
end $$;

-- Validate assignment metadata even when the RPC is called outside the web form.
alter function public.prepare_staff_account_creation(uuid,uuid,jsonb) set schema private;
alter function private.prepare_staff_account_creation(uuid,uuid,jsonb) rename to prepare_staff_account_location_base;
revoke all on function private.prepare_staff_account_location_base(uuid,uuid,jsonb) from public,anon,authenticated;
create function public.prepare_staff_account_creation(p_operation_key uuid,p_clinic_id uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b text:=nullif(btrim(p_payload->>'barangay'),''); c text:=nullif(btrim(p_payload->>'cityMunicipality'),'');
begin
 perform private.require_capability(p_clinic_id,'admin.users');
 if (b is null)<>(c is null) or char_length(b)>120 or char_length(c)>120 then raise exception 'Enter both barangay and city/municipality, or clear both.' using errcode='CV422'; end if;
 return private.prepare_staff_account_location_base(p_operation_key,p_clinic_id,p_payload);
end $$;

alter function public.complete_staff_account_creation(uuid,uuid) set schema private;
alter function private.complete_staff_account_creation(uuid,uuid) rename to complete_staff_account_location_base;
revoke all on function private.complete_staff_account_location_base(uuid,uuid) from public,anon,authenticated;
create function public.complete_staff_account_creation(p_operation_key uuid,p_clinic_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.staff_account_creations; v_result jsonb;
begin
 perform private.require_capability(p_clinic_id,'admin.users');
 select * into c from private.staff_account_creations where operation_key=p_operation_key and clinic_id=p_clinic_id and created_by=auth.uid() for update;
 if not found then raise exception 'not found' using errcode='CV404'; end if;
 v_result:=private.complete_staff_account_location_base(p_operation_key,p_clinic_id);
 if c.result is null and nullif(btrim(c.payload->>'barangay'),'') is not null then
  update public.staff_memberships set barangay=btrim(c.payload->>'barangay'),city_municipality=btrim(c.payload->>'cityMunicipality') where id=(v_result->>'membershipId')::uuid and clinic_id=p_clinic_id;
  perform private.audit((select organization_id from public.clinics where id=p_clinic_id),'admin.users','staff.location_assigned','staff_membership',(v_result->>'membershipId')::uuid,null,jsonb_build_object('barangay',btrim(c.payload->>'barangay'),'cityMunicipality',btrim(c.payload->>'cityMunicipality')),null);
 end if;
 return v_result;
end $$;

revoke all on function public.list_staff_memberships(uuid),public.update_staff_location(uuid,uuid,uuid,integer,text,text),public.prepare_staff_account_creation(uuid,uuid,jsonb),public.complete_staff_account_creation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_staff_memberships(uuid),public.update_staff_location(uuid,uuid,uuid,integer,text,text),public.prepare_staff_account_creation(uuid,uuid,jsonb),public.complete_staff_account_creation(uuid,uuid) to authenticated;
