-- EXOS-AUD-022: the inventory ledger and stock balances were decoupled.
--   * Any company user could insert inventory_movements (a viewer posted
--     adjustment_in 9,999 kg) without the balance moving, and current_stock was
--     a freely writable column.
--   * private.post_source_inventory_change clamped negative stock to 0.
--   * Charging foundry sources never decremented their inventory items.
--
-- Now:
--   * inventory_movements is written only by SECURITY DEFINER code (client
--     INSERT/UPDATE/DELETE revoked, tenant insert policy dropped).
--   * A client cannot change inventory_items.current_stock directly. A new item
--     created with an opening stock gets a matching 'adjustment_in' movement.
--     Manual corrections use public.post_inventory_adjustment (owner, admin,
--     inventory_manager, factory_manager) with a reason.
--   * Receipt edits that would take an item negative are rejected, not clamped.
--   * Furnace charges and refunds on a foundry source linked to an inventory item
--     post 'production_issue' / 'return_in' movements and move the balance.
--   * public.inventory_ledger_reconciliation shows any item whose balance does
--     not equal the signed sum of its movements.
-- The hosted database had 0 inventory items and 0 movements when this was written.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists "inventory_movements tenant insert" on public.inventory_movements;
revoke insert, update, delete on public.inventory_movements from anon, authenticated;

create or replace function private.inventory_movement_sign(p_type text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case when p_type in ('purchase_in','production_in','scrap_in','adjustment_in','return_in') then 1
    when p_type in ('production_issue','dispatch_out','scrap_out','adjustment_out') then -1 else 0 end
$$;
revoke all on function private.inventory_movement_sign(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.post_source_inventory_change(p_company_id uuid, p_old_item uuid, p_old_qty numeric, p_old_rate numeric, p_new_item uuid, p_new_qty numeric, p_new_rate numeric, p_unit text, p_reference_type text, p_reference_id uuid, p_movement_date date, p_in_type text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_old_qty numeric(14,3) := coalesce(p_old_qty, 0);
  v_old_rate numeric(14,2) := coalesce(p_old_rate, 0);
  v_new_qty numeric(14,3) := coalesce(p_new_qty, 0);
  v_new_rate numeric(14,2) := coalesce(p_new_rate, 0);
  v_stock numeric;
  v_avg numeric;
  v_delta numeric(14,3);
  v_qty_value numeric;
  v_revalue numeric(14,2) := 0;
  v_on_hand numeric;
begin
  if p_old_item is not null and p_new_item is distinct from p_old_item and v_old_qty > 0 then
    select current_stock, average_rate into v_stock, v_avg from public.inventory_items
    where id = p_old_item and company_id = p_company_id for update;
    if found then
      if v_stock - v_old_qty < -0.0005 then
        raise exception 'Inventory item stock (% ) is below the % being moved off it; record the consumption first', v_stock, v_old_qty using errcode = '23514';
      end if;
      update public.inventory_items
      set average_rate = case when v_stock - v_old_qty > 0 and v_old_rate > 0
            then round(greatest(v_stock * v_avg - v_old_qty * v_old_rate, 0) / (v_stock - v_old_qty), 2) else average_rate end,
          current_stock = v_stock - v_old_qty, updated_at = now()
      where id = p_old_item and company_id = p_company_id;
      insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
        reference_id, rate, amount, movement_date, notes, created_by)
      values (p_company_id, p_old_item, 'adjustment_out', v_old_qty, coalesce(p_unit, 'kg'), p_reference_type, p_reference_id,
        v_old_rate, round(v_old_qty * v_old_rate, 2), private.business_today(), p_note || ': moved to the corrected item', auth.uid());
    end if;
    v_old_qty := 0;
    v_old_rate := 0;
  end if;
  if p_new_item is null then return; end if;

  v_delta := v_new_qty - v_old_qty;
  if v_delta = 0 and v_new_rate = v_old_rate then return; end if;
  select current_stock, average_rate into v_stock, v_avg from public.inventory_items
  where id = p_new_item and company_id = p_company_id for update;
  if not found then return; end if;
  v_stock := coalesce(v_stock, 0);
  v_avg := coalesce(v_avg, 0);

  v_qty_value := case when v_delta >= 0 then v_delta * v_new_rate else v_delta * v_old_rate end;
  if v_new_rate <> v_old_rate and least(v_old_qty, v_new_qty) > 0 then
    v_on_hand := least(greatest(v_stock, 0), least(v_old_qty, v_new_qty));
    v_revalue := round((v_new_rate - v_old_rate) * v_on_hand, 2);
  end if;

  if v_stock + v_delta < -0.0005 then
    raise exception 'Inventory item stock would go negative (% + %); stock already issued cannot be removed by a receipt edit', v_stock, v_delta using errcode = '23514';
  end if;
  update public.inventory_items
  set average_rate = case
        when v_stock + v_delta > 0 and (v_new_rate > 0 or v_old_rate > 0)
          then round(greatest(v_stock * v_avg + v_qty_value + v_revalue, 0) / (v_stock + v_delta), 2)
        else average_rate end,
      current_stock = v_stock + v_delta,
      updated_at = now()
  where id = p_new_item and company_id = p_company_id;

  if v_delta <> 0 then
    insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
      reference_id, rate, amount, movement_date, notes, created_by)
    values (p_company_id, p_new_item, case when v_delta > 0 then coalesce(p_in_type, 'adjustment_in') else 'adjustment_out' end,
      abs(v_delta), coalesce(p_unit, 'kg'), p_reference_type, p_reference_id,
      case when v_delta > 0 then v_new_rate else v_old_rate end, abs(round(v_qty_value, 2)),
      coalesce(p_movement_date, private.business_today()), p_note, auth.uid());
  end if;
  if v_revalue <> 0 then
    insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
      reference_id, rate, amount, movement_date, notes, created_by)
    values (p_company_id, p_new_item, case when v_revalue > 0 then 'adjustment_in' else 'adjustment_out' end, 0,
      coalesce(p_unit, 'kg'), p_reference_type, p_reference_id, v_new_rate, abs(v_revalue), private.business_today(),
      p_note || ': purchase cost revalued from ' || v_old_rate || ' to ' || v_new_rate || ' for ' || v_on_hand || ' on hand', auth.uid());
  end if;
end;
$function$;

-- Direct client edits of the balance are rejected; opening stock is journalled.
create or replace function private.guard_inventory_item_balance()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if current_user = 'authenticated' and tg_op = 'UPDATE' and new.current_stock is distinct from old.current_stock then
    raise exception 'Inventory stock moves only through receipts, issues and stock adjustments' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and coalesce(new.current_stock, 0) < 0 then
    raise exception 'Opening stock cannot be negative' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_inventory_item_balance() from public, anon, authenticated;
drop trigger if exists a_guard_inventory_item_balance on public.inventory_items;
create trigger a_guard_inventory_item_balance before insert or update on public.inventory_items
  for each row execute function private.guard_inventory_item_balance();

create or replace function private.journal_inventory_opening_stock()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(new.current_stock, 0) > 0 then
    insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
      reference_id, rate, amount, movement_date, notes, created_by)
    values (new.company_id, new.id, 'adjustment_in', new.current_stock, coalesce(new.unit, 'kg'), 'opening_stock', new.id,
      coalesce(new.average_rate, 0), round(new.current_stock * coalesce(new.average_rate, 0), 2), private.business_today(),
      'Opening stock when the item was created', auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function private.journal_inventory_opening_stock() from public, anon, authenticated;
drop trigger if exists journal_inventory_opening_stock on public.inventory_items;
create trigger journal_inventory_opening_stock after insert on public.inventory_items
  for each row execute function private.journal_inventory_opening_stock();

create or replace function private.post_inventory_adjustment(p_item_id uuid, p_direction text, p_quantity numeric, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_item public.inventory_items%rowtype;
  v_qty numeric := round(coalesce(p_quantity, 0), 3);
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','inventory_manager','factory_manager') then
    raise exception 'Permission denied to adjust stock' using errcode = '42501';
  end if;
  if p_direction not in ('in','out') or v_qty <= 0 then raise exception 'Give a positive adjustment quantity and direction in/out' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give an adjustment reason of at least 10 characters' using errcode = '23514'; end if;
  select * into v_item from public.inventory_items where id = p_item_id and company_id = v_company_id for update;
  if not found then raise exception 'Inventory item not found for this company' using errcode = '23514'; end if;
  if p_direction = 'out' and coalesce(v_item.current_stock, 0) - v_qty < -0.0005 then
    raise exception 'Stock of % % is less than the % to remove', v_item.current_stock, v_item.unit, v_qty using errcode = '23514';
  end if;
  update public.inventory_items set current_stock = coalesce(current_stock, 0) + case when p_direction = 'in' then v_qty else -v_qty end,
    updated_at = now() where id = p_item_id;
  insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
    reference_id, rate, amount, movement_date, notes, created_by)
  values (v_company_id, p_item_id, case when p_direction = 'in' then 'adjustment_in' else 'adjustment_out' end, v_qty,
    coalesce(v_item.unit, 'kg'), 'stock_adjustment', p_item_id, coalesce(v_item.average_rate, 0),
    round(v_qty * coalesce(v_item.average_rate, 0), 2), private.business_today(), btrim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.post_inventory_adjustment(uuid, text, numeric, text) from public, anon, authenticated;
create or replace function public.post_inventory_adjustment(p_item_id uuid, p_direction text, p_quantity numeric, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.post_inventory_adjustment(p_item_id, p_direction, p_quantity, p_reason) $$;
revoke all on function public.post_inventory_adjustment(uuid, text, numeric, text) from public, anon;
grant execute on function public.post_inventory_adjustment(uuid, text, numeric, text) to authenticated;

-- Furnace charge / refund on a foundry source moves its inventory item.
-- consumption delta = change in availability not explained by a receipt-weight correction.
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
begin
  if v_item is null or v_delta = 0 then return null; end if;
  select current_stock, average_rate into v_stock, v_rate from public.inventory_items where id = v_item and company_id = new.company_id for update;
  if not found then return null; end if;
  if coalesce(v_stock, 0) + v_delta < -0.0005 then
    raise exception 'Inventory item stock (%) is below the % kg charged from source %', v_stock, -v_delta, v_number using errcode = '23514';
  end if;
  update public.inventory_items set current_stock = coalesce(current_stock, 0) + v_delta, updated_at = now() where id = v_item;
  insert into public.inventory_movements(company_id, inventory_item_id, movement_type, quantity, unit, reference_type,
    reference_id, rate, amount, movement_date, notes, created_by)
  values (new.company_id, v_item, case when v_delta < 0 then 'production_issue' else 'return_in' end, abs(v_delta), 'kg',
    tg_table_name, new.id, coalesce(v_rate, 0), round(abs(v_delta) * coalesce(v_rate, 0), 2), private.business_today(),
    case when v_delta < 0 then concat('Charged to furnace from ', v_number) else concat('Furnace charge refunded to ', v_number) end, auth.uid());
  return null;
end;
$$;
revoke all on function private.post_foundry_source_consumption() from public, anon, authenticated;
drop trigger if exists post_foundry_source_consumption on public.foundry_aluminium_scrap;
create trigger post_foundry_source_consumption after update of available_weight_kg on public.foundry_aluminium_scrap
  for each row execute function private.post_foundry_source_consumption();
drop trigger if exists post_foundry_source_consumption on public.foundry_external_aluminium_sources;
create trigger post_foundry_source_consumption after update of available_weight_kg on public.foundry_external_aluminium_sources
  for each row execute function private.post_foundry_source_consumption();

create or replace view public.inventory_ledger_reconciliation
with (security_invoker = true) as
select i.company_id, i.id inventory_item_id, i.item_code, i.item_name, i.current_stock,
  coalesce(sum((case when m.movement_type in ('purchase_in','production_in','scrap_in','adjustment_in','return_in') then 1 when m.movement_type in ('production_issue','dispatch_out','scrap_out','adjustment_out') then -1 else 0 end) * m.quantity), 0)::numeric(14,3) ledger_stock,
  (coalesce(i.current_stock, 0) - coalesce(sum((case when m.movement_type in ('purchase_in','production_in','scrap_in','adjustment_in','return_in') then 1 when m.movement_type in ('production_issue','dispatch_out','scrap_out','adjustment_out') then -1 else 0 end) * m.quantity), 0))::numeric(14,3) difference
from public.inventory_items i
left join public.inventory_movements m on m.inventory_item_id = i.id and m.company_id = i.company_id
group by i.company_id, i.id, i.item_code, i.item_name, i.current_stock;
revoke all on public.inventory_ledger_reconciliation from public, anon;
grant select on public.inventory_ledger_reconciliation to authenticated;

commit;
