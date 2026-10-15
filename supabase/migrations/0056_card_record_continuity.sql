-- Merge relinks note ownership only; the original content, author, role and time remain immutable.
create function private.note_change_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (to_jsonb(new)-'child_id')=(to_jsonb(old)-'child_id') and new.child_id<>old.child_id and new.child_id=private.canonical_child(old.child_id) then return new; end if;
  raise exception 'notes are immutable' using errcode='CV403';
end $$;
revoke all on function private.note_change_guard() from public,anon,authenticated;
drop trigger child_staff_notes_immutable on public.child_staff_notes;
create trigger child_staff_notes_immutable before update or delete on public.child_staff_notes for each row execute function private.note_change_guard();

create function private.card_note_merge_continuity() returns trigger language plpgsql security definer set search_path='' as $$
declare v_cards int; v_notes int;
begin
  update public.card_submissions set child_id=new.merged_into_id where child_id=new.id;
  get diagnostics v_cards=row_count;
  update public.child_staff_notes set child_id=new.merged_into_id where child_id=new.id;
  get diagnostics v_notes=row_count;
  if v_cards>0 or v_notes>0 then
    perform private.audit(new.organization_id,'review.resolve','child.card_notes_merged','child',new.id,null,jsonb_build_object('survivorId',new.merged_into_id,'cards',v_cards,'notes',v_notes),null);
  end if;
  return new;
end $$;
revoke all on function private.card_note_merge_continuity() from public,anon,authenticated;
create trigger children_card_notes_merge after update of merged_into_id on public.children for each row when(new.merged_into_id is not null and old.merged_into_id is distinct from new.merged_into_id) execute function private.card_note_merge_continuity();

create function private.card_transfer_continuity() returns trigger language plpgsql security definer set search_path='' as $$
declare v_count int;
begin
  update public.card_submissions set clinic_id=new.to_clinic_id,version=version+1,updated_at=now()
  where child_id=new.child_id and clinic_id=new.from_clinic_id and status in ('pending','changes_requested');
  get diagnostics v_count=row_count;
  if v_count>0 then
    perform private.audit(new.organization_id,'child.register','card.transfer_routed','record_transfer',new.id,null,jsonb_build_object('toClinicId',new.to_clinic_id,'cards',v_count),null);
  end if;
  return new;
end $$;
revoke all on function private.card_transfer_continuity() from public,anon,authenticated;
create trigger record_transfers_card_route after update of status on public.record_transfers for each row when(new.status='completed' and old.status is distinct from new.status) execute function private.card_transfer_continuity();

-- Share the merge/transfer child lock before final routing, so an in-flight draft cannot be inserted into an obsolete record.
create function private.card_write_route() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.children where id=private.canonical_child(new.child_id) for share;
  if tg_op='INSERT' or (new.rows is distinct from old.rows) then
    new.child_id:=private.canonical_child(new.child_id);
    if new.submitted_by<>auth.uid() or not private.guardian_can_read_child(new.child_id) then raise exception 'not found' using errcode='CV404'; end if;
    select clinic_id into new.clinic_id from public.child_clinic_enrollments where child_id=new.child_id and status in ('pending','active') order by is_primary desc,created_at limit 1;
    if new.clinic_id is null then raise exception 'a clinic is required' using errcode='CV422'; end if;
  end if;
  return new;
end $$;
revoke all on function private.card_write_route() from public,anon,authenticated;
create trigger card_submissions_route before insert or update of rows,child_id,clinic_id on public.card_submissions for each row execute function private.card_write_route();

-- Acquire the child lock before the submission-row lock, matching merge and transfer command order.
alter function public.submit_card_record(uuid,uuid,jsonb,uuid,integer) set schema private;
alter function private.submit_card_record(uuid,uuid,jsonb,uuid,integer) rename to submit_card_record_impl;
revoke all on function private.submit_card_record_impl(uuid,uuid,jsonb,uuid,integer) from public,anon,authenticated;
create function public.submit_card_record(p_operation_key uuid,p_child_id uuid,p_rows jsonb,p_submission_id uuid default null,p_expected_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.children where id=p_child_id for share;
  return private.submit_card_record_impl(p_operation_key,p_child_id,p_rows,p_submission_id,p_expected_version);
end $$;
revoke all on function public.submit_card_record(uuid,uuid,jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function public.submit_card_record(uuid,uuid,jsonb,uuid,integer) to authenticated;

create function private.note_write_lock() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.children where id=new.child_id for share;
  if not private.child_in_clinic(new.child_id,new.clinic_id) then raise exception 'not found' using errcode='CV404'; end if;
  return new;
end $$;
revoke all on function private.note_write_lock() from public,anon,authenticated;
create trigger child_staff_notes_lock before insert on public.child_staff_notes for each row execute function private.note_write_lock();
