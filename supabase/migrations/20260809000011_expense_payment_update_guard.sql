-- Review follow-up: enforce_expense_payment_guards() (added in 20260809000002) was only a
-- BEFORE INSERT trigger. expense_payments has a tenant UPDATE policy, so a client could insert
-- a small valid payment and then UPDATE amount_paid / expense_ledger_id / company_id to bypass
-- the approval, same-company, and overpay checks. Apply the same guard on UPDATE as well,
-- scoped (via WHEN) to only fire when one of those guarded columns actually changes.

drop trigger if exists enforce_expense_payment_guards_bu on public.expense_payments;
create trigger enforce_expense_payment_guards_bu
  before update on public.expense_payments
  for each row
  when (
    new.amount_paid is distinct from old.amount_paid
    or new.expense_ledger_id is distinct from old.expense_ledger_id
    or new.company_id is distinct from old.company_id
  )
  execute function public.enforce_expense_payment_guards();
