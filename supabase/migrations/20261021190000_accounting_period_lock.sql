-- EXOS-AUD-023: there was no accounting period lock. Invoices, receipts, credit
-- notes and expenses could be dated into months already reported or filed, and a
-- payment could be dated before its invoice.
--
--   * public.accounting_period_locks records the company's "books closed
--     through" date with a reason. public.set_books_locked_through(date, reason)
--     moves it: owner/admin/accounts may close forward; only the owner may
--     reopen (move the date back). Every change is a new row (full history).
--   * In invoices, payments, credit_notes, expense_ledger, expense_payments and
--     expense_supplier_credits a row dated on or before the lock date cannot be
--     inserted, deleted (hard or soft), or have its date moved into or out of the
--     closed period. Settlement updates on an older document (amount paid, status,
--     credited amount) are still allowed, because the settling payment or credit
--     is itself dated in the open period.
--   * A payment or credit note cannot be dated before its invoice.
-- No lock exists until a company sets one, so current behaviour is unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.accounting_period_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  locked_through date not null,
  previous_locked_through date,
  reason text not null check (length(btrim(reason)) >= 10),
  set_by uuid not null references auth.users(id),
  set_by_role text not null,
  set_at timestamptz not null default now()
);
create index if not exists accounting_period_locks_company_set_idx on public.accounting_period_locks(company_id, set_at desc);
alter table public.accounting_period_locks enable row level security;
drop policy if exists "accounting period locks tenant read" on public.accounting_period_locks;
create policy "accounting period locks tenant read" on public.accounting_period_locks
  for select using (company_id = public.get_current_user_company_id());
revoke all on public.accounting_period_locks from public, anon, authenticated;
grant select on public.accounting_period_locks to authenticated;

create or replace function private.books_locked_through(p_company_id uuid)
returns date
language sql
stable
security definer
set search_path = public, private
as $$
  select l.locked_through from public.accounting_period_locks l
  where l.company_id = p_company_id order by l.set_at desc, l.id desc limit 1
$$;
revoke all on function private.books_locked_through(uuid) from public, anon, authenticated;

create or replace function public.get_books_locked_through()
returns date
language sql
stable
security definer
set search_path = public, private
as $$ select private.books_locked_through(public.get_current_user_company_id()) $$;
revoke all on function public.get_books_locked_through() from public, anon;
grant execute on function public.get_books_locked_through() to authenticated;

create or replace function private.set_books_locked_through(p_locked_through date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_role text := private.get_current_user_role();
  v_current date;
  v_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if v_role not in ('owner','admin','accounts') then raise exception 'Only owner, admin or accounts can close the books' using errcode = '42501'; end if;
  if p_locked_through is null or p_locked_through >= current_date then
    raise exception 'The lock date must be before today' using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Give a reason of at least 10 characters' using errcode = '23514'; end if;
  perform 1 from public.companies where id = v_company_id for update;
  v_current := private.books_locked_through(v_company_id);
  if v_current is not null and p_locked_through < v_current and v_role <> 'owner' then
    raise exception 'Only the owner can reopen a closed period' using errcode = '42501';
  end if;
  if v_current is not distinct from p_locked_through then raise exception 'The books are already locked through %', p_locked_through using errcode = '23514'; end if;
  insert into public.accounting_period_locks(company_id, locked_through, previous_locked_through, reason, set_by, set_by_role)
  values (v_company_id, p_locked_through, v_current, btrim(p_reason), auth.uid(), v_role)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.set_books_locked_through(date, text) from public, anon, authenticated;
create or replace function public.set_books_locked_through(p_locked_through date, p_reason text)
returns uuid language sql security definer set search_path = public, private
as $$ select private.set_books_locked_through(p_locked_through, p_reason) $$;
revoke all on function public.set_books_locked_through(date, text) from public, anon;
grant execute on function public.set_books_locked_through(date, text) to authenticated;

-- TG_ARGV[0] = accounting date column; TG_ARGV[1] (optional) = fallback timestamp column.
create or replace function private.enforce_accounting_period_lock()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_company uuid := (v_row ->> 'company_id')::uuid;
  v_lock date := private.books_locked_through(v_company);
  v_new date;
  v_old date;
  v_label text := case tg_table_name when 'invoices' then 'invoice' when 'payments' then 'payment receipt' when 'credit_notes' then 'credit note'
    when 'expense_ledger' then 'expense' when 'expense_payments' then 'expense payment' when 'expense_supplier_credits' then 'supplier credit'
    else replace(tg_table_name, '_', ' ') end;
begin
  if v_lock is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'DELETE' then
    v_new := coalesce(nullif(to_jsonb(new) ->> tg_argv[0], '')::date,
      case when tg_nargs > 1 then nullif(to_jsonb(new) ->> tg_argv[1], '')::timestamptz::date end, current_date);
  end if;
  if tg_op <> 'INSERT' then
    v_old := coalesce(nullif(to_jsonb(old) ->> tg_argv[0], '')::date,
      case when tg_nargs > 1 then nullif(to_jsonb(old) ->> tg_argv[1], '')::timestamptz::date end, current_date);
  end if;
  if tg_op = 'INSERT' and v_new <= v_lock then
    raise exception 'Books are closed through %; % dated % cannot be recorded', v_lock, v_label, v_new using errcode = '23514';
  end if;
  if tg_op = 'DELETE' and v_old <= v_lock then
    raise exception 'Books are closed through %; % dated % cannot be deleted', v_lock, v_label, v_old using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if v_new is distinct from v_old and (v_new <= v_lock or v_old <= v_lock) then
      raise exception 'Books are closed through %; % cannot be re-dated from % to %', v_lock, v_label, v_old, v_new using errcode = '23514';
    end if;
    if v_old <= v_lock and (to_jsonb(new) ? 'deleted_at') and (to_jsonb(old) ->> 'deleted_at') is null and (to_jsonb(new) ->> 'deleted_at') is not null then
      raise exception 'Books are closed through %; % dated % cannot be deleted', v_lock, v_label, v_old using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.enforce_accounting_period_lock() from public, anon, authenticated;

drop trigger if exists a_enforce_period_lock on public.invoices;
create trigger a_enforce_period_lock before insert or update or delete on public.invoices
  for each row execute function private.enforce_accounting_period_lock('invoice_date', 'created_at');
drop trigger if exists a_enforce_period_lock on public.payments;
create trigger a_enforce_period_lock before insert or update or delete on public.payments
  for each row execute function private.enforce_accounting_period_lock('payment_date', 'created_at');
drop trigger if exists a_enforce_period_lock on public.credit_notes;
create trigger a_enforce_period_lock before insert or update or delete on public.credit_notes
  for each row execute function private.enforce_accounting_period_lock('credit_date', 'created_at');
drop trigger if exists a_enforce_period_lock on public.expense_ledger;
create trigger a_enforce_period_lock before insert or update or delete on public.expense_ledger
  for each row execute function private.enforce_accounting_period_lock('invoice_date', 'created_at');
drop trigger if exists a_enforce_period_lock on public.expense_payments;
create trigger a_enforce_period_lock before insert or update or delete on public.expense_payments
  for each row execute function private.enforce_accounting_period_lock('payment_date', 'created_at');
drop trigger if exists a_enforce_period_lock on public.expense_supplier_credits;
create trigger a_enforce_period_lock before insert or update or delete on public.expense_supplier_credits
  for each row execute function private.enforce_accounting_period_lock('credit_date', 'created_at');

-- A receipt or credit cannot predate its invoice.
create or replace function private.enforce_settlement_not_before_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_invoice_date date;
  v_date date := nullif(to_jsonb(new) ->> tg_argv[0], '')::date;
begin
  if new.invoice_id is null or v_date is null then return new; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) ->> tg_argv[0]) is not distinct from (to_jsonb(old) ->> tg_argv[0])
    and new.invoice_id is not distinct from old.invoice_id then
    return new;
  end if;
  select invoice_date into v_invoice_date from public.invoices where id = new.invoice_id and company_id = new.company_id;
  if v_invoice_date is not null and v_date < v_invoice_date then
    raise exception 'A % dated % cannot predate its invoice dated %', case tg_table_name when 'payments' then 'payment receipt' else 'credit note' end, v_date, v_invoice_date using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_settlement_not_before_invoice() from public, anon, authenticated;
drop trigger if exists a_settlement_not_before_invoice on public.payments;
create trigger a_settlement_not_before_invoice before insert or update on public.payments
  for each row execute function private.enforce_settlement_not_before_invoice('payment_date');
drop trigger if exists a_settlement_not_before_invoice on public.credit_notes;
create trigger a_settlement_not_before_invoice before insert or update on public.credit_notes
  for each row execute function private.enforce_settlement_not_before_invoice('credit_date');

commit;
