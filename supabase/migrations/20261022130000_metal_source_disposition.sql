-- EXOS-AUD2-004: metal-source status was a free client write. Any production user
-- could set a lot that QC had rejected (or the 100 t lots held by 20261021300000)
-- back to available and charge it, with no reason or audit row. Marking a lot
-- "returned" left its kilograms in inventory and its payable unchanged, and could
-- be undone.
--
-- Lot status now changes only through public.set_metal_source_disposition:
--   hold    available/reserved -> rejected            owner, admin, factory/production manager, quality
--   release rejected -> available/reserved/used        owner, admin, factory manager, quality; not the
--                                                      person who placed the hold (owner excepted); the
--                                                      received weight must be within the receipt limit
--   return  available/reserved/rejected -> returned    owner, admin, factory/production manager, quality
--           The unused kilograms leave inventory as a 'purchase_return' movement, and the
--           disposition records the credit due from the vendor (unused kg x rate) for accounts
--           to settle through the supplier-credit workflow. A returned lot is final.
-- Every disposition is stored in public.metal_source_dispositions, and both source
-- tables get row audits with previous and new values.
begin;
set local lock_timeout = '5s';

alter table public.foundry_aluminium_scrap drop constraint if exists foundry_aluminium_scrap_status_check;
alter table public.foundry_aluminium_scrap add constraint foundry_aluminium_scrap_status_check
  check (status = any (array['available','reserved','used','rejected','returned']));

alter table public.inventory_movements drop constraint if exists movement_type_check;
alter table public.inventory_movements add constraint movement_type_check
  check (movement_type = any (array['purchase_in','production_in','production_issue','dispatch_out','scrap_in','scrap_out',
    'adjustment_in','adjustment_out','return_in','purchase_return']));

create table if not exists private.metal_source_disposition_authorizations (
  transaction_id bigint not null,
  source_table text not null,
  source_id uuid not null,
  disposition text not null,
  actor_id uuid not null,
  primary key (transaction_id, source_table, source_id)
);
revoke all on private.metal_source_disposition_authorizations from public, anon, authenticated;

create table if not exists public.metal_source_dispositions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_table text not null check (source_table in ('foundry_aluminium_scrap','foundry_external_aluminium_sources')),
  source_id uuid not null,
  source_number text,
  disposition text not null check (disposition in ('hold','release','return')),
  from_status text not null,
  to_status text not null,
  returned_kg numeric(14,3) check (returned_kg is null or returned_kg > 0),
  credit_due_amount numeric(14,2) check (credit_due_amount is null or credit_due_amount >= 0),
  expense_ledger_id uuid references public.expense_ledger(id),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  recorded_by uuid not null references public.app_users(id),
  recorded_by_role text not null,
  recorded_at timestamptz not null default now()
);
create index if not exists metal_source_dispositions_source_idx
  on public.metal_source_dispositions(company_id, source_table, source_id, recorded_at desc);
create index if not exists metal_source_dispositions_expense_idx
  on public.metal_source_dispositions(expense_ledger_id) where expense_ledger_id is not null;
create index if not exists metal_source_dispositions_recorded_by_idx
  on public.metal_source_dispositions(recorded_by);

alter table public.metal_source_dispositions enable row level security;
revoke all on public.metal_source_dispositions from public, anon, authenticated;
grant select on public.metal_source_dispositions to authenticated;
drop policy if exists metal_source_dispositions_read on public.metal_source_dispositions;
create policy metal_source_dispositions_read on public.metal_source_dispositions for select to authenticated
  using (company_id = (select private.get_current_user_company_id())
    and (select private.get_current_user_dealer_id()) is null
    and (select private.get_current_user_role()) in ('owner','admin','factory_manager','production_manager','production','quality','accounts','inventory_manager'));

-- Client writes cannot change a lot's status; nested writers (furnace charge refunds) and
-- the disposition RPC (authorized per transaction) can.
create or replace function private.guard_metal_source_status()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'returned' then
    raise exception 'A returned metal lot is final; record a new receipt if the material comes back'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from private.metal_source_disposition_authorizations a
    where a.transaction_id = txid_current() and a.source_table = tg_table_name and a.source_id = old.id
  ) then
    raise exception 'Lot status changes through the lot disposition (hold, release or return to vendor) with a reason'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_metal_source_status() from public, anon, authenticated;

drop trigger if exists a0_guard_metal_source_status on public.foundry_aluminium_scrap;
create trigger a0_guard_metal_source_status before update on public.foundry_aluminium_scrap
for each row execute function private.guard_metal_source_status();
drop trigger if exists a0_guard_metal_source_status on public.foundry_external_aluminium_sources;
create trigger a0_guard_metal_source_status before update on public.foundry_external_aluminium_sources
for each row execute function private.guard_metal_source_status();

-- Same body as 20261021010000, plus the authorized return that empties the lot.
create or replace function private.guard_foundry_source_balance()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_available numeric;
begin
  -- Nested writers: the batch charge/refund writer and the source's own
  -- expense/inventory synchronisation. None of them takes client values.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, 'available') not in ('available', 'rejected') then
      raise exception 'A new metal source must start as available or rejected' using errcode = '23514';
    end if;
    new.available_weight_kg := new.weight_kg;
    return new;
  end if;

  if new.id is distinct from old.id or new.company_id is distinct from old.company_id then
    raise exception 'Metal source identity is immutable' using errcode = '23514';
  end if;

  -- An authorized return to vendor removes everything not yet charged.
  if exists (
    select 1 from private.metal_source_disposition_authorizations a
    where a.transaction_id = txid_current() and a.source_table = tg_table_name and a.source_id = old.id
      and a.disposition = 'return'
  ) then
    if new.weight_kg is distinct from old.weight_kg then
      raise exception 'A return to vendor cannot change the received weight' using errcode = '23514';
    end if;
    new.available_weight_kg := 0;
    new.status := 'returned';
    return new;
  end if;

  -- Client-supplied availability is ignored; only a received-weight correction moves it.
  v_available := coalesce(old.available_weight_kg, old.weight_kg) + (new.weight_kg - old.weight_kg);
  if v_available < 0 then
    raise exception 'Received weight % kg is below the % kg already charged to furnace batches',
      new.weight_kg, old.weight_kg - coalesce(old.available_weight_kg, old.weight_kg)
      using errcode = '23514';
  end if;
  new.available_weight_kg := v_available;

  if new.status not in ('rejected', 'returned') then
    new.status := case
      when v_available >= new.weight_kg then 'available'
      when v_available <= 0 then 'used'
      else 'reserved'
    end;
  end if;
  return new;
end;
$$;

-- Same body as 20261021220000, with returns posted as 'purchase_return'.
create or replace function private.post_foundry_source_consumption()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_delta numeric := round((coalesce(new.available_weight_kg, new.weight_kg) - coalesce(old.available_weight_kg, old.weight_kg))
    - (new.weight_kg - old.weight_kg), 3);
  v_item uuid := (to_jsonb(new) ->> 'inventory_item_id')::uuid;
  v_stock numeric;
  v_rate numeric;
  v_number text := coalesce(to_jsonb(new) ->> 'scrap_number', to_jsonb(new) ->> 'source_number', new.id::text);
  v_return boolean := exists (
    select 1 from private.metal_source_disposition_authorizations a
    where a.transaction_id = txid_current() and a.source_table = tg_table_name and a.source_id = new.id
      and a.disposition = 'return');
begin
  if v_item is null or v_delta = 0 then return null; end if;
  select current_stock, average_rate into v_stock, v_rate from public.inventory_items where id = v_item and company_id = new.company_id for update;
  if not found then return null; end if;
  if coalesce(v_stock, 0) + v_delta < -0.0005 then
    raise exception 'Inventory item stock (%) is below the % kg % source %', v_stock, -v_delta,
      case when v_return then 'returned from' else 'charged from' end, v_number using errcode = '23514';
  end if;
  update public.inventory_items set current_stock = coalesce(current_stock, 0) + v_delta, updated_at = now() where id = v_item;
  insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
    reference_id, rate, amount, movement_date, notes, created_by)
  values (new.company_id, v_item,
    case when v_return then 'purchase_return' when v_delta < 0 then 'production_issue' else 'return_in' end,
    abs(v_delta), 'kg', tg_table_name, new.id, coalesce(v_rate, 0), round(abs(v_delta) * coalesce(v_rate, 0), 2), private.business_today(),
    case when v_return then concat('Returned to vendor from ', v_number)
      when v_delta < 0 then concat('Charged to furnace from ', v_number)
      else concat('Furnace charge refunded to ', v_number) end, auth.uid());
  return null;
end;
$$;

create or replace function public.set_metal_source_disposition(p_source_table text, p_source_id uuid, p_disposition text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
  v_company uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_source record;
  v_number text;
  v_to text;
  v_last_hold uuid;
  v_max numeric;
  v_returned numeric;
  v_credit numeric;
  v_id uuid;
begin
  if v_actor is null or v_company is null or private.get_current_user_dealer_id() is not null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_source_table not in ('foundry_aluminium_scrap', 'foundry_external_aluminium_sources') then
    raise exception 'Unsupported metal source' using errcode = '22023';
  end if;
  if p_disposition not in ('hold', 'release', 'return') then
    raise exception 'Disposition must be hold, release or return' using errcode = '22023';
  end if;
  if (p_disposition = 'release' and v_role not in ('owner','admin','factory_manager','quality'))
    or (p_disposition <> 'release' and v_role not in ('owner','admin','factory_manager','production_manager','quality')) then
    raise exception 'Your role cannot % metal lots', p_disposition using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give the reason for this disposition (at least 10 characters)' using errcode = '23514';
  end if;

  execute format('select id, company_id, status, weight_kg, available_weight_kg, rate, expense_ledger_id,
      coalesce(to_jsonb(s) ->> ''scrap_number'', to_jsonb(s) ->> ''source_number'') number,
      coalesce(to_jsonb(s) ->> ''scrap_source'', ''incoming'') origin
    from public.%I s where id = $1 and company_id = $2 for update', p_source_table)
    into v_source using p_source_id, v_company;
  if v_source.id is null then
    raise exception 'Metal lot not found for this company' using errcode = '23514';
  end if;
  v_number := coalesce(v_source.number, v_source.id::text);

  if v_source.status = 'returned' then
    raise exception 'Lot % was returned to the vendor; record a new receipt if the material comes back', v_number using errcode = '23514';
  end if;
  if p_disposition = 'hold' then
    if v_source.status not in ('available', 'reserved') then
      raise exception 'Only an available or partly used lot can be put on hold (lot % is %)', v_number, v_source.status using errcode = '23514';
    end if;
    v_to := 'rejected';
  elsif p_disposition = 'release' then
    if v_source.status <> 'rejected' then
      raise exception 'Lot % is not on hold', v_number using errcode = '23514';
    end if;
    select d.recorded_by into v_last_hold from public.metal_source_dispositions d
    where d.company_id = v_company and d.source_table = p_source_table and d.source_id = p_source_id and d.disposition = 'hold'
    order by d.recorded_at desc limit 1;
    if v_last_hold = v_actor and v_role <> 'owner' then
      raise exception 'A hold must be released by someone other than the person who placed it' using errcode = '42501';
    end if;
    select coalesce(s.metal_receipt_max_kg, 60000) into v_max from public.company_settings s where s.company_id = v_company;
    if v_source.weight_kg > coalesce(v_max, 60000) then
      raise exception 'Lot % records % kg, above the % kg receipt limit; correct the received weight before releasing it',
        v_number, v_source.weight_kg, coalesce(v_max, 60000) using errcode = '23514';
    end if;
    v_to := 'available';
  else
    if v_source.origin = 'in_house' then
      raise exception 'In-house scrap cannot be returned to a vendor; put it on hold instead' using errcode = '23514';
    end if;
    v_returned := round(coalesce(v_source.available_weight_kg, v_source.weight_kg), 3);
    if v_returned <= 0 then
      raise exception 'Lot % has no unused weight to return', v_number using errcode = '23514';
    end if;
    v_credit := round(v_returned * coalesce(v_source.rate, 0), 2);
    v_to := 'returned';
  end if;

  insert into private.metal_source_disposition_authorizations(transaction_id, source_table, source_id, disposition, actor_id)
  values (txid_current(), p_source_table, p_source_id, p_disposition, v_actor)
  on conflict (transaction_id, source_table, source_id) do update set disposition = excluded.disposition, actor_id = excluded.actor_id;

  -- available_weight_kg is named so the AFTER UPDATE OF available_weight_kg inventory posting fires;
  -- guard_foundry_source_balance sets its value (0 on return, unchanged otherwise).
  execute format('update public.%I set status = $1, available_weight_kg = available_weight_kg, updated_at = now() where id = $2 and company_id = $3', p_source_table)
    using v_to, p_source_id, v_company;

  delete from private.metal_source_disposition_authorizations
  where transaction_id = txid_current() and source_table = p_source_table and source_id = p_source_id;

  -- A release lands on available, reserved or used depending on what was already charged.
  execute format('select status from public.%I where id = $1', p_source_table) into v_to using p_source_id;

  insert into public.metal_source_dispositions(company_id, source_table, source_id, source_number, disposition, from_status, to_status,
    returned_kg, credit_due_amount, expense_ledger_id, reason, recorded_by, recorded_by_role)
  values (v_company, p_source_table, p_source_id, v_number, p_disposition, v_source.status, v_to,
    v_returned, v_credit, case when p_disposition = 'return' then v_source.expense_ledger_id end, btrim(p_reason), v_actor, v_role)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'lot', v_number, 'status', v_to, 'returned_kg', v_returned, 'credit_due_amount', v_credit);
end;
$$;

revoke all on function public.set_metal_source_disposition(text, uuid, text, text) from public, anon;
grant execute on function public.set_metal_source_disposition(text, uuid, text, text) to authenticated;

drop trigger if exists audit_row_foundry_aluminium_scrap on public.foundry_aluminium_scrap;
create trigger audit_row_foundry_aluminium_scrap after insert or update or delete on public.foundry_aluminium_scrap
for each row execute function private.audit_row_change('foundry', 'scrap_number');
drop trigger if exists audit_row_foundry_external_aluminium_sources on public.foundry_external_aluminium_sources;
create trigger audit_row_foundry_external_aluminium_sources after insert or update or delete on public.foundry_external_aluminium_sources
for each row execute function private.audit_row_change('foundry', 'source_number');

commit;
