-- Expenses module phase 3: approval thresholds + utility and maintenance auto-posting.

alter table public.energy_readings
  add column if not exists expense_ledger_id uuid references public.expense_ledger(id) on delete set null;

alter table public.breakdown_logs
  add column if not exists expense_ledger_id uuid references public.expense_ledger(id) on delete set null,
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists due_date date,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_method text;

alter table public.breakdown_logs
  add constraint breakdown_logs_payment_status_check check (
    payment_status in ('unpaid','partially_paid','paid','overdue','cancelled','reversed')
  );

create index if not exists energy_readings_company_expense_idx
  on public.energy_readings(company_id, expense_ledger_id);
create index if not exists breakdown_logs_company_expense_idx
  on public.breakdown_logs(company_id, expense_ledger_id);

create or replace function public.apply_expense_approval_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_threshold numeric(14,2) := 25000;
begin
  if new.approval_status in ('cancelled','reversed','rejected','paid') then
    return new;
  end if;

  v_role := public.get_current_user_role();

  if coalesce(new.total_amount, 0) <= v_threshold and v_role in ('owner','admin','accounts') then
    new.approval_status := 'approved';
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.approved_at := coalesce(new.approved_at, now());
  else
    if coalesce(new.approval_status, 'draft') in ('draft', 'pending_approval') then
      new.approval_status := 'pending_approval';
      if new.approval_status <> 'approved' then
        new.approved_by := null;
        new.approved_at := null;
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_energy_reading_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_category text;
  v_subcategory text;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

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

  if coalesce(new.total_cost, 0) <= 0 then
    return new;
  end if;

  if new.energy_type in ('diesel','furnace_oil','lpg') then
    v_category := 'fuel_oils';
    v_subcategory := new.energy_type;
  else
    v_category := 'utilities';
    v_subcategory := new.energy_type;
  end if;

  v_expense_id := public.upsert_source_expense(
    new.company_id,
    'energy',
    'energy_readings',
    'energy_readings',
    new.id,
    concat(upper(new.energy_type), '-', to_char(new.reading_date, 'YYYYMMDD')),
    v_category,
    v_subcategory,
    null,
    concat('Utility cost from energy reading: ', replace(new.energy_type, '_', ' ')),
    coalesce(new.consumption, 0),
    coalesce(new.unit, 'units'),
    coalesce(new.rate_per_unit, 0),
    coalesce(new.total_cost, 0),
    0,
    0,
    0,
    coalesce(new.total_cost, 0),
    'unpaid',
    null,
    null,
    null,
    null,
    null
  );

  update public.energy_readings
  set expense_ledger_id = v_expense_id
  where id = new.id and company_id = new.company_id;

  return new;
end;
$$;

create or replace function public.sync_breakdown_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

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

  if coalesce(new.cost, 0) <= 0 then
    return new;
  end if;

  v_expense_id := public.upsert_source_expense(
    new.company_id,
    'maintenance',
    'breakdown_logs',
    'breakdown_logs',
    new.id,
    concat('MNT-', to_char(new.breakdown_date, 'YYYYMMDD')),
    'maintenance_repairs',
    lower(coalesce(new.machine_type, 'other')),
    new.vendor_id,
    concat('Machine breakdown repair: ', coalesce(new.issue_description, 'Maintenance service')),
    1,
    'job',
    coalesce(new.cost, 0),
    coalesce(new.cost, 0),
    0,
    0,
    0,
    coalesce(new.cost, 0),
    coalesce(new.payment_status, 'unpaid'),
    new.payment_method,
    new.invoice_number,
    new.invoice_date,
    new.due_date,
    null
  );

  update public.breakdown_logs
  set expense_ledger_id = v_expense_id
  where id = new.id and company_id = new.company_id;

  return new;
end;
$$;

drop trigger if exists z_apply_expense_approval_policy on public.expense_ledger;
create trigger z_apply_expense_approval_policy
before insert or update on public.expense_ledger
for each row execute function public.apply_expense_approval_policy();

drop trigger if exists sync_expense_energy_readings on public.energy_readings;
create trigger sync_expense_energy_readings
after insert or update or delete on public.energy_readings
for each row execute function public.sync_energy_reading_expense();

drop trigger if exists sync_expense_breakdown_logs on public.breakdown_logs;
create trigger sync_expense_breakdown_logs
after insert or update or delete on public.breakdown_logs
for each row execute function public.sync_breakdown_expense();
