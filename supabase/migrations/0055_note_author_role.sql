alter table public.child_staff_notes add column author_role text;
create function private.stamp_note_role() returns trigger language plpgsql security definer set search_path='' as $$
declare v_cap text;
begin
  v_cap:=case new.category when 'post_vaccination' then 'vaccination.record' when 'follow_up' then case when private.has_capability(new.clinic_id,'vaccination.record') then 'vaccination.record' else 'bhw.followup' end else 'child.register' end;
  select m.role_code into new.author_role from public.staff_memberships m
  where m.profile_id=new.created_by and m.clinic_id=new.clinic_id and m.status='active' and m.valid_from<=now() and (m.valid_until is null or m.valid_until>now())
    and (v_cap=any(private.role_preset(m.role_code)) or v_cap=any(m.capabilities))
  order by m.created_at,m.id limit 1;
  return new;
end $$;
revoke all on function private.stamp_note_role() from public,anon,authenticated;
create trigger child_staff_notes_role before insert on public.child_staff_notes for each row execute function private.stamp_note_role();

create or replace function public.list_child_notes(p_clinic_id uuid,p_child_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_clinical boolean;
begin
  perform private.require_capability(p_clinic_id,'child.search');
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  if v_org is null or not private.child_in_clinic(p_child_id,p_clinic_id) then raise exception 'not found' using errcode='CV404'; end if;
  v_clinical:=private.has_capability(p_clinic_id,'child.read_clinical');
  return coalesce((select jsonb_agg(jsonb_build_object('noteId',n.id,'category',n.category,'note',n.note,'familyVisible',n.family_visible,'eventId',case when v_clinical then n.event_id end,'createdAt',n.created_at,'authorName',p.display_name,'authorRole',n.author_role) order by n.created_at desc) from public.child_staff_notes n join public.profiles p on p.id=n.created_by where n.organization_id=v_org and n.clinic_id=p_clinic_id and n.child_id=p_child_id and (v_clinical or n.category<>'post_vaccination')),'[]'::jsonb);
end $$;
create or replace function public.guardian_child_notes(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.guardian_has_full_access(p_child_id) or not private.session_ok() then raise exception 'not found' using errcode='CV404'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('noteId',n.id,'category',n.category,'note',n.note,'eventId',n.event_id,'createdAt',n.created_at,'authorName',p.display_name,'authorRole',n.author_role,'clinicName',c.name) order by n.created_at desc) from public.child_staff_notes n join public.profiles p on p.id=n.created_by join public.clinics c on c.id=n.clinic_id where n.child_id=p_child_id and n.family_visible),'[]'::jsonb);
end $$;
