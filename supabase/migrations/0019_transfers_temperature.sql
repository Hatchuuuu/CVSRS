-- 0019 Stock transfers with in-transit custody, and temperature logs. Blueprint refs: F13, F14, BP19, M09 (inventory intelligence).
--  * A transfer is two ledger transactions: SEND moves stock from a usable location into the sender's "In transit" location
--    (nothing disappears from the books while it travels); RECEIVE moves it from transit into the receiver's location.
--  * A short delivery leaves the missing units visibly in transit and opens a review case; a person then decides "write off" or "return".
--  * Cold-chain limits are POLICY: none exist until an approver records them with a policy reference. Readings are always kept; they are
--    only judged against limits that someone approved. Nothing is quarantined automatically: an excursion is flagged for a person to decide.

-- ---------------------------------------------------------------------------------------------
-- Report correction: a transfer spans two clinics, so the ledger for a clinic is what moved in ITS locations.
-- ---------------------------------------------------------------------------------------------
create or replace function public.report_stock_summary(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id); v_tz text; v_rows jsonb;
begin
  perform private.report_range(p_clinic_id, p_from, p_to);
  select timezone into v_tz from public.clinics where id = p_clinic_id;
  select coalesce(jsonb_agg(jsonb_build_object('productCode', p.code, 'product', p.name, 'lot', l.manufacturer_lot, 'expiresOn', l.expires_on, 'disposition', l.global_disposition,
           'received', x.received, 'issued', x.issued, 'wastage', x.wastage, 'adjustments', x.adjustments, 'onHand', x.on_hand, 'ledgerTotal', x.ledger_total,
           'reconciles', x.on_hand = x.ledger_total) order by p.name, l.expires_on, l.manufacturer_lot), '[]'::jsonb) into v_rows
    from (select m.lot_id,
            coalesce(sum(m.quantity_delta) filter (where t.type = 'receipt' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) received,
            -coalesce(sum(m.quantity_delta) filter (where t.type in ('issue_administration') and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0)
              - coalesce(sum(m.quantity_delta) filter (where t.type = 'reversal' and t.reason like 'correction:%' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) issued,
            -coalesce(sum(m.quantity_delta) filter (where t.type = 'wastage' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) wastage,
            coalesce(sum(m.quantity_delta) filter (where t.type = 'adjustment' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) adjustments,
            coalesce((select sum(b.on_hand) from public.stock_balances b join public.stock_locations s2 on s2.id = b.location_id where b.lot_id = m.lot_id and s2.clinic_id = p_clinic_id), 0) on_hand,
            sum(m.quantity_delta) ledger_total
            from public.stock_movements m join public.stock_transactions t on t.id = m.transaction_id join public.stock_locations s on s.id = m.location_id
           where s.clinic_id = p_clinic_id group by m.lot_id) x
    join public.vaccine_lots l on l.id = x.lot_id join public.vaccine_products p on p.id = l.product_id;
  if not p_export then perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'stock_summary', 'from', p_from, 'to', p_to), null); end if;
  return jsonb_build_object('report', 'stock_summary', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', false, 'definitions', private.report_definitions(), 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------------------------
create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  from_clinic_id uuid not null,
  to_clinic_id uuid not null,
  lot_id uuid not null,
  from_location_id uuid not null references public.stock_locations (id),
  transit_location_id uuid not null references public.stock_locations (id),
  to_location_id uuid references public.stock_locations (id),
  quantity_sent numeric not null check (quantity_sent > 0),
  quantity_received numeric check (quantity_received > 0),
  status text not null default 'in_transit' check (status in ('in_transit','received','received_short','cancelled','closed_written_off','closed_returned')),
  reference text not null,
  note text,
  sent_by uuid not null references public.profiles (id),
  sent_at timestamptz not null default now(),
  received_by uuid references public.profiles (id),
  received_at timestamptz,
  resolution_note text,
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  review_case_id uuid,
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, from_clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, to_clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, lot_id) references public.vaccine_lots (organization_id, id),
  check (from_clinic_id <> to_clinic_id),
  check (quantity_received is null or quantity_received <= quantity_sent),
  unique (organization_id, reference)
);
create index stock_transfers_from_idx on public.stock_transfers (from_clinic_id, status);
create index stock_transfers_to_idx on public.stock_transfers (to_clinic_id, status);
create trigger stock_transfers_no_delete before delete on public.stock_transfers for each row execute function private.forbid_change();
create trigger stock_transfers_no_truncate before truncate on public.stock_transfers for each statement execute function private.forbid_change();
alter table public.stock_transfers enable row level security;
revoke all on public.stock_transfers from anon, authenticated;

create function private.transit_location(p_org uuid, p_clinic uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.stock_locations where clinic_id = p_clinic and kind = 'in_transit' and status = 'active' order by created_at limit 1;
  if v_id is null then
    insert into public.stock_locations (organization_id, clinic_id, name, kind, created_by, updated_by) values (p_org, p_clinic, 'In transit', 'in_transit', auth.uid(), auth.uid())
    on conflict (clinic_id, name) do nothing;
    select id into v_id from public.stock_locations where clinic_id = p_clinic and kind = 'in_transit' order by created_at limit 1;
  end if;
  return v_id;
end $$;

create function private.transfer_json(t public.stock_transfers) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'reference', t.reference, 'status', t.status, 'fromClinicId', t.from_clinic_id, 'toClinicId', t.to_clinic_id,
    'fromClinic', (select name from public.clinics where id = t.from_clinic_id), 'toClinic', (select name from public.clinics where id = t.to_clinic_id),
    'lotId', t.lot_id, 'lot', l.manufacturer_lot, 'product', p.name, 'productCode', p.code, 'expiresOn', l.expires_on, 'stockUnit', p.stock_unit,
    'quantitySent', t.quantity_sent, 'quantityReceived', t.quantity_received, 'shortfall', case when t.status = 'received_short' then t.quantity_sent - t.quantity_received else null end,
    'sentAt', t.sent_at, 'receivedAt', t.received_at, 'note', t.note, 'resolutionNote', t.resolution_note)
    from public.vaccine_lots l join public.vaccine_products p on p.id = l.product_id where l.id = t.lot_id
$$;

create function public.send_stock_transfer(p_operation_key uuid, p_from_clinic_id uuid, p_to_clinic_id uuid, p_from_location_id uuid, p_lot_id uuid, p_quantity numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_from_clinic_id); v_prev jsonb; v_lot public.vaccine_lots; v_loc public.stock_locations; v_prod public.vaccine_products; v_transit uuid; v_tx uuid; v_id uuid := gen_random_uuid(); v_ref text; v_today date;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.transfer.send', jsonb_build_object('f', p_from_clinic_id, 't', p_to_clinic_id, 'loc', p_from_location_id, 'lot', p_lot_id, 'q', p_quantity, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be positive' using errcode = 'CV422'; end if;
  if p_to_clinic_id = p_from_clinic_id or not exists (select 1 from public.clinics where id = p_to_clinic_id and organization_id = v_org and status = 'active') then raise exception 'choose another active clinic in this organization' using errcode = 'CV422'; end if;
  select * into v_lot from public.vaccine_lots where id = p_lot_id and organization_id = v_org;
  select * into v_loc from public.stock_locations where id = p_from_location_id and organization_id = v_org and clinic_id = p_from_clinic_id and status = 'active';
  if v_lot.id is null or v_loc.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  select * into v_prod from public.vaccine_products where id = v_lot.product_id;
  v_today := private.local_today(p_from_clinic_id);
  if v_loc.kind <> 'usable' then raise exception 'send from a usable location' using errcode = 'CV422'; end if;
  if v_lot.global_disposition <> 'usable' then raise exception 'lot is % and cannot be transferred', v_lot.global_disposition using errcode = 'CV409'; end if;
  if private.lot_is_expired(v_lot.expires_on, v_today) then raise exception 'lot is expired' using errcode = 'CV409'; end if;
  v_transit := private.transit_location(v_org, p_from_clinic_id);
  v_ref := 'TR-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 6));
  insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, operation_id, created_by)
  values (v_org, p_from_clinic_id, 'transfer_out', v_ref, left(p_note, 300), p_operation_key, auth.uid()) returning id into v_tx;
  perform private.post_movement(v_org, v_tx, p_from_location_id, p_lot_id, -p_quantity, 'tr-out:' || p_operation_key);
  perform private.post_movement(v_org, v_tx, v_transit, p_lot_id, p_quantity, 'tr-transit:' || p_operation_key);
  insert into public.stock_transfers (id, organization_id, from_clinic_id, to_clinic_id, lot_id, from_location_id, transit_location_id, quantity_sent, reference, note, sent_by)
  values (v_id, v_org, p_from_clinic_id, p_to_clinic_id, p_lot_id, p_from_location_id, v_transit, p_quantity, v_ref, left(nullif(btrim(p_note), ''), 300), auth.uid());
  perform private.audit(v_org, 'inventory.manage', 'transfer.sent', 'stock_transfer', v_id, null, jsonb_build_object('ref', v_ref, 'to', p_to_clinic_id, 'lot', p_lot_id, 'qty', p_quantity), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', v_id, 'reference', v_ref, 'status', 'in_transit'));
end $$;

create function public.receive_stock_transfer(p_operation_key uuid, p_clinic_id uuid, p_transfer_id uuid, p_location_id uuid, p_received_quantity numeric, p_accepted boolean default true, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; t public.stock_transfers; v_loc public.stock_locations; v_dest uuid; v_q uuid; v_tx uuid; v_status text; v_case uuid;
begin
  select * into t from public.stock_transfers where id = p_transfer_id and organization_id = v_org and to_clinic_id = p_clinic_id for update;
  if t.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.transfer.receive', jsonb_build_object('c', p_clinic_id, 't', p_transfer_id, 'loc', p_location_id, 'q', p_received_quantity, 'a', p_accepted, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if t.status <> 'in_transit' then raise exception 'this transfer is not waiting to be received' using errcode = 'CV409'; end if;
  if p_received_quantity is null or p_received_quantity <= 0 or p_received_quantity > t.quantity_sent then raise exception 'received quantity must be more than zero and at most what was sent' using errcode = 'CV422'; end if;
  select * into v_loc from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id and status = 'active';
  if v_loc.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if v_loc.kind <> 'usable' then raise exception 'receive into a usable location' using errcode = 'CV422'; end if;
  v_dest := p_location_id;
  if not p_accepted then
    select id into v_q from public.stock_locations where clinic_id = p_clinic_id and kind = 'quarantine' and status = 'active' order by created_at limit 1;
    if v_q is null then raise exception 'create a quarantine location before receiving unaccepted stock' using errcode = 'CV422'; end if;
    v_dest := v_q;
  end if;
  insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, operation_id, created_by)
  values (v_org, p_clinic_id, 'transfer_in', t.reference, left(p_note, 300), p_operation_key, auth.uid()) returning id into v_tx;
  perform private.post_movement(v_org, v_tx, t.transit_location_id, t.lot_id, -p_received_quantity, 'tr-take:' || p_operation_key);
  perform private.post_movement(v_org, v_tx, v_dest, t.lot_id, p_received_quantity, 'tr-in:' || p_operation_key);
  v_status := case when p_received_quantity < t.quantity_sent then 'received_short' else 'received' end;
  if v_status = 'received_short' then
    insert into public.record_review_cases (organization_id, clinic_id, kind, reason, evidence, created_by, updated_by)
    values (v_org, t.from_clinic_id, 'stock', 'Transfer ' || t.reference || ' arrived short', jsonb_build_object('transferId', t.id, 'sent', t.quantity_sent, 'received', p_received_quantity), auth.uid(), auth.uid()) returning id into v_case;
  end if;
  update public.stock_transfers set status = v_status, to_location_id = v_dest, quantity_received = p_received_quantity, received_by = auth.uid(), received_at = now(), review_case_id = v_case, version = version + 1 where id = t.id;
  perform private.audit(v_org, 'inventory.manage', 'transfer.received', 'stock_transfer', t.id, jsonb_build_object('status', 'in_transit'), jsonb_build_object('status', v_status, 'qty', p_received_quantity, 'accepted', p_accepted), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', t.id, 'status', v_status, 'locationId', v_dest, 'shortfall', t.quantity_sent - p_received_quantity));
end $$;

create function public.cancel_stock_transfer(p_operation_key uuid, p_clinic_id uuid, p_transfer_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; t public.stock_transfers; v_tx uuid; v_loc public.stock_locations;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  select * into t from public.stock_transfers where id = p_transfer_id and organization_id = v_org and from_clinic_id = p_clinic_id for update;
  if t.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.transfer.cancel', jsonb_build_object('c', p_clinic_id, 't', p_transfer_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if t.status <> 'in_transit' then raise exception 'only a transfer that has not been received can be cancelled' using errcode = 'CV409'; end if;
  select * into v_loc from public.stock_locations where id = t.from_location_id and status = 'active';
  if v_loc.id is null then raise exception 'the original location is closed; return the stock through a count adjustment' using errcode = 'CV409'; end if;
  insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, operation_id, created_by)
  values (v_org, p_clinic_id, 'transfer_in', t.reference, 'cancelled: ' || left(btrim(p_reason), 250), p_operation_key, auth.uid()) returning id into v_tx;
  perform private.post_movement(v_org, v_tx, t.transit_location_id, t.lot_id, -t.quantity_sent, 'tr-cancel-out:' || p_operation_key);
  perform private.post_movement(v_org, v_tx, t.from_location_id, t.lot_id, t.quantity_sent, 'tr-cancel-back:' || p_operation_key);
  update public.stock_transfers set status = 'cancelled', resolution_note = left(btrim(p_reason), 300), resolved_by = auth.uid(), resolved_at = now(), version = version + 1 where id = t.id;
  perform private.audit(v_org, 'inventory.manage', 'transfer.cancelled', 'stock_transfer', t.id, jsonb_build_object('status', 'in_transit'), jsonb_build_object('status', 'cancelled'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', t.id, 'status', 'cancelled'));
end $$;

-- A short delivery is resolved by a person who did not send it: write the missing units off as wastage, or take them back into stock.
create function public.resolve_transfer_shortfall(p_operation_key uuid, p_clinic_id uuid, p_transfer_id uuid, p_decision text, p_note text, p_return_location_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; t public.stock_transfers; v_tx uuid; v_short numeric; v_loc public.stock_locations; v_status text;
begin
  if p_decision not in ('write_off','return') then raise exception 'choose write_off or return' using errcode = 'CV422'; end if;
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'a note is required' using errcode = 'CV422'; end if;
  select * into t from public.stock_transfers where id = p_transfer_id and organization_id = v_org and from_clinic_id = p_clinic_id for update;
  if t.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.transfer.resolve', jsonb_build_object('c', p_clinic_id, 't', p_transfer_id, 'd', p_decision, 'n', p_note, 'l', p_return_location_id));
  if v_prev is not null then return v_prev; end if;
  if t.status <> 'received_short' then raise exception 'this transfer has no shortfall to resolve' using errcode = 'CV409'; end if;
  if t.sent_by = auth.uid() then raise exception 'the person who sent the transfer cannot resolve its shortfall' using errcode = 'CV403'; end if;
  v_short := t.quantity_sent - t.quantity_received;
  if p_decision = 'write_off' then
    insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, approved_by, operation_id, created_by)
    values (v_org, p_clinic_id, 'wastage', t.reference, 'transfer shortfall written off: ' || left(btrim(p_note), 200), auth.uid(), p_operation_key, auth.uid()) returning id into v_tx;
    perform private.post_movement(v_org, v_tx, t.transit_location_id, t.lot_id, -v_short, 'tr-writeoff:' || p_operation_key);
    v_status := 'closed_written_off';
  else
    select * into v_loc from public.stock_locations where id = coalesce(p_return_location_id, t.from_location_id) and organization_id = v_org and clinic_id = p_clinic_id and status = 'active' and kind = 'usable';
    if v_loc.id is null then raise exception 'choose an active usable location to return the stock to' using errcode = 'CV422'; end if;
    insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, approved_by, operation_id, created_by)
    values (v_org, p_clinic_id, 'transfer_in', t.reference, 'shortfall returned: ' || left(btrim(p_note), 200), auth.uid(), p_operation_key, auth.uid()) returning id into v_tx;
    perform private.post_movement(v_org, v_tx, t.transit_location_id, t.lot_id, -v_short, 'tr-ret-out:' || p_operation_key);
    perform private.post_movement(v_org, v_tx, v_loc.id, t.lot_id, v_short, 'tr-ret-in:' || p_operation_key);
    v_status := 'closed_returned';
  end if;
  update public.stock_transfers set status = v_status, resolution_note = left(btrim(p_note), 300), resolved_by = auth.uid(), resolved_at = now(), version = version + 1 where id = t.id;
  if t.review_case_id is not null then
    update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(), resolution = jsonb_build_object('decision', p_decision, 'note', p_note) where id = t.review_case_id and status in ('open','in_review');
  end if;
  perform private.audit(v_org, 'inventory.approve', 'transfer.shortfall_resolved', 'stock_transfer', t.id, jsonb_build_object('status', 'received_short'), jsonb_build_object('status', v_status, 'units', v_short), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transferId', t.id, 'status', v_status, 'units', v_short));
end $$;

create function public.list_stock_transfers(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['inventory.manage','inventory.approve']);
  return jsonb_build_object(
    'outgoing', coalesce((select jsonb_agg(private.transfer_json(t) order by t.sent_at desc) from (select * from public.stock_transfers where from_clinic_id = p_clinic_id order by sent_at desc limit 50) t), '[]'::jsonb),
    'incoming', coalesce((select jsonb_agg(private.transfer_json(t) order by t.sent_at desc) from (select * from public.stock_transfers where to_clinic_id = p_clinic_id order by sent_at desc limit 50) t), '[]'::jsonb),
    'clinics', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from public.clinics c where c.organization_id = v_org and c.status = 'active' and c.id <> p_clinic_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Temperature logs
-- ---------------------------------------------------------------------------------------------
create table public.cold_chain_limits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  min_c numeric not null check (min_c between -80 and 60),
  max_c numeric not null check (max_c between -80 and 60),
  policy_reference text not null check (length(btrim(policy_reference)) >= 3),
  set_by uuid not null references public.profiles (id),
  set_at timestamptz not null default now(),
  operation_id uuid not null unique,
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  check (min_c < max_c)
);
create index cold_chain_limits_idx on public.cold_chain_limits (clinic_id, set_at desc);

create table public.temperature_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  location_id uuid not null references public.stock_locations (id),
  observed_at timestamptz not null,
  min_c numeric not null check (min_c between -80 and 60),
  max_c numeric not null check (max_c between -80 and 60),
  limit_min_c numeric,
  limit_max_c numeric,
  limits_id uuid references public.cold_chain_limits (id),
  status text not null check (status in ('no_limits','within_limits','excursion')),
  note text,
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null default now(),
  operation_id uuid not null unique,
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  check (min_c <= max_c)
);
create index temperature_readings_idx on public.temperature_readings (clinic_id, location_id, observed_at desc);

create table public.temperature_reviews (
  reading_id uuid primary key references public.temperature_readings (id),
  organization_id uuid not null references public.organizations (id),
  action text not null check (action in ('no_action','lots_quarantined','stock_discarded','other')),
  note text not null check (length(btrim(note)) >= 3),
  reviewed_by uuid not null references public.profiles (id),
  reviewed_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['public.cold_chain_limits','public.temperature_readings','public.temperature_reviews'] loop
    execute format('create trigger %I before update or delete on %s for each row execute function private.forbid_change()', replace(t, '.', '_') || '_immutable', t);
    execute format('create trigger %I before truncate on %s for each statement execute function private.forbid_change()', replace(t, '.', '_') || '_no_truncate', t);
    execute format('alter table %s enable row level security', t);
    execute format('revoke all on %s from anon, authenticated', t);
  end loop;
end $$;

create function public.set_cold_chain_limits(p_operation_key uuid, p_clinic_id uuid, p_min_c numeric, p_max_c numeric, p_policy_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; v_id uuid;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'coldchain.limits', jsonb_build_object('c', p_clinic_id, 'a', p_min_c, 'b', p_max_c, 'p', p_policy_reference));
  if v_prev is not null then return v_prev; end if;
  if p_min_c is null or p_max_c is null or p_min_c >= p_max_c then raise exception 'the lower limit must be below the upper limit' using errcode = 'CV422'; end if;
  if p_policy_reference is null or length(btrim(p_policy_reference)) < 3 then raise exception 'name the cold-chain policy these limits come from' using errcode = 'CV422'; end if;
  insert into public.cold_chain_limits (organization_id, clinic_id, min_c, max_c, policy_reference, set_by, operation_id) values (v_org, p_clinic_id, p_min_c, p_max_c, btrim(p_policy_reference), auth.uid(), p_operation_key) returning id into v_id;
  perform private.audit(v_org, 'inventory.approve', 'coldchain.limits_set', 'clinic', p_clinic_id, null, jsonb_build_object('min', p_min_c, 'max', p_max_c, 'policy', p_policy_reference), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('limitsId', v_id));
end $$;

create function public.record_temperature(p_operation_key uuid, p_clinic_id uuid, p_location_id uuid, p_observed_at timestamptz, p_min_c numeric, p_max_c numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; v_lim public.cold_chain_limits; v_status text; v_id uuid; v_loc public.stock_locations;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'coldchain.reading', jsonb_build_object('c', p_clinic_id, 'l', p_location_id, 'o', p_observed_at, 'a', p_min_c, 'b', p_max_c, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  select * into v_loc from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id and status = 'active';
  if v_loc.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if v_loc.kind = 'in_transit' then raise exception 'readings are logged for storage locations' using errcode = 'CV422'; end if;
  if p_min_c is null or p_max_c is null or p_min_c > p_max_c or p_min_c < -80 or p_max_c > 60 then raise exception 'check the temperatures: lowest cannot be above highest, and both must be realistic' using errcode = 'CV422'; end if;
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then raise exception 'the reading time cannot be in the future' using errcode = 'CV422'; end if;
  if p_observed_at < now() - interval '14 days' then raise exception 'readings older than 14 days cannot be entered here' using errcode = 'CV422'; end if;
  select * into v_lim from public.cold_chain_limits where clinic_id = p_clinic_id order by set_at desc limit 1;
  v_status := case when v_lim.id is null then 'no_limits' when p_min_c < v_lim.min_c or p_max_c > v_lim.max_c then 'excursion' else 'within_limits' end;
  insert into public.temperature_readings (organization_id, clinic_id, location_id, observed_at, min_c, max_c, limit_min_c, limit_max_c, limits_id, status, note, recorded_by, operation_id)
  values (v_org, p_clinic_id, p_location_id, p_observed_at, p_min_c, p_max_c, v_lim.min_c, v_lim.max_c, v_lim.id, v_status, left(nullif(btrim(p_note), ''), 300), auth.uid(), p_operation_key) returning id into v_id;
  perform private.audit(v_org, 'inventory.manage', case when v_status = 'excursion' then 'coldchain.excursion' else 'coldchain.reading' end, 'stock_location', p_location_id, null, jsonb_build_object('min', p_min_c, 'max', p_max_c, 'status', v_status), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('readingId', v_id, 'status', v_status));
end $$;

create function public.review_temperature_excursion(p_operation_key uuid, p_clinic_id uuid, p_reading_id uuid, p_action text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; r public.temperature_readings;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'coldchain.review', jsonb_build_object('c', p_clinic_id, 'r', p_reading_id, 'a', p_action, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if p_action not in ('no_action','lots_quarantined','stock_discarded','other') then raise exception 'choose what was done' using errcode = 'CV422'; end if;
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'a note is required' using errcode = 'CV422'; end if;
  select * into r from public.temperature_readings where id = p_reading_id and organization_id = v_org and clinic_id = p_clinic_id;
  if r.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if r.status <> 'excursion' then raise exception 'only an excursion needs review' using errcode = 'CV409'; end if;
  if exists (select 1 from public.temperature_reviews where reading_id = r.id) then raise exception 'already reviewed' using errcode = 'CV409'; end if;
  if r.recorded_by = auth.uid() then raise exception 'the person who logged the reading cannot review it' using errcode = 'CV403'; end if;
  insert into public.temperature_reviews (reading_id, organization_id, action, note, reviewed_by) values (r.id, v_org, p_action, btrim(p_note), auth.uid());
  perform private.audit(v_org, 'inventory.approve', 'coldchain.excursion_reviewed', 'stock_location', r.location_id, null, jsonb_build_object('action', p_action), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('readingId', r.id, 'action', p_action));
end $$;

create function public.list_temperature(p_clinic_id uuid, p_days integer default 14) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_days int := least(greatest(coalesce(p_days, 14), 1), 90);
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['inventory.manage','inventory.approve']);
  return jsonb_build_object(
    'limits', (select jsonb_build_object('minC', l.min_c, 'maxC', l.max_c, 'policyReference', l.policy_reference, 'setAt', l.set_at) from public.cold_chain_limits l where l.clinic_id = p_clinic_id order by l.set_at desc limit 1),
    'readings', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'location', s.name, 'locationId', r.location_id, 'observedAt', r.observed_at, 'minC', r.min_c, 'maxC', r.max_c, 'status', r.status, 'note', r.note,
          'limitMinC', r.limit_min_c, 'limitMaxC', r.limit_max_c, 'reviewed', rv.reading_id is not null, 'reviewAction', rv.action, 'reviewNote', rv.note) order by r.observed_at desc)
        from public.temperature_readings r join public.stock_locations s on s.id = r.location_id left join public.temperature_reviews rv on rv.reading_id = r.id
       where r.clinic_id = p_clinic_id and r.observed_at >= now() - make_interval(days => v_days)), '[]'::jsonb),
    'openExcursions', (select count(*) from public.temperature_readings r where r.clinic_id = p_clinic_id and r.status = 'excursion' and not exists (select 1 from public.temperature_reviews rv where rv.reading_id = r.id)));
end $$;

revoke all on function private.transit_location(uuid, uuid), private.transfer_json(public.stock_transfers) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'send_stock_transfer(uuid,uuid,uuid,uuid,uuid,numeric,text)', 'receive_stock_transfer(uuid,uuid,uuid,uuid,numeric,boolean,text)', 'cancel_stock_transfer(uuid,uuid,uuid,text)',
    'resolve_transfer_shortfall(uuid,uuid,uuid,text,text,uuid)', 'list_stock_transfers(uuid)', 'set_cold_chain_limits(uuid,uuid,numeric,numeric,text)',
    'record_temperature(uuid,uuid,uuid,timestamptz,numeric,numeric,text)', 'review_temperature_excursion(uuid,uuid,uuid,text,text)', 'list_temperature(uuid,integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Backlog now also shows cold-chain and transfer work waiting for a person.
create or replace function public.report_backlog(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id);
begin
  perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'backlog'), null);
  return jsonb_build_object('report', 'backlog', 'asOf', now(), 'definitions', jsonb_build_object('version', 'r1', 'terms', jsonb_build_object(
      'openReviewCases', 'Review cases still open or in review, by type.', 'pendingOutsideDoses', 'Doses reported as given elsewhere that staff have not yet verified or rejected.',
      'provisionalChildren', 'Children enrolled here whose identity has not been confirmed.', 'pendingGuardianLinks', 'Guardian links waiting for in-person verification.',
      'pendingCertificates', 'Certificates prepared but not yet issued (document not stored).', 'failedMessages', 'Notification jobs that failed permanently.',
      'openTemperatureExcursions', 'Fridge readings outside the approved limits that nobody has reviewed.', 'transfersNeedingDecision', 'Stock transfers that arrived short and still need a decision.',
      'transfersInTransit', 'Stock sent to or from this clinic that has not been received yet.')),
    'openReviewCases', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.record_review_cases where clinic_id = p_clinic_id and status in ('open','in_review') group by kind) k),
    'pendingOutsideDoses', (select count(*) from private.current_revisions cr where cr.verification_status = 'pending_verification' and cr.event_status = 'active'
                              and private.child_in_clinic(private.canonical_child(cr.child_id), p_clinic_id)),
    'provisionalChildren', (select count(*) from public.children c join public.child_clinic_enrollments e on e.child_id = c.id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where c.record_status = 'provisional' and c.merged_into_id is null),
    'pendingGuardianLinks', (select count(*) from public.guardian_child_relationships r join public.child_clinic_enrollments e on e.child_id = r.child_id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where r.status = 'provisional'),
    'pendingCertificates', (select count(*) from public.certificates where clinic_id = p_clinic_id and status = 'pending'),
    'failedMessages', (select count(*) from private.outbox_jobs where organization_id = v_org and status = 'failed'),
    'openTemperatureExcursions', (select count(*) from public.temperature_readings r where r.clinic_id = p_clinic_id and r.status = 'excursion' and not exists (select 1 from public.temperature_reviews rv where rv.reading_id = r.id)),
    'transfersNeedingDecision', (select count(*) from public.stock_transfers where from_clinic_id = p_clinic_id and status = 'received_short'),
    'transfersInTransit', (select count(*) from public.stock_transfers where (from_clinic_id = p_clinic_id or to_clinic_id = p_clinic_id) and status = 'in_transit'));
end $$;
