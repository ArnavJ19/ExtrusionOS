-- Expense ledger integrity (FINANCE_EXPENSES_DEEP_AUDIT_2026-10-15: EXP-01..EXP-25, SEC-02).
--
-- The central expense ledger becomes database-owned:
--   * totals are derived from components, never trusted from the client (EXP-01);
--   * approval state changes only through an authorized transition (EXP-02, EXP-14, EXP-18);
--   * paid/credited/refunded projections are derived from immutable settlement ledgers
--     (EXP-04, EXP-05, EXP-09, EXP-12, EXP-13, EXP-17);
--   * supplier payments post only through a locked, idempotent RPC against an approved,
--     same-company expense (EXP-03, EXP-06, EXP-08);
--   * source-linked costs keep the central ledger authoritative and retire their expense
--     through an auditable path (EXP-10, EXP-11, EXP-15, EXP-19..EXP-22, EXP-24, EXP-25);
--   * direct authenticated DML is removed and reads are finance-only (EXP-07, SEC-02);
--   * overdue state is computed at read time (EXP-16) and new expenses are INR-only (EXP-23).
-- Historical rows are not rewritten except to recompute valid ledger projections; anything
-- that cannot be reconciled automatically is listed in expense_ledger_reconciliation_issues.
begin;

create or replace function private.business_today()
returns date language sql stable set search_path = pg_catalog
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function private.business_today() from public, anon;
grant execute on function private.business_today() to authenticated;

-- ---------------------------------------------------------------------------
-- Schema: settlement projections, idempotency, settlement ledgers
-- ---------------------------------------------------------------------------
alter table public.expense_ledger
  add column if not exists credited_amount numeric(14,2) not null default 0,
  add column if not exists refunded_amount numeric(14,2) not null default 0,
  add column if not exists supplier_credit_due numeric(14,2) not null default 0,
  add column if not exists approval_note text,
  add column if not exists idempotency_key uuid,
  add column if not exists request_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expense_ledger_settlement_nonnegative') then
    alter table public.expense_ledger add constraint expense_ledger_settlement_nonnegative
      check (credited_amount >= 0 and refunded_amount >= 0 and supplier_credit_due >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expense_ledger_id_company_unique') then
    alter table public.expense_ledger add constraint expense_ledger_id_company_unique unique (id, company_id);
  end if;
  -- New writes are INR-only until a governed exchange-rate basis exists (EXP-23 / RPT-07).
  -- Both writers (manual RPC and source upsert) enforce INR; historical foreign-currency
  -- rows stay payable and are reported per currency rather than restated.
end $$;

create unique index if not exists expense_ledger_company_idempotency_unique
  on public.expense_ledger(company_id, idempotency_key) where idempotency_key is not null;

alter table public.expense_payments
  add column if not exists status text not null default 'posted',
  add column if not exists idempotency_key uuid,
  add column if not exists request_hash text,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id),
  add column if not exists reversal_reason text,
  add column if not exists reversal_idempotency_key uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expense_payments_status_check') then
    alter table public.expense_payments add constraint expense_payments_status_check check (status in ('posted','reversed'));
  end if;
  -- Tenant-composite parent reference (EXP-06). NOT VALID enforces every new row; existing
  -- rows are validated only when no historical mismatch exists.
  if not exists (select 1 from pg_constraint where conname = 'expense_payments_parent_company_fk') then
    alter table public.expense_payments add constraint expense_payments_parent_company_fk
      foreign key (expense_ledger_id, company_id) references public.expense_ledger(id, company_id) not valid;
  end if;
  if not exists (
    select 1 from public.expense_payments p
    left join public.expense_ledger e on e.id = p.expense_ledger_id and e.company_id = p.company_id
    where e.id is null
  ) then
    alter table public.expense_payments validate constraint expense_payments_parent_company_fk;
  else
    raise warning 'expense_payments_parent_company_fk left NOT VALID: historical cross-company payment links exist. Review expense_ledger_reconciliation_issues.';
  end if;
end $$;

create unique index if not exists expense_payments_company_idempotency_unique
  on public.expense_payments(company_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists expense_payments_company_reversal_idempotency_unique
  on public.expense_payments(company_id, reversal_idempotency_key) where reversal_idempotency_key is not null;
do $$
begin
  if not exists (
    select 1 from public.expense_payments
    where status = 'posted' and nullif(btrim(reference_number), '') is not null
    group by company_id, expense_ledger_id, upper(btrim(reference_number)) having count(*) > 1
  ) then
    create unique index if not exists expense_payments_posted_reference_unique
      on public.expense_payments(company_id, expense_ledger_id, upper(btrim(reference_number)))
      where status = 'posted' and nullif(btrim(reference_number), '') is not null;
  else
    raise warning 'Skipped expense_payments_posted_reference_unique: duplicate posted references exist. The posting RPC still rejects new duplicates.';
  end if;
end $$;

create table if not exists public.expense_supplier_credits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  expense_ledger_id uuid not null,
  credit_type text not null check (credit_type in ('credit_note','refund')),
  credit_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text,
  reference_number text,
  reason text not null,
  status text not null default 'posted' check (status in ('posted','reversed')),
  idempotency_key uuid not null,
  request_hash text not null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  reversal_idempotency_key uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_supplier_credits_parent_company_fk
    foreign key (expense_ledger_id, company_id) references public.expense_ledger(id, company_id),
  constraint expense_supplier_credits_company_idempotency_unique unique (company_id, idempotency_key)
);
create unique index if not exists expense_supplier_credits_reversal_idempotency_unique
  on public.expense_supplier_credits(company_id, reversal_idempotency_key) where reversal_idempotency_key is not null;
create index if not exists expense_supplier_credits_company_expense_idx
  on public.expense_supplier_credits(company_id, expense_ledger_id, credit_date desc);
alter table public.expense_supplier_credits enable row level security;

-- ---------------------------------------------------------------------------
-- Access: finance-only reads, no direct authenticated DML (EXP-07, EXP-13, SEC-02)
-- ---------------------------------------------------------------------------
drop policy if exists "expense ledger tenant read" on public.expense_ledger;
drop policy if exists "expense ledger tenant insert" on public.expense_ledger;
drop policy if exists "expense ledger tenant update" on public.expense_ledger;
drop policy if exists expense_ledger_finance_read on public.expense_ledger;
create policy expense_ledger_finance_read on public.expense_ledger for select to authenticated using (
  company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','accounts')
);
drop policy if exists "expense payments tenant read" on public.expense_payments;
drop policy if exists "expense payments tenant insert" on public.expense_payments;
drop policy if exists "expense payments tenant update" on public.expense_payments;
drop policy if exists expense_payments_finance_read on public.expense_payments;
create policy expense_payments_finance_read on public.expense_payments for select to authenticated using (
  company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','accounts')
);
drop policy if exists expense_supplier_credits_finance_read on public.expense_supplier_credits;
create policy expense_supplier_credits_finance_read on public.expense_supplier_credits for select to authenticated using (
  company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner','admin','accounts')
);
revoke insert, update, delete, truncate on public.expense_ledger, public.expense_payments, public.expense_supplier_credits from anon, authenticated;
grant select on public.expense_ledger, public.expense_payments, public.expense_supplier_credits to authenticated;

-- ---------------------------------------------------------------------------
-- Derived totals and settlement projection (EXP-01, EXP-13, EXP-16, EXP-17)
-- ---------------------------------------------------------------------------
create or replace function private.expense_live_payment_status(
  p_status text, p_balance numeric, p_due_date date, p_as_of date default null
)
returns text language sql stable set search_path = pg_catalog, private as $$
  select case
    when p_status in ('unpaid','partially_paid') and coalesce(p_balance, 0) > 0
      and p_due_date is not null and p_due_date < coalesce(p_as_of, private.business_today()) then 'overdue'
    when p_status = 'overdue' and (coalesce(p_balance, 0) <= 0 or p_due_date is null
      or p_due_date >= coalesce(p_as_of, private.business_today())) then 'unpaid'
    else p_status
  end
$$;
revoke all on function private.expense_live_payment_status(text,numeric,date,date) from public, anon;
grant execute on function private.expense_live_payment_status(text,numeric,date,date) to authenticated;

create or replace function public.expense_apply_totals()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_paid numeric(14,2) := 0;
  v_refunded numeric(14,2) := 0;
  v_credited numeric(14,2) := 0;
  v_last_payment date;
  v_net numeric(14,2);
  v_derive boolean;
begin
  new.quantity := coalesce(new.quantity, 0);
  new.rate := coalesce(new.rate, 0);
  new.base_amount := coalesce(new.base_amount, 0);
  new.tax_amount := coalesce(new.tax_amount, 0);
  new.freight_amount := coalesce(new.freight_amount, 0);
  new.discount_amount := coalesce(new.discount_amount, 0);
  new.currency := coalesce(nullif(btrim(new.currency), ''), 'INR');

  -- Totals are always derived on insert and whenever any component (or the total itself)
  -- is written. Untouched historical rows keep their stored total until edited, so a
  -- legacy mismatch is reported instead of silently restating an approved payable.
  v_derive := tg_op = 'INSERT' or (new.quantity, new.rate, new.base_amount, new.tax_amount,
    new.freight_amount, new.discount_amount, new.total_amount)
    is distinct from (old.quantity, old.rate, old.base_amount, old.tax_amount,
    old.freight_amount, old.discount_amount, old.total_amount);
  if v_derive then
    if new.base_amount = 0 and new.quantity > 0 and new.rate > 0 then
      new.base_amount := round(new.quantity * new.rate, 2);
    end if;
    new.total_amount := round(new.base_amount + new.tax_amount + new.freight_amount - new.discount_amount, 2);
    if new.total_amount < 0 then
      raise exception 'Expense discount cannot exceed base, tax and freight amounts' using errcode = '23514';
    end if;
  else
    new.total_amount := old.total_amount;
  end if;

  -- Settlement projections are owned by the payment and supplier-credit ledgers.
  if tg_op = 'UPDATE' then
    select coalesce(sum(p.amount_paid) filter (where p.status = 'posted'), 0),
           max(p.payment_date) filter (where p.status = 'posted')
      into v_paid, v_last_payment
    from public.expense_payments p
    where p.company_id = new.company_id and p.expense_ledger_id = new.id;
    select coalesce(sum(c.amount) filter (where c.status = 'posted' and c.credit_type = 'credit_note'), 0),
           coalesce(sum(c.amount) filter (where c.status = 'posted' and c.credit_type = 'refund'), 0)
      into v_credited, v_refunded
    from public.expense_supplier_credits c
    where c.company_id = new.company_id and c.expense_ledger_id = new.id;
  end if;

  if v_refunded > v_paid then
    raise exception 'Supplier refunds cannot exceed posted supplier payments. Reverse the refund first.' using errcode = '23514';
  end if;
  v_net := v_paid - v_refunded;
  if v_net > new.total_amount then
    raise exception 'Posted supplier payments exceed the expense total' using errcode = '23514';
  end if;
  if v_credited > new.total_amount then
    raise exception 'Supplier credit notes exceed the expense total' using errcode = '23514';
  end if;

  new.amount_paid := v_paid;
  new.refunded_amount := v_refunded;
  new.credited_amount := v_credited;
  new.balance_amount := greatest(round(new.total_amount - v_net - v_credited, 2), 0);
  new.supplier_credit_due := greatest(round(v_net + v_credited - new.total_amount, 2), 0);

  if new.approval_status in ('cancelled', 'reversed') then
    new.payment_status := new.approval_status;
  elsif new.total_amount > 0 and new.balance_amount = 0 then
    new.payment_status := 'paid';
  elsif new.balance_amount > 0 and new.due_date is not null and new.due_date < private.business_today() then
    new.payment_status := 'overdue';
  elsif v_net > 0 or v_credited > 0 then
    new.payment_status := 'partially_paid';
  else
    new.payment_status := 'unpaid';
  end if;
  -- The settlement date is the latest posted supplier payment, never the edit date.
  new.paid_date := case when new.payment_status = 'paid' then v_last_payment else null end;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval policy and transitions (EXP-02, EXP-14, EXP-18)
-- ---------------------------------------------------------------------------
create or replace function private.expense_approval_threshold()
returns numeric language sql immutable set search_path = pg_catalog as $$ select 25000::numeric $$;
revoke all on function private.expense_approval_threshold() from public, anon, authenticated;

create or replace function public.apply_expense_approval_policy()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_role text;
  v_transition boolean := coalesce(current_setting('extrusionos.expense_approval_transition', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if v_transition then
      return new;
    end if;
    if coalesce(new.approval_status, 'draft') not in ('draft', 'pending_approval', 'approved') then
      raise exception 'New expenses start as draft or are submitted for approval' using errcode = '23514';
    end if;
    -- A manual draft stays draft. Every submitted state, including a client-supplied
    -- "approved", is re-evaluated against the threshold and the caller's role.
    if coalesce(new.approval_status, 'draft') = 'draft' and new.source_table is null then
      new.approval_status := 'draft';
      new.approved_by := null;
      new.approved_at := null;
      return new;
    end if;
    v_role := private.get_current_user_role();
    if new.total_amount > 0 and new.total_amount <= private.expense_approval_threshold()
      and v_role in ('owner', 'admin', 'accounts') then
      new.approval_status := 'approved';
      new.approved_by := auth.uid();
      new.approved_at := now();
    else
      new.approval_status := 'pending_approval';
      new.approved_by := null;
      new.approved_at := null;
    end if;
    return new;
  end if;

  if (new.approval_status, new.approved_by, new.approved_at)
    is distinct from (old.approval_status, old.approved_by, old.approved_at) and not v_transition then
    raise exception 'Approval status changes must use the expense approval workflow' using errcode = '42501';
  end if;
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
      raise exception 'Expense % is approved and locked. An owner or admin must reopen it with a reason before its amounts or details change.', old.expense_number
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.set_expense_approval_state(
  p_expense_id uuid, p_company_id uuid, p_status text, p_note text, p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform set_config('extrusionos.expense_approval_transition', 'on', true);
  update public.expense_ledger
  set approval_status = p_status,
      approved_by = case when p_approved then auth.uid() else null end,
      approved_at = case when p_approved then now() else null end,
      approval_note = coalesce(p_note, approval_note),
      updated_by = auth.uid()
  where id = p_expense_id and company_id = p_company_id;
  perform set_config('extrusionos.expense_approval_transition', '', true);
end;
$$;
revoke all on function private.set_expense_approval_state(uuid,uuid,text,text,boolean) from public, anon, authenticated;

create or replace function private.transition_expense_approval(
  p_expense_id uuid, p_action text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_expense public.expense_ledger%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_next text;
  v_approved boolean := false;
  v_finance_limit boolean;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for expense approvals' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('submit', 'approve', 'reject', 'reopen', 'cancel') then
    raise exception 'Unsupported expense approval action' using errcode = '22023';
  end if;

  select * into v_expense from public.expense_ledger
  where id = p_expense_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Expense not found for this company'; end if;
  if v_expense.deleted_at is not null then raise exception 'Deleted expenses cannot change approval state'; end if;
  -- Accounts may decide expenses up to the threshold; larger ones need owner or admin.
  v_finance_limit := v_role in ('owner', 'admin') or v_expense.total_amount <= private.expense_approval_threshold();

  if p_action = 'submit' then
    if v_expense.approval_status not in ('draft', 'rejected') then
      raise exception 'Only draft or rejected expenses can be submitted';
    end if;
    if v_expense.total_amount <= 0 then raise exception 'Expense total must be greater than zero before submission'; end if;
    if v_expense.total_amount <= private.expense_approval_threshold() then
      v_next := 'approved';
      v_approved := true;
    else
      v_next := 'pending_approval';
    end if;
  elsif p_action = 'approve' then
    if v_expense.approval_status <> 'pending_approval' then raise exception 'Only expenses pending approval can be approved'; end if;
    if not v_finance_limit then
      raise exception 'Expenses above Rs 25,000 need owner or admin approval' using errcode = '42501';
    end if;
    v_next := 'approved';
    v_approved := true;
  elsif p_action = 'reject' then
    if v_expense.approval_status <> 'pending_approval' then raise exception 'Only expenses pending approval can be rejected'; end if;
    if not v_finance_limit then
      raise exception 'Expenses above Rs 25,000 need owner or admin review' using errcode = '42501';
    end if;
    if length(coalesce(v_note, '')) < 5 then raise exception 'Enter a clear rejection reason'; end if;
    v_next := 'rejected';
  elsif p_action = 'reopen' then
    if v_role not in ('owner', 'admin') then
      raise exception 'Only an owner or admin can reopen an approved expense' using errcode = '42501';
    end if;
    if v_expense.approval_status <> 'approved' then raise exception 'Only approved expenses can be reopened'; end if;
    if length(coalesce(v_note, '')) < 5 then raise exception 'Enter a clear reason for reopening this approved expense'; end if;
    if v_expense.amount_paid > 0 or v_expense.credited_amount > 0 or v_expense.refunded_amount > 0 then
      raise exception 'Reverse posted supplier payments and credits before reopening this expense';
    end if;
    v_next := case when v_expense.source_table is null then 'draft' else 'pending_approval' end;
  else
    if v_expense.source_table is not null then
      raise exception 'Cancel a source-linked expense by cancelling or deleting its source record';
    end if;
    if v_expense.approval_status not in ('draft', 'pending_approval', 'rejected', 'approved') then
      raise exception 'This expense cannot be cancelled from its current state';
    end if;
    if not v_finance_limit then
      raise exception 'Expenses above Rs 25,000 need an owner or admin to cancel them' using errcode = '42501';
    end if;
    if length(coalesce(v_note, '')) < 5 then raise exception 'Enter a clear cancellation reason'; end if;
    if v_expense.amount_paid - v_expense.refunded_amount > 0 then
      raise exception 'Reverse posted supplier payments or record the supplier refund before cancelling this expense';
    end if;
    v_next := 'cancelled';
  end if;

  perform private.set_expense_approval_state(v_expense.id, v_company_id, v_next, v_note, v_approved);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'expense_approval_' || p_action, 'expense_ledger', v_expense.id,
    jsonb_build_object('expense_number', v_expense.expense_number, 'from', v_expense.approval_status,
      'to', v_next, 'note', v_note, 'total_amount', v_expense.total_amount));

  return jsonb_build_object('expense_id', v_expense.id, 'approval_status', v_next);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settlement ledger guards and synchronisation (EXP-04, EXP-05, EXP-09)
-- ---------------------------------------------------------------------------
create or replace function private.guard_expense_settlement_row()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_mutable text[] := array['status','reversed_at','reversed_by','reversal_reason','reversal_idempotency_key','updated_at'];
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('extrusionos.allow_ledger_purge', true), '') <> 'on' then
      raise exception 'Supplier payment and credit history cannot be deleted. Reverse the entry instead.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'posted' and new.status = 'reversed'
    and new.reversed_at is not null and nullif(btrim(coalesce(new.reversal_reason, '')), '') is not null
    and (to_jsonb(new) - v_mutable) = (to_jsonb(old) - v_mutable) then
    return new;
  end if;
  raise exception 'Posted supplier payments and credits are immutable. Reverse the entry and post a correction.' using errcode = '42501';
end;
$$;
revoke all on function private.guard_expense_settlement_row() from public, anon, authenticated;

create or replace function public.sync_expense_payment_totals()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := coalesce(new.company_id, old.company_id);
  v_ids uuid[];
begin
  -- Recompute every affected parent (old and new on reassignment) in a stable lock order.
  select array_agg(distinct parent_id order by parent_id) into v_ids
  from unnest(array[
    case when tg_op <> 'INSERT' then old.expense_ledger_id end,
    case when tg_op <> 'DELETE' then new.expense_ledger_id end
  ]) as parent(parent_id)
  where parent_id is not null;
  if v_ids is null then return coalesce(new, old); end if;
  perform 1 from public.expense_ledger
  where company_id = v_company_id and id = any(v_ids)
  order by id
  for update;
  update public.expense_ledger
  set updated_at = now()
  where company_id = v_company_id and id = any(v_ids);
  return coalesce(new, old);
end;
$$;

create or replace function public.log_expense_payment_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    coalesce(new.company_id, old.company_id), auth.uid(),
    case tg_op when 'INSERT' then 'expense_payment_added' when 'UPDATE' then
      case when old.status = 'posted' and new.status = 'reversed' then 'expense_payment_reversed' else 'expense_payment_updated' end
      else 'expense_payment_deleted' end,
    'expense_payments', coalesce(new.id, old.id),
    jsonb_build_object('before', case when tg_op <> 'INSERT' then to_jsonb(old) end,
      'after', case when tg_op <> 'DELETE' then to_jsonb(new) end)
  );
  return coalesce(new, old);
end;
$$;

create or replace function private.log_expense_supplier_credit_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    coalesce(new.company_id, old.company_id), auth.uid(),
    case when tg_op = 'INSERT' then 'expense_supplier_' || new.credit_type || '_posted'
      when tg_op = 'UPDATE' then 'expense_supplier_' || new.credit_type || '_reversed'
      else 'expense_supplier_credit_deleted' end,
    'expense_supplier_credits', coalesce(new.id, old.id),
    jsonb_build_object('before', case when tg_op <> 'INSERT' then to_jsonb(old) end,
      'after', case when tg_op <> 'DELETE' then to_jsonb(new) end)
  );
  return coalesce(new, old);
end;
$$;
revoke all on function private.log_expense_supplier_credit_audit() from public, anon, authenticated;

create or replace function public.log_expense_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_created', 'expense_ledger', new.id,
      jsonb_build_object('expense_number', new.expense_number, 'source_table', new.source_table,
        'source_record_id', new.source_record_id, 'total_amount', new.total_amount,
        'approval_status', new.approval_status));
    return new;
  end if;
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('before', o.value, 'after', n.value)), '{}'::jsonb)
    into v_changes
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value and n.key not in ('updated_at');
  if v_changes <> '{}'::jsonb then
    insert into public.audit_logs (company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (new.company_id, auth.uid(), 'expense_updated', 'expense_ledger', new.id,
      jsonb_build_object('expense_number', new.expense_number, 'changes', v_changes));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual expense writer (EXP-01, EXP-02, EXP-08, EXP-23)
-- ---------------------------------------------------------------------------
create or replace function private.indian_financial_year(p_date date)
returns integer language sql immutable set search_path = pg_catalog as $$
  select case when p_date is null then null
    when extract(month from p_date) >= 4 then extract(year from p_date)::integer
    else extract(year from p_date)::integer - 1 end
$$;
revoke all on function private.indian_financial_year(date) from public, anon, authenticated;

create or replace function private.find_duplicate_vendor_bill(
  p_company_id uuid, p_vendor_id uuid, p_invoice_number text, p_invoice_date date,
  p_total numeric, p_exclude_id uuid, p_exclude_source_record uuid
)
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  -- A repeated vendor bill number within the same Indian financial year and the same total
  -- is treated as a duplicate entry. Vendors that restart numbering each year, or split one
  -- bill across cost lines with different totals, remain valid.
  select e.expense_number
  from public.expense_ledger e
  where e.company_id = p_company_id
    and p_vendor_id is not null and nullif(btrim(p_invoice_number), '') is not null
    and e.vendor_id = p_vendor_id
    and upper(btrim(e.invoice_number)) = upper(btrim(p_invoice_number))
    and private.indian_financial_year(e.invoice_date) is not distinct from private.indian_financial_year(p_invoice_date)
    and e.total_amount = p_total
    and e.deleted_at is null
    and e.approval_status not in ('cancelled', 'rejected', 'reversed')
    and (p_exclude_id is null or e.id <> p_exclude_id)
    and (p_exclude_source_record is null or e.source_record_id is distinct from p_exclude_source_record)
  order by e.created_at
  limit 1
$$;
revoke all on function private.find_duplicate_vendor_bill(uuid,uuid,text,date,numeric,uuid,uuid) from public, anon, authenticated;

create or replace function private.save_manual_expense_atomic(
  p_expense_id uuid, p_payload jsonb, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_existing public.expense_ledger%rowtype;
  v_result public.expense_ledger%rowtype;
  v_id uuid;
  v_quantity numeric(14,3);
  v_rate numeric(14,2);
  v_base numeric(14,2);
  v_tax numeric(14,2);
  v_freight numeric(14,2);
  v_discount numeric(14,2);
  v_total numeric(14,2);
  v_claimed_total numeric;
  v_category text := nullif(btrim(p_payload ->> 'expense_category'), '');
  v_subcategory text := nullif(btrim(p_payload ->> 'expense_subcategory'), '');
  v_description text := nullif(btrim(p_payload ->> 'description'), '');
  v_unit text := nullif(btrim(p_payload ->> 'unit'), '');
  v_currency text := coalesce(nullif(btrim(p_payload ->> 'currency'), ''), 'INR');
  v_vendor_id uuid := nullif(p_payload ->> 'vendor_id', '')::uuid;
  v_machine_id uuid := nullif(p_payload ->> 'machine_id', '')::uuid;
  v_item_id uuid := nullif(p_payload ->> 'inventory_item_id', '')::uuid;
  v_invoice_number text := nullif(btrim(p_payload ->> 'invoice_number'), '');
  v_invoice_date date := nullif(p_payload ->> 'invoice_date', '')::date;
  v_due_date date := nullif(p_payload ->> 'due_date', '')::date;
  v_payment_method text := nullif(btrim(p_payload ->> 'payment_method'), '');
  v_cost_center text := nullif(btrim(p_payload ->> 'cost_center'), '');
  v_department text := nullif(btrim(p_payload ->> 'department'), '');
  v_notes text := nullif(btrim(p_payload ->> 'notes'), '');
  v_submit boolean := coalesce(nullif(p_payload ->> 'submit', '')::boolean, false);
  v_vendor_name text;
  v_duplicate text;
  v_hash text;
  v_replay boolean := false;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for expenses' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Expense details are required' using errcode = '22023';
  end if;
  if p_expense_id is null and p_idempotency_key is null then
    raise exception 'Expense idempotency key is required';
  end if;

  begin
    v_quantity := round(coalesce(nullif(p_payload ->> 'quantity', '')::numeric, 0), 3);
    v_rate := round(coalesce(nullif(p_payload ->> 'rate', '')::numeric, 0), 2);
    v_base := round(coalesce(nullif(p_payload ->> 'base_amount', '')::numeric, 0), 2);
    v_tax := round(coalesce(nullif(p_payload ->> 'tax_amount', '')::numeric, 0), 2);
    v_freight := round(coalesce(nullif(p_payload ->> 'freight_amount', '')::numeric, 0), 2);
    v_discount := round(coalesce(nullif(p_payload ->> 'discount_amount', '')::numeric, 0), 2);
    v_claimed_total := nullif(p_payload ->> 'total_amount', '')::numeric;
  exception when others then
    raise exception 'Expense amounts must be valid numbers' using errcode = '22023';
  end;
  if 'NaN'::numeric in (v_quantity, v_rate, v_base, v_tax, v_freight, v_discount) then
    raise exception 'Expense amounts must be finite numbers' using errcode = '22023';
  end if;
  if least(v_quantity, v_rate, v_base, v_tax, v_freight, v_discount) < 0 then
    raise exception 'Expense quantity, rate and amounts cannot be negative' using errcode = '23514';
  end if;
  if v_category is null or v_category not in ('raw_material','scrap_purchase','external_aluminium_source','packaging_material',
    'spare_parts','maintenance_repairs','dies_tooling','utilities','fuel_oils','chemicals','freight_logistics',
    'labour_vendor_services','office_and_administration','production_consumables','surface_treatment',
    'factory_overheads','miscellaneous') then
    raise exception 'Select a valid expense category' using errcode = '22023';
  end if;
  if length(coalesce(v_description, '')) < 3 then raise exception 'Enter an expense description'; end if;
  if v_currency <> 'INR' then
    raise exception 'Expenses are recorded in INR until currency conversion is available. Convert the bill to INR at the booked rate.' using errcode = '23514';
  end if;
  if v_quantity > 0 and v_rate > 0 then
    if v_base = 0 then
      v_base := round(v_quantity * v_rate, 2);
    elsif abs(v_base - round(v_quantity * v_rate, 2)) >= 0.005 then
      raise exception 'Base amount must equal quantity x rate (%). Clear the rate to enter a lump-sum base.', round(v_quantity * v_rate, 2)
        using errcode = '23514';
    end if;
  end if;
  v_total := round(v_base + v_tax + v_freight - v_discount, 2);
  if v_total <= 0 then raise exception 'Expense total must be greater than zero' using errcode = '23514'; end if;
  if v_claimed_total is not null and abs(v_claimed_total - v_total) >= 0.005 then
    raise exception 'Total amount (%) does not match base + tax + freight - discount (%)', v_claimed_total, v_total
      using errcode = '23514';
  end if;
  if v_invoice_date is not null and v_due_date is not null and v_due_date < v_invoice_date then
    raise exception 'Due date cannot be before the bill date';
  end if;
  if v_vendor_id is not null then
    select vendor_name into v_vendor_name from public.vendors where id = v_vendor_id and company_id = v_company_id;
    if not found then raise exception 'Vendor not found for this company'; end if;
  end if;
  if v_machine_id is not null and not exists (select 1 from public.machines where id = v_machine_id and company_id = v_company_id) then
    raise exception 'Machine not found for this company';
  end if;
  if v_item_id is not null and not exists (select 1 from public.inventory_items where id = v_item_id and company_id = v_company_id) then
    raise exception 'Inventory item not found for this company';
  end if;

  v_hash := md5(jsonb_build_object('expense_id', p_expense_id, 'category', v_category, 'subcategory', v_subcategory,
    'description', v_description, 'quantity', v_quantity, 'unit', v_unit, 'rate', v_rate, 'base', v_base,
    'tax', v_tax, 'freight', v_freight, 'discount', v_discount, 'currency', v_currency, 'vendor', v_vendor_id,
    'machine', v_machine_id, 'item', v_item_id, 'invoice_number', v_invoice_number, 'invoice_date', v_invoice_date,
    'due_date', v_due_date, 'payment_method', v_payment_method, 'cost_center', v_cost_center,
    'department', v_department, 'notes', v_notes, 'submit', v_submit)::text);

  if p_expense_id is null then
    perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':manual-expense:' || p_idempotency_key::text, 0));
    select * into v_existing from public.expense_ledger
    where company_id = v_company_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_hash is distinct from v_hash then
        raise exception 'This retry key was already used for different expense details. Refresh and review expense % before saving again.', v_existing.expense_number;
      end if;
      v_id := v_existing.id;
      v_replay := true;
    end if;
  else
    select * into v_existing from public.expense_ledger
    where id = p_expense_id and company_id = v_company_id
    for update;
    if not found then raise exception 'Expense not found for this company'; end if;
    if v_existing.deleted_at is not null then raise exception 'Deleted expenses cannot be edited'; end if;
    if v_existing.source_table is not null then
      raise exception 'Expense % is posted from %. Edit the source record instead.', v_existing.expense_number, v_existing.source_table;
    end if;
    if v_existing.approval_status not in ('draft', 'pending_approval', 'rejected') then
      raise exception 'Expense % is % and locked. An owner or admin must reopen it before editing.', v_existing.expense_number, v_existing.approval_status;
    end if;
  end if;

  if not v_replay then
    v_duplicate := private.find_duplicate_vendor_bill(v_company_id, v_vendor_id, v_invoice_number, v_invoice_date, v_total, p_expense_id, null);
    if v_duplicate is not null then
      raise exception 'This vendor bill is already recorded as expense % for the same amount in this financial year.', v_duplicate
        using errcode = '23505';
    end if;

    if p_expense_id is null then
      insert into public.expense_ledger(
        company_id, source_module, source_submodule, expense_category, expense_subcategory, vendor_id,
        vendor_name_snapshot, description, quantity, unit, rate, base_amount, tax_amount, freight_amount,
        discount_amount, total_amount, currency, payment_method, invoice_number, invoice_date, due_date,
        cost_center, department, machine_id, inventory_item_id, approval_status, notes, created_by, updated_by,
        idempotency_key, request_hash
      ) values (
        v_company_id, 'manual', 'manual_expense', v_category, v_subcategory, v_vendor_id,
        v_vendor_name, v_description, v_quantity, v_unit, v_rate, v_base, v_tax, v_freight,
        v_discount, v_total, v_currency, v_payment_method, v_invoice_number, v_invoice_date, v_due_date,
        v_cost_center, v_department, v_machine_id, v_item_id,
        case when v_submit then 'pending_approval' else 'draft' end,
        v_notes, auth.uid(), auth.uid(), p_idempotency_key, v_hash
      ) returning id into v_id;
    else
      update public.expense_ledger
      set expense_category = v_category, expense_subcategory = v_subcategory, vendor_id = v_vendor_id,
          vendor_name_snapshot = v_vendor_name, description = v_description, quantity = v_quantity, unit = v_unit,
          rate = v_rate, base_amount = v_base, tax_amount = v_tax, freight_amount = v_freight,
          discount_amount = v_discount, total_amount = v_total, currency = v_currency,
          payment_method = v_payment_method, invoice_number = v_invoice_number, invoice_date = v_invoice_date,
          due_date = v_due_date, cost_center = v_cost_center, department = v_department,
          machine_id = v_machine_id, inventory_item_id = v_item_id, notes = v_notes, updated_by = auth.uid()
      where id = p_expense_id and company_id = v_company_id;
      v_id := p_expense_id;
      if v_submit and v_existing.approval_status in ('draft', 'rejected') then
        perform private.transition_expense_approval(v_id, 'submit', null);
      end if;
    end if;
  end if;

  select * into v_result from public.expense_ledger where id = v_id and company_id = v_company_id;
  return jsonb_build_object('expense_id', v_result.id, 'expense_number', v_result.expense_number,
    'approval_status', v_result.approval_status, 'payment_status', v_result.payment_status,
    'total_amount', v_result.total_amount, 'idempotent_replay', v_replay);
end;
$$;

-- ---------------------------------------------------------------------------
-- Supplier payments, credit notes and refunds (EXP-03, EXP-04, EXP-06, EXP-08, EXP-12)
-- ---------------------------------------------------------------------------
create or replace function private.record_expense_payment_atomic(
  p_expense_id uuid, p_payment jsonb, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_expense public.expense_ledger%rowtype;
  v_existing public.expense_payments%rowtype;
  v_payment_id uuid;
  v_amount numeric(14,2);
  v_date date;
  v_method text := nullif(btrim(p_payment ->> 'payment_method'), '');
  v_bank text := nullif(btrim(p_payment ->> 'bank_account'), '');
  v_reference text := nullif(btrim(p_payment ->> 'reference_number'), '');
  v_notes text := nullif(btrim(p_payment ->> 'notes'), '');
  v_hash text;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier payments' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Payment idempotency key is required'; end if;
  begin
    v_amount := round(nullif(p_payment ->> 'amount_paid', '')::numeric, 2);
    v_date := coalesce(nullif(p_payment ->> 'payment_date', '')::date, private.business_today());
  exception when others then
    raise exception 'Enter a valid payment amount and date' using errcode = '22023';
  end;
  v_hash := md5(jsonb_build_object('expense_id', p_expense_id, 'amount', v_amount, 'date', v_date, 'method', v_method,
    'bank', v_bank, 'reference', v_reference, 'notes', v_notes)::text);

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-payment:' || p_idempotency_key::text, 0));
  select * into v_existing from public.expense_payments
  where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'This retry key was already used for a different supplier payment. Refresh the expense and review its payments before posting again.';
    end if;
    select * into v_expense from public.expense_ledger where id = v_existing.expense_ledger_id and company_id = v_company_id;
    return jsonb_build_object('payment_id', v_existing.id, 'expense_id', v_existing.expense_ledger_id,
      'amount_paid', v_expense.amount_paid, 'balance_amount', v_expense.balance_amount,
      'payment_status', v_expense.payment_status, 'idempotent_replay', true);
  end if;

  -- Lock the parent before reading its balance so concurrent postings serialize.
  select * into v_expense from public.expense_ledger
  where id = p_expense_id and company_id = v_company_id
  for update;
  if not found then raise exception 'Expense not found for this company'; end if;
  if v_expense.deleted_at is not null or v_expense.approval_status in ('cancelled', 'reversed') then
    raise exception 'Cancelled or deleted expenses cannot be paid';
  end if;
  if v_expense.approval_status <> 'approved' then
    raise exception 'Expense % is %. Only approved expenses can be paid.', v_expense.expense_number, v_expense.approval_status;
  end if;
  if v_amount is null or v_amount = 'NaN'::numeric or v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if v_amount > v_expense.balance_amount then
    raise exception 'Payment amount exceeds the outstanding expense balance of %', v_expense.balance_amount;
  end if;
  if v_date > private.business_today() then raise exception 'Payment date cannot be in the future'; end if;
  if v_method is null or v_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then
    raise exception 'Select a valid payment method';
  end if;
  if v_method in ('bank_transfer', 'upi', 'cheque') and v_reference is null then
    raise exception 'Reference number is required for bank, UPI and cheque payments';
  end if;
  if v_reference is not null and exists (
    select 1 from public.expense_payments
    where company_id = v_company_id and expense_ledger_id = v_expense.id and status = 'posted'
      and upper(btrim(reference_number)) = upper(v_reference)
  ) then
    raise exception 'Reference % is already posted against this expense', v_reference using errcode = '23505';
  end if;

  insert into public.expense_payments(company_id, expense_ledger_id, payment_date, amount_paid, payment_method,
    bank_account, reference_number, notes, created_by, status, idempotency_key, request_hash)
  values (v_company_id, v_expense.id, v_date, v_amount, v_method, v_bank, v_reference, v_notes, auth.uid(),
    'posted', p_idempotency_key, v_hash)
  returning id into v_payment_id;

  select * into v_expense from public.expense_ledger where id = v_expense.id and company_id = v_company_id;
  return jsonb_build_object('payment_id', v_payment_id, 'expense_id', v_expense.id,
    'amount_paid', v_expense.amount_paid, 'balance_amount', v_expense.balance_amount,
    'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$$;

create or replace function private.reverse_expense_payment_atomic(
  p_payment_id uuid, p_reason text, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_payment public.expense_payments%rowtype;
  v_expense public.expense_ledger%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier payment reversals' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Reversal idempotency key is required'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Enter a clear reversal reason'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-payment-reversal:' || p_idempotency_key::text, 0));

  select * into v_payment from public.expense_payments where id = p_payment_id and company_id = v_company_id;
  if not found then raise exception 'Supplier payment not found for this company'; end if;
  perform 1 from public.expense_ledger where id = v_payment.expense_ledger_id and company_id = v_company_id for update;
  select * into v_payment from public.expense_payments where id = p_payment_id and company_id = v_company_id for update;
  if v_payment.status = 'reversed' then
    if v_payment.reversal_idempotency_key = p_idempotency_key then
      select * into v_expense from public.expense_ledger where id = v_payment.expense_ledger_id and company_id = v_company_id;
      return jsonb_build_object('payment_id', v_payment.id, 'expense_id', v_expense.id, 'amount_paid', v_expense.amount_paid,
        'balance_amount', v_expense.balance_amount, 'payment_status', v_expense.payment_status, 'idempotent_replay', true);
    end if;
    raise exception 'This supplier payment is already reversed';
  end if;

  update public.expense_payments
  set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason),
      reversal_idempotency_key = p_idempotency_key
  where id = v_payment.id and company_id = v_company_id;

  select * into v_expense from public.expense_ledger where id = v_payment.expense_ledger_id and company_id = v_company_id;
  return jsonb_build_object('payment_id', v_payment.id, 'expense_id', v_expense.id, 'amount_paid', v_expense.amount_paid,
    'balance_amount', v_expense.balance_amount, 'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$$;

create or replace function private.record_expense_supplier_credit_atomic(
  p_expense_id uuid, p_credit jsonb, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_expense public.expense_ledger%rowtype;
  v_existing public.expense_supplier_credits%rowtype;
  v_type text := nullif(btrim(p_credit ->> 'credit_type'), '');
  v_amount numeric(14,2);
  v_date date;
  v_method text := nullif(btrim(p_credit ->> 'payment_method'), '');
  v_reference text := nullif(btrim(p_credit ->> 'reference_number'), '');
  v_reason text := nullif(btrim(p_credit ->> 'reason'), '');
  v_hash text;
  v_credit_id uuid;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier credits' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Supplier credit idempotency key is required'; end if;
  if v_type is null or v_type not in ('credit_note', 'refund') then raise exception 'Select a supplier credit note or refund'; end if;
  begin
    v_amount := round(nullif(p_credit ->> 'amount', '')::numeric, 2);
    v_date := coalesce(nullif(p_credit ->> 'credit_date', '')::date, private.business_today());
  exception when others then
    raise exception 'Enter a valid amount and date' using errcode = '22023';
  end;
  v_hash := md5(jsonb_build_object('expense_id', p_expense_id, 'type', v_type, 'amount', v_amount, 'date', v_date,
    'method', v_method, 'reference', v_reference, 'reason', v_reason)::text);

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-supplier-credit:' || p_idempotency_key::text, 0));
  select * into v_existing from public.expense_supplier_credits
  where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'This retry key was already used for a different supplier credit. Refresh the expense before posting again.';
    end if;
    select * into v_expense from public.expense_ledger where id = v_existing.expense_ledger_id and company_id = v_company_id;
    return jsonb_build_object('credit_id', v_existing.id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
      'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', true);
  end if;

  select * into v_expense from public.expense_ledger where id = p_expense_id and company_id = v_company_id for update;
  if not found then raise exception 'Expense not found for this company'; end if;
  if v_expense.deleted_at is not null or v_expense.approval_status <> 'approved' then
    raise exception 'Supplier credits and refunds can only be posted to an approved expense';
  end if;
  if v_amount is null or v_amount = 'NaN'::numeric or v_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if v_date > private.business_today() then raise exception 'Credit or refund date cannot be in the future'; end if;
  if length(coalesce(v_reason, '')) < 5 then raise exception 'Enter a clear supplier credit or refund reason'; end if;
  if v_type = 'credit_note' then
    if v_reference is null then raise exception 'Enter the supplier credit note number'; end if;
    if v_amount > v_expense.total_amount - v_expense.credited_amount then
      raise exception 'Credit note exceeds the uncredited expense amount of %', v_expense.total_amount - v_expense.credited_amount;
    end if;
    if exists (select 1 from public.expense_supplier_credits where company_id = v_company_id and expense_ledger_id = v_expense.id
      and status = 'posted' and credit_type = 'credit_note' and upper(btrim(reference_number)) = upper(v_reference)) then
      raise exception 'Supplier credit note % is already posted against this expense', v_reference using errcode = '23505';
    end if;
  else
    if v_method is null or v_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then
      raise exception 'Select how the supplier refund was received';
    end if;
    if v_method in ('bank_transfer', 'upi', 'cheque') and v_reference is null then
      raise exception 'Reference number is required for bank, UPI and cheque refunds';
    end if;
    if v_amount > v_expense.supplier_credit_due then
      raise exception 'Refund exceeds the supplier credit due of %', v_expense.supplier_credit_due;
    end if;
  end if;

  insert into public.expense_supplier_credits(company_id, expense_ledger_id, credit_type, credit_date, amount,
    payment_method, reference_number, reason, idempotency_key, request_hash, created_by)
  values (v_company_id, v_expense.id, v_type, v_date, v_amount, case when v_type = 'refund' then v_method end,
    v_reference, v_reason, p_idempotency_key, v_hash, auth.uid())
  returning id into v_credit_id;

  select * into v_expense from public.expense_ledger where id = v_expense.id and company_id = v_company_id;
  return jsonb_build_object('credit_id', v_credit_id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
    'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$$;

create or replace function private.reverse_expense_supplier_credit_atomic(
  p_credit_id uuid, p_reason text, p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_credit public.expense_supplier_credits%rowtype;
  v_expense public.expense_ledger%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for supplier credit reversals' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Reversal idempotency key is required'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Enter a clear reversal reason'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':expense-credit-reversal:' || p_idempotency_key::text, 0));

  select * into v_credit from public.expense_supplier_credits where id = p_credit_id and company_id = v_company_id;
  if not found then raise exception 'Supplier credit not found for this company'; end if;
  perform 1 from public.expense_ledger where id = v_credit.expense_ledger_id and company_id = v_company_id for update;
  select * into v_credit from public.expense_supplier_credits where id = p_credit_id and company_id = v_company_id for update;
  if v_credit.status = 'reversed' then
    if v_credit.reversal_idempotency_key = p_idempotency_key then
      select * into v_expense from public.expense_ledger where id = v_credit.expense_ledger_id and company_id = v_company_id;
      return jsonb_build_object('credit_id', v_credit.id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
        'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', true);
    end if;
    raise exception 'This supplier credit is already reversed';
  end if;
  update public.expense_supplier_credits
  set status = 'reversed', reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason),
      reversal_idempotency_key = p_idempotency_key
  where id = v_credit.id and company_id = v_company_id;
  select * into v_expense from public.expense_ledger where id = v_credit.expense_ledger_id and company_id = v_company_id;
  return jsonb_build_object('credit_id', v_credit.id, 'expense_id', v_expense.id, 'balance_amount', v_expense.balance_amount,
    'supplier_credit_due', v_expense.supplier_credit_due, 'payment_status', v_expense.payment_status, 'idempotent_replay', false);
end;
$$;

create or replace function public.save_manual_expense_atomic(p_expense_id uuid, p_payload jsonb, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.save_manual_expense_atomic(p_expense_id, p_payload, p_idempotency_key) $$;
create or replace function public.transition_expense_approval(p_expense_id uuid, p_action text, p_note text)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.transition_expense_approval(p_expense_id, p_action, p_note) $$;
create or replace function public.record_expense_payment_atomic(p_expense_id uuid, p_payment jsonb, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.record_expense_payment_atomic(p_expense_id, p_payment, p_idempotency_key) $$;
create or replace function public.reverse_expense_payment_atomic(p_payment_id uuid, p_reason text, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.reverse_expense_payment_atomic(p_payment_id, p_reason, p_idempotency_key) $$;
create or replace function public.record_expense_supplier_credit_atomic(p_expense_id uuid, p_credit jsonb, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.record_expense_supplier_credit_atomic(p_expense_id, p_credit, p_idempotency_key) $$;
create or replace function public.reverse_expense_supplier_credit_atomic(p_credit_id uuid, p_reason text, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.reverse_expense_supplier_credit_atomic(p_credit_id, p_reason, p_idempotency_key) $$;

-- ---------------------------------------------------------------------------
-- Source-linked costs (EXP-10, EXP-11, EXP-15, EXP-19..EXP-22, EXP-24, EXP-25)
-- ---------------------------------------------------------------------------
create or replace function private.retire_source_expense(
  p_company_id uuid, p_expense_id uuid, p_delete boolean, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_expense public.expense_ledger%rowtype;
begin
  if p_expense_id is null then return; end if;
  select * into v_expense from public.expense_ledger where id = p_expense_id and company_id = p_company_id for update;
  if not found then return; end if;
  -- Paid history is never silently removed from spend: cash must be reversed or refunded first.
  if v_expense.amount_paid - v_expense.refunded_amount > 0 then
    raise exception 'Expense % has posted supplier payments. Reverse them or record the supplier refund in Expenses before this source cost is %.',
      v_expense.expense_number, p_reason using errcode = '23514';
  end if;
  if v_expense.approval_status <> 'cancelled' then
    perform private.set_expense_approval_state(v_expense.id, p_company_id, 'cancelled', 'Source ' || p_reason, false);
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (p_company_id, auth.uid(), 'expense_source_retired', 'expense_ledger', v_expense.id,
      jsonb_build_object('expense_number', v_expense.expense_number, 'from', v_expense.approval_status,
        'reason', p_reason, 'source_table', v_expense.source_table, 'source_record_id', v_expense.source_record_id,
        'total_amount', v_expense.total_amount));
  end if;
  if p_delete and v_expense.deleted_at is null then
    update public.expense_ledger set deleted_at = now(), updated_by = auth.uid()
    where id = v_expense.id and company_id = p_company_id;
  end if;
end;
$$;
revoke all on function private.retire_source_expense(uuid,uuid,boolean,text) from public, anon, authenticated;

create or replace function public.upsert_source_expense_v2(
  p_company_id uuid, p_source_module text, p_source_submodule text, p_source_table text, p_source_record_id uuid,
  p_source_label text, p_expense_category text, p_expense_subcategory text, p_vendor_id uuid, p_description text,
  p_quantity numeric, p_unit text, p_rate numeric, p_base_amount numeric, p_tax_amount numeric,
  p_freight_amount numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text,
  p_payment_method text, p_invoice_number text, p_invoice_date date, p_due_date date, p_inventory_item_id uuid,
  p_vendor_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_existing public.expense_ledger%rowtype;
  v_vendor_name text := nullif(btrim(p_vendor_name), '');
  v_vendor_id uuid;
  v_invoice_number text := nullif(btrim(p_invoice_number), '');
  v_duplicate text;
  v_id uuid;
  v_total numeric(14,2) := round(coalesce(p_base_amount,0) + coalesce(p_tax_amount,0) + coalesce(p_freight_amount,0) - coalesce(p_discount_amount,0), 2);
begin
  -- p_total_amount and p_payment_status are accepted for signature compatibility only:
  -- the total is derived from components and payment state comes from the payment ledger.
  if p_vendor_id is not null then
    select id, vendor_name into v_vendor_id, v_vendor_name from public.vendors where id = p_vendor_id and company_id = p_company_id;
    if v_vendor_id is null then v_vendor_name := nullif(btrim(p_vendor_name), ''); end if;
  end if;

  v_duplicate := private.find_duplicate_vendor_bill(p_company_id, v_vendor_id, v_invoice_number, p_invoice_date, v_total, null, p_source_record_id);
  if v_duplicate is not null then
    raise warning 'Duplicate vendor bill % also recorded as expense %', v_invoice_number, v_duplicate;
    insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
    values (p_company_id, auth.uid(), 'expense_duplicate_vendor_bill_warning', p_source_table, p_source_record_id,
      jsonb_build_object('invoice_number', v_invoice_number, 'vendor_id', v_vendor_id, 'existing_expense', v_duplicate, 'total_amount', v_total));
  end if;

  select * into v_existing from public.expense_ledger
  where company_id = p_company_id and source_table = p_source_table and source_record_id = p_source_record_id
  for update;

  if not found then
    insert into public.expense_ledger(company_id, source_module, source_submodule, source_table, source_record_id, source_label,
      expense_category, expense_subcategory, vendor_id, vendor_name_snapshot, description, quantity, unit, rate,
      base_amount, tax_amount, freight_amount, discount_amount, total_amount, currency, payment_method,
      invoice_number, invoice_date, due_date, inventory_item_id, approval_status, created_by, updated_by)
    values (p_company_id, p_source_module, p_source_submodule, p_source_table, p_source_record_id, p_source_label,
      p_expense_category, p_expense_subcategory, v_vendor_id, v_vendor_name, p_description, coalesce(p_quantity, 0), p_unit,
      coalesce(p_rate, 0), coalesce(p_base_amount, 0), coalesce(p_tax_amount, 0), coalesce(p_freight_amount, 0),
      coalesce(p_discount_amount, 0), v_total, 'INR', p_payment_method, v_invoice_number, p_invoice_date, p_due_date,
      p_inventory_item_id, 'pending_approval', auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  if v_existing.approval_status = 'cancelled' then
    -- A previously retired source cost that becomes chargeable again needs a fresh approval.
    update public.expense_ledger set deleted_at = null where id = v_existing.id and company_id = p_company_id;
    perform private.set_expense_approval_state(v_existing.id, p_company_id, 'pending_approval', 'Source cost reactivated', false);
  end if;

  update public.expense_ledger
  set source_module = p_source_module, source_submodule = p_source_submodule, source_label = p_source_label,
      expense_category = p_expense_category, expense_subcategory = p_expense_subcategory, vendor_id = v_vendor_id,
      vendor_name_snapshot = v_vendor_name, description = p_description, quantity = coalesce(p_quantity, 0),
      unit = p_unit, rate = coalesce(p_rate, 0), base_amount = coalesce(p_base_amount, 0),
      tax_amount = coalesce(p_tax_amount, 0), freight_amount = coalesce(p_freight_amount, 0),
      discount_amount = coalesce(p_discount_amount, 0), total_amount = v_total, payment_method = p_payment_method,
      invoice_number = v_invoice_number, invoice_date = p_invoice_date, due_date = p_due_date,
      inventory_item_id = p_inventory_item_id, deleted_at = null, updated_by = auth.uid()
  where id = v_existing.id and company_id = p_company_id
    and (source_module, source_submodule, source_label, expense_category, expense_subcategory, vendor_id,
      vendor_name_snapshot, description, quantity, unit, rate, base_amount, tax_amount, freight_amount,
      discount_amount, total_amount, payment_method, invoice_number, invoice_date, due_date, inventory_item_id, deleted_at)
    is distinct from (p_source_module, p_source_submodule, p_source_label, p_expense_category, p_expense_subcategory, v_vendor_id,
      v_vendor_name, p_description, coalesce(p_quantity, 0)::numeric(14,3), p_unit, coalesce(p_rate, 0)::numeric(14,2),
      coalesce(p_base_amount, 0)::numeric(14,2), coalesce(p_tax_amount, 0)::numeric(14,2), coalesce(p_freight_amount, 0)::numeric(14,2),
      coalesce(p_discount_amount, 0)::numeric(14,2), v_total, p_payment_method, v_invoice_number, p_invoice_date, p_due_date,
      p_inventory_item_id, null::timestamptz);
  return v_existing.id;
end;
$$;
revoke all on function public.upsert_source_expense_v2(uuid,text,text,text,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,date,date,uuid,text) from public, anon, authenticated;

create or replace function public.upsert_source_expense(
  p_company_id uuid, p_source_module text, p_source_submodule text, p_source_table text, p_source_record_id uuid,
  p_source_label text, p_expense_category text, p_expense_subcategory text, p_vendor_id uuid, p_description text,
  p_quantity numeric, p_unit text, p_rate numeric, p_base_amount numeric, p_tax_amount numeric,
  p_freight_amount numeric, p_discount_amount numeric, p_total_amount numeric, p_payment_status text,
  p_payment_method text, p_invoice_number text, p_invoice_date date, p_due_date date, p_inventory_item_id uuid
)
returns uuid
language sql
security definer
set search_path = public, private
as $$
  select public.upsert_source_expense_v2(p_company_id, p_source_module, p_source_submodule, p_source_table, p_source_record_id,
    p_source_label, p_expense_category, p_expense_subcategory, p_vendor_id, p_description, p_quantity, p_unit, p_rate,
    p_base_amount, p_tax_amount, p_freight_amount, p_discount_amount, p_total_amount, p_payment_status, p_payment_method,
    p_invoice_number, p_invoice_date, p_due_date, p_inventory_item_id, null)
$$;
revoke all on function public.upsert_source_expense(uuid,text,text,text,uuid,text,text,text,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,date,date,uuid) from public, anon, authenticated;

-- Weighted-average stock valuation for a source receipt. Quantity changes move stock at the
-- receipt rate; a rate change revalues only the units of this receipt that remain on hand;
-- a SKU change moves the receipt from the former item to the new one (EXP-22, EXP-24).
create or replace function private.post_source_inventory_change(
  p_company_id uuid, p_old_item uuid, p_old_qty numeric, p_old_rate numeric,
  p_new_item uuid, p_new_qty numeric, p_new_rate numeric, p_unit text,
  p_reference_type text, p_reference_id uuid, p_movement_date date, p_in_type text, p_note text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
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
      update public.inventory_items
      set average_rate = case when v_stock - v_old_qty > 0 and v_old_rate > 0
            then round(greatest(v_stock * v_avg - v_old_qty * v_old_rate, 0) / (v_stock - v_old_qty), 2) else average_rate end,
          current_stock = greatest(v_stock - v_old_qty, 0), updated_at = now()
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

  update public.inventory_items
  set average_rate = case
        when v_stock + v_delta > 0 and (v_new_rate > 0 or v_old_rate > 0)
          then round(greatest(v_stock * v_avg + v_qty_value + v_revalue, 0) / (v_stock + v_delta), 2)
        else average_rate end,
      current_stock = greatest(v_stock + v_delta, 0),
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
$$;
revoke all on function private.post_source_inventory_change(uuid,uuid,numeric,numeric,uuid,numeric,numeric,text,text,uuid,date,text,text) from public, anon, authenticated;

create or replace function public.sync_external_source_inventory_and_expense()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item_code text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_payment_status text;
begin
  -- The projection updates below re-enter this trigger; nested calls are no-ops (EXP-19).
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.weight_kg, old.rate,
      old.inventory_item_id, 0, old.rate, coalesce(old.unit, 'kg'), 'foundry_external_aluminium_sources', old.id,
      private.business_today(), 'purchase_in', 'External source deleted');
    return old;
  end if;

  v_item_code := concat('RM-EXT-', upper(regexp_replace(coalesce(new.item_type, 'raw'), '[^a-zA-Z0-9]+', '-', 'g')), '-',
    upper(regexp_replace(coalesce(new.alloy, 'GEN'), '[^a-zA-Z0-9]+', '', 'g')));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code,
    btrim(concat('External Aluminium ', replace(coalesce(new.item_type, 'raw_material'), '_', ' '), ' ', coalesce(new.alloy, ''))),
    'billets', coalesce(new.unit, 'kg'));
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, case when tg_op = 'UPDATE' then old.weight_kg else 0 end,
    case when tg_op = 'UPDATE' then old.rate else 0 end, v_item_id, new.weight_kg, new.rate, coalesce(new.unit, 'kg'),
    'foundry_external_aluminium_sources', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'purchase_in', case when tg_op = 'INSERT' then 'External aluminium source purchase' else 'External aluminium source updated' end);

  v_base := case when coalesce(new.rate, 0) > 0 and coalesce(new.weight_kg, 0) > 0
    then round(new.weight_kg * new.rate, 2) else coalesce(new.base_amount, 0) end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  if v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'foundry', 'external_aluminium_sources',
      'foundry_external_aluminium_sources', new.id, new.source_number, 'raw_material', 'external_aluminium_source',
      new.vendor_id, concat('External aluminium purchase: ', replace(new.item_type, '_', ' '), coalesce(concat(' alloy ', new.alloy), '')),
      new.weight_kg, coalesce(new.unit, 'kg'), coalesce(new.rate, 0), v_base, coalesce(new.tax_amount, 0),
      coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total, null, new.payment_method,
      new.invoice_number, new.invoice_date, new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.foundry_external_aluminium_sources
  set base_amount = v_base, total_amount = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_amount, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$$;

create or replace function public.sync_scrap_inventory_and_expense()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item_code text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.weight_kg, old.rate,
      old.inventory_item_id, 0, old.rate, coalesce(old.unit, 'kg'), 'foundry_aluminium_scrap', old.id,
      private.business_today(), 'scrap_in', 'Scrap source deleted');
    return old;
  end if;

  v_item_code := concat('SCRAP-', upper(regexp_replace(coalesce(new.scrap_quality, 'MIXED'), '[^a-zA-Z0-9]+', '-', 'g')));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code,
    btrim(concat('Aluminium Scrap ', replace(coalesce(new.scrap_quality, 'mixed'), '_', ' '))), 'scrap', coalesce(new.unit, 'kg'));
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, case when tg_op = 'UPDATE' then old.weight_kg else 0 end,
    case when tg_op = 'UPDATE' then old.rate else 0 end, v_item_id, new.weight_kg, new.rate, coalesce(new.unit, 'kg'),
    'foundry_aluminium_scrap', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'scrap_in', case when tg_op = 'INSERT' then 'Incoming aluminium scrap purchase' else 'Aluminium scrap source updated' end);

  v_base := case when coalesce(new.rate, 0) > 0 and coalesce(new.weight_kg, 0) > 0
    then round(new.weight_kg * new.rate, 2) else coalesce(new.base_amount, 0) end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  if v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'foundry', 'scrap_purchase', 'foundry_aluminium_scrap',
      new.id, new.scrap_number, 'raw_material', 'scrap_purchase', new.vendor_id,
      concat('Aluminium scrap purchase: ', replace(new.scrap_quality, '_', ' '), ' (', replace(new.scrap_source, '_', ' '), ')'),
      new.weight_kg, coalesce(new.unit, 'kg'), coalesce(new.rate, 0), v_base, coalesce(new.tax_amount, 0),
      coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total, null, new.payment_method,
      new.invoice_number, new.invoice_date, new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.foundry_aluminium_scrap
  set base_amount = v_base, total_amount = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_amount, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$$;

create or replace function public.sync_outsourced_billet_expense()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_item_code text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_new_qty numeric(14,3);
  v_old_qty numeric(14,3);
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    if coalesce(old.status, 'received') <> 'cancelled' then
      perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.weight_kg, old.price_per_kg,
        old.inventory_item_id, 0, old.price_per_kg, coalesce(old.unit, 'kg'), 'outsourced_billet_batches', old.id,
        private.business_today(), 'purchase_in', 'Outsourced billet batch deleted');
    end if;
    return old;
  end if;

  v_item_code := concat('OBB-', upper(regexp_replace(coalesce(new.alloy, 'GEN'), '[^a-zA-Z0-9]+', '', 'g')), '-',
    replace(coalesce(new.billet_diameter_inch::text, '0'), '.', ''));
  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id, v_item_code,
    btrim(concat('Outsourced billet batch ', coalesce(new.alloy, ''), ' ', coalesce(new.temper, ''))), 'billets', coalesce(new.unit, 'kg'));
  v_new_qty := case when coalesce(new.status, 'received') = 'cancelled' then 0 else coalesce(new.weight_kg, 0) end;
  v_old_qty := case when tg_op = 'INSERT' or coalesce(old.status, 'received') = 'cancelled' then 0 else coalesce(old.weight_kg, 0) end;
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, v_old_qty,
    case when tg_op = 'UPDATE' then old.price_per_kg else 0 end, v_item_id, v_new_qty, new.price_per_kg, coalesce(new.unit, 'kg'),
    'outsourced_billet_batches', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'purchase_in', case when tg_op = 'INSERT' then 'Outsourced billet purchase' else 'Outsourced billet batch updated' end);

  v_base := case
    when coalesce(new.price_per_kg, 0) > 0 and coalesce(new.weight_kg, 0) > 0 then round(new.weight_kg * new.price_per_kg, 2)
    when coalesce(new.base_amount, 0) > 0 then new.base_amount
    else coalesce(new.total_price, 0)
  end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  -- A cancelled batch is void: its payable is retired, never left active (EXP-20). Any
  -- cancellation fee is recorded as a separate manual expense against the vendor.
  if coalesce(new.status, 'received') = 'cancelled' or v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false,
      case when coalesce(new.status, 'received') = 'cancelled' then 'cancelled' else 'set to zero' end);
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'foundry', 'outsourced_billets', 'outsourced_billet_batches',
      new.id, new.batch_number, 'raw_material', 'outsourced_billet_purchase', new.vendor_id,
      concat('Outsourced billet batch purchase ', new.batch_number), new.weight_kg, coalesce(new.unit, 'kg'),
      coalesce(new.price_per_kg, 0), v_base, coalesce(new.tax_amount, 0), coalesce(new.freight_amount, 0),
      coalesce(new.discount_amount, 0), v_total, null, new.payment_method, new.invoice_number, new.invoice_date,
      new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.outsourced_billet_batches
  set base_amount = v_base, total_price = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_price, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$$;

create or replace function public.sync_packaging_purchase_inventory_and_expense()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_material_code text;
  v_material_name text;
  v_material_type text;
  v_material_unit text;
  v_item_id uuid;
  v_expense_id uuid;
  v_base numeric(14,2);
  v_total numeric(14,2);
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    perform private.post_source_inventory_change(old.company_id, old.inventory_item_id, old.quantity, old.rate,
      old.inventory_item_id, 0, old.rate, coalesce(old.unit, 'meter'), 'packaging_material_purchases', old.id,
      private.business_today(), 'purchase_in', 'Packaging material purchase deleted');
    return old;
  end if;

  if tg_op = 'UPDATE' and new.material_id <> old.material_id then
    raise exception 'Material cannot be changed for an existing purchase record. Create a new purchase entry instead.';
  end if;
  select material_code, material_name, material_type, unit
    into v_material_code, v_material_name, v_material_type, v_material_unit
  from public.packaging_materials where id = new.material_id and company_id = new.company_id;
  if not found then raise exception 'Packaging material not found for this company'; end if;

  v_item_id := public.ensure_inventory_item_for_expense_source(new.company_id,
    concat('PKG-', upper(regexp_replace(coalesce(v_material_code, 'MAT'), '[^a-zA-Z0-9]+', '-', 'g'))),
    concat('Packaging Material ', coalesce(v_material_name, '')), 'packing_material', coalesce(new.unit, v_material_unit, 'meter'));
  perform private.post_source_inventory_change(new.company_id,
    case when tg_op = 'UPDATE' then old.inventory_item_id end, case when tg_op = 'UPDATE' then old.quantity else 0 end,
    case when tg_op = 'UPDATE' then old.rate else 0 end, v_item_id, new.quantity, new.rate,
    coalesce(new.unit, v_material_unit, 'meter'), 'packaging_material_purchases', new.id,
    case when tg_op = 'INSERT' then coalesce(new.received_date, private.business_today()) else private.business_today() end,
    'purchase_in', case when tg_op = 'INSERT' then 'Packaging material purchase' else 'Packaging material purchase updated' end);

  v_base := case when coalesce(new.rate, 0) > 0 and coalesce(new.quantity, 0) > 0
    then round(new.quantity * new.rate, 2) else coalesce(new.base_amount, 0) end;
  v_total := round(v_base + coalesce(new.tax_amount, 0) + coalesce(new.freight_amount, 0) - coalesce(new.discount_amount, 0), 2);

  if v_total <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    v_expense_id := new.expense_ledger_id;
  else
    v_expense_id := public.upsert_source_expense_v2(new.company_id, 'packaging', 'material_purchase',
      'packaging_material_purchases', new.id, new.purchase_number, 'packaging_material', coalesce(v_material_type, 'other'),
      new.vendor_id, concat('Packaging material purchase: ', coalesce(v_material_name, v_material_code, 'Material')),
      new.quantity, coalesce(new.unit, v_material_unit, 'meter'), coalesce(new.rate, 0), v_base, coalesce(new.tax_amount, 0),
      coalesce(new.freight_amount, 0), coalesce(new.discount_amount, 0), v_total, null, new.payment_method,
      new.invoice_number, new.invoice_date, new.due_date, v_item_id, null);
  end if;
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;

  update public.packaging_material_purchases
  set base_amount = v_base, total_amount = v_total, inventory_item_id = v_item_id, expense_ledger_id = v_expense_id,
      payment_status = coalesce(v_payment_status, payment_status), updated_at = now()
  where id = new.id and company_id = new.company_id
    and (base_amount, total_amount, inventory_item_id, expense_ledger_id, payment_status)
      is distinct from (v_base, v_total, v_item_id, v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$$;

create or replace function public.sync_energy_reading_expense()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_expense_id uuid;
  v_category text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    return old;
  end if;
  -- A zero-cost reading retires the previously posted payable instead of leaving it (EXP-15).
  if coalesce(new.total_cost, 0) <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    return new;
  end if;
  v_category := case when new.energy_type in ('diesel', 'furnace_oil', 'lpg') then 'fuel_oils' else 'utilities' end;
  v_expense_id := public.upsert_source_expense_v2(new.company_id, 'energy', 'energy_readings', 'energy_readings', new.id,
    concat(upper(new.energy_type), '-', to_char(new.reading_date, 'YYYYMMDD')), v_category, new.energy_type, null,
    concat('Utility cost from energy reading: ', replace(new.energy_type, '_', ' ')), coalesce(new.consumption, 0),
    coalesce(new.unit, 'units'), coalesce(new.rate_per_unit, 0), round(coalesce(new.total_cost, 0), 2), 0, 0, 0,
    round(coalesce(new.total_cost, 0), 2),
    null, null, null, null, null, null, null);
  update public.energy_readings set expense_ledger_id = v_expense_id
  where id = new.id and company_id = new.company_id and expense_ledger_id is distinct from v_expense_id;
  return new;
end;
$$;

create or replace function public.sync_breakdown_expense()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_expense_id uuid;
  v_payment_status text;
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    perform private.retire_source_expense(old.company_id, old.expense_ledger_id, true, 'deleted');
    return old;
  end if;
  if coalesce(new.cost, 0) <= 0 then
    perform private.retire_source_expense(new.company_id, new.expense_ledger_id, false, 'set to zero');
    return new;
  end if;
  -- The maintenance form records a free-text supplier and bill; map them into the
  -- central payable when the linked vendor/invoice fields are blank (EXP-21).
  v_expense_id := public.upsert_source_expense_v2(new.company_id, 'maintenance', 'breakdown_logs', 'breakdown_logs', new.id,
    concat('MNT-', to_char(new.breakdown_date, 'YYYYMMDD')), 'maintenance_repairs', lower(coalesce(new.machine_type, 'other')),
    new.vendor_id, concat('Machine breakdown repair: ', coalesce(new.issue_description, 'Maintenance service')), 1, 'job',
    round(coalesce(new.cost, 0), 2), round(coalesce(new.cost, 0), 2), 0, 0, 0, round(coalesce(new.cost, 0), 2), null,
    new.payment_method, coalesce(nullif(btrim(new.invoice_number), ''), nullif(btrim(new.bill_number), '')),
    coalesce(new.invoice_date, new.bill_date), new.due_date, null, new.vendor_name);
  select payment_status into v_payment_status from public.expense_ledger where id = v_expense_id and company_id = new.company_id;
  update public.breakdown_logs
  set expense_ledger_id = v_expense_id, payment_status = coalesce(v_payment_status, payment_status)
  where id = new.id and company_id = new.company_id
    and (expense_ledger_id, payment_status) is distinct from (v_expense_id, coalesce(v_payment_status, payment_status));
  return new;
end;
$$;

-- Central payment state is authoritative; source records display its projection (EXP-10).
create or replace function private.project_expense_payment_status_to_source()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.source_table is null or new.source_record_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.payment_status is not distinct from old.payment_status then return new; end if;
  if new.source_table in ('foundry_external_aluminium_sources', 'foundry_aluminium_scrap', 'outsourced_billet_batches',
    'packaging_material_purchases', 'breakdown_logs') then
    execute format('update public.%I set payment_status = $1 where id = $2 and company_id = $3 and payment_status is distinct from $1',
      new.source_table) using new.payment_status, new.source_record_id, new.company_id;
  end if;
  return new;
end;
$$;
revoke all on function private.project_expense_payment_status_to_source() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- Replace every historical trigger that points at an expense sync function (including
-- the broken dispatcher, which called trigger functions directly) with one canonical trigger.
do $$
declare
  v_trigger record;
begin
  for v_trigger in
    select t.tgname, c.relname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and not t.tgisinternal
      and c.relname in ('foundry_external_aluminium_sources', 'foundry_aluminium_scrap', 'outsourced_billet_batches')
      and p.proname in ('sync_expense_link_for_sources', 'sync_external_source_inventory_and_expense',
        'sync_scrap_inventory_and_expense', 'sync_outsourced_billet_expense')
  loop
    execute format('drop trigger if exists %I on public.%I', v_trigger.tgname, v_trigger.relname);
  end loop;
end $$;

create trigger sync_expense_foundry_external_sources
after insert or update or delete on public.foundry_external_aluminium_sources
for each row execute function public.sync_external_source_inventory_and_expense();
create trigger sync_expense_foundry_scrap
after insert or update or delete on public.foundry_aluminium_scrap
for each row execute function public.sync_scrap_inventory_and_expense();
create trigger sync_expense_outsourced_billets
after insert or update or delete on public.outsourced_billet_batches
for each row execute function public.sync_outsourced_billet_expense();

drop trigger if exists expense_payments_immutable_guard on public.expense_payments;
create trigger expense_payments_immutable_guard
before update or delete on public.expense_payments
for each row execute function private.guard_expense_settlement_row();
drop trigger if exists expense_supplier_credits_immutable_guard on public.expense_supplier_credits;
create trigger expense_supplier_credits_immutable_guard
before update or delete on public.expense_supplier_credits
for each row execute function private.guard_expense_settlement_row();
drop trigger if exists set_expense_supplier_credits_updated_at on public.expense_supplier_credits;
create trigger set_expense_supplier_credits_updated_at
before update on public.expense_supplier_credits
for each row execute function public.set_updated_at();
drop trigger if exists sync_expense_supplier_credit_totals on public.expense_supplier_credits;
create trigger sync_expense_supplier_credit_totals
after insert or update or delete on public.expense_supplier_credits
for each row execute function public.sync_expense_payment_totals();
drop trigger if exists log_expense_supplier_credit_audit on public.expense_supplier_credits;
create trigger log_expense_supplier_credit_audit
after insert or update or delete on public.expense_supplier_credits
for each row execute function private.log_expense_supplier_credit_audit();
drop trigger if exists project_expense_payment_status_to_source on public.expense_ledger;
create trigger project_expense_payment_status_to_source
after insert or update on public.expense_ledger
for each row execute function private.project_expense_payment_status_to_source();

-- ---------------------------------------------------------------------------
-- Read projections: live overdue state (EXP-16) and historical reconciliation
-- ---------------------------------------------------------------------------
create or replace view public.expense_ledger_authorized with (security_barrier = true) as
select e.id, e.company_id, e.expense_number, e.source_module, e.source_submodule, e.source_table, e.source_record_id,
  e.source_label, e.expense_category, e.expense_subcategory, e.vendor_id, e.vendor_name_snapshot, e.description,
  e.quantity, e.unit, e.rate, e.base_amount, e.tax_amount, e.freight_amount, e.discount_amount, e.total_amount,
  e.currency, e.amount_paid, e.refunded_amount, e.credited_amount, e.balance_amount, e.supplier_credit_due,
  private.expense_live_payment_status(e.payment_status, e.balance_amount, e.due_date) as payment_status,
  e.payment_status as stored_payment_status, e.payment_method, e.invoice_number, e.invoice_date, e.due_date,
  e.paid_date, e.cost_center, e.department, e.machine_id, e.inventory_item_id, e.maintenance_record_id,
  e.approval_status, e.approval_note, e.approved_by, e.approved_at, e.notes, e.created_by, e.updated_by,
  e.created_at, e.updated_at, e.deleted_at
from public.expense_ledger e
where auth.uid() is not null and e.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts');

create or replace view public.expense_ledger_reconciliation_issues with (security_barrier = true) as
with ledger as (
  select e.*,
    coalesce((select sum(p.amount_paid) from public.expense_payments p where p.company_id = e.company_id
      and p.expense_ledger_id = e.id and p.status = 'posted'), 0) as ledger_paid,
    coalesce((select sum(c.amount) from public.expense_supplier_credits c where c.company_id = e.company_id
      and c.expense_ledger_id = e.id and c.status = 'posted' and c.credit_type = 'credit_note'), 0) as ledger_credited,
    coalesce((select sum(c.amount) from public.expense_supplier_credits c where c.company_id = e.company_id
      and c.expense_ledger_id = e.id and c.status = 'posted' and c.credit_type = 'refund'), 0) as ledger_refunded
  from public.expense_ledger e
  where auth.uid() is not null and e.company_id = private.get_current_user_company_id()
    and private.get_current_user_role() in ('owner', 'admin', 'accounts')
)
select id as expense_id, company_id, expense_number, 'total_component_mismatch'::text as issue,
  total_amount as stored_value, round(base_amount + tax_amount + freight_amount - discount_amount, 2) as expected_value
from ledger where total_amount <> round(base_amount + tax_amount + freight_amount - discount_amount, 2)
union all
select id, company_id, expense_number, 'paid_projection_mismatch', amount_paid, ledger_paid
from ledger where amount_paid <> ledger_paid
union all
select id, company_id, expense_number, 'settlement_exceeds_total', total_amount, ledger_paid - ledger_refunded + ledger_credited
from ledger where ledger_paid - ledger_refunded > total_amount or ledger_credited > total_amount
union all
select id, company_id, expense_number, 'paid_without_approval', amount_paid, 0
from ledger where ledger_paid - ledger_refunded > 0 and approval_status not in ('approved')
union all
select id, company_id, expense_number, 'legacy_paid_approval_label', null, null
from ledger where approval_status = 'paid'
union all
select id, company_id, expense_number, 'non_inr_currency', total_amount, null
from ledger where currency <> 'INR'
union all
select p.expense_ledger_id, p.company_id, null, 'cross_company_payment_link', p.amount_paid, null
from public.expense_payments p
where auth.uid() is not null and p.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts')
  and not exists (select 1 from public.expense_ledger e where e.id = p.expense_ledger_id and e.company_id = p.company_id);

revoke all on public.expense_ledger_authorized, public.expense_ledger_reconciliation_issues from public, anon, authenticated;
grant select on public.expense_ledger_authorized, public.expense_ledger_reconciliation_issues to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function private.save_manual_expense_atomic(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function private.transition_expense_approval(uuid,text,text) from public, anon, authenticated;
revoke all on function private.record_expense_payment_atomic(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function private.reverse_expense_payment_atomic(uuid,text,uuid) from public, anon, authenticated;
revoke all on function private.record_expense_supplier_credit_atomic(uuid,jsonb,uuid) from public, anon, authenticated;
revoke all on function private.reverse_expense_supplier_credit_atomic(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.save_manual_expense_atomic(uuid,jsonb,uuid) from public, anon;
revoke all on function public.transition_expense_approval(uuid,text,text) from public, anon;
revoke all on function public.record_expense_payment_atomic(uuid,jsonb,uuid) from public, anon;
revoke all on function public.reverse_expense_payment_atomic(uuid,text,uuid) from public, anon;
revoke all on function public.record_expense_supplier_credit_atomic(uuid,jsonb,uuid) from public, anon;
revoke all on function public.reverse_expense_supplier_credit_atomic(uuid,text,uuid) from public, anon;
grant execute on function public.save_manual_expense_atomic(uuid,jsonb,uuid) to authenticated;
grant execute on function public.transition_expense_approval(uuid,text,text) to authenticated;
grant execute on function public.record_expense_payment_atomic(uuid,jsonb,uuid) to authenticated;
grant execute on function public.reverse_expense_payment_atomic(uuid,text,uuid) to authenticated;
grant execute on function public.record_expense_supplier_credit_atomic(uuid,jsonb,uuid) to authenticated;
grant execute on function public.reverse_expense_supplier_credit_atomic(uuid,text,uuid) to authenticated;
revoke execute on function public.expense_apply_totals() from public, anon, authenticated;
revoke execute on function public.apply_expense_approval_policy() from public, anon, authenticated;
revoke execute on function public.prevent_direct_edit_approved_expense() from public, anon, authenticated;
revoke execute on function public.sync_expense_payment_totals() from public, anon, authenticated;
revoke execute on function public.log_expense_audit() from public, anon, authenticated;
revoke execute on function public.log_expense_payment_audit() from public, anon, authenticated;
revoke execute on function public.sync_external_source_inventory_and_expense() from public, anon, authenticated;
revoke execute on function public.sync_scrap_inventory_and_expense() from public, anon, authenticated;
revoke execute on function public.sync_outsourced_billet_expense() from public, anon, authenticated;
revoke execute on function public.sync_packaging_purchase_inventory_and_expense() from public, anon, authenticated;
revoke execute on function public.sync_energy_reading_expense() from public, anon, authenticated;
revoke execute on function public.sync_breakdown_expense() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- One-time projection repair
-- ---------------------------------------------------------------------------
do $$
declare
  v_invalid integer;
begin
  -- "paid" was never an approval decision (EXP-18). Relabel it to the approval it implied;
  -- payment state is then derived from the ledger, so an unpaid row no longer reads as paid.
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  select company_id, null, 'expense_legacy_paid_approval_relabelled', 'expense_ledger', id,
    jsonb_build_object('expense_number', expense_number, 'from', 'paid', 'to', 'approved', 'amount_paid', amount_paid)
  from public.expense_ledger where approval_status = 'paid';
  perform set_config('extrusionos.expense_approval_transition', 'on', true);
  update public.expense_ledger set approval_status = 'approved' where approval_status = 'paid';
  perform set_config('extrusionos.expense_approval_transition', '', true);

  -- Recompute settlement projections wherever the posted ledger is internally valid. Rows
  -- that cannot be reconciled automatically stay untouched and appear in the reconciliation view.
  update public.expense_ledger e set updated_at = now()
  where coalesce((select sum(p.amount_paid) from public.expense_payments p
    where p.company_id = e.company_id and p.expense_ledger_id = e.id and p.status = 'posted'), 0) <= e.total_amount;
  select count(*) into v_invalid from public.expense_ledger e
  where coalesce((select sum(p.amount_paid) from public.expense_payments p
    where p.company_id = e.company_id and p.expense_ledger_id = e.id and p.status = 'posted'), 0) > e.total_amount;
  if v_invalid > 0 then
    raise warning '% expense rows have posted payments above their total; review expense_ledger_reconciliation_issues.', v_invalid;
  end if;
end $$;

commit;
