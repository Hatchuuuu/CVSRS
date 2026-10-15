-- Scoped staff observations for a child. Notes are append-only; corrections are new notes, preserving authorship and audit history.
create table public.child_staff_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  clinic_id uuid not null references public.clinics(id),
  child_id uuid not null references public.children(id),
  event_id uuid references public.vaccination_events(id),
  category text not null check (category in ('post_vaccination','follow_up','intake','operational')),
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  family_visible boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index child_staff_notes_child_idx on public.child_staff_notes (child_id, created_at desc);
alter table public.child_staff_notes enable row level security;
revoke all on public.child_staff_notes from anon, authenticated;

create function public.add_child_note(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_category text, p_note text, p_family_visible boolean default true, p_event_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_prev jsonb; v_cap text;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null or not private.child_in_clinic(p_child_id, p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  v_cap := case p_category when 'post_vaccination' then 'vaccination.record' when 'follow_up' then 'bhw.followup' when 'intake' then 'child.register' else 'admin.users' end;
  if p_category = 'follow_up' and private.has_capability(p_clinic_id, 'vaccination.record') then v_cap := 'vaccination.record'; end if;
  perform private.require_capability(p_clinic_id, v_cap);
  if p_category not in ('post_vaccination','follow_up','intake','operational') or char_length(btrim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'check the note details' using errcode = 'CV422'; end if;
  if p_event_id is not null and not exists (select 1 from public.vaccination_events where id=p_event_id and child_id=p_child_id and organization_id=v_org) then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'child.note.add', jsonb_build_object('clinic',p_clinic_id,'child',p_child_id,'category',p_category,'note',btrim(p_note),'visible',p_family_visible,'event',p_event_id));
  if v_prev is not null then return v_prev; end if;
  insert into public.child_staff_notes(organization_id,clinic_id,child_id,event_id,category,note,family_visible,created_by)
  values(v_org,p_clinic_id,p_child_id,p_event_id,p_category,btrim(p_note),p_family_visible,auth.uid()) returning id into v_id;
  perform private.audit(v_org,v_cap,'child.note_added','child_staff_note',v_id,null,jsonb_build_object('childId',p_child_id,'category',p_category,'familyVisible',p_family_visible),null);
  return private.finish_command(v_org,p_operation_key,jsonb_build_object('noteId',v_id));
end $$;

create function public.list_child_notes(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_result jsonb;
begin
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  if v_org is null or not private.child_in_clinic(p_child_id,p_clinic_id) then raise exception 'not found' using errcode='CV404'; end if;
  if not (private.has_capability(p_clinic_id,'child.search') or private.has_capability(p_clinic_id,'bhw.followup')) then raise exception 'forbidden' using errcode='CV403'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('noteId',n.id,'category',n.category,'note',n.note,'familyVisible',n.family_visible,'eventId',n.event_id,'createdAt',n.created_at,'authorName',p.display_name) order by n.created_at desc),'[]'::jsonb)
  into v_result from public.child_staff_notes n join public.profiles p on p.id=n.created_by where n.organization_id=v_org and n.clinic_id=p_clinic_id and n.child_id=p_child_id;
  return v_result;
end $$;

create function public.guardian_child_notes(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.guardian_can_read_child(p_child_id) then raise exception 'not found' using errcode='CV404'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('noteId',n.id,'category',n.category,'note',n.note,'createdAt',n.created_at,'authorName',p.display_name,'clinicName',c.name) order by n.created_at desc),'[]'::jsonb)
  into v_result from public.child_staff_notes n join public.profiles p on p.id=n.created_by join public.clinics c on c.id=n.clinic_id where n.child_id=p_child_id and n.family_visible;
  return v_result;
end $$;

revoke all on function public.add_child_note(uuid,uuid,uuid,text,text,boolean,uuid), public.list_child_notes(uuid,uuid), public.guardian_child_notes(uuid) from public, anon, authenticated;
grant execute on function public.add_child_note(uuid,uuid,uuid,text,text,boolean,uuid), public.list_child_notes(uuid,uuid), public.guardian_child_notes(uuid) to authenticated;
