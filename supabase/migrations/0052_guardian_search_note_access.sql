create or replace function public.staff_search_children(p_clinic_id uuid,p_query text,p_dob date default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_q text:=private.norm_name(p_query); v_like text; v_res jsonb; v_lim int:=least(greatest(coalesce(p_limit,20),1),25);
begin
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  if v_org is null then raise exception 'forbidden' using errcode='CV403'; end if;
  perform private.require_capability(p_clinic_id,'child.search');
  if length(v_q)<2 and p_dob is null then raise exception 'query too short' using errcode='CV422'; end if;
  if char_length(coalesce(p_query,''))>200 then raise exception 'query too long' using errcode='CV422'; end if;
  v_like:='%'||replace(replace(replace(v_q,'\','\\'),'%','\%'),'_','\_')||'%';
  select coalesce(jsonb_agg(x order by (x->>'rank')::real desc,x->>'displayName'),'[]'::jsonb) into v_res from (
    select jsonb_build_object('childId',c.id,'displayName',c.display_name,'localRecordNo',c.local_record_no,'dob',c.dob,'dobPrecision',c.birth_date_precision,'recordStatus',c.record_status,
      'rank',greatest(extensions.similarity(c.search_name,v_q),case when c.search_name like v_like then 0.9 else 0 end,case when upper(btrim(p_query))=c.local_record_no then 1 else 0 end,coalesce(g.score,0))) x
    from public.children c
    left join lateral (
      select max(case when private.norm_name(gu.full_name) like v_like then 0.9 when private.has_capability(p_clinic_id,'guardian.verify') and (private.norm_name(coalesce(gu.contact_email,'')) like v_like or private.norm_name(coalesce(gu.contact_phone,'')) like v_like) then 0.8 else 0 end) score
      from public.guardian_child_relationships r join public.guardians gu on gu.id=r.guardian_id and gu.organization_id=c.organization_id
      where r.child_id=c.id and r.status in ('provisional','active') and (r.ends_at is null or r.ends_at>now()) and gu.deleted_at is null
    ) g on true
    where c.organization_id=v_org and c.record_status in ('provisional','active','inactive')
      and exists(select 1 from public.child_clinic_enrollments e where e.child_id=c.id and e.clinic_id=p_clinic_id and e.status in ('pending','active'))
      and (p_dob is null or c.dob=p_dob)
      and (length(v_q)<2 or c.search_name like v_like or extensions.similarity(c.search_name,v_q)>=0.3 or upper(btrim(p_query))=c.local_record_no or coalesce(g.score,0)>0)
    order by greatest(extensions.similarity(c.search_name,v_q),case when c.search_name like v_like then 0.9 else 0 end,case when upper(btrim(p_query))=c.local_record_no then 1 else 0 end,coalesce(g.score,0)) desc,c.display_name,c.id
    limit v_lim
  ) s;
  perform private.audit(v_org,'child.search','child.search','clinic',p_clinic_id,null,jsonb_build_object('queryLength',length(v_q),'withDob',p_dob is not null,'results',jsonb_array_length(v_res)),null);
  return v_res;
end $$;

create or replace function public.guardian_child_notes(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.guardian_has_full_access(p_child_id) or not private.session_ok() then raise exception 'not found' using errcode='CV404'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('noteId',n.id,'category',n.category,'note',n.note,'createdAt',n.created_at,'authorName',p.display_name,'clinicName',c.name) order by n.created_at desc) from public.child_staff_notes n join public.profiles p on p.id=n.created_by join public.clinics c on c.id=n.clinic_id where n.child_id=p_child_id and n.family_visible),'[]'::jsonb);
end $$;

create or replace function public.list_child_notes(p_clinic_id uuid,p_child_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_clinical boolean;
begin
  perform private.require_capability(p_clinic_id,'child.search');
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  if v_org is null or not private.child_in_clinic(p_child_id,p_clinic_id) then raise exception 'not found' using errcode='CV404'; end if;
  v_clinical:=private.has_capability(p_clinic_id,'child.read_clinical');
  return coalesce((select jsonb_agg(jsonb_build_object('noteId',n.id,'category',n.category,'note',n.note,'familyVisible',n.family_visible,'eventId',n.event_id,'createdAt',n.created_at,'authorName',p.display_name) order by n.created_at desc) from public.child_staff_notes n join public.profiles p on p.id=n.created_by where n.organization_id=v_org and n.clinic_id=p_clinic_id and n.child_id=p_child_id and (v_clinical or n.category<>'post_vaccination')),'[]'::jsonb);
end $$;
