-- 0011 Vaccine inventory: lots, locations, immutable signed ledger, rebuildable balance projection.
-- Blueprint refs: BP19, BP28.4, F12, F15 (basic), T13, T14 (normal path), T15 (posting side), T16 (movement side).
--
-- Rules
--  * The ledger (stock_movements) is the truth. stock_balances is a projection maintained in the same transaction and can be
--    rebuilt and reconciled. Nobody edits a counter.
--  * physical on-hand, usable stock, quarantine and expired are different numbers.
--  * Single-dose presentations only for issue. Multi-dose products (doses_per_container <> 1) are blocked from issue until the
--    vial-session workflow exists (BP19 / MVP checklist).
--  * Expiry interpretation (is the printed date still usable?) is a cold-chain policy question: private.settings key
--    'expiry_last_day_usable' (default true) -- Requires external validation.

insert into private.settings(key, value) values
  ('expiry_last_day_usable', 'true'::jsonb),          -- policy: lot usable through its expiry date (needs validation)
  ('adjustment_auto_approve_units', '0'::jsonb)       -- |delta| above this needs inventory.approve (0 = every adjustment)
  on conflict (key) do nothing;

create table public.vaccine_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  product_id uuid not null,
  manufacturer_lot text not null check (length(btrim(manufacturer_lot)) between 1 and 60),
  expires_on date not null,
  manufacturer text,
  global_disposition text not null default 'usable' check (global_disposition in ('usable','quarantined','recalled')),
  policy_version text not null default '',
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, product_id) references public.vaccine_products (organization_id, id),
  unique (organization_id, id), unique (organization_id, product_id, manufacturer_lot)
);
create index vaccine_lots_expiry_idx on public.vaccine_lots (expires_on, global_disposition);
create trigger vaccine_lots_touch before update on public.vaccine_lots for each row execute function private.touch_row();

-- Lot identity is immutable; only disposition may change, and only through commands (no direct grants exist anyway).
create function private.lot_identity_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.product_id, new.manufacturer_lot, new.expires_on, new.manufacturer) is distinct from (old.product_id, old.manufacturer_lot, old.expires_on, old.manufacturer) then
    raise exception 'lot identity is immutable; use a reviewed correction' using errcode = 'CV409';
  end if;
  return new;
end $$;
create trigger vaccine_lots_identity before update on public.vaccine_lots for each row execute function private.lot_identity_guard();

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('usable','quarantine','in_transit')),
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles (id),
  version integer not null default 1 check (version > 0),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  unique (organization_id, id), unique (clinic_id, name)
);
create trigger stock_locations_touch before update on public.stock_locations for each row execute function private.touch_row();

create table public.stock_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  type text not null check (type in ('receipt','issue_administration','wastage','adjustment','transfer_out','transfer_in','reversal')),
  source_reference text not null default '',
  event_id uuid,                     -- links an administration issue to its vaccination event (M06)
  reason text,
  approved_by uuid references public.profiles (id),
  operation_id uuid not null,        -- the client Idempotency-Key that caused this posting
  reverses_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, event_id) references public.vaccination_events (organization_id, id),
  foreign key (reverses_id) references public.stock_transactions (id),
  unique (organization_id, id), unique (organization_id, operation_id, type)
);
create index stock_tx_clinic_idx on public.stock_transactions (clinic_id, occurred_at desc);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  transaction_id uuid not null,
  location_id uuid not null,
  lot_id uuid not null,
  quantity_delta numeric not null check (quantity_delta <> 0),
  unit text not null,
  movement_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid references public.profiles (id),
  foreign key (organization_id, transaction_id) references public.stock_transactions (organization_id, id),
  foreign key (organization_id, location_id) references public.stock_locations (organization_id, id),
  foreign key (organization_id, lot_id) references public.vaccine_lots (organization_id, id),
  unique (organization_id, movement_key)
);
create index stock_movements_lot_idx on public.stock_movements (lot_id, location_id, occurred_at);
create index stock_movements_tx_idx on public.stock_movements (transaction_id);

create table public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  location_id uuid not null, lot_id uuid not null,
  on_hand numeric not null default 0 check (on_hand >= 0),
  allocated numeric not null default 0 check (allocated >= 0 and allocated <= on_hand),
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.stock_locations (organization_id, id),
  foreign key (organization_id, lot_id) references public.vaccine_lots (organization_id, id),
  unique (location_id, lot_id)
);

create trigger stock_transactions_immutable before update or delete on public.stock_transactions for each row execute function private.forbid_change();
create trigger stock_movements_immutable before update or delete on public.stock_movements for each row execute function private.forbid_change();

-- TRUNCATE bypasses row triggers, so append-only tables need statement-level guards too (found by test: the ledger could be wiped).
do $$
declare t text;
begin
  foreach t in array array['public.stock_transactions','public.stock_movements','public.vaccination_events','public.vaccination_revisions','public.schedule_evaluations','public.dose_credits','public.privacy_records','private.command_receipts'] loop
    execute format('create trigger %I before truncate on %s for each statement execute function private.forbid_change()', replace(t, '.', '_') || '_no_truncate', t);
  end loop;
end $$;

-- Projection maintained in the SAME transaction as the ledger insert; row lock serialises concurrent postings.
create function private.apply_movement() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- UPDATE first: an INSERT ... ON CONFLICT checks the proposed row's CHECK constraints before conflict resolution, so a
  -- negative delta would be rejected even though the resulting balance is valid.
  update public.stock_balances set on_hand = on_hand + new.quantity_delta, updated_at = now()
   where location_id = new.location_id and lot_id = new.lot_id;
  if not found then
    begin
      insert into public.stock_balances (organization_id, location_id, lot_id, on_hand) values (new.organization_id, new.location_id, new.lot_id, new.quantity_delta);
    exception when unique_violation then
      -- a concurrent first posting created the row between our UPDATE and INSERT
      update public.stock_balances set on_hand = on_hand + new.quantity_delta, updated_at = now() where location_id = new.location_id and lot_id = new.lot_id;
    end;
  end if;
  return new;
end $$;
create trigger stock_movements_apply after insert on public.stock_movements for each row execute function private.apply_movement();

-- Deferred FK from history to lots (the column existed since 0006).
alter table public.vaccination_revisions add foreign key (organization_id, lot_id) references public.vaccine_lots (organization_id, id);

-- Ledger ordering guarantee: a transaction's movements must net to zero only for transfers; everything else is single-leg.
alter table public.record_review_cases drop constraint if exists record_review_cases_kind_check;
alter table public.record_review_cases add constraint record_review_cases_kind_check check (kind in ('duplicate','link','identity_edit','correction','clinical','stock','sync'));

alter table public.vaccine_lots enable row level security;
alter table public.stock_locations enable row level security;
alter table public.stock_transactions enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;
revoke all on public.vaccine_lots, public.stock_locations, public.stock_transactions, public.stock_movements, public.stock_balances from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
create function private.lot_is_expired(p_expires date, p_as_of date) returns boolean language sql stable set search_path = '' as $$
  select case when private.setting_bool('expiry_last_day_usable') then p_expires < p_as_of else p_expires <= p_as_of end
$$;

-- Exact unit conversion (numeric, never floating point): doses -> stock units (containers).
create function private.doses_to_stock_units(p_product uuid, p_doses numeric) returns numeric language sql stable security definer set search_path = '' as $$
  select p_doses / doses_per_container from public.vaccine_products where id = p_product
$$;

-- Usable = physical on-hand, in a usable location, of a lot that is usable and unexpired, minus allocations.
create function private.usable_on_hand(p_location uuid, p_lot uuid, p_as_of date) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when l.global_disposition = 'usable' and loc.kind = 'usable' and loc.status = 'active' and not private.lot_is_expired(l.expires_on, p_as_of)
                then b.on_hand - b.allocated else 0 end
      from public.stock_balances b join public.vaccine_lots l on l.id = b.lot_id join public.stock_locations loc on loc.id = b.location_id
     where b.location_id = p_location and b.lot_id = p_lot), 0)
$$;

-- Internal posting primitive. Locks the balance row, refuses to go below zero, appends one immutable movement.
create function private.post_movement(p_org uuid, p_tx uuid, p_location uuid, p_lot uuid, p_delta numeric, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_unit text; v_on numeric;
begin
  if p_delta = 0 then raise exception 'quantity must not be zero' using errcode = 'CV422'; end if;
  select p.stock_unit into v_unit from public.vaccine_lots l join public.vaccine_products p on p.id = l.product_id where l.id = p_lot and l.organization_id = p_org;
  if v_unit is null then raise exception 'unknown lot' using errcode = 'CV404'; end if;
  if p_delta < 0 then
    select on_hand into v_on from public.stock_balances where location_id = p_location and lot_id = p_lot for update;
    if coalesce(v_on, 0) + p_delta < 0 then raise exception 'insufficient stock' using errcode = 'CV409'; end if;
  end if;
  insert into public.stock_movements (organization_id, transaction_id, location_id, lot_id, quantity_delta, unit, movement_key, created_by)
  values (p_org, p_tx, p_location, p_lot, p_delta, v_unit, p_key, auth.uid());
end $$;

-- Used by the administration command (M06): one physical single-dose administration = one issue movement from a usable location.
create function private.issue_for_administration(p_org uuid, p_clinic uuid, p_location uuid, p_lot uuid, p_doses numeric, p_event uuid, p_operation uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_prod public.vaccine_products; v_lot public.vaccine_lots; v_loc public.stock_locations; v_tx uuid; v_today date; v_qty numeric;
begin
  select * into v_lot from public.vaccine_lots where id = p_lot and organization_id = p_org;
  select * into v_loc from public.stock_locations where id = p_location and organization_id = p_org and clinic_id = p_clinic;
  if v_lot.id is null or v_loc.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  select * into v_prod from public.vaccine_products where id = v_lot.product_id;
  if v_prod.doses_per_container <> 1 then raise exception 'multi-dose products need the vial workflow, which is not enabled' using errcode = 'CV422'; end if;
  if v_prod.status <> 'active' then raise exception 'product is not active' using errcode = 'CV409'; end if;
  v_today := private.local_today(p_clinic);
  if v_lot.global_disposition <> 'usable' then raise exception 'lot is % and cannot be used', v_lot.global_disposition using errcode = 'CV409'; end if;
  if private.lot_is_expired(v_lot.expires_on, v_today) then raise exception 'lot is expired' using errcode = 'CV409'; end if;
  if v_loc.kind <> 'usable' or v_loc.status <> 'active' then raise exception 'location is not a usable stock location' using errcode = 'CV409'; end if;
  v_qty := private.doses_to_stock_units(v_prod.id, p_doses);
  insert into public.stock_transactions (organization_id, clinic_id, type, event_id, operation_id, created_by)
  values (p_org, p_clinic, 'issue_administration', p_event, p_operation, auth.uid()) returning id into v_tx;
  perform private.post_movement(p_org, v_tx, p_location, p_lot, -v_qty, 'issue:' || p_operation);
  return v_tx;
end $$;

create function private.inventory_org(p_clinic uuid, p_cap text default 'inventory.manage') returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic, p_cap);
  return v_org;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------
create function public.create_stock_location(p_operation_key uuid, p_clinic_id uuid, p_name text, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; v_id uuid;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.create_location', jsonb_build_object('c', p_clinic_id, 'n', p_name, 'k', p_kind));
  if v_prev is not null then return v_prev; end if;
  insert into public.stock_locations (organization_id, clinic_id, name, kind, created_by, updated_by) values (v_org, p_clinic_id, btrim(p_name), p_kind, auth.uid(), auth.uid()) returning id into v_id;
  perform private.audit(v_org, 'inventory.manage', 'stock.location_created', 'stock_location', v_id, null, jsonb_build_object('kind', p_kind), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('locationId', v_id));
end $$;

create function public.register_lot(p_operation_key uuid, p_clinic_id uuid, p_product_id uuid, p_manufacturer_lot text, p_expires_on date, p_manufacturer text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; v_id uuid;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.register_lot', jsonb_build_object('c', p_clinic_id, 'p', p_product_id, 'l', p_manufacturer_lot, 'e', p_expires_on, 'm', p_manufacturer));
  if v_prev is not null then return v_prev; end if;
  if not exists (select 1 from public.vaccine_products where id = p_product_id and organization_id = v_org and status = 'active') then raise exception 'product is not active' using errcode = 'CV422'; end if;
  if p_expires_on is null then raise exception 'expiry date is required' using errcode = 'CV422'; end if;
  if private.lot_is_expired(p_expires_on, private.local_today(p_clinic_id)) then raise exception 'a lot that is already expired cannot be registered for use' using errcode = 'CV422'; end if;
  insert into public.vaccine_lots (organization_id, product_id, manufacturer_lot, expires_on, manufacturer, created_by, updated_by)
  values (v_org, p_product_id, btrim(p_manufacturer_lot), p_expires_on, nullif(btrim(coalesce(p_manufacturer, '')), ''), auth.uid(), auth.uid()) returning id into v_id;
  perform private.audit(v_org, 'inventory.manage', 'stock.lot_registered', 'vaccine_lot', v_id, null, jsonb_build_object('lot', p_manufacturer_lot, 'expires', p_expires_on), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('lotId', v_id));
end $$;

-- Receiving: positive quantity, delivery reference required. Not accepted (damaged/suspect) stock is booked into quarantine, never usable.
create function public.receive_stock(p_operation_key uuid, p_clinic_id uuid, p_location_id uuid, p_lot_id uuid, p_quantity numeric, p_delivery_reference text, p_accepted boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; v_lot public.vaccine_lots; v_loc public.stock_locations; v_q uuid; v_tx uuid; v_dest uuid;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.receive', jsonb_build_object('c', p_clinic_id, 'loc', p_location_id, 'lot', p_lot_id, 'q', p_quantity, 'ref', p_delivery_reference, 'a', p_accepted));
  if v_prev is not null then return v_prev; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be positive' using errcode = 'CV422'; end if;
  if p_delivery_reference is null or length(btrim(p_delivery_reference)) = 0 then raise exception 'delivery reference is required' using errcode = 'CV422'; end if;
  select * into v_lot from public.vaccine_lots where id = p_lot_id and organization_id = v_org;
  select * into v_loc from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id and status = 'active';
  if v_lot.id is null or v_loc.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if v_loc.kind <> 'usable' then raise exception 'receive into a usable location' using errcode = 'CV422'; end if;
  if v_lot.global_disposition = 'recalled' then raise exception 'lot is recalled' using errcode = 'CV409'; end if;
  v_dest := p_location_id;
  if not p_accepted then
    select id into v_q from public.stock_locations where clinic_id = p_clinic_id and kind = 'quarantine' and status = 'active' order by created_at limit 1;
    if v_q is null then raise exception 'create a quarantine location before receiving unaccepted stock' using errcode = 'CV422'; end if;
    v_dest := v_q;
  end if;
  insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, operation_id, created_by)
  values (v_org, p_clinic_id, 'receipt', btrim(p_delivery_reference), p_operation_key, auth.uid()) returning id into v_tx;
  perform private.post_movement(v_org, v_tx, v_dest, p_lot_id, p_quantity, 'receipt:' || p_operation_key);
  perform private.audit(v_org, 'inventory.manage', 'stock.received', 'vaccine_lot', p_lot_id, null, jsonb_build_object('qty', p_quantity, 'accepted', p_accepted, 'ref', p_delivery_reference), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transactionId', v_tx, 'locationId', v_dest, 'accepted', p_accepted));
end $$;

create function public.record_wastage(p_operation_key uuid, p_clinic_id uuid, p_location_id uuid, p_lot_id uuid, p_quantity numeric, p_reason text, p_incident_reference text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; v_tx uuid; v_loc public.stock_locations;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.wastage', jsonb_build_object('c', p_clinic_id, 'loc', p_location_id, 'lot', p_lot_id, 'q', p_quantity, 'r', p_reason, 'i', p_incident_reference));
  if v_prev is not null then return v_prev; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be positive' using errcode = 'CV422'; end if;
  if p_reason not in ('expired','damaged','spoiled','breakage','open_vial_discard','temperature_excursion','other') then raise exception 'invalid wastage reason' using errcode = 'CV422'; end if;
  select * into v_loc from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id;
  if v_loc.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, operation_id, created_by)
  values (v_org, p_clinic_id, 'wastage', coalesce(p_incident_reference, ''), p_reason, p_operation_key, auth.uid()) returning id into v_tx;
  perform private.post_movement(v_org, v_tx, p_location_id, p_lot_id, -p_quantity, 'wastage:' || p_operation_key);
  perform private.audit(v_org, 'inventory.manage', 'stock.wastage', 'vaccine_lot', p_lot_id, null, jsonb_build_object('qty', p_quantity, 'reason', p_reason), p_incident_reference);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('transactionId', v_tx));
end $$;

-- Physical count reconciliation. Differences above the threshold need a second person with inventory.approve.
create function public.propose_stock_adjustment(p_operation_key uuid, p_clinic_id uuid, p_location_id uuid, p_lot_id uuid, p_observed numeric, p_count_reference text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; v_book numeric; v_delta numeric; v_thr numeric; v_case uuid; v_tx uuid; v_can_approve boolean;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.adjust', jsonb_build_object('c', p_clinic_id, 'loc', p_location_id, 'lot', p_lot_id, 'obs', p_observed, 'ref', p_count_reference, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if p_observed is null or p_observed < 0 then raise exception 'observed count must be zero or more' using errcode = 'CV422'; end if;
  if p_count_reference is null or length(btrim(p_count_reference)) = 0 or p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'count reference and reason are required' using errcode = 'CV422'; end if;
  if not exists (select 1 from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  select coalesce(on_hand, 0) into v_book from public.stock_balances where location_id = p_location_id and lot_id = p_lot_id;
  v_book := coalesce(v_book, 0);
  v_delta := p_observed - v_book;
  if v_delta = 0 then return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'no_difference', 'book', v_book)); end if;
  v_thr := coalesce((select (value)::text::numeric from private.settings where key = 'adjustment_auto_approve_units'), 0);
  v_can_approve := private.has_capability(p_clinic_id, 'inventory.approve');
  if abs(v_delta) <= v_thr or v_can_approve then
    -- Even an approver's own proposal is posted by that approver: the actor is recorded as both requester and approver.
    insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, approved_by, operation_id, created_by)
    values (v_org, p_clinic_id, 'adjustment', p_count_reference, p_reason, case when v_can_approve then auth.uid() end, p_operation_key, auth.uid()) returning id into v_tx;
    perform private.post_movement(v_org, v_tx, p_location_id, p_lot_id, v_delta, 'adjust:' || p_operation_key);
    perform private.audit(v_org, 'inventory.manage', 'stock.adjusted', 'vaccine_lot', p_lot_id, jsonb_build_object('book', v_book), jsonb_build_object('observed', p_observed, 'delta', v_delta), p_reason);
    return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'posted', 'delta', v_delta, 'transactionId', v_tx));
  end if;
  -- Above threshold and no approval authority: park as a review case; nothing is posted yet.
  insert into public.record_review_cases (organization_id, clinic_id, kind, reason, evidence, created_by, updated_by)
  values (v_org, p_clinic_id, 'stock', 'stock count difference awaiting approval',
          jsonb_build_object('locationId', p_location_id, 'lotId', p_lot_id, 'book', v_book, 'observed', p_observed, 'delta', v_delta, 'countReference', p_count_reference, 'reason', p_reason, 'operationKey', p_operation_key),
          auth.uid(), auth.uid()) returning id into v_case;
  perform private.audit(v_org, 'inventory.manage', 'stock.adjustment_proposed', 'review_case', v_case, jsonb_build_object('book', v_book), jsonb_build_object('observed', p_observed), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'pending_approval', 'caseId', v_case, 'delta', v_delta));
end $$;

create function public.approve_stock_adjustment(p_operation_key uuid, p_clinic_id uuid, p_case_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; k public.record_review_cases; v_book numeric; v_tx uuid; v_delta numeric; v_loc uuid; v_lot uuid;
begin
  select * into k from public.record_review_cases where id = p_case_id and organization_id = v_org and clinic_id = p_clinic_id and kind = 'stock' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.approve_adjustment', jsonb_build_object('c', p_clinic_id, 'case', p_case_id));
  if v_prev is not null then return v_prev; end if;
  if k.status not in ('open','in_review') then raise exception 'case already decided' using errcode = 'CV409'; end if;
  if k.created_by = auth.uid() then raise exception 'the proposer cannot approve their own adjustment' using errcode = 'CV403'; end if;
  v_loc := (k.evidence ->> 'locationId')::uuid; v_lot := (k.evidence ->> 'lotId')::uuid;
  -- Re-derive the delta from the observed count against the CURRENT book balance (stock may have moved since the proposal).
  select coalesce(on_hand, 0) into v_book from public.stock_balances where location_id = v_loc and lot_id = v_lot for update;
  v_book := coalesce(v_book, 0);
  v_delta := (k.evidence ->> 'observed')::numeric - v_book;
  if v_delta <> 0 then
    insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, approved_by, operation_id, created_by)
    values (v_org, p_clinic_id, 'adjustment', k.evidence ->> 'countReference', k.evidence ->> 'reason', auth.uid(), p_operation_key, k.created_by) returning id into v_tx;
    perform private.post_movement(v_org, v_tx, v_loc, v_lot, v_delta, 'adjust:' || p_operation_key);
  end if;
  update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'approved', 'postedDelta', v_delta, 'transactionId', v_tx) where id = k.id;
  perform private.audit(v_org, 'inventory.approve', 'stock.adjustment_approved', 'review_case', k.id, null, jsonb_build_object('delta', v_delta), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'posted', 'delta', v_delta, 'transactionId', v_tx));
end $$;

-- Lot disposition. Quarantine can be applied by inventory staff; recall and release need inventory.approve. Physical stock is untouched.
create function public.set_lot_disposition(p_operation_key uuid, p_clinic_id uuid, p_lot_id uuid, p_disposition text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; l public.vaccine_lots; v_cap text;
begin
  if p_disposition not in ('quarantined','recalled','usable') then raise exception 'invalid disposition' using errcode = 'CV422'; end if;
  v_cap := case when p_disposition = 'quarantined' then 'inventory.manage' else 'inventory.approve' end;
  v_org := private.inventory_org(p_clinic_id, v_cap);
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.disposition', jsonb_build_object('c', p_clinic_id, 'lot', p_lot_id, 'd', p_disposition, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into l from public.vaccine_lots where id = p_lot_id and organization_id = v_org for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if l.global_disposition = p_disposition then raise exception 'lot is already %', p_disposition using errcode = 'CV409'; end if;
  if l.global_disposition = 'recalled' and p_disposition = 'usable' then
    -- Releasing a recall is a deliberate governance act: only inventory.approve, recorded, and never silently.
    null;
  end if;
  update public.vaccine_lots set global_disposition = p_disposition, updated_by = auth.uid() where id = l.id;
  perform private.audit(v_org, v_cap, 'stock.lot_' || p_disposition, 'vaccine_lot', l.id, jsonb_build_object('disposition', l.global_disposition), jsonb_build_object('disposition', p_disposition), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('lotId', l.id, 'disposition', p_disposition));
end $$;

-- Read models ---------------------------------------------------------------------------------
create function public.list_stock(p_clinic_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_today date; v_res jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['inventory.manage','inventory.approve','vaccination.record']);
  v_today := private.local_today(p_clinic_id);
  select jsonb_build_object(
    'asOf', v_today,
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'status', s.status) order by s.name) from public.stock_locations s where s.clinic_id = p_clinic_id), '[]'::jsonb),
    'lots', coalesce((select jsonb_agg(jsonb_build_object(
        'lotId', l.id, 'lot', l.manufacturer_lot, 'product', p.name, 'productCode', p.code, 'stockUnit', p.stock_unit, 'expiresOn', l.expires_on, 'disposition', l.global_disposition,
        'expired', private.lot_is_expired(l.expires_on, v_today),
        'physicalOnHand', coalesce((select sum(b.on_hand) from public.stock_balances b join public.stock_locations s on s.id = b.location_id where b.lot_id = l.id and s.clinic_id = p_clinic_id), 0),
        'usable', coalesce((select sum(private.usable_on_hand(b.location_id, b.lot_id, v_today)) from public.stock_balances b join public.stock_locations s on s.id = b.location_id where b.lot_id = l.id and s.clinic_id = p_clinic_id), 0),
        'locations', coalesce((select jsonb_agg(jsonb_build_object('locationId', b.location_id, 'onHand', b.on_hand)) from public.stock_balances b join public.stock_locations s on s.id = b.location_id where b.lot_id = l.id and s.clinic_id = p_clinic_id), '[]'::jsonb))
      order by l.expires_on, l.manufacturer_lot)
      from public.vaccine_lots l join public.vaccine_products p on p.id = l.product_id where l.organization_id = v_org), '[]'::jsonb)) into v_res;
  return v_res;
end $$;

create function public.list_lot_ledger(p_clinic_id uuid, p_lot_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('movementId', m.id, 'at', m.occurred_at, 'type', t.type, 'delta', m.quantity_delta, 'unit', m.unit, 'location', s.name,
      'reference', t.source_reference, 'reason', t.reason, 'approvedBy', t.approved_by) order by m.occurred_at, m.id)
    from public.stock_movements m join public.stock_transactions t on t.id = m.transaction_id join public.stock_locations s on s.id = m.location_id
   where m.lot_id = p_lot_id and s.clinic_id = p_clinic_id and m.organization_id = v_org), '[]'::jsonb);
end $$;

-- Projection vs ledger reconciliation; optionally repairs the PROJECTION (never the ledger).
create function public.reconcile_stock(p_operation_key uuid, p_clinic_id uuid, p_repair boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; v_diff jsonb;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.reconcile', jsonb_build_object('c', p_clinic_id, 'repair', p_repair));
  if v_prev is not null then return v_prev; end if;
  select coalesce(jsonb_agg(jsonb_build_object('locationId', x.location_id, 'lotId', x.lot_id, 'ledger', x.ledger, 'projection', x.projection)), '[]'::jsonb) into v_diff from (
    select coalesce(l.location_id, b.location_id) location_id, coalesce(l.lot_id, b.lot_id) lot_id, coalesce(l.q, 0) ledger, coalesce(b.on_hand, 0) projection
      from (select m.location_id, m.lot_id, sum(m.quantity_delta) q from public.stock_movements m join public.stock_locations s on s.id = m.location_id where s.clinic_id = p_clinic_id group by 1, 2) l
      full join (select b2.location_id, b2.lot_id, b2.on_hand from public.stock_balances b2 join public.stock_locations s on s.id = b2.location_id where s.clinic_id = p_clinic_id) b
        on b.location_id = l.location_id and b.lot_id = l.lot_id
     where coalesce(l.q, 0) <> coalesce(b.on_hand, 0)) x;
  if p_repair and jsonb_array_length(v_diff) > 0 then
    -- Rebuild projection rows from the ledger. allocated is preserved but capped so the projection stays valid.
    insert into public.stock_balances (organization_id, location_id, lot_id, on_hand)
    select v_org, (d ->> 'locationId')::uuid, (d ->> 'lotId')::uuid, (d ->> 'ledger')::numeric from jsonb_array_elements(v_diff) d
    on conflict (location_id, lot_id) do update set on_hand = excluded.on_hand, allocated = least(public.stock_balances.allocated, excluded.on_hand), updated_at = now();
  end if;
  update public.stock_balances b set reconciled_at = now() from public.stock_locations s where s.id = b.location_id and s.clinic_id = p_clinic_id and (p_repair or jsonb_array_length(v_diff) = 0);
  perform private.audit(v_org, 'inventory.approve', 'stock.reconciled', 'clinic', p_clinic_id, null, jsonb_build_object('mismatches', jsonb_array_length(v_diff), 'repaired', p_repair and jsonb_array_length(v_diff) > 0), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('mismatches', v_diff, 'repaired', p_repair and jsonb_array_length(v_diff) > 0));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_stock_location(uuid,uuid,text,text)', 'register_lot(uuid,uuid,uuid,text,date,text)', 'receive_stock(uuid,uuid,uuid,uuid,numeric,text,boolean)',
    'record_wastage(uuid,uuid,uuid,uuid,numeric,text,text)', 'propose_stock_adjustment(uuid,uuid,uuid,uuid,numeric,text,text)', 'approve_stock_adjustment(uuid,uuid,uuid)',
    'set_lot_disposition(uuid,uuid,uuid,text,text)', 'list_stock(uuid)', 'list_lot_ledger(uuid,uuid)', 'reconcile_stock(uuid,uuid,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
