-- Match merge and transfer lock order before touching a card submission.
alter function public.review_card_submission(uuid,uuid,uuid,text,text,integer,jsonb) set schema private;
alter function private.review_card_submission(uuid,uuid,uuid,text,text,integer,jsonb) rename to review_card_submission_impl;
revoke all on function private.review_card_submission_impl(uuid,uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated;
create function public.review_card_submission(p_operation_key uuid,p_clinic_id uuid,p_submission_id uuid,p_decision text,p_note text,p_expected_version integer,p_reviewed_rows jsonb default '[]') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_child uuid;
begin
  perform private.require_capability(p_clinic_id,'evidence.verify');
  select child_id into v_child from public.card_submissions where id=p_submission_id and clinic_id=p_clinic_id;
  if v_child is null then raise exception 'not found' using errcode='CV404'; end if;
  perform 1 from public.children where id=v_child for share;
  if not exists(select 1 from public.card_submissions where id=p_submission_id and child_id=v_child and clinic_id=p_clinic_id) then
    raise exception 'submission changed; reload' using errcode='CV409';
  end if;
  return private.review_card_submission_impl(p_operation_key,p_clinic_id,p_submission_id,p_decision,p_note,p_expected_version,p_reviewed_rows);
end $$;
revoke all on function public.review_card_submission(uuid,uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.review_card_submission(uuid,uuid,uuid,text,text,integer,jsonb) to authenticated;
