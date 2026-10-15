-- Keep inactive records discoverable so staff can read their history and reactivate a returning child's existing record.
-- Rank the full matching set before applying the existing result limit.
create or replace function public.staff_search_children(p_clinic_id uuid, p_query text, p_dob date default null, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_q text := private.norm_name(p_query); v_like text; v_res jsonb; v_lim int := least(greatest(coalesce(p_limit, 20), 1), 25);
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'forbidden' using errcode = 'CV403'; end if;
  perform private.require_capability(p_clinic_id, 'child.search');
  if length(v_q) < 2 and p_dob is null then raise exception 'query too short' using errcode = 'CV422'; end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(x order by (x ->> 'rank')::real desc, x ->> 'displayName'), '[]'::jsonb) into v_res from (
    select jsonb_build_object('childId', c.id, 'displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob,
                              'dobPrecision', c.birth_date_precision, 'recordStatus', c.record_status,
                              'rank', greatest(extensions.similarity(c.search_name, v_q), case when c.search_name like v_like then 0.9 else 0 end,
                                               case when upper(btrim(p_query)) = c.local_record_no then 1 else 0 end)) x
      from public.children c
     where c.record_status in ('provisional','active','inactive')
       and exists (select 1 from public.child_clinic_enrollments e where e.child_id = c.id and e.clinic_id = p_clinic_id and e.status in ('pending','active'))
       and (p_dob is null or c.dob = p_dob)
       and (length(v_q) < 2 or c.search_name like v_like or extensions.similarity(c.search_name, v_q) >= 0.3 or upper(btrim(p_query)) = c.local_record_no)
     order by greatest(extensions.similarity(c.search_name, v_q), case when c.search_name like v_like then 0.9 else 0 end,
                       case when upper(btrim(p_query)) = c.local_record_no then 1 else 0 end) desc, c.display_name, c.id
     limit v_lim) s;
  perform private.audit(v_org, 'child.search', 'child.search', 'clinic', p_clinic_id, null,
                        jsonb_build_object('queryLength', length(v_q), 'withDob', p_dob is not null, 'results', jsonb_array_length(v_res)), null);
  return v_res;
end $$;
