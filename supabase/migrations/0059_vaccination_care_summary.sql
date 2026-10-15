-- Family-visible care instructions are part of the signed administration transaction.
alter table public.child_staff_notes drop constraint child_staff_notes_note_check;
alter table public.child_staff_notes add constraint child_staff_notes_note_check check(char_length(btrim(note)) between 3 and 4000);
alter table public.child_staff_notes add column administration_summary boolean not null default false;
alter table public.child_staff_notes add constraint administration_summary_event check(not administration_summary or (event_id is not null and category='post_vaccination'));
create unique index child_staff_notes_one_administration_summary on public.child_staff_notes(event_id) where administration_summary;

alter function public.record_administration(uuid,uuid,uuid,jsonb) set schema private;
alter function private.record_administration(uuid,uuid,uuid,jsonb) rename to record_administration_care_base;
revoke all on function private.record_administration_care_base(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
create function public.record_administration(p_operation_key uuid,p_clinic_id uuid,p_encounter_id uuid,p_admin jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_care jsonb:=p_admin->'care'; v_result jsonb; v_entry record; v_text text:=''; v_label text; v_child uuid; v_org uuid; v_product text; v_id uuid; v_event uuid;
begin
 perform private.require_capability(p_clinic_id,'vaccination.record');
 if v_care is not null then
  if jsonb_typeof(v_care)<>'object' then raise exception 'Check the care instructions.' using errcode='CV422'; end if;
  for v_entry in select key,value from jsonb_each(v_care) loop
   v_label:=case v_entry.key when 'medicines' then 'Medicine given or advised' when 'expectedEffects' then 'Side effects discussed' when 'observations' then 'Reactions or symptoms observed' when 'aftercare' then 'Home care instructions' when 'warningSigns' then 'When to seek medical help' when 'followUp' then 'Follow-up instructions' end;
   if v_label is null or jsonb_typeof(v_entry.value)<>'string' or char_length(btrim(v_entry.value#>>'{}'))>500 then raise exception 'Check the care instructions; each field accepts up to 500 characters.' using errcode='CV422'; end if;
  end loop;
 end if;
 select private.canonical_child(child_id) into v_child from public.encounters where id=p_encounter_id and clinic_id=p_clinic_id;
 perform 1 from public.children where id=v_child for share;
 v_result:=private.record_administration_care_base(p_operation_key,p_clinic_id,p_encounter_id,p_admin);
 if v_care is not null then
  for v_entry in select * from (values ('medicines','Medicine given or advised'),('expectedEffects','Side effects discussed'),('observations','Reactions or symptoms observed'),('aftercare','Home care instructions'),('warningSigns','When to seek medical help'),('followUp','Follow-up instructions')) as fields(key,label) loop
   if nullif(btrim(v_care->>v_entry.key),'') is not null then v_text:=v_text||E'\n\n'||v_entry.label||E':\n'||btrim(v_care->>v_entry.key); end if;
  end loop;
  if v_text<>'' then
   v_event:=(v_result->>'eventId')::uuid;
   select r.organization_id,r.child_id,p.name into v_org,v_child,v_product from private.current_revisions r join public.vaccine_products p on p.id=r.product_id where r.event_id=v_event;
   insert into public.child_staff_notes(organization_id,clinic_id,child_id,event_id,category,note,family_visible,created_by,administration_summary)
   values(v_org,p_clinic_id,v_child,v_event,'post_vaccination','Vaccination care summary'||E'\nVaccine given: '||v_product||v_text,true,auth.uid(),true)
   on conflict(event_id) where administration_summary do nothing returning id into v_id;
   if v_id is not null then perform private.audit(v_org,'vaccination.record','vaccination.care_shared','child_staff_note',v_id,null,jsonb_build_object('childId',v_child,'eventId',v_event,'care',v_care,'familyVisible',true),null); end if;
  end if;
 end if;
 return v_result;
end $$;
revoke all on function public.record_administration(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_administration(uuid,uuid,uuid,jsonb) to authenticated;
