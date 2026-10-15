-- Pending work must not disappear behind bounded history windows.
-- Keep existing authorization and immutable records; expose actor IDs only to the
-- same authorized inventory readers so the UI can explain two-person decisions.

create or replace function public.list_stock_transfers(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['inventory.manage','inventory.approve']);
  return jsonb_build_object(
    'outgoing', coalesce((select jsonb_agg(private.transfer_json(t) || jsonb_build_object('sentBy', t.sent_by) order by t.sent_at desc, t.id)
      from (
        select pending.* from public.stock_transfers pending
         where pending.from_clinic_id = p_clinic_id and pending.status in ('in_transit','received_short')
        union all
        (select closed.* from public.stock_transfers closed
          where closed.from_clinic_id = p_clinic_id and closed.status not in ('in_transit','received_short')
          order by closed.sent_at desc, closed.id limit 50)
      ) t), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(private.transfer_json(t) || jsonb_build_object('sentBy', t.sent_by) order by t.sent_at desc, t.id)
      from (
        select pending.* from public.stock_transfers pending
         where pending.to_clinic_id = p_clinic_id and pending.status in ('in_transit','received_short')
        union all
        (select closed.* from public.stock_transfers closed
          where closed.to_clinic_id = p_clinic_id and closed.status not in ('in_transit','received_short')
          order by closed.sent_at desc, closed.id limit 50)
      ) t), '[]'::jsonb),
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
      from public.clinics c where c.organization_id = v_org and c.status = 'active' and c.id <> p_clinic_id), '[]'::jsonb));
end $$;

create or replace function public.list_temperature(p_clinic_id uuid, p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_days int := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['inventory.manage','inventory.approve']);
  return jsonb_build_object(
    'limits', (select jsonb_build_object('minC', l.min_c, 'maxC', l.max_c, 'policyReference', l.policy_reference, 'setAt', l.set_at)
      from public.cold_chain_limits l where l.clinic_id = p_clinic_id order by l.set_at desc limit 1),
    'readings', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'location', s.name, 'locationId', r.location_id,
        'observedAt', r.observed_at, 'minC', r.min_c, 'maxC', r.max_c, 'status', r.status, 'note', r.note,
        'limitMinC', r.limit_min_c, 'limitMaxC', r.limit_max_c, 'recordedBy', r.recorded_by,
        'reviewed', rv.reading_id is not null, 'reviewAction', rv.action, 'reviewNote', rv.note) order by r.observed_at desc, r.id)
      from public.temperature_readings r
      join public.stock_locations s on s.id = r.location_id
      left join public.temperature_reviews rv on rv.reading_id = r.id
      where r.clinic_id = p_clinic_id
        and (r.observed_at >= now() - make_interval(days => v_days) or (r.status = 'excursion' and rv.reading_id is null))), '[]'::jsonb),
    'openExcursions', (select count(*) from public.temperature_readings r
      where r.clinic_id = p_clinic_id and r.status = 'excursion'
        and not exists (select 1 from public.temperature_reviews rv where rv.reading_id = r.id)));
end $$;
