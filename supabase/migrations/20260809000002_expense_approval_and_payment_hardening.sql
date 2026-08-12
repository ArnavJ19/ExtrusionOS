-- Expense subsystem hardening. Unlike customer receipts/invoices (which go through
-- SECURITY DEFINER atomic RPCs), expenses are written directly to tables under RLS, so
-- the approval and disbursement controls must live in triggers. This migration:
--   1. Stops a client from self-approving an over-threshold expense (approval bypass).
--   2. Blocks expense payments against an un-approved / cancelled / reversed expense.
--   3. Serializes concurrent expense-payment inserts so they cannot overpay.
--   4. Recomputes manual-expense landed total server-side instead of trusting the client.
--   5. Verifies an expense payment belongs to the same company as its parent expense.
-- All changes redefine existing functions or add a new guard trigger; no data is dropped.

-- 1 + (approver stamping). Over-threshold expenses can only be 'approved' by owner/admin;
-- any other actor's 'approved' is downgraded to pending_approval and approver stamps cleared.
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

  -- Auto-approve small expenses posted by a finance-authorized role.
  if coalesce(new.total_amount, 0) <= v_threshold and v_role in ('owner','admin','accounts') then
    new.approval_status := 'approved';
    new.approved_by := coalesce(new.approved_by, auth.uid());
    new.approved_at := coalesce(new.approved_at, now());
    return new;
  end if;

  -- Above threshold (or posted by a non-finance role): only owner/admin may approve.
  if new.approval_status = 'approved' then
    if v_role in ('owner','admin') then
      new.approved_by := coalesce(new.approved_by, auth.uid());
      new.approved_at := coalesce(new.approved_at, now());
      return new;
    end if;
    -- Anyone else trying to self-approve is forced back to pending.
    new.approval_status := 'pending_approval';
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;

  -- Everything else normalizes to pending_approval and clears any stale approver stamp.
  if coalesce(new.approval_status, 'draft') in ('draft', 'pending_approval') then
    new.approval_status := 'pending_approval';
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

-- 4. Manual-expense totals are derived from components server-side. Source-driven
-- expenses (foundry/scrap/billet/packaging/energy/maintenance) keep their existing
-- behaviour, since their own sync triggers own the landed total.
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

  if coalesce(new.source_module, 'manual') = 'manual' then
    -- Never trust a client-supplied total for a manual expense.
    if new.base_amount <= 0 and new.quantity > 0 and new.rate > 0 then
      new.base_amount := round((new.quantity * new.rate)::numeric, 2);
    end if;
    new.total_amount := greatest(round((new.base_amount + new.tax_amount + new.freight_amount - new.discount_amount)::numeric, 2), 0);
  else
    new.total_amount := coalesce(new.total_amount, new.base_amount + new.tax_amount + new.freight_amount - new.discount_amount);
    if new.total_amount <= 0 and new.quantity > 0 and new.rate > 0 then
      new.base_amount := round((new.quantity * new.rate)::numeric, 2);
      new.total_amount := round((new.base_amount + new.tax_amount + new.freight_amount - new.discount_amount)::numeric, 2);
    end if;
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

-- 2 + 3 + 5. Gate every expense payment: lock the parent expense (serializes concurrent
-- inserts so they cannot overpay), require it to be approved, verify same company, and
-- reject a payment that would push cumulative paid past the approved total.
create or replace function public.enforce_expense_payment_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense record;
  v_other_paid numeric(14,2);
begin
  select id, company_id, total_amount, approval_status
    into v_expense
  from public.expense_ledger
  where id = new.expense_ledger_id
  for update;

  if not found then
    raise exception 'Expense not found for this payment';
  end if;
  if v_expense.company_id is distinct from new.company_id then
    raise exception 'Expense payment company does not match the parent expense';
  end if;
  if v_expense.approval_status <> 'approved' then
    raise exception 'Expense must be approved before a payment can be recorded (current status: %)', v_expense.approval_status;
  end if;

  select coalesce(sum(amount_paid), 0)
    into v_other_paid
  from public.expense_payments
  where expense_ledger_id = new.expense_ledger_id
    and company_id = new.company_id
    and id <> new.id;

  if round((v_other_paid + coalesce(new.amount_paid, 0))::numeric, 2) > coalesce(v_expense.total_amount, 0) + 0.01 then
    raise exception 'Expense payments would exceed the approved expense total';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_expense_payment_guards_bi on public.expense_payments;
create trigger enforce_expense_payment_guards_bi
  before insert on public.expense_payments
  for each row execute function public.enforce_expense_payment_guards();
