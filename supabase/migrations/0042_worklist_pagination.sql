-- Keep existing result shapes and default calls; add paired keyset cursors to bounded worklists.
drop function public.my_messages(integer);
create function public.my_messages(p_limit integer default 50, p_before timestamptz default null, p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then return null; end if;
  if (p_before is null) <> (p_before_id is null) then raise exception 'incomplete paging cursor' using errcode = 'CV422'; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.messages where recipient_profile_id = auth.uid() and read_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'childId', x.child_id, 'createdAt', x.created_at, 'read', x.read_at is not null) order by x.created_at desc, x.id desc), '[]'::jsonb)
      from (select * from public.messages where recipient_profile_id = auth.uid()
        and (p_before is null or (created_at,id) < (p_before,p_before_id))
        order by created_at desc,id desc limit least(greatest(coalesce(p_limit,50),1),100)) x));
end $$;

drop function public.list_review_cases(uuid,text,integer);
create function public.list_review_cases(p_clinic_id uuid, p_status text default 'open', p_limit integer default 50,
  p_after timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  if not (private.has_capability(p_clinic_id,'guardian.verify') or private.has_capability(p_clinic_id,'review.resolve')
    or private.has_capability(p_clinic_id,'correction.approve') or private.has_capability(p_clinic_id,'inventory.approve')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  if (p_after is null) <> (p_after_id is null) then raise exception 'incomplete paging cursor' using errcode = 'CV422'; end if;
  select coalesce(jsonb_agg(s.x order by s.sort_at,s.sort_id),'[]'::jsonb) into v_res from (
    select jsonb_build_object('caseId',k.id,'kind',k.kind,'status',k.status,'reason',k.reason,'createdAt',k.created_at,'version',k.version,
      'evidence',k.evidence,'childId',k.child_id,'candidateChildId',k.candidate_child_id,'eventId',k.vaccination_event_id,'createdBy',k.created_by,
      'child',(select jsonb_build_object('displayName',c.display_name,'localRecordNo',c.local_record_no,'dob',c.dob) from public.children c where c.id=k.child_id),
      'candidate',(select jsonb_build_object('displayName',c.display_name,'localRecordNo',c.local_record_no,'dob',c.dob) from public.children c where c.id=k.candidate_child_id and private.child_in_clinic(c.id,p_clinic_id)),
      'guardianName',(select g.full_name from public.guardians g where g.id=k.guardian_id)) x,
      k.created_at sort_at,k.id sort_id
    from public.record_review_cases k where k.clinic_id=p_clinic_id and k.status=p_status
      and (p_after is null or (k.created_at,k.id) > (p_after,p_after_id))
    order by k.created_at,k.id limit least(greatest(coalesce(p_limit,50),1),100)) s;
  return v_res;
end $$;

drop function public.list_followup_worklist(uuid,text,integer);
create function public.list_followup_worklist(p_clinic_id uuid, p_filter text default 'behind', p_limit integer default 50,
  p_after_behind integer default null, p_after_due integer default null, p_after_name text default null, p_after_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_res jsonb; v_lim int := least(greatest(coalesce(p_limit,50),1),100); v_today date; v_contact boolean;
begin
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id,array['bhw.followup','child.read_clinical']);
  if p_filter not in ('behind','due','review','all') then raise exception 'unknown filter' using errcode = 'CV422'; end if;
  if num_nonnulls(p_after_behind,p_after_due,p_after_name,p_after_id) not in (0,4)
    or p_after_behind < 0 or p_after_due < 0 then raise exception 'invalid paging cursor' using errcode = 'CV422'; end if;
  v_today := private.local_today(p_clinic_id);
  v_contact := private.has_capability(p_clinic_id,'bhw.followup');
  select jsonb_build_object(
    'asOf',now(),
    'schedule',case when exists(select 1 from public.followup_snapshots where clinic_id=p_clinic_id and status='evaluated') then 'active' when exists(select 1 from public.followup_snapshots where clinic_id=p_clinic_id) then 'none' else 'unknown' end,
    'staleChildren',(select count(*) from public.children c join public.child_clinic_enrollments e on e.child_id=c.id and e.clinic_id=p_clinic_id and e.status='active'
      left join public.followup_snapshots s on s.child_id=c.id where c.merged_into_id is null and c.record_status='active' and private.followup_is_stale(c.organization_id,c.dob,v_today,s.computed_at,s.schedule_version_id,s.child_id is not null)),
    'items',coalesce((select jsonb_agg(x.item order by x.ord1 desc,x.ord2 desc,x.ord3,x.ord4) from (
      select jsonb_build_object('childId',c.id,'childName',c.display_name,'recordNo',c.local_record_no,'dob',c.dob,'behind',s.behind,'due',s.due,'review',s.review,'needs',s.needs,'computedAt',s.computed_at,
        'lastAttempt',(select jsonb_build_object('outcome',a.outcome,'at',a.recorded_at,'note',a.note,'nextTryOn',a.next_try_on) from public.followup_attempts a where a.child_id=c.id order by a.recorded_at desc limit 1),
        'attempts',(select count(*) from public.followup_attempts a where a.child_id=c.id),
        'guardian',(select jsonb_build_object('name',g.full_name,'phone',case when v_contact then g.contact_phone end,'phoneChecked',g.contact_verified_at is not null)
          from public.guardian_child_relationships r join public.guardians g on g.id=r.guardian_id where r.child_id=c.id and r.status='active' and g.deleted_at is null order by r.created_at limit 1)) item,
        s.behind ord1,s.due ord2,c.display_name ord3,c.id ord4
      from public.followup_snapshots s join public.children c on c.id=s.child_id
      where s.clinic_id=p_clinic_id and s.status='evaluated'
        and ((p_filter='behind' and s.behind>0) or (p_filter='due' and s.due>0) or (p_filter='review' and s.review>0) or (p_filter='all' and (s.behind+s.due+s.review)>0))
        and not exists(select 1 from public.followup_attempts a where a.child_id=c.id and a.next_try_on>v_today and a.recorded_at=(select max(a2.recorded_at) from public.followup_attempts a2 where a2.child_id=c.id))
        and (p_after_id is null or (-s.behind,-s.due,c.display_name,c.id) > (-p_after_behind,-p_after_due,p_after_name,p_after_id))
      order by s.behind desc,s.due desc,c.display_name,c.id limit v_lim) x),'[]'::jsonb)) into v_res;
  perform private.audit(v_org,case when v_contact then 'bhw.followup' else 'child.read_clinical' end,'followup.listed','clinic',p_clinic_id,null,jsonb_build_object('filter',p_filter,'shown',jsonb_array_length(v_res->'items')),null);
  return v_res;
end $$;

create index messages_inbox_paging_idx on public.messages(recipient_profile_id,created_at desc,id desc);
create index review_cases_paging_idx on public.record_review_cases(clinic_id,status,created_at,id);
revoke all on function public.my_messages(integer,timestamptz,uuid), public.list_review_cases(uuid,text,integer,timestamptz,uuid),
  public.list_followup_worklist(uuid,text,integer,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.my_messages(integer,timestamptz,uuid), public.list_review_cases(uuid,text,integer,timestamptz,uuid),
  public.list_followup_worklist(uuid,text,integer,integer,integer,text,uuid) to authenticated;
