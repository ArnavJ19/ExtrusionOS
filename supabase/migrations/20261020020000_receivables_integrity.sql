-- Receivables integrity (FINANCE_EXPENSES_DEEP_AUDIT_2026-10-15: AR-01..AR-04, AR-09, AR-10, SEC-01).
--   * receipt retries are bound to their submitted details (AR-03);
--   * receipt dates use the Asia/Kolkata business calendar (AR-10);
--   * customer refunds are an auditable outgoing transaction against customer credit due (AR-02);
--   * an open balance past its due date stays overdue after a partial receipt (AR-04);
--   * one active invoice per dispatch is enforced even where the legacy unique index was skipped (AR-09);
--   * historical credit-settlement overlaps are listed for correction (AR-01);
--   * invoice headers are readable by finance roles only (SEC-01).
-- Requires 20261015020000_credit_settlement_exclusivity.sql and 20261015030000_credit_note_retry_binding.sql.
begin;

create or replace function private.business_today()
returns date language sql stable set search_path = pg_catalog
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function private.business_today() from public, anon;
grant execute on function private.business_today() to authenticated;

alter table public.payments
  add column if not exists related_credit_note_id uuid references public.credit_notes(id);

-- ---------------------------------------------------------------------------
-- Collection state (AR-04) and refund guard (AR-02)
-- ---------------------------------------------------------------------------
create or replace function private.recalculate_invoice_collection_state(
  p_invoice_id uuid,
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_invoice public.invoices%rowtype;
  v_effective_paid numeric(14,2);
  v_last_payment_date date;
  v_next_status text;
  v_open numeric(14,2);
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and company_id = p_company_id
  for update;
  if not found then raise exception 'Invoice not found for this company'; end if;

  select round(coalesce(sum(
    case
      when payment_status = 'PAID' and payment_type = 'REFUND' then -amount
      when payment_status = 'PAID' then amount
      else 0
    end
  ), 0), 2),
  max(payment_date) filter (where payment_status = 'PAID' and coalesce(payment_type, '') <> 'REFUND')
  into v_effective_paid, v_last_payment_date
  from public.payments
  where invoice_id = p_invoice_id and company_id = p_company_id;

  v_effective_paid := coalesce(v_effective_paid, 0);
  if v_effective_paid < 0 then
    raise exception 'Customer refunds would exceed posted receipts. Reverse the refund before reversing this receipt.'
      using errcode = '23514';
  end if;
  if v_effective_paid > v_invoice.grand_total then
    raise exception 'Effective receipts exceed the invoice total';
  end if;
  v_open := greatest(v_invoice.grand_total - v_effective_paid - v_invoice.credited_amount, 0);

  -- A balance past its due date stays overdue after a partial receipt; paid and partial
  -- amounts remain separately visible in amount_paid and balance_due.
  v_next_status := case
    when v_invoice.status = 'cancelled' then 'cancelled'
    when v_invoice.credited_amount >= v_invoice.grand_total and v_invoice.grand_total > 0 then 'credited'
    when v_invoice.grand_total > 0 and v_effective_paid + v_invoice.credited_amount >= v_invoice.grand_total then 'paid'
    when v_invoice.status = 'draft' then 'draft'
    when v_open > 0 and v_invoice.due_date is not null and v_invoice.due_date < private.business_today()
      and (v_invoice.status <> 'generated' or v_effective_paid > 0 or v_invoice.credited_amount > 0) then 'overdue'
    when v_effective_paid > 0 or v_invoice.credited_amount > 0 then 'partially_paid'
    when v_invoice.status = 'generated' then 'generated'
    else 'sent'
  end;

  update public.invoices
  set amount_paid = v_effective_paid,
      status = v_next_status,
      paid_date = case when v_next_status = 'paid' then v_last_payment_date else null end,
      updated_at = now()
  where id = p_invoice_id and company_id = p_company_id;
end;
$$;
revoke all on function private.recalculate_invoice_collection_state(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Receipt posting: retry binding (AR-03) and business calendar (AR-10)
-- ---------------------------------------------------------------------------
create or replace function private.record_payment_atomic(
  p_invoice_id uuid,
  p_payment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_invoice public.invoices%rowtype;
  v_payment_id uuid;
  v_existing public.payments%rowtype;
  v_idempotency_key uuid;
  v_amount numeric(14,2);
  v_payment_date date;
  v_today date := private.business_today();
  v_payment_method text := nullif(p_payment ->> 'payment_method', '');
  v_reference_number text := nullif(trim(p_payment ->> 'reference_number'), '');
  v_notes text := nullif(trim(p_payment ->> 'notes'), '');
  v_payment_type text;
  v_dealership_id uuid;
  v_result public.invoices%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for payments' using errcode = '42501';
  end if;
  begin
    v_idempotency_key := nullif(p_payment ->> 'idempotency_key', '')::uuid;
    v_amount := round(coalesce(nullif(p_payment ->> 'amount', '')::numeric, 0), 2);
    v_payment_date := coalesce(nullif(p_payment ->> 'payment_date', '')::date, v_today);
  exception when others then
    raise exception 'Enter a valid receipt amount, date and retry key' using errcode = '22023';
  end;
  if v_idempotency_key is null then
    raise exception 'Payment idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':invoice-payment:' || v_idempotency_key::text,
    0
  ));

  select * into v_existing
  from public.payments
  where company_id = v_company_id
    and idempotency_key = v_idempotency_key;

  if found then
    if v_existing.invoice_id <> p_invoice_id then
      raise exception 'The idempotency key is already assigned to another invoice';
    end if;
    -- A retry is a replay only when every submitted detail matches the committed receipt.
    if v_existing.amount is distinct from v_amount
      or v_existing.payment_date is distinct from v_payment_date
      or v_existing.payment_method is distinct from v_payment_method
      or nullif(trim(coalesce(v_existing.reference_number, '')), '') is distinct from v_reference_number
      or nullif(trim(coalesce(v_existing.notes, '')), '') is distinct from v_notes
      or coalesce(v_existing.payment_type, '') = 'REFUND' then
      raise exception 'This retry key was already used for a receipt with different details. Refresh the invoice and review receipt % before posting again.', v_existing.id;
    end if;
    select * into v_result
    from public.invoices
    where id = p_invoice_id and company_id = v_company_id;
    return jsonb_build_object(
      'payment_id', v_existing.id,
      'invoice_id', p_invoice_id,
      'amount_paid', v_result.amount_paid,
      'balance_due', v_result.balance_due,
      'invoice_status', v_result.status,
      'idempotent_replay', true
    );
  end if;

  select *
  into v_invoice
  from public.invoices
  where id = p_invoice_id
    and company_id = v_company_id
  for update;

  if not found then
    raise exception 'Invoice not found for this company';
  end if;
  if not exists (
    select 1 from public.customers
    where id = v_invoice.customer_id and company_id = v_company_id
  ) then
    raise exception 'Invoice customer not found for this company';
  end if;
  if v_invoice.order_id is not null then
    select dealer_id
    into v_dealership_id
    from public.orders
    where id = v_invoice.order_id
      and company_id = v_company_id
      and customer_id = v_invoice.customer_id;
    if not found then
      raise exception 'Invoice order and customer lineage is invalid';
    end if;
  end if;
  if v_invoice.dispatch_id is not null and not exists (
    select 1
    from public.dispatches
    where id = v_invoice.dispatch_id
      and company_id = v_company_id
      and order_id = v_invoice.order_id
  ) then
    raise exception 'Invoice dispatch lineage is invalid';
  end if;

  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select *
  into v_invoice
  from public.invoices
  where id = p_invoice_id and company_id = v_company_id
  for update;

  if v_invoice.status not in ('generated', 'sent', 'partially_paid', 'overdue') then
    raise exception 'Payments can only be posted to an issued, unpaid invoice';
  end if;
  if v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if v_amount > v_invoice.balance_due then
    raise exception 'Payment amount exceeds the outstanding invoice balance';
  end if;
  if v_payment_date > v_today then
    raise exception 'Payment date cannot be in the future';
  end if;
  if v_payment_method is null or v_payment_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'credit_note', 'other') then
    raise exception 'Select a valid payment method';
  end if;
  if v_payment_method in ('bank_transfer', 'upi', 'cheque') and v_reference_number is null then
    raise exception 'Reference number is required for bank, UPI, and cheque receipts';
  end if;

  v_payment_type := case
    when v_payment_method = 'credit_note' then 'ADJUSTMENT'
    when v_amount = v_invoice.balance_due then 'FINAL_PAYMENT'
    else 'PARTIAL_PAYMENT'
  end;

  insert into public.payments(
    company_id, invoice_id, order_id, branch_id, dealership_id, payment_date, amount, payment_method,
    payment_type, payment_status, reference_number, notes, recorded_by_user_id, idempotency_key, created_at, updated_at
  )
  values (
    v_company_id, p_invoice_id, v_invoice.order_id, v_invoice.branch_id, v_dealership_id, v_payment_date, v_amount,
    v_payment_method, v_payment_type, 'PAID', v_reference_number, v_notes, auth.uid(), v_idempotency_key, now(), now()
  )
  returning id into v_payment_id;

  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select * into v_result
  from public.invoices
  where id = p_invoice_id and company_id = v_company_id;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    v_company_id, auth.uid(), 'payment_recorded', 'payment', v_payment_id,
    jsonb_build_object('invoice_id', p_invoice_id, 'order_id', v_invoice.order_id, 'customer_id', v_invoice.customer_id,
      'amount', v_amount, 'payment_method', v_payment_method, 'payment_date', v_payment_date,
      'reference_number', v_reference_number)
  );

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'invoice_id', p_invoice_id,
    'amount_paid', v_result.amount_paid,
    'balance_due', v_result.balance_due,
    'invoice_status', v_result.status,
    'idempotent_replay', false
  );
end;
$$;
revoke all on function private.record_payment_atomic(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer refunds (AR-02)
-- ---------------------------------------------------------------------------
create or replace function private.record_customer_refund_atomic(
  p_invoice_id uuid,
  p_refund jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_invoice public.invoices%rowtype;
  v_existing public.payments%rowtype;
  v_refund_id uuid;
  v_amount numeric(14,2);
  v_date date;
  v_today date := private.business_today();
  v_method text := nullif(btrim(p_refund ->> 'payment_method'), '');
  v_reference text := nullif(btrim(p_refund ->> 'reference_number'), '');
  v_notes text := nullif(btrim(p_refund ->> 'notes'), '');
  v_credit_note_id uuid;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for customer refunds' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Refund idempotency key is required'; end if;
  begin
    v_amount := round(nullif(p_refund ->> 'amount', '')::numeric, 2);
    v_date := coalesce(nullif(p_refund ->> 'refund_date', '')::date, v_today);
    v_credit_note_id := nullif(p_refund ->> 'credit_note_id', '')::uuid;
  exception when others then
    raise exception 'Enter a valid refund amount and date' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':invoice-payment:' || p_idempotency_key::text, 0));
  select * into v_existing from public.payments where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.invoice_id <> p_invoice_id or coalesce(v_existing.payment_type, '') <> 'REFUND'
      or v_existing.amount is distinct from v_amount or v_existing.payment_date is distinct from v_date
      or v_existing.payment_method is distinct from v_method
      or nullif(trim(coalesce(v_existing.reference_number, '')), '') is distinct from v_reference
      or nullif(trim(coalesce(v_existing.notes, '')), '') is distinct from v_notes
      or v_existing.related_credit_note_id is distinct from v_credit_note_id then
      raise exception 'This retry key was already used for different refund details. Refresh the invoice before posting again.';
    end if;
    select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id;
    return jsonb_build_object('payment_id', v_existing.id, 'invoice_id', p_invoice_id, 'amount_paid', v_invoice.amount_paid,
      'customer_credit_due', v_invoice.customer_credit_due, 'invoice_status', v_invoice.status, 'idempotent_replay', true);
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id for update;
  if not found then raise exception 'Invoice not found for this company'; end if;
  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id for update;

  if v_invoice.status in ('draft', 'cancelled') then raise exception 'Refunds can only be recorded against an issued invoice'; end if;
  if v_amount is null or v_amount = 'NaN'::numeric or v_amount <= 0 then raise exception 'Refund amount must be greater than zero'; end if;
  if v_amount > v_invoice.customer_credit_due then
    raise exception 'Refund exceeds the customer credit due of %', v_invoice.customer_credit_due;
  end if;
  if v_amount > v_invoice.amount_paid then
    raise exception 'Refund exceeds the cash received on this invoice';
  end if;
  if v_date > v_today then raise exception 'Refund date cannot be in the future'; end if;
  if v_method is null or v_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'other') then
    raise exception 'Select how the refund was paid';
  end if;
  if v_method in ('bank_transfer', 'upi', 'cheque') and v_reference is null then
    raise exception 'Reference number is required for bank, UPI and cheque refunds';
  end if;
  if length(coalesce(v_notes, '')) < 5 then raise exception 'Enter a clear refund reason'; end if;
  if v_credit_note_id is not null and not exists (
    select 1 from public.credit_notes
    where id = v_credit_note_id and company_id = v_company_id and invoice_id = p_invoice_id and status = 'issued'
  ) then
    raise exception 'The linked credit note is not an issued credit note for this invoice';
  end if;

  insert into public.payments(company_id, invoice_id, order_id, branch_id, payment_date, amount, payment_method, payment_type,
    payment_status, reference_number, notes, recorded_by_user_id, idempotency_key, related_credit_note_id, created_at, updated_at)
  values (v_company_id, p_invoice_id, v_invoice.order_id, v_invoice.branch_id, v_date, v_amount, v_method, 'REFUND',
    'PAID', v_reference, v_notes, auth.uid(), p_idempotency_key, v_credit_note_id, now(), now())
  returning id into v_refund_id;

  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select * into v_invoice from public.invoices where id = p_invoice_id and company_id = v_company_id;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'customer_refund_recorded', 'payment', v_refund_id,
    jsonb_build_object('invoice_id', p_invoice_id, 'customer_id', v_invoice.customer_id, 'amount', v_amount,
      'payment_method', v_method, 'reference_number', v_reference, 'credit_note_id', v_credit_note_id, 'reason', v_notes));

  return jsonb_build_object('payment_id', v_refund_id, 'invoice_id', p_invoice_id, 'amount_paid', v_invoice.amount_paid,
    'customer_credit_due', v_invoice.customer_credit_due, 'invoice_status', v_invoice.status, 'idempotent_replay', false);
end;
$$;
revoke all on function private.record_customer_refund_atomic(uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function public.record_customer_refund_atomic(p_invoice_id uuid, p_refund jsonb, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.record_customer_refund_atomic(p_invoice_id, p_refund, p_idempotency_key) $$;
revoke all on function public.record_customer_refund_atomic(uuid, jsonb, uuid) from public, anon;
grant execute on function public.record_customer_refund_atomic(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- One active invoice per dispatch, independent of the legacy index (AR-09)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_single_active_dispatch_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.dispatch_id is null or new.status = 'cancelled' then return new; end if;
  if tg_op = 'UPDATE' and new.dispatch_id is not distinct from old.dispatch_id
    and new.company_id is not distinct from old.company_id and old.status <> 'cancelled' then
    return new;
  end if;
  -- Same key as the invoice writer, so concurrent creations and edits serialize per dispatch.
  perform pg_advisory_xact_lock(hashtextextended('dispatch-invoice:' || new.company_id::text || ':' || new.dispatch_id::text, 0));
  if exists (
    select 1 from public.invoices
    where company_id = new.company_id and dispatch_id = new.dispatch_id and status <> 'cancelled' and id <> new.id
  ) then
    raise exception 'This dispatch already has an active invoice' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_single_active_dispatch_invoice() from public, anon, authenticated;

drop trigger if exists enforce_single_active_dispatch_invoice on public.invoices;
create trigger enforce_single_active_dispatch_invoice
before insert or update of dispatch_id, status, company_id on public.invoices
for each row execute function private.enforce_single_active_dispatch_invoice();

do $$
begin
  if not exists (
    select 1 from public.invoices
    where dispatch_id is not null and status <> 'cancelled'
    group by company_id, dispatch_id having count(*) > 1
  ) then
    create unique index if not exists invoices_company_dispatch_active_unique
      on public.invoices(company_id, dispatch_id)
      where dispatch_id is not null and status <> 'cancelled';
  else
    raise warning 'invoices_company_dispatch_active_unique is still absent: resolve legacy duplicates listed in invoice_settlement_review. New duplicates are rejected by enforce_single_active_dispatch_invoice.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Finance-only reads (SEC-01), live overdue projection and settlement review (AR-01)
-- ---------------------------------------------------------------------------
drop policy if exists invoices_finance_read on public.invoices;
create policy invoices_finance_read on public.invoices
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );

create or replace function private.invoice_live_status(
  p_status text, p_balance numeric, p_due_date date, p_as_of date default null
)
returns text language sql stable set search_path = pg_catalog, private as $$
  select case
    when p_status in ('sent', 'partially_paid') and coalesce(p_balance, 0) > 0 and p_due_date is not null
      and p_due_date < coalesce(p_as_of, private.business_today()) then 'overdue'
    else p_status
  end
$$;
revoke all on function private.invoice_live_status(text, numeric, date, date) from public, anon;
grant execute on function private.invoice_live_status(text, numeric, date, date) to authenticated;

create or replace view public.invoices_authorized with (security_barrier = true) as
select i.id, i.company_id, i.customer_id, i.order_id, i.dispatch_id, i.invoice_number, i.invoice_date, i.due_date,
  private.invoice_live_status(i.status, i.balance_due, i.due_date) as status, i.status as stored_status,
  i.subtotal, i.tax_total, i.grand_total, i.amount_paid, i.credited_amount, i.balance_due, i.customer_credit_due,
  i.paid_date, i.notes, i.created_at, i.updated_at, i.deleted_at
from public.invoices i
where auth.uid() is not null and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts');

create or replace view public.invoice_settlement_review with (security_barrier = true) as
select i.id as invoice_id, i.company_id, i.invoice_number, 'credit_note_and_adjustment'::text as issue,
  i.amount_paid, i.credited_amount, i.grand_total
from public.invoices i
where auth.uid() is not null and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts')
  and exists (select 1 from public.credit_notes n where n.company_id = i.company_id and n.invoice_id = i.id and n.status = 'issued')
  and exists (select 1 from public.payments p where p.company_id = i.company_id and p.invoice_id = i.id
    and p.payment_status = 'PAID' and (p.payment_method = 'credit_note' or p.payment_type = 'ADJUSTMENT'))
union all
select i.id, i.company_id, i.invoice_number, 'duplicate_active_dispatch_invoice', i.amount_paid, i.credited_amount, i.grand_total
from public.invoices i
where auth.uid() is not null and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts')
  and i.dispatch_id is not null and i.status <> 'cancelled'
  and exists (select 1 from public.invoices other where other.company_id = i.company_id and other.dispatch_id = i.dispatch_id
    and other.status <> 'cancelled' and other.id <> i.id)
union all
select i.id, i.company_id, i.invoice_number, 'customer_credit_due', i.amount_paid, i.credited_amount, i.grand_total
from public.invoices i
where auth.uid() is not null and i.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts')
  and i.customer_credit_due > 0 and i.status <> 'cancelled';

revoke all on public.invoices_authorized, public.invoice_settlement_review from public, anon, authenticated;
grant select on public.invoices_authorized, public.invoice_settlement_review to authenticated;

commit;
