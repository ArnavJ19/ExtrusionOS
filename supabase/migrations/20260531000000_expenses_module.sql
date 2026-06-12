-- Expenses module foundation with source-linked ledger architecture

create table if not exists public.expense_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  expense_number text not null,
  source_module text not null default 'manual',
  source_submodule text,
  source_table text,
  source_record_id uuid,
  source_label text,
  expense_category text not null,
  expense_subcategory text,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_name_snapshot text,
  description text,
  quantity numeric(14,3) not null default 0,
  unit text,
  rate numeric(14,2) not null default 0,
  base_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  freight_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  currency text not null default 'INR',
  amount_paid numeric(14,2) not null default 0,
  balance_amount numeric(14,2) not null default 0,
  payment_status text not null default 'unpaid',
  payment_method text,
  invoice_number text,
  invoice_date date,
  due_date date,
  paid_date date,
  cost_center text,
  department text,
  machine_id uuid references public.machines(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  maintenance_record_id uuid,
  approval_status text not null default 'draft',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint expense_ledger_company_number_unique unique (company_id, expense_number)
);

alter table public.expense_ledger
  add constraint expense_ledger_quantity_nonnegative check (quantity >= 0);
alter table public.expense_ledger
  add constraint expense_ledger_rate_nonnegative check (rate >= 0);
alter table public.expense_ledger
  add constraint expense_ledger_amounts_nonnegative check (
    base_amount >= 0 and tax_amount >= 0 and freight_amount >= 0 and discount_amount >= 0 and amount_paid >= 0
  );
alter table public.expense_ledger
  add constraint expense_ledger_total_nonnegative check (total_amount >= 0);
alter table public.expense_ledger
  add constraint expense_ledger_balance_nonnegative check (balance_amount >= 0);
alter table public.expense_ledger
  add constraint expense_ledger_currency_check check (currency in ('INR', 'USD', 'EUR', 'AED', 'GBP', 'other'));
alter table public.expense_ledger
  add constraint expense_ledger_payment_status_check check (payment_status in ('unpaid','partially_paid','paid','overdue','cancelled','reversed'));
alter table public.expense_ledger
  add constraint expense_ledger_approval_status_check check (approval_status in ('draft','pending_approval','approved','rejected','paid','cancelled','reversed'));

create unique index if not exists expense_ledger_source_unique_idx
  on public.expense_ledger(company_id, source_table, source_record_id)
  where source_table is not null and source_record_id is not null;

create index if not exists expense_ledger_company_created_idx on public.expense_ledger(company_id, created_at desc);
create index if not exists expense_ledger_company_category_idx on public.expense_ledger(company_id, expense_category, expense_subcategory);
create index if not exists expense_ledger_company_vendor_idx on public.expense_ledger(company_id, vendor_id, created_at desc);
create index if not exists expense_ledger_company_payment_idx on public.expense_ledger(company_id, payment_status, due_date);
create index if not exists expense_ledger_company_approval_idx on public.expense_ledger(company_id, approval_status, created_at desc);

create table if not exists public.expense_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  expense_ledger_id uuid not null references public.expense_ledger(id) on delete cascade,
  payment_date date not null default current_date,
  amount_paid numeric(14,2) not null,
  payment_method text,
  bank_account text,
  reference_number text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expense_payments
  add constraint expense_payments_amount_positive check (amount_paid > 0);

create index if not exists expense_payments_company_expense_idx on public.expense_payments(company_id, expense_ledger_id, payment_date desc);
create index if not exists expense_payments_company_reference_idx on public.expense_payments(company_id, reference_number);

alter table public.expense_ledger enable row level security;
alter table public.expense_payments enable row level security;

create policy "expense ledger tenant read" on public.expense_ledger
  for select using (company_id = public.get_current_user_company_id());
create policy "expense ledger tenant insert" on public.expense_ledger
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','accounts','production_manager','production','dispatch_manager','dispatch','inventory_manager','factory_manager')
  );
create policy "expense ledger tenant update" on public.expense_ledger
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','accounts','production_manager','production','dispatch_manager','dispatch','inventory_manager','factory_manager')
  )
  with check (company_id = public.get_current_user_company_id());

create policy "expense payments tenant read" on public.expense_payments
  for select using (company_id = public.get_current_user_company_id());
create policy "expense payments tenant insert" on public.expense_payments
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','accounts')
  );
create policy "expense payments tenant update" on public.expense_payments
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','accounts')
  )
  with check (company_id = public.get_current_user_company_id());

create or replace function public.expense_generate_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.expense_number is null or btrim(new.expense_number) = '' then
    new.expense_number := concat('EXP-', to_char(now(), 'YYYYMMDDHH24MISS'), '-', upper(substring(replace(new.id::text, '-', '') from 1 for 6)));
  end if;
  return new;
end;
$$;

create or replace function public.expense_apply_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.quantity := coalesce(new.quantity, 0);
  new.rate := coalesce(new.rate, 0);
  new.base_amount := coalesce(new.base_amount, 0);
  new.tax_amount := coalesce(new.tax_amount, 0);
  new.freight_amount := coalesce(new.freight_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.total_amount := coalesce(new.total_amount, new.base_amount + new.tax_amount + new.freight_amount - new.discount_amount);

  if new.total_amount <= 0 and new.quantity > 0 and new.rate > 0 then
    new.base_amount := round((new.quantity * new.rate)::numeric, 2);
    new.total_amount := round((new.base_amount + new.tax_amount + new.freight_amount - new.discount_amount)::numeric, 2);
  end if;

  new.amount_paid := coalesce(new.amount_paid, 0);
  if new.amount_paid > new.total_amount then
    raise exception 'Payment amount cannot exceed total expense amount';
  end if;

  new.balance_amount := greatest(round((new.total_amount - new.amount_paid)::numeric, 2), 0);

  if new.approval_status in ('cancelled', 'reversed') then
    new.payment_status := new.approval_status;
  elsif new.balance_amount = 0 and new.total_amount > 0 then
    new.payment_status := 'paid';
    new.paid_date := coalesce(new.paid_date, current_date);
  elsif new.amount_paid > 0 and new.balance_amount > 0 then
    new.payment_status := 'partially_paid';
  elsif new.due_date is not null and new.due_date < current_date and new.balance_amount > 0 then
    new.payment_status := 'overdue';
  else
    new.payment_status := 'unpaid';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.sync_expense_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_company_id uuid;
  v_paid numeric(14,2);
begin
  v_expense_id := coalesce(new.expense_ledger_id, old.expense_ledger_id);
  v_company_id := coalesce(new.company_id, old.company_id);

  select coalesce(sum(amount_paid), 0)
    into v_paid
  from public.expense_payments
  where expense_ledger_id = v_expense_id and company_id = v_company_id;

  update public.expense_ledger
  set amount_paid = v_paid,
      updated_at = now()
  where id = v_expense_id and company_id = v_company_id;

  return coalesce(new, old);
end;
$$;

create or replace function public.log_expense_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_created', 'expense_ledger', new.id, jsonb_build_object('expense_number', new.expense_number, 'source_table', new.source_table, 'source_record_id', new.source_record_id, 'total_amount', new.total_amount));
    return new;
  end if;

  if tg_op = 'UPDATE' then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_updated', 'expense_ledger', new.id, jsonb_build_object('expense_number', new.expense_number, 'payment_status', new.payment_status, 'approval_status', new.approval_status, 'total_amount', new.total_amount, 'amount_paid', new.amount_paid));
    return new;
  end if;

  return null;
end;
$$;

create or replace function public.log_expense_payment_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_payment_added', 'expense_payments', new.id, jsonb_build_object('expense_ledger_id', new.expense_ledger_id, 'amount_paid', new.amount_paid, 'payment_date', new.payment_date));
    return new;
  end if;

  if tg_op = 'UPDATE' then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_payment_updated', 'expense_payments', new.id, jsonb_build_object('expense_ledger_id', new.expense_ledger_id, 'amount_paid', new.amount_paid, 'payment_date', new.payment_date));
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (old.company_id, auth.uid(), 'expense_payment_deleted', 'expense_payments', old.id, jsonb_build_object('expense_ledger_id', old.expense_ledger_id, 'amount_paid', old.amount_paid, 'payment_date', old.payment_date));
    return old;
  end if;

  return null;
end;
$$;

create or replace function public.upsert_source_expense(
  p_company_id uuid,
  p_source_module text,
  p_source_submodule text,
  p_source_table text,
  p_source_record_id uuid,
  p_source_label text,
  p_expense_category text,
  p_expense_subcategory text,
  p_vendor_id uuid,
  p_description text,
  p_quantity numeric,
  p_unit text,
  p_rate numeric,
  p_base_amount numeric,
  p_tax_amount numeric,
  p_freight_amount numeric,
  p_discount_amount numeric,
  p_total_amount numeric,
  p_payment_status text,
  p_payment_method text,
  p_invoice_number text,
  p_invoice_date date,
  p_due_date date,
  p_inventory_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_vendor_name text;
begin
  if p_vendor_id is not null then
    select vendor_name into v_vendor_name
    from public.vendors
    where id = p_vendor_id and company_id = p_company_id;
  end if;

  if p_invoice_number is not null and p_vendor_id is not null then
    if exists (
      select 1
      from public.expense_ledger e
      where e.company_id = p_company_id
        and e.vendor_id = p_vendor_id
        and e.invoice_number = p_invoice_number
        and coalesce(e.source_record_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(p_source_record_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and e.deleted_at is null
    ) then
      raise warning 'Duplicate invoice number % detected for the same vendor', p_invoice_number;
    end if;
  end if;

  insert into public.expense_ledger (
    company_id,
    source_module,
    source_submodule,
    source_table,
    source_record_id,
    source_label,
    expense_category,
    expense_subcategory,
    vendor_id,
    vendor_name_snapshot,
    description,
    quantity,
    unit,
    rate,
    base_amount,
    tax_amount,
    freight_amount,
    discount_amount,
    total_amount,
    payment_status,
    payment_method,
    invoice_number,
    invoice_date,
    due_date,
    inventory_item_id,
    approval_status,
    created_by,
    updated_by
  )
  values (
    p_company_id,
    p_source_module,
    p_source_submodule,
    p_source_table,
    p_source_record_id,
    p_source_label,
    p_expense_category,
    p_expense_subcategory,
    p_vendor_id,
    v_vendor_name,
    p_description,
    coalesce(p_quantity, 0),
    p_unit,
    coalesce(p_rate, 0),
    coalesce(p_base_amount, 0),
    coalesce(p_tax_amount, 0),
    coalesce(p_freight_amount, 0),
    coalesce(p_discount_amount, 0),
    coalesce(p_total_amount, 0),
    coalesce(p_payment_status, 'unpaid'),
    p_payment_method,
    p_invoice_number,
    p_invoice_date,
    p_due_date,
    p_inventory_item_id,
    'pending_approval',
    auth.uid(),
    auth.uid()
  )
  on conflict (company_id, source_table, source_record_id)
  do update set
    source_module = excluded.source_module,
    source_submodule = excluded.source_submodule,
    source_label = excluded.source_label,
    expense_category = excluded.expense_category,
    expense_subcategory = excluded.expense_subcategory,
    vendor_id = excluded.vendor_id,
    vendor_name_snapshot = excluded.vendor_name_snapshot,
    description = excluded.description,
    quantity = excluded.quantity,
    unit = excluded.unit,
    rate = excluded.rate,
    base_amount = excluded.base_amount,
    tax_amount = excluded.tax_amount,
    freight_amount = excluded.freight_amount,
    discount_amount = excluded.discount_amount,
    total_amount = excluded.total_amount,
    payment_method = excluded.payment_method,
    invoice_number = excluded.invoice_number,
    invoice_date = excluded.invoice_date,
    due_date = excluded.due_date,
    inventory_item_id = excluded.inventory_item_id,
    payment_status = case
      when public.expense_ledger.payment_status in ('paid','partially_paid','overdue','cancelled','reversed') then public.expense_ledger.payment_status
      else excluded.payment_status
    end,
    updated_by = auth.uid(),
    updated_at = now(),
    deleted_at = null
  returning id into v_expense_id;

  return v_expense_id;
end;
$$;

alter table public.foundry_external_aluminium_sources
  add column if not exists unit text not null default 'kg',
  add column if not exists rate numeric(14,2) not null default 0,
  add column if not exists base_amount numeric(14,2) not null default 0,
  add column if not exists tax_amount numeric(14,2) not null default 0,
  add column if not exists freight_amount numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0,
  add column if not exists total_amount numeric(14,2) not null default 0,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists due_date date,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_method text,
  add column if not exists expense_ledger_id uuid references public.expense_ledger(id) on delete set null,
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

alter table public.foundry_aluminium_scrap
  add column if not exists unit text not null default 'kg',
  add column if not exists rate numeric(14,2) not null default 0,
  add column if not exists base_amount numeric(14,2) not null default 0,
  add column if not exists tax_amount numeric(14,2) not null default 0,
  add column if not exists freight_amount numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0,
  add column if not exists total_amount numeric(14,2) not null default 0,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists due_date date,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_method text,
  add column if not exists expense_ledger_id uuid references public.expense_ledger(id) on delete set null,
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

alter table public.outsourced_billet_batches
  add column if not exists unit text not null default 'kg',
  add column if not exists base_amount numeric(14,2) not null default 0,
  add column if not exists tax_amount numeric(14,2) not null default 0,
  add column if not exists freight_amount numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists due_date date,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_method text,
  add column if not exists expense_ledger_id uuid references public.expense_ledger(id) on delete set null,
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null;

alter table public.foundry_external_aluminium_sources
  add constraint foundry_external_amounts_nonnegative check (rate >= 0 and base_amount >= 0 and tax_amount >= 0 and freight_amount >= 0 and discount_amount >= 0 and total_amount >= 0);
alter table public.foundry_aluminium_scrap
  add constraint foundry_scrap_amounts_nonnegative check (rate >= 0 and base_amount >= 0 and tax_amount >= 0 and freight_amount >= 0 and discount_amount >= 0 and total_amount >= 0);
alter table public.outsourced_billet_batches
  add constraint outsourced_billet_amounts_nonnegative check (price_per_kg is null or price_per_kg >= 0);

create or replace function public.ensure_inventory_item_for_expense_source(
  p_company_id uuid,
  p_item_code text,
  p_item_name text,
  p_item_category text,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  select id into v_item_id
  from public.inventory_items
  where company_id = p_company_id and item_code = p_item_code
  limit 1;

  if v_item_id is null then
    insert into public.inventory_items (
      company_id,
      item_code,
      item_name,
      item_category,
      unit,
      current_stock,
      reorder_level,
      average_rate,
      is_active
    )
    values (
      p_company_id,
      p_item_code,
      p_item_name,
      p_item_category,
      p_unit,
      0,
      0,
      0,
      true
    )
    returning id into v_item_id;
  end if;

  return v_item_id;
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
    new.company_id,
    'foundry',
    'external_aluminium_sources',
    'foundry_external_aluminium_sources',
    new.id,
    new.source_number,
    'raw_material',
    'external_aluminium_source',
    new.vendor_id,
    concat('External aluminium purchase: ', replace(new.item_type, '_', ' '), coalesce(concat(' alloy ', new.alloy), '')),
    new.weight_kg,
    coalesce(new.unit, 'kg'),
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

  update public.foundry_external_aluminium_sources
  set expense_ledger_id = v_expense_id,
      inventory_item_id = v_item_id,
      updated_at = now()
  where id = new.id and company_id = new.company_id;

  return new;
end;
$$;

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
    new.company_id,
    'foundry',
    'scrap_purchase',
    'foundry_aluminium_scrap',
    new.id,
    new.scrap_number,
    'raw_material',
    'scrap_purchase',
    new.vendor_id,
    concat('Aluminium scrap purchase: ', replace(new.scrap_quality, '_', ' '), ' (', replace(new.scrap_source, '_', ' '), ')'),
    new.weight_kg,
    coalesce(new.unit, 'kg'),
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

  update public.foundry_aluminium_scrap
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
begin
  if tg_op = 'DELETE' then
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

create or replace function public.sync_expense_link_for_sources()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'foundry_external_aluminium_sources' then
    return public.sync_external_source_inventory_and_expense();
  elsif tg_table_name = 'foundry_aluminium_scrap' then
    return public.sync_scrap_inventory_and_expense();
  elsif tg_table_name = 'outsourced_billet_batches' then
    return public.sync_outsourced_billet_expense();
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists expense_generate_number on public.expense_ledger;
create trigger expense_generate_number
before insert on public.expense_ledger
for each row execute function public.expense_generate_number();

drop trigger if exists expense_apply_totals on public.expense_ledger;
create trigger expense_apply_totals
before insert or update on public.expense_ledger
for each row execute function public.expense_apply_totals();

drop trigger if exists set_expense_ledger_updated_at on public.expense_ledger;
create trigger set_expense_ledger_updated_at
before update on public.expense_ledger
for each row execute function public.set_updated_at();

drop trigger if exists set_expense_payments_updated_at on public.expense_payments;
create trigger set_expense_payments_updated_at
before update on public.expense_payments
for each row execute function public.set_updated_at();

drop trigger if exists sync_expense_payment_totals on public.expense_payments;
create trigger sync_expense_payment_totals
after insert or update or delete on public.expense_payments
for each row execute function public.sync_expense_payment_totals();

drop trigger if exists log_expense_audit on public.expense_ledger;
create trigger log_expense_audit
after insert or update on public.expense_ledger
for each row execute function public.log_expense_audit();

drop trigger if exists log_expense_payment_audit on public.expense_payments;
create trigger log_expense_payment_audit
after insert or update or delete on public.expense_payments
for each row execute function public.log_expense_payment_audit();

drop trigger if exists sync_expense_foundry_external_sources on public.foundry_external_aluminium_sources;
create trigger sync_expense_foundry_external_sources
after insert or update or delete on public.foundry_external_aluminium_sources
for each row execute function public.sync_expense_link_for_sources();

drop trigger if exists sync_expense_foundry_scrap on public.foundry_aluminium_scrap;
create trigger sync_expense_foundry_scrap
after insert or update or delete on public.foundry_aluminium_scrap
for each row execute function public.sync_expense_link_for_sources();

drop trigger if exists sync_expense_outsourced_billets on public.outsourced_billet_batches;
create trigger sync_expense_outsourced_billets
after insert or update or delete on public.outsourced_billet_batches
for each row execute function public.sync_expense_link_for_sources();
