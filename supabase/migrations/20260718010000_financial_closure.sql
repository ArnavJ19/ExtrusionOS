-- Close the invoice-to-receipt workflow around server-owned, auditable events.

alter table public.invoices
  add column if not exists paid_date date;

alter table public.payments
  add column if not exists idempotency_key uuid,
  add column if not exists reversal_idempotency_key uuid,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references auth.users(id),
  add column if not exists reversal_reason text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists payments_company_idempotency_unique
  on public.payments(company_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists payments_company_reversal_idempotency_unique
  on public.payments(company_id, reversal_idempotency_key)
  where reversal_idempotency_key is not null;

create index if not exists payments_company_invoice_effective_idx
  on public.payments(company_id, invoice_id, payment_status, payment_date);

do $$
begin
  if not exists (
    select 1
    from public.invoices
    where dispatch_id is not null and status <> 'cancelled'
    group by company_id, dispatch_id
    having count(*) > 1
  ) then
    create unique index if not exists invoices_company_dispatch_active_unique
      on public.invoices(company_id, dispatch_id)
      where dispatch_id is not null and status <> 'cancelled';
  else
    raise warning 'Skipped invoices_company_dispatch_active_unique because legacy duplicate dispatch invoices exist';
  end if;
end $$;

create or replace function private.recalculate_invoice_totals(
  p_invoice_id uuid,
  p_company_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_default_gst numeric(7,2) := 18;
  v_subtotal numeric(14,2);
  v_tax_total numeric(14,2);
begin
  select coalesce(default_gst_percent, 18)
  into v_default_gst
  from public.company_settings
  where company_id = p_company_id
  limit 1;

  v_default_gst := coalesce(v_default_gst, 18);

  select
    round(coalesce(sum(coalesce(line_total, final_line_value, quantity * unit_rate, 0)), 0), 2),
    round(coalesce(sum(
      coalesce(line_total, final_line_value, quantity * unit_rate, 0)
      * coalesce(gst_percent, v_default_gst) / 100
    ), 0), 2)
  into v_subtotal, v_tax_total
  from public.invoice_items
  where invoice_id = p_invoice_id
    and company_id = p_company_id;

  if v_subtotal <= 0 then
    raise exception 'The selected source has no billable quantity and rate. Complete the order commercial lines before generating an invoice.';
  end if;

  update public.invoices
  set subtotal = v_subtotal,
      tax_total = v_tax_total,
      grand_total = round(v_subtotal + v_tax_total, 2),
      updated_at = now()
  where id = p_invoice_id
    and company_id = p_company_id;
end;
$$;

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
begin
  select *
  into v_invoice
  from public.invoices
  where id = p_invoice_id
    and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Invoice not found for this company';
  end if;

  select
    round(coalesce(sum(
      case
        when payment_status = 'PAID' and payment_type = 'REFUND' then -amount
        when payment_status = 'PAID' then amount
        else 0
      end
    ), 0), 2),
    max(payment_date) filter (
      where payment_status = 'PAID'
        and coalesce(payment_type, '') <> 'REFUND'
    )
  into v_effective_paid, v_last_payment_date
  from public.payments
  where invoice_id = p_invoice_id
    and company_id = p_company_id;

  v_effective_paid := greatest(0, coalesce(v_effective_paid, 0));
  if v_effective_paid > v_invoice.grand_total then
    raise exception 'Effective receipts exceed the invoice total';
  end if;

  v_next_status := case
    when v_invoice.status = 'cancelled' then 'cancelled'
    when v_invoice.grand_total > 0 and v_effective_paid = v_invoice.grand_total then 'paid'
    when v_effective_paid > 0 then 'partially_paid'
    when v_invoice.status in ('draft', 'generated') then v_invoice.status
    when v_invoice.due_date is not null and v_invoice.due_date < current_date then 'overdue'
    else 'sent'
  end;

  update public.invoices
  set amount_paid = v_effective_paid,
      status = v_next_status,
      paid_date = case when v_next_status = 'paid' then v_last_payment_date else null end,
      updated_at = now()
  where id = p_invoice_id
    and company_id = p_company_id;
end;
$$;

create or replace function private.save_invoice_atomic(
  p_invoice_id uuid,
  p_invoice jsonb,
  p_items jsonb,
  p_replace_items boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_requested_customer_id uuid := nullif(p_invoice ->> 'customer_id', '')::uuid;
  v_order_id uuid := nullif(p_invoice ->> 'order_id', '')::uuid;
  v_dispatch_id uuid := nullif(p_invoice ->> 'dispatch_id', '')::uuid;
  v_order public.orders%rowtype;
  v_existing public.invoices%rowtype;
  v_invoice_id uuid;
  v_payload jsonb;
  v_item jsonb;
  v_requested_status text := coalesce(nullif(p_invoice ->> 'status', ''), 'draft');
  v_invoice_prefix text := 'INV';
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for invoices' using errcode = '42501';
  end if;
  if v_order_id is null then
    raise exception 'Select the source order for this invoice';
  end if;
  if v_dispatch_id is null then
    raise exception 'Select a packed dispatch. Tax invoices cannot bill an order directly.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Invoice items must be an array';
  end if;

  select *
  into v_order
  from public.orders
  where id = v_order_id
    and company_id = v_company_id
  for share;

  if not found then
    raise exception 'Order not found for this company';
  end if;
  if v_order.current_stage = 'cancelled' then
    raise exception 'A cancelled order cannot be invoiced';
  end if;
  if v_requested_customer_id is not null and v_requested_customer_id <> v_order.customer_id then
    raise exception 'Invoice customer must match the source order customer';
  end if;
  if not exists (
    select 1 from public.customers
    where id = v_order.customer_id and company_id = v_company_id
  ) then
    raise exception 'Order customer not found for this company';
  end if;

  if v_dispatch_id is not null then
    if not exists (
      select 1
      from public.dispatches
      where id = v_dispatch_id
        and company_id = v_company_id
        and order_id = v_order_id
    ) then
      raise exception 'Dispatch must belong to the selected order and company';
    end if;
    if p_invoice_id is null and exists (
      select 1
      from public.invoices
      where company_id = v_company_id
        and dispatch_id = v_dispatch_id
        and status <> 'cancelled'
    ) then
      raise exception 'This dispatch already has an active invoice';
    end if;
  end if;

  if p_invoice_id is null then
    if v_requested_status not in ('draft', 'generated') then
      raise exception 'New invoices can only start as draft or generated';
    end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
      raise exception 'An invoice requires at least one source line';
    end if;
  else
    select *
    into v_existing
    from public.invoices
    where id = p_invoice_id
      and company_id = v_company_id
    for update;

    if not found then
      raise exception 'Invoice not found for this company';
    end if;
    if v_existing.status not in ('draft', 'generated') or v_existing.amount_paid <> 0 then
      raise exception 'Only unpaid draft or generated invoices can be edited';
    end if;
    if v_requested_status not in ('draft', 'generated', 'sent') then
      raise exception 'Use the receipt workflow to change a financial invoice status';
    end if;
    if not p_replace_items or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
      raise exception 'Editing an invoice requires its source lines to be regenerated';
    end if;
  end if;

  select coalesce(nullif(invoice_prefix, ''), 'INV')
  into v_invoice_prefix
  from public.company_settings
  where company_id = v_company_id
  limit 1;
  v_invoice_prefix := coalesce(v_invoice_prefix, 'INV');

  v_payload := private.keep_jsonb_keys(p_invoice, array[
      'invoice_number', 'invoice_date', 'due_date', 'status', 'notes'
    ])
    || jsonb_build_object(
      'company_id', v_company_id,
      'customer_id', v_order.customer_id,
      'order_id', v_order_id,
      'dispatch_id', v_dispatch_id,
      'subtotal', 0,
      'tax_total', 0,
      'grand_total', 0,
      'amount_paid', 0,
      'paid_date', null,
      'status', v_requested_status
    );

  if p_invoice_id is null then
    if nullif(v_payload ->> 'invoice_number', '') is null then
      v_payload := v_payload || jsonb_build_object(
        'invoice_number', private.next_business_number_locked(
          'public.invoices'::regclass,
          'invoice_number',
          v_company_id,
          v_invoice_prefix,
          coalesce(nullif(v_payload ->> 'invoice_date', '')::date, current_date)
        )
      );
    end if;
    v_invoice_id := private.insert_jsonb_row(
      'public.invoices'::regclass,
      v_payload || jsonb_build_object('created_by', auth.uid())
    );
  else
    v_invoice_id := private.update_jsonb_row(
      'public.invoices'::regclass,
      p_invoice_id,
      v_company_id,
      (v_payload - 'invoice_number') || jsonb_build_object('updated_at', now())
    );
  end if;

  delete from public.invoice_items
  where invoice_id = v_invoice_id
    and company_id = v_company_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    perform private.insert_jsonb_row(
      'public.invoice_items'::regclass,
      (v_item - array['id', 'company_id', 'invoice_id', 'created_at', 'updated_at'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'invoice_id', v_invoice_id,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  perform private.recalculate_invoice_totals(v_invoice_id, v_company_id);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    v_company_id,
    auth.uid(),
    case when p_invoice_id is null then 'invoice_created' else 'invoice_updated' end,
    'invoice',
    v_invoice_id,
    jsonb_build_object(
      'order_id', v_order_id,
      'dispatch_id', v_dispatch_id,
      'customer_id', v_order.customer_id,
      'status', v_requested_status
    )
  );

  return v_invoice_id;
end;
$$;

create or replace function private.replace_invoice_items_atomic(
  p_invoice_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_invoice public.invoices%rowtype;
  v_item jsonb;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for invoices' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Invoice items must contain at least one source line';
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
  if v_invoice.status not in ('draft', 'generated') or v_invoice.amount_paid <> 0 then
    raise exception 'Only unpaid draft or generated invoices can regenerate source lines';
  end if;

  delete from public.invoice_items
  where invoice_id = p_invoice_id
    and company_id = v_company_id;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    perform private.insert_jsonb_row(
      'public.invoice_items'::regclass,
      (v_item - array['id', 'company_id', 'invoice_id', 'created_at', 'updated_at'])
        || jsonb_build_object(
          'company_id', v_company_id,
          'invoice_id', p_invoice_id,
          'created_at', now(),
          'updated_at', now()
        )
    );
  end loop;

  perform private.recalculate_invoice_totals(p_invoice_id, v_company_id);
  return p_invoice_id;
end;
$$;

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
  v_existing_payment_id uuid;
  v_existing_invoice_id uuid;
  v_idempotency_key uuid := nullif(p_payment ->> 'idempotency_key', '')::uuid;
  v_amount numeric(14,2) := round(coalesce(nullif(p_payment ->> 'amount', '')::numeric, 0), 2);
  v_payment_date date := coalesce(nullif(p_payment ->> 'payment_date', '')::date, current_date);
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
  if v_idempotency_key is null then
    raise exception 'Payment idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':invoice-payment:' || v_idempotency_key::text,
    0
  ));

  select id, invoice_id
  into v_existing_payment_id, v_existing_invoice_id
  from public.payments
  where company_id = v_company_id
    and idempotency_key = v_idempotency_key;

  if v_existing_payment_id is not null then
    if v_existing_invoice_id <> p_invoice_id then
      raise exception 'The idempotency key is already assigned to another invoice';
    end if;
    select * into v_result
    from public.invoices
    where id = p_invoice_id and company_id = v_company_id;
    return jsonb_build_object(
      'payment_id', v_existing_payment_id,
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
  if v_payment_date > current_date then
    raise exception 'Payment date cannot be in the future';
  end if;
  if v_payment_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'credit_note', 'other') then
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
    company_id,
    invoice_id,
    order_id,
    branch_id,
    dealership_id,
    payment_date,
    amount,
    payment_method,
    payment_type,
    payment_status,
    reference_number,
    notes,
    recorded_by_user_id,
    idempotency_key,
    created_at,
    updated_at
  )
  values (
    v_company_id,
    p_invoice_id,
    v_invoice.order_id,
    v_invoice.branch_id,
    v_dealership_id,
    v_payment_date,
    v_amount,
    v_payment_method,
    v_payment_type,
    'PAID',
    v_reference_number,
    v_notes,
    auth.uid(),
    v_idempotency_key,
    now(),
    now()
  )
  returning id into v_payment_id;

  perform private.recalculate_invoice_collection_state(p_invoice_id, v_company_id);
  select * into v_result
  from public.invoices
  where id = p_invoice_id and company_id = v_company_id;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    v_company_id,
    auth.uid(),
    'payment_recorded',
    'payment',
    v_payment_id,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'order_id', v_invoice.order_id,
      'customer_id', v_invoice.customer_id,
      'amount', v_amount,
      'payment_method', v_payment_method,
      'reference_number', v_reference_number
    )
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

create or replace function private.reverse_payment_atomic(
  p_payment_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then
    raise exception 'Permission denied for payment reversals' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Reversal idempotency key is required';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Enter a clear reversal reason';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_company_id::text || ':payment-reversal:' || p_idempotency_key::text,
    0
  ));

  select *
  into v_payment
  from public.payments
  where id = p_payment_id
    and company_id = v_company_id
  for update;

  if not found then
    raise exception 'Payment not found for this company';
  end if;
  if v_payment.reversal_idempotency_key = p_idempotency_key
    and v_payment.payment_status = 'CANCELLED' then
    select * into v_invoice
    from public.invoices
    where id = v_payment.invoice_id and company_id = v_company_id;
    return jsonb_build_object(
      'payment_id', p_payment_id,
      'invoice_id', v_payment.invoice_id,
      'amount_paid', v_invoice.amount_paid,
      'balance_due', v_invoice.balance_due,
      'invoice_status', v_invoice.status,
      'idempotent_replay', true
    );
  end if;
  if v_payment.payment_status <> 'PAID' then
    raise exception 'Only a posted receipt can be reversed';
  end if;

  perform 1
  from public.invoices
  where id = v_payment.invoice_id
    and company_id = v_company_id
  for update;
  if not found then
    raise exception 'Linked invoice not found for this company';
  end if;

  update public.payments
  set payment_status = 'CANCELLED',
      reversed_at = now(),
      reversed_by = auth.uid(),
      reversal_reason = trim(p_reason),
      reversal_idempotency_key = p_idempotency_key,
      updated_at = now()
  where id = p_payment_id
    and company_id = v_company_id;

  perform private.recalculate_invoice_collection_state(v_payment.invoice_id, v_company_id);
  select * into v_invoice
  from public.invoices
  where id = v_payment.invoice_id and company_id = v_company_id;

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (
    v_company_id,
    auth.uid(),
    'payment_reversed',
    'payment',
    p_payment_id,
    jsonb_build_object(
      'invoice_id', v_payment.invoice_id,
      'amount', v_payment.amount,
      'reason', trim(p_reason)
    )
  );

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'amount_paid', v_invoice.amount_paid,
    'balance_due', v_invoice.balance_due,
    'invoice_status', v_invoice.status,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.record_payment_atomic(p_invoice_id uuid, p_payment jsonb)
returns jsonb
language sql
security definer
set search_path = public, private
as $$ select private.record_payment_atomic(p_invoice_id, p_payment) $$;

create or replace function public.reverse_payment_atomic(p_payment_id uuid, p_reason text, p_idempotency_key uuid)
returns jsonb
language sql
security definer
set search_path = public, private
as $$ select private.reverse_payment_atomic(p_payment_id, p_reason, p_idempotency_key) $$;

revoke all on function public.record_payment_atomic(uuid, jsonb) from public, anon;
revoke all on function public.reverse_payment_atomic(uuid, text, uuid) from public, anon;
revoke all on function private.recalculate_invoice_totals(uuid, uuid) from public, anon, authenticated;
revoke all on function private.recalculate_invoice_collection_state(uuid, uuid) from public, anon, authenticated;
revoke all on function private.record_payment_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.reverse_payment_atomic(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_payment_atomic(uuid, jsonb) to authenticated;
grant execute on function public.reverse_payment_atomic(uuid, text, uuid) to authenticated;

-- Header rows are readable to the finance team but mutable only through the
-- SECURITY DEFINER workflows above. This closes browser-side direct writes.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('invoices', 'payments')
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;
end $$;

create policy invoices_finance_read on public.invoices
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );

create policy payments_finance_read on public.payments
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );

-- Invoice lines may be read by the same finance roles but are written only by
-- the atomic invoice functions.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'invoice_items'
  loop
    execute format('drop policy if exists %I on public.invoice_items', v_policy.policyname);
  end loop;
end $$;

create policy invoice_items_finance_read on public.invoice_items
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );
