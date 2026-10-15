-- 0010 Product picker for clinical recording forms (active products only, no configuration data).

create function public.list_active_products(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['evidence.verify','vaccination.record','inventory.manage','rules.propose','rules.approve']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name,
      'antigens', coalesce((select jsonb_agg(a.code order by a.code) from public.product_antigens pa join public.antigens a on a.id = pa.antigen_id where pa.product_id = p.id), '[]'::jsonb)) order by p.name)
    from public.vaccine_products p where p.organization_id = v_org and p.status = 'active'), '[]'::jsonb);
end $$;
revoke all on function public.list_active_products(uuid) from public, anon, authenticated;
grant execute on function public.list_active_products(uuid) to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
