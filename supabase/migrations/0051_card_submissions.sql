-- Family card drafts remain separate from approved clinical history, including before guardian verification.
create table public.card_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  clinic_id uuid not null references public.clinics(id),
  child_id uuid not null references public.children(id),
  submitted_by uuid not null references public.profiles(id),
  rows jsonb not null check (jsonb_typeof(rows)='array' and jsonb_array_length(rows) between 1 and 20),
  status text not null default 'pending' check (status in ('pending','changes_requested','approved','rejected','withdrawn')),
  version integer not null default 1,
  decision_note text,
  decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index card_submissions_clinic_idx on public.card_submissions(clinic_id,status,created_at);
alter table public.card_submissions enable row level security;
revoke all on public.card_submissions from anon,authenticated;

create function public.submit_card_record(p_operation_key uuid,p_child_id uuid,p_rows jsonb,p_submission_id uuid default null,p_expected_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_clinic uuid; v_prev jsonb; v_id uuid; v_row jsonb; v_old public.card_submissions;
begin
  if not private.guardian_can_read_child(p_child_id) then raise exception 'not found' using errcode='CV404'; end if;
  select organization_id into v_org from public.children where id=p_child_id;
  select clinic_id into v_clinic from public.child_clinic_enrollments where child_id=p_child_id and status in ('pending','active') order by is_primary desc,created_at limit 1;
  if v_clinic is null then raise exception 'a clinic is required' using errcode='CV422'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 20 or octet_length(p_rows::text)>40000 then raise exception 'enter 1 to 20 card rows' using errcode='CV422'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) is distinct from 'object' then raise exception 'invalid card row' using errcode='CV422'; end if;
    perform private.clean_outside_dose(v_row);
    if char_length(coalesce(v_row->>'doseLabel',''))>40 or char_length(coalesce(v_row->>'notes',''))>500 or coalesce(v_row->>'source','manual') not in ('manual','ocr') then raise exception 'invalid card row' using errcode='CV422'; end if;
  end loop;
  v_prev:=private.begin_command(v_org,p_operation_key,'card.submit',jsonb_build_object('child',p_child_id,'rows',p_rows,'submission',p_submission_id,'version',p_expected_version));
  if v_prev is not null then return v_prev; end if;
  if p_submission_id is not null then
    select * into v_old from public.card_submissions where id=p_submission_id and child_id=p_child_id and submitted_by=auth.uid() for update;
    if not found then raise exception 'not found' using errcode='CV404'; end if;
    if v_old.status<>'changes_requested' or v_old.version is distinct from p_expected_version then raise exception 'submission changed; reload' using errcode='CV409'; end if;
    update public.card_submissions set rows=p_rows,status='pending',version=version+1,updated_at=now() where id=v_old.id returning id into v_id;
  else
    insert into public.card_submissions(organization_id,clinic_id,child_id,submitted_by,rows) values(v_org,v_clinic,p_child_id,auth.uid(),p_rows) returning id into v_id;
  end if;
  perform private.audit(v_org,'guardian','card.submitted','card_submission',v_id,to_jsonb(v_old),jsonb_build_object('rows',p_rows,'status','pending'),null);
  return private.finish_command(v_org,p_operation_key,jsonb_build_object('submissionId',v_id,'status','pending'));
end $$;

create function public.guardian_list_card_submissions(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.guardian_can_read_child(p_child_id) then raise exception 'not found' using errcode='CV404'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('submissionId',s.id,'rows',s.rows,'status',s.status,'version',s.version,'decisionNote',s.decision_note,'createdAt',s.created_at) order by s.created_at desc) from public.card_submissions s where s.child_id=p_child_id and s.submitted_by=auth.uid()),'[]'::jsonb);
end $$;

create function public.staff_list_card_submissions(p_clinic_id uuid,p_child_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_capability(p_clinic_id,'child.read_clinical');
  if not private.child_in_clinic(p_child_id,p_clinic_id) then raise exception 'not found' using errcode='CV404'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('submissionId',s.id,'rows',s.rows,'status',s.status,'version',s.version,'decisionNote',s.decision_note,'createdAt',s.created_at) order by s.created_at desc) from public.card_submissions s where s.child_id=p_child_id and s.clinic_id=p_clinic_id),'[]'::jsonb);
end $$;

create function public.review_card_submission(p_operation_key uuid,p_clinic_id uuid,p_submission_id uuid,p_decision text,p_note text,p_expected_version integer,p_reviewed_rows jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.card_submissions; v_prev jsonb; v_row jsonb; v_events jsonb:='[]'; v_result jsonb;
begin
  perform private.require_capability(p_clinic_id,'evidence.verify');
  select * into s from public.card_submissions where id=p_submission_id and clinic_id=p_clinic_id for update;
  if not found or not private.child_in_clinic(s.child_id,p_clinic_id) then raise exception 'not found' using errcode='CV404'; end if;
  v_prev:=private.begin_command(s.organization_id,p_operation_key,'card.review',jsonb_build_object('submission',p_submission_id,'decision',p_decision,'note',p_note,'version',p_expected_version,'rows',p_reviewed_rows));
  if v_prev is not null then return v_prev; end if;
  if s.status<>'pending' or s.version<>p_expected_version then raise exception 'submission changed; reload' using errcode='CV409'; end if;
  if s.submitted_by=auth.uid() then raise exception 'the submitter cannot review their own card' using errcode='CV403'; end if;
  if p_decision not in ('approved','rejected','changes_requested') or char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then raise exception 'choose a decision and write a review note' using errcode='CV422'; end if;
  if p_decision='approved' then
    if jsonb_typeof(p_reviewed_rows) is distinct from 'array' or jsonb_array_length(p_reviewed_rows)<>jsonb_array_length(s.rows) then raise exception 'review every card row' using errcode='CV422'; end if;
    for v_row in select value from jsonb_array_elements(p_reviewed_rows) loop
      v_result:=public.record_outside_dose_staff(gen_random_uuid(),p_clinic_id,s.child_id,v_row||jsonb_build_object('precision','exact'),nullif(v_row->>'productId','')::uuid,true);
      v_events:=v_events||jsonb_build_array(v_result->>'eventId');
    end loop;
  end if;
  update public.card_submissions set status=p_decision,decision_note=btrim(p_note),decided_by=auth.uid(),version=version+1,updated_at=now() where id=s.id;
  perform private.audit(s.organization_id,'evidence.verify','card.reviewed','card_submission',s.id,to_jsonb(s),jsonb_build_object('status',p_decision,'reviewedRows',p_reviewed_rows,'events',v_events),p_note);
  return private.finish_command(s.organization_id,p_operation_key,jsonb_build_object('submissionId',s.id,'status',p_decision,'events',v_events));
end $$;

create function public.withdraw_card_submission(p_operation_key uuid,p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.card_submissions; v_prev jsonb;
begin
  select * into s from public.card_submissions where id=p_submission_id and submitted_by=auth.uid() for update;
  if not found or not private.guardian_can_read_child(s.child_id) then raise exception 'not found' using errcode='CV404'; end if;
  v_prev:=private.begin_command(s.organization_id,p_operation_key,'card.withdraw',jsonb_build_object('submission',p_submission_id));
  if v_prev is not null then return v_prev; end if;
  if s.status not in ('pending','changes_requested') then raise exception 'already decided' using errcode='CV409'; end if;
  update public.card_submissions set status='withdrawn',version=version+1,updated_at=now() where id=s.id;
  perform private.audit(s.organization_id,'guardian','card.withdrawn','card_submission',s.id,to_jsonb(s),jsonb_build_object('status','withdrawn'),null);
  return private.finish_command(s.organization_id,p_operation_key,jsonb_build_object('status','withdrawn'));
end $$;

revoke all on function public.submit_card_record(uuid,uuid,jsonb,uuid,integer),public.guardian_list_card_submissions(uuid),public.staff_list_card_submissions(uuid,uuid),public.review_card_submission(uuid,uuid,uuid,text,text,integer,jsonb),public.withdraw_card_submission(uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_card_record(uuid,uuid,jsonb,uuid,integer),public.guardian_list_card_submissions(uuid),public.staff_list_card_submissions(uuid,uuid),public.review_card_submission(uuid,uuid,uuid,text,text,integer,jsonb),public.withdraw_card_submission(uuid,uuid) to authenticated;

-- Fix the prior note function's event-child check: event ownership is represented by current revisions.
create or replace function public.add_child_note(p_operation_key uuid,p_clinic_id uuid,p_child_id uuid,p_category text,p_note text,p_family_visible boolean default true,p_event_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_id uuid; v_prev jsonb; v_cap text;
begin
  select organization_id into v_org from public.clinics where id=p_clinic_id;
  if v_org is null or not private.child_in_clinic(p_child_id,p_clinic_id) then raise exception 'not found' using errcode='CV404'; end if;
  v_cap:=case p_category when 'post_vaccination' then 'vaccination.record' when 'follow_up' then 'bhw.followup' else 'child.register' end;
  if p_category='follow_up' and private.has_capability(p_clinic_id,'vaccination.record') then v_cap:='vaccination.record'; end if;
  perform private.require_capability(p_clinic_id,v_cap);
  if p_category not in ('post_vaccination','follow_up','intake','operational') or char_length(btrim(coalesce(p_note,''))) not between 3 and 1000 or p_family_visible is null then raise exception 'check the note details' using errcode='CV422'; end if;
  if p_event_id is not null and not exists(select 1 from private.current_revisions where event_id=p_event_id and child_id=p_child_id and organization_id=v_org) then raise exception 'not found' using errcode='CV404'; end if;
  v_prev:=private.begin_command(v_org,p_operation_key,'child.note.add',jsonb_build_object('clinic',p_clinic_id,'child',p_child_id,'category',p_category,'note',btrim(p_note),'visible',p_family_visible,'event',p_event_id));
  if v_prev is not null then return v_prev; end if;
  insert into public.child_staff_notes(organization_id,clinic_id,child_id,event_id,category,note,family_visible,created_by) values(v_org,p_clinic_id,p_child_id,p_event_id,p_category,btrim(p_note),p_family_visible,auth.uid()) returning id into v_id;
  perform private.audit(v_org,v_cap,'child.note_added','child_staff_note',v_id,null,jsonb_build_object('childId',p_child_id,'category',p_category,'familyVisible',p_family_visible,'note',btrim(p_note)),null);
  return private.finish_command(v_org,p_operation_key,jsonb_build_object('noteId',v_id));
end $$;
create trigger child_staff_notes_immutable before update or delete on public.child_staff_notes for each row execute function private.forbid_change();
