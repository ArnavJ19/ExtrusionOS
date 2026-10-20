-- BUG (found via UAT, after fixing the dispatcher in 20260809000008): the foundry scrap and
-- external-source expense-sync trigger functions do a self-UPDATE of their own table inside
-- an AFTER INSERT/UPDATE trigger with NO re-entry guard, so once the trigger actually fires
-- they recurse until "stack depth limit exceeded". Their sibling sync_outsourced_billet_expense
-- already guards with pg_trigger_depth() > 1 (as do the energy/maintenance sync functions);
-- these two were missing it. This adds the same guard so the self-UPDATE cannot re-run the body.
-- Bodies are otherwise identical to their current definitions.

create or replace function public.sync_scrap_inventory_and_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_code text;
  v_item_name text;
  v_item_id uuid;
  v_expense_id uuid;
  v_delta numeric(14,3);
  v_base numeric(14,2);
  v_total numeric(14,2);
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.inventory_item_id is not null and coalesce(old.weight_kg, 0) > 0 then
      update public.inventory_items
      set current_stock = greatest(current_stock - old.weight_kg, 0),
          updated_at = now()
      where id = old.inventory_item_id and company_id = old.company_id;

      insert into public.inventory_movements (
        company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
      ) values (
        old.company_id, old.inventory_item_id, 'adjustment_out', old.weight_kg, coalesce(old.unit, 'kg'), 'foundry_aluminium_scrap', old.id, coalesce(old.rate, 0), coalesce(old.total_amount, 0), current_date, 'Scrap source deleted', auth.uid()
      );
    end if;

    if old.expense_ledger_id is not null then
      update public.expense_ledger
      set approval_status = 'cancelled',
          payment_status = case when amount_paid > 0 then payment_status else 'cancelled' end,
          deleted_at = now(),
          updated_by = auth.uid(),
          updated_at = now()
      where id = old.expense_ledger_id and company_id = old.company_id;
    end if;

    return old;
  end if;

  v_item_code := concat('SCRAP-', upper(regexp_replace(coalesce(new.scrap_quality, 'MIXED'), '[^a-zA-Z0-9]+', '-', 'g')));
  v_item_name := concat('Aluminium Scrap ', replace(coalesce(new.scrap_quality, 'mixed'), '_', ' '));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code, btrim(v_item_name), 'scrap', coalesce(new.unit, 'kg'));

  new.inventory_item_id := v_item_id;

  if tg_op = 'INSERT' then
    update public.inventory_items
    set current_stock = current_stock + coalesce(new.weight_kg, 0),
        average_rate = case
          when current_stock + coalesce(new.weight_kg, 0) > 0 and coalesce(new.rate, 0) > 0 then
            round((((current_stock * average_rate) + (coalesce(new.weight_kg, 0) * coalesce(new.rate, 0))) / nullif(current_stock + coalesce(new.weight_kg, 0), 0))::numeric, 2)
          else average_rate
        end,
        updated_at = now()
    where id = v_item_id and company_id = new.company_id;

    insert into public.inventory_movements (
      company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
    ) values (
      new.company_id, v_item_id, 'scrap_in', coalesce(new.weight_kg, 0), coalesce(new.unit, 'kg'), 'foundry_aluminium_scrap', new.id, coalesce(new.rate, 0), coalesce(new.total_amount, 0), coalesce(new.received_date, current_date), 'Incoming aluminium scrap purchase', auth.uid()
    );
  else
    v_delta := coalesce(new.weight_kg, 0) - coalesce(old.weight_kg, 0);
    if v_delta <> 0 then
      update public.inventory_items
      set current_stock = greatest(current_stock + v_delta, 0),
          updated_at = now()
      where id = v_item_id and company_id = new.company_id;

      insert into public.inventory_movements (
        company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
      ) values (
        new.company_id,
        v_item_id,
        case when v_delta >= 0 then 'adjustment_in' else 'adjustment_out' end,
        abs(v_delta),
        coalesce(new.unit, 'kg'),
        'foundry_aluminium_scrap',
        new.id,
        coalesce(new.rate, 0),
        abs(round((v_delta * coalesce(new.rate, 0))::numeric, 2)),
        current_date,
        'Weight updated for aluminium scrap source',
        auth.uid()
      );
    end if;
  end if;

  v_base := case when coalesce(new.base_amount, 0) > 0 then new.base_amount else round((coalesce(new.weight_kg, 0) * coalesce(new.rate, 0))::numeric, 2) end;
  v_total := case when coalesce(new.total_amount, 0) > 0 then new.total_amount else round((v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0))::numeric, 2) end;

  update public.foundry_aluminium_scrap
  set base_amount = v_base,
      total_amount = v_total,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  v_expense_id := public.upsert_source_expense(
    new.company_id, 'foundry', 'scrap_purchase', 'foundry_aluminium_scrap', new.id, new.scrap_number,
    'raw_material', 'scrap_purchase', new.vendor_id,
    concat('Aluminium scrap purchase: ', replace(new.scrap_quality, '_', ' '), ' (', replace(new.scrap_source, '_', ' '), ')'),
    new.weight_kg, coalesce(new.unit, 'kg'), coalesce(new.rate, 0), v_base,
    coalesce(new.tax_amount, 0), coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total,
    new.payment_status, new.payment_method, new.invoice_number, new.invoice_date, new.due_date, v_item_id
  );

  update public.foundry_aluminium_scrap
  set expense_ledger_id = v_expense_id,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  return new;
end;
$$;

create or replace function public.sync_external_source_inventory_and_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_code text;
  v_item_name text;
  v_item_id uuid;
  v_expense_id uuid;
  v_delta numeric(14,3);
  v_base numeric(14,2);
  v_total numeric(14,2);
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.inventory_item_id is not null and coalesce(old.weight_kg, 0) > 0 then
      update public.inventory_items
      set current_stock = greatest(current_stock - old.weight_kg, 0),
          updated_at = now()
      where id = old.inventory_item_id and company_id = old.company_id;

      insert into public.inventory_movements (
        company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
      ) values (
        old.company_id, old.inventory_item_id, 'adjustment_out', old.weight_kg, coalesce(old.unit, 'kg'), 'foundry_external_aluminium_sources', old.id, coalesce(old.rate, 0), coalesce(old.total_amount, 0), current_date, 'External source deleted', auth.uid()
      );
    end if;

    if old.expense_ledger_id is not null then
      update public.expense_ledger
      set approval_status = 'cancelled',
          payment_status = case when amount_paid > 0 then payment_status else 'cancelled' end,
          deleted_at = now(),
          updated_by = auth.uid(),
          updated_at = now()
      where id = old.expense_ledger_id and company_id = old.company_id;
    end if;

    return old;
  end if;

  v_item_code := concat('RM-EXT-', upper(regexp_replace(coalesce(new.item_type, 'raw'), '[^a-zA-Z0-9]+', '-', 'g')), '-', upper(regexp_replace(coalesce(new.alloy, 'GEN'), '[^a-zA-Z0-9]+', '', 'g')));
  v_item_name := concat('External Aluminium ', replace(coalesce(new.item_type, 'raw_material'), '_', ' '), ' ', coalesce(new.alloy, ''));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code, btrim(v_item_name), 'billets', coalesce(new.unit, 'kg'));

  new.inventory_item_id := v_item_id;

  if tg_op = 'INSERT' then
    update public.inventory_items
    set current_stock = current_stock + coalesce(new.weight_kg, 0),
        average_rate = case
          when current_stock + coalesce(new.weight_kg, 0) > 0 and coalesce(new.rate, 0) > 0 then
            round((((current_stock * average_rate) + (coalesce(new.weight_kg, 0) * coalesce(new.rate, 0))) / nullif(current_stock + coalesce(new.weight_kg, 0), 0))::numeric, 2)
          else average_rate
        end,
        updated_at = now()
    where id = v_item_id and company_id = new.company_id;

    insert into public.inventory_movements (
      company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
    ) values (
      new.company_id, v_item_id, 'purchase_in', coalesce(new.weight_kg, 0), coalesce(new.unit, 'kg'), 'foundry_external_aluminium_sources', new.id, coalesce(new.rate, 0), coalesce(new.total_amount, 0), coalesce(new.received_date, current_date), 'External aluminium source purchase', auth.uid()
    );
  else
    v_delta := coalesce(new.weight_kg, 0) - coalesce(old.weight_kg, 0);
    if v_delta <> 0 then
      update public.inventory_items
      set current_stock = greatest(current_stock + v_delta, 0),
          updated_at = now()
      where id = v_item_id and company_id = new.company_id;

      insert into public.inventory_movements (
        company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
      ) values (
        new.company_id,
        v_item_id,
        case when v_delta >= 0 then 'adjustment_in' else 'adjustment_out' end,
        abs(v_delta),
        coalesce(new.unit, 'kg'),
        'foundry_external_aluminium_sources',
        new.id,
        coalesce(new.rate, 0),
        abs(round((v_delta * coalesce(new.rate, 0))::numeric, 2)),
        current_date,
        'Weight updated for external aluminium source',
        auth.uid()
      );
    end if;
  end if;

  v_base := case when coalesce(new.base_amount, 0) > 0 then new.base_amount else round((coalesce(new.weight_kg, 0) * coalesce(new.rate, 0))::numeric, 2) end;
  v_total := case when coalesce(new.total_amount, 0) > 0 then new.total_amount else round((v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0))::numeric, 2) end;

  update public.foundry_external_aluminium_sources
  set base_amount = v_base,
      total_amount = v_total,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  v_expense_id := public.upsert_source_expense(
    new.company_id, 'foundry', 'external_aluminium_sources', 'foundry_external_aluminium_sources', new.id, new.source_number,
    'raw_material', 'external_aluminium_source', new.vendor_id,
    concat('External aluminium purchase: ', replace(new.item_type, '_', ' '), coalesce(concat(' alloy ', new.alloy), '')),
    new.weight_kg, coalesce(new.unit, 'kg'), coalesce(new.rate, 0), v_base,
    coalesce(new.tax_amount, 0), coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total,
    new.payment_status, new.payment_method, new.invoice_number, new.invoice_date, new.due_date, v_item_id
  );

  update public.foundry_external_aluminium_sources
  set expense_ledger_id = v_expense_id,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  return new;
end;
$$;
