-- Expenses module phase 2: packaging purchase source integration, outsourced billet inventory sync,
-- and approved expense immutability protections.

create table if not exists public.packaging_material_purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_number text not null,
  material_id uuid not null references public.packaging_materials(id) on delete restrict,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  received_date date not null default current_date,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'meter',
  rate numeric(14,2) not null default 0,
  base_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  freight_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  invoice_number text,
  invoice_date date,
  due_date date,
  payment_status text not null default 'unpaid',
  payment_method text,
  notes text,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  expense_ledger_id uuid references public.expense_ledger(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint packaging_material_purchases_company_number_unique unique (company_id, purchase_number),
  constraint packaging_material_purchases_amounts_nonnegative check (
    rate >= 0 and base_amount >= 0 and tax_amount >= 0 and freight_amount >= 0 and discount_amount >= 0 and total_amount >= 0
  ),
  constraint packaging_material_purchases_payment_status_check check (
    payment_status in ('unpaid','partially_paid','paid','overdue','cancelled','reversed')
  )
);

create index if not exists packaging_material_purchases_company_date_idx
  on public.packaging_material_purchases(company_id, received_date desc);
create index if not exists packaging_material_purchases_company_vendor_idx
  on public.packaging_material_purchases(company_id, vendor_id, received_date desc);
create index if not exists packaging_material_purchases_company_material_idx
  on public.packaging_material_purchases(company_id, material_id, received_date desc);

alter table public.packaging_material_purchases enable row level security;

drop policy if exists "packaging material purchases tenant read" on public.packaging_material_purchases;
create policy "packaging material purchases tenant read"
  on public.packaging_material_purchases
  for select
  using (company_id = public.get_current_user_company_id());

drop policy if exists "packaging material purchases tenant insert" on public.packaging_material_purchases;
create policy "packaging material purchases tenant insert"
  on public.packaging_material_purchases
  for insert
  with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','accounts','production_manager','production','dispatch_manager','dispatch','inventory_manager','factory_manager')
  );

drop policy if exists "packaging material purchases tenant update" on public.packaging_material_purchases;
create policy "packaging material purchases tenant update"
  on public.packaging_material_purchases
  for update
  using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','accounts','production_manager','production','dispatch_manager','dispatch','inventory_manager','factory_manager')
  )
  with check (company_id = public.get_current_user_company_id());

create or replace function public.sync_packaging_purchase_inventory_and_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material_code text;
  v_material_name text;
  v_material_type text;
  v_material_unit text;
  v_item_code text;
  v_item_id uuid;
  v_expense_id uuid;
  v_delta numeric(14,3);
  v_base numeric(14,2);
  v_total numeric(14,2);
begin
  -- Guard against recursion from post-trigger updates within this function.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.inventory_item_id is not null and coalesce(old.quantity, 0) > 0 then
      update public.inventory_items
      set current_stock = greatest(current_stock - old.quantity, 0),
          updated_at = now()
      where id = old.inventory_item_id and company_id = old.company_id;

      insert into public.inventory_movements (
        company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
      ) values (
        old.company_id,
        old.inventory_item_id,
        'adjustment_out',
        old.quantity,
        coalesce(old.unit, 'meter'),
        'packaging_material_purchases',
        old.id,
        coalesce(old.rate, 0),
        coalesce(old.total_amount, 0),
        current_date,
        'Packaging material purchase deleted',
        auth.uid()
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

  if tg_op = 'UPDATE' and new.material_id <> old.material_id then
    raise exception 'Material cannot be changed for an existing purchase record. Create a new purchase entry instead.';
  end if;

  select material_code, material_name, material_type, unit
    into v_material_code, v_material_name, v_material_type, v_material_unit
  from public.packaging_materials
  where id = new.material_id and company_id = new.company_id;

  if not found then
    raise exception 'Packaging material not found for this company';
  end if;

  v_item_code := concat('PKG-', upper(regexp_replace(coalesce(v_material_code, 'MAT'), '[^a-zA-Z0-9]+', '-', 'g')));
  v_item_id := public.ensure_inventory_item_for_expense_source(
    new.company_id,
    v_item_code,
    concat('Packaging Material ', coalesce(v_material_name, '')),
    'packing_material',
    coalesce(new.unit, v_material_unit, 'meter')
  );

  if tg_op = 'INSERT' then
    v_delta := coalesce(new.quantity, 0);
  else
    v_delta := coalesce(new.quantity, 0) - coalesce(old.quantity, 0);
  end if;

  if v_delta <> 0 then
    update public.inventory_items
    set current_stock = greatest(current_stock + v_delta, 0),
        average_rate = case
          when current_stock + v_delta > 0 and coalesce(new.rate, 0) > 0 and v_delta > 0 then
            round((((current_stock * average_rate) + (v_delta * coalesce(new.rate, 0))) / nullif(current_stock + v_delta, 0))::numeric, 2)
          else average_rate
        end,
        updated_at = now()
    where id = v_item_id and company_id = new.company_id;

    insert into public.inventory_movements (
      company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
    ) values (
      new.company_id,
      v_item_id,
      case when v_delta >= 0 then 'purchase_in' else 'adjustment_out' end,
      abs(v_delta),
      coalesce(new.unit, v_material_unit, 'meter'),
      'packaging_material_purchases',
      new.id,
      coalesce(new.rate, 0),
      abs(round((v_delta * coalesce(new.rate, 0))::numeric, 2)),
      coalesce(new.received_date, current_date),
      case when tg_op = 'INSERT' then 'Packaging material purchase' else 'Packaging material purchase quantity updated' end,
      auth.uid()
    );
  end if;

  v_base := case when coalesce(new.base_amount, 0) > 0 then new.base_amount else round((coalesce(new.quantity, 0) * coalesce(new.rate, 0))::numeric, 2) end;
  v_total := case when coalesce(new.total_amount, 0) > 0 then new.total_amount else round((v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0))::numeric, 2) end;

  update public.packaging_material_purchases
  set base_amount = v_base,
      total_amount = v_total,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  v_expense_id := public.upsert_source_expense(
    new.company_id,
    'packaging',
    'material_purchase',
    'packaging_material_purchases',
    new.id,
    new.purchase_number,
    'packaging_material',
    coalesce(v_material_type, 'other'),
    new.vendor_id,
    concat('Packaging material purchase: ', coalesce(v_material_name, v_material_code, 'Material')),
    new.quantity,
    coalesce(new.unit, v_material_unit, 'meter'),
    coalesce(new.rate, 0),
    v_base,
    coalesce(new.tax_amount, 0),
    coalesce(new.freight_amount, 0),
    coalesce(new.discount_amount, 0),
    v_total,
    new.payment_status,
    new.payment_method,
    new.invoice_number,
    new.invoice_date,
    new.due_date,
    v_item_id
  );

  update public.packaging_material_purchases
  set expense_ledger_id = v_expense_id,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  return new;
end;
$$;

create or replace function public.sync_outsourced_billet_expense()
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
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_effective_new_qty numeric(14,3);
  v_effective_old_qty numeric(14,3);
  v_delta numeric(14,3);
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.inventory_item_id is not null and coalesce(old.weight_kg, 0) > 0 and coalesce(old.status, 'received') <> 'cancelled' then
      update public.inventory_items
      set current_stock = greatest(current_stock - old.weight_kg, 0),
          updated_at = now()
      where id = old.inventory_item_id and company_id = old.company_id;

      insert into public.inventory_movements (
        company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
      ) values (
        old.company_id,
        old.inventory_item_id,
        'adjustment_out',
        old.weight_kg,
        coalesce(old.unit, 'kg'),
        'outsourced_billet_batches',
        old.id,
        coalesce(old.price_per_kg, 0),
        coalesce(old.total_price, 0),
        current_date,
        'Outsourced billet batch deleted',
        auth.uid()
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

  v_item_code := concat('OBB-', upper(regexp_replace(coalesce(new.alloy, 'GEN'), '[^a-zA-Z0-9]+', '', 'g')), '-', replace(coalesce(new.billet_diameter_inch::text, '0'), '.', ''));
  v_item_name := concat('Outsourced billet batch ', coalesce(new.alloy, ''), ' ', coalesce(new.temper, ''));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code, btrim(v_item_name), 'billets', coalesce(new.unit, 'kg'));

  v_effective_new_qty := case when coalesce(new.status, 'received') = 'cancelled' then 0 else coalesce(new.weight_kg, 0) end;
  v_effective_old_qty := case when tg_op = 'INSERT' then 0 when coalesce(old.status, 'received') = 'cancelled' then 0 else coalesce(old.weight_kg, 0) end;
  v_delta := v_effective_new_qty - v_effective_old_qty;

  if v_delta <> 0 then
    update public.inventory_items
    set current_stock = greatest(current_stock + v_delta, 0),
        average_rate = case
          when current_stock + v_delta > 0 and coalesce(new.price_per_kg, 0) > 0 and v_delta > 0 then
            round((((current_stock * average_rate) + (v_delta * coalesce(new.price_per_kg, 0))) / nullif(current_stock + v_delta, 0))::numeric, 2)
          else average_rate
        end,
        updated_at = now()
    where id = v_item_id and company_id = new.company_id;

    insert into public.inventory_movements (
      company_id, inventory_item_id, movement_type, quantity, unit, reference_type, reference_id, rate, amount, movement_date, notes, created_by
    ) values (
      new.company_id,
      v_item_id,
      case when v_delta >= 0 then 'purchase_in' else 'adjustment_out' end,
      abs(v_delta),
      coalesce(new.unit, 'kg'),
      'outsourced_billet_batches',
      new.id,
      coalesce(new.price_per_kg, 0),
      abs(round((v_delta * coalesce(new.price_per_kg, 0))::numeric, 2)),
      coalesce(new.received_date, current_date),
      case when tg_op = 'INSERT' then 'Outsourced billet purchase' else 'Outsourced billet quantity/status updated' end,
      auth.uid()
    );
  end if;

  v_base := case
    when coalesce(new.base_amount, 0) > 0 then new.base_amount
    when coalesce(new.total_price, 0) > 0 then new.total_price
    else round((coalesce(new.weight_kg, 0) * coalesce(new.price_per_kg, 0))::numeric, 2)
  end;
  v_total := round((v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0))::numeric, 2);

  update public.outsourced_billet_batches
  set base_amount = v_base,
      total_price = v_total,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  v_expense_id := public.upsert_source_expense(
    new.company_id,
    'foundry',
    'outsourced_billets',
    'outsourced_billet_batches',
    new.id,
    new.batch_number,
    'raw_material',
    'outsourced_billet_purchase',
    new.vendor_id,
    concat('Outsourced billet batch purchase ', new.batch_number),
    new.weight_kg,
    coalesce(new.unit, 'kg'),
    coalesce(new.price_per_kg, 0),
    v_base,
    coalesce(new.tax_amount, 0),
    coalesce(new.freight_amount, 0),
    coalesce(new.discount_amount, 0),
    v_total,
    new.payment_status,
    new.payment_method,
    new.invoice_number,
    new.invoice_date,
    new.due_date,
    v_item_id
  );

  update public.outsourced_billet_batches
  set expense_ledger_id = v_expense_id,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  return new;
end;
$$;

create or replace function public.prevent_direct_edit_approved_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.approval_status = 'approved' then
    if new.source_module is distinct from old.source_module
      or new.source_submodule is distinct from old.source_submodule
      or new.source_table is distinct from old.source_table
      or new.source_record_id is distinct from old.source_record_id
      or new.expense_category is distinct from old.expense_category
      or new.expense_subcategory is distinct from old.expense_subcategory
      or new.vendor_id is distinct from old.vendor_id
      or new.vendor_name_snapshot is distinct from old.vendor_name_snapshot
      or new.description is distinct from old.description
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.rate is distinct from old.rate
      or new.base_amount is distinct from old.base_amount
      or new.tax_amount is distinct from old.tax_amount
      or new.freight_amount is distinct from old.freight_amount
      or new.discount_amount is distinct from old.discount_amount
      or new.total_amount is distinct from old.total_amount
      or new.currency is distinct from old.currency
      or new.invoice_number is distinct from old.invoice_number
      or new.invoice_date is distinct from old.invoice_date
      or new.due_date is distinct from old.due_date
      or new.cost_center is distinct from old.cost_center
      or new.department is distinct from old.department
      or new.machine_id is distinct from old.machine_id
      or new.inventory_item_id is distinct from old.inventory_item_id
      or new.maintenance_record_id is distinct from old.maintenance_record_id
    then
      raise exception 'Approved expenses cannot be edited directly. Use reversal/adjustment workflow.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists set_packaging_material_purchases_updated_at on public.packaging_material_purchases;
create trigger set_packaging_material_purchases_updated_at
before update on public.packaging_material_purchases
for each row execute function public.set_updated_at();

drop trigger if exists sync_expense_packaging_material_purchases on public.packaging_material_purchases;
create trigger sync_expense_packaging_material_purchases
after insert or update or delete on public.packaging_material_purchases
for each row execute function public.sync_packaging_purchase_inventory_and_expense();

drop trigger if exists prevent_direct_edit_approved_expense on public.expense_ledger;
create trigger prevent_direct_edit_approved_expense
before update on public.expense_ledger
for each row execute function public.prevent_direct_edit_approved_expense();
