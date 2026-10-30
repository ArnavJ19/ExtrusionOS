begin;

-- Issued snapshots make the commercial source used by a tax invoice reproducible.
alter table public.invoices
  add column if not exists issued_at timestamptz,
  add column if not exists issued_snapshot jsonb,
  add column if not exists source_fingerprint text;

create table if not exists public.financial_receipt_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_name text not null check (length(source_name) between 1 and 160),
  field_mapping jsonb not null default '{}'::jsonb,
  row_count integer not null default 0 check (row_count between 0 and 500),
  posted_count integer not null default 0 check (posted_count between 0 and 500),
  failed_count integer not null default 0 check (failed_count between 0 and 500),
  imported_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id, source_fingerprint)
);

create table if not exists public.financial_receipt_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{32}$'),
  source_type text not null check (source_type in ('manual', 'csv')),
  source_import_batch_id uuid references public.financial_receipt_import_batches(id) on delete restrict,
  source_row_number integer check (source_row_number is null or source_row_number > 0),
  received_amount numeric(14,2) not null check (received_amount > 0),
  payment_date date not null,
  payment_method text not null check (payment_method in ('bank_transfer', 'upi', 'cheque', 'cash', 'credit_note', 'other')),
  reference_number text,
  notes text,
  status text not null default 'posted' check (status in ('posted', 'partially_reversed', 'reversed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id, idempotency_key),
  check ((source_type = 'csv') = (source_import_batch_id is not null)),
  check ((source_type = 'csv') = (source_row_number is not null)),
  check (payment_method not in ('bank_transfer', 'upi', 'cheque') or nullif(trim(reference_number), '') is not null)
);

alter table public.payments
  add column if not exists receipt_event_id uuid references public.financial_receipt_events(id) on delete restrict;

create table if not exists public.financial_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_event_id uuid not null references public.financial_receipt_events(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(receipt_event_id, invoice_id),
  unique(payment_id)
);

-- Only the grouped writer can authorize one exact canonical payment in this transaction.
create table private.financial_receipt_authorizations (
  transaction_id bigint not null,
  receipt_event_id uuid not null references public.financial_receipt_events(id),
  company_id uuid not null,
  invoice_id uuid not null,
  amount numeric(14,2) not null,
  idempotency_key uuid not null,
  primary key(transaction_id, company_id, invoice_id, idempotency_key)
);
revoke all on private.financial_receipt_authorizations from public, anon, authenticated;

create table if not exists public.financial_receipt_import_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid not null references public.financial_receipt_import_batches(id) on delete restrict,
  row_number integer not null check (row_number > 0),
  row_payload jsonb not null,
  idempotency_key uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'posted', 'failed')),
  receipt_event_id uuid references public.financial_receipt_events(id) on delete restrict,
  payment_id uuid references public.payments(id) on delete restrict,
  error text,
  created_at timestamptz not null default now(),
  unique(batch_id, row_number),
  unique(company_id, idempotency_key)
);

create index if not exists financial_receipt_events_company_date_idx
  on public.financial_receipt_events(company_id, payment_date desc, created_at desc);
create index if not exists financial_receipt_allocations_company_invoice_idx
  on public.financial_receipt_allocations(company_id, invoice_id, receipt_event_id);
create index if not exists financial_receipt_import_rows_company_batch_idx
  on public.financial_receipt_import_rows(company_id, batch_id, row_number);

alter table public.financial_receipt_import_batches enable row level security;
alter table public.financial_receipt_events enable row level security;
alter table public.financial_receipt_allocations enable row level security;
alter table public.financial_receipt_import_rows enable row level security;

create policy financial_receipt_import_batches_finance_read on public.financial_receipt_import_batches
  for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin', 'accounts'));
create policy financial_receipt_events_finance_read on public.financial_receipt_events
  for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin', 'accounts'));
create policy financial_receipt_allocations_finance_read on public.financial_receipt_allocations
  for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin', 'accounts'));
create policy financial_receipt_import_rows_finance_read on public.financial_receipt_import_rows
  for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin', 'accounts'));

revoke all on public.financial_receipt_import_batches, public.financial_receipt_events,
  public.financial_receipt_allocations, public.financial_receipt_import_rows from public, anon, authenticated;
grant select on public.financial_receipt_import_batches, public.financial_receipt_events,
  public.financial_receipt_allocations, public.financial_receipt_import_rows to authenticated;

create or replace function private.seal_issued_invoice_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_items jsonb;
  v_snapshot jsonb;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.issued_snapshot is not null then
    if row(new.company_id, new.customer_id, new.order_id, new.dispatch_id, new.invoice_number,
      new.invoice_date, new.due_date, new.place_of_supply_state_code, new.subtotal, new.tax_total, new.grand_total)
      is distinct from
      row(old.company_id, old.customer_id, old.order_id, old.dispatch_id, old.invoice_number,
      old.invoice_date, old.due_date, old.place_of_supply_state_code, old.subtotal, old.tax_total, old.grand_total) then
      raise exception 'Issued invoice commercial fields are immutable; use a reviewed correction route';
    end if;
    new.issued_at := old.issued_at;
    new.issued_snapshot := old.issued_snapshot;
    new.source_fingerprint := old.source_fingerprint;
    return new;
  end if;

  -- save_invoice_atomic updates the invoice header before replacing its lines.
  -- Its totals recalculation below seals the final line set in the same transaction.
  if tg_op = 'UPDATE' and old.issued_snapshot is null and old.status in ('draft', 'generated')
    and new.status in ('sent', 'partially_paid', 'paid', 'overdue', 'credited')
    and coalesce(new.amount_paid, 0) = coalesce(old.amount_paid, 0) then
    return new;
  end if;

  if coalesce(new.grand_total, 0) <= 0
    or (new.status not in ('sent', 'partially_paid', 'paid', 'overdue', 'credited') and coalesce(new.amount_paid, 0) <= 0) then
    return new;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.id,
    'source_line_id', item.source_line_id,
    'profile_id', item.profile_id,
    'description', item.item_description,
    'hsn_code', item.hsn_code,
    'quantity', item.quantity,
    'unit_rate', item.unit_rate,
    'line_total', item.line_total,
    'gst_percent', item.gst_percent
  ) order by item.id), '[]'::jsonb)
  into v_items
  from public.invoice_items item
  where item.company_id = new.company_id and item.invoice_id = new.id;

  if jsonb_array_length(v_items) = 0 and new.dispatch_id is not null then
    raise exception 'An issued invoice requires its complete source line snapshot';
  end if;

  v_snapshot := jsonb_build_object(
    'invoice_id', new.id,
    'company_id', new.company_id,
    'customer_id', new.customer_id,
    'order_id', new.order_id,
    'dispatch_id', new.dispatch_id,
    'invoice_number', new.invoice_number,
    'invoice_date', new.invoice_date,
    'due_date', new.due_date,
    'place_of_supply_state_code', new.place_of_supply_state_code,
    'subtotal', new.subtotal,
    'tax_total', new.tax_total,
    'grand_total', new.grand_total,
    'items', v_items
  );
  new.issued_at := coalesce(new.issued_at, now());
  new.issued_snapshot := v_snapshot;
  new.source_fingerprint := md5(v_snapshot::text);
  return new;
end;
$$;

revoke all on function private.seal_issued_invoice_snapshot() from public, anon, authenticated;
drop trigger if exists seal_issued_invoice_snapshot on public.invoices;
create trigger seal_issued_invoice_snapshot
before insert or update on public.invoices
for each row execute function private.seal_issued_invoice_snapshot();

create or replace function private.block_issued_invoice_item_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_invoice_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  if exists (select 1 from public.invoices where id = v_invoice_id and issued_snapshot is not null) then
    raise exception 'Issued invoice lines are immutable; use a reviewed correction route';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.block_issued_invoice_item_mutation() from public, anon, authenticated;
drop trigger if exists block_issued_invoice_item_mutation on public.invoice_items;
create trigger block_issued_invoice_item_mutation
before insert or update or delete on public.invoice_items
for each row execute function private.block_issued_invoice_item_mutation();

-- Existing issued invoices receive the snapshot that can be proven from their
-- retained invoice lines. Legacy headers without lines remain receivable.
update public.invoices invoice
set updated_at = coalesce(invoice.updated_at, now())
where invoice.issued_snapshot is null
  and (invoice.status in ('sent', 'partially_paid', 'paid', 'overdue', 'credited') or coalesce(invoice.amount_paid, 0) > 0)
  and exists (select 1 from public.invoice_items item where item.company_id = invoice.company_id and item.invoice_id = invoice.id);

create or replace view public.invoice_dispatch_tax_basis_authorized with (security_barrier = true) as
select packed.company_id, packed.id as packing_line_id,
  coalesce(nullif(order_item.hsn_code, ''), nullif(quote_item.hsn_code, ''), nullif(profile.hsn_code, '')) as hsn_code,
  coalesce(packed.gst_percent, order_item.gst_percent, quote_item.gst_percent, quote.gst_percent) as gst_percent
from public.packing_list_items packed
left join public.order_items order_item on order_item.id = packed.order_item_id and order_item.company_id = packed.company_id
left join public.quote_items quote_item on quote_item.id = packed.quote_item_id and quote_item.company_id = packed.company_id
left join public.quotes quote on quote.id = quote_item.quote_id and quote.company_id = packed.company_id
left join public.aluminium_profiles profile on profile.id = packed.profile_id and profile.company_id = packed.company_id
where auth.uid() is not null and packed.company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts');
revoke all on public.invoice_dispatch_tax_basis_authorized from public, anon, authenticated;
grant select on public.invoice_dispatch_tax_basis_authorized to authenticated;

create or replace function private.reviewed_invoice_source_fingerprint(p_company_id uuid, p_dispatch_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_default_gst numeric;
  v_lines text;
  v_count integer;
  v_payload text;
begin
  select coalesce(settings.default_gst_percent, 18)
  into v_default_gst
  from public.company_settings settings where settings.company_id = p_company_id;
  v_default_gst := coalesce(v_default_gst, 18);
  if v_default_gst < 0 or v_default_gst > 100 then raise exception 'Company GST default is outside the supported range'; end if;

  select count(*), string_agg(
    '{"source_line_id":"' || packed.id::text || '","quantity":"' || to_char(round(coalesce(nullif(packed.net_weight_kg, 0), nullif(packed.gross_weight_kg, 0), 0), 3), 'FM999999999999990.000') ||
    '","unit_rate":"' || to_char(round(coalesce(nullif(packed.net_rate, 0), 0), 2), 'FM999999999999990.00') ||
    '","line_total":"' || to_char(round(round(coalesce(nullif(packed.net_weight_kg, 0), nullif(packed.gross_weight_kg, 0), 0), 3) * round(coalesce(nullif(packed.net_rate, 0), 0), 2), 2), 'FM999999999999990.00') ||
    '","hsn_code":"' || coalesce(nullif(order_item.hsn_code, ''), nullif(quote_item.hsn_code, ''), nullif(profile.hsn_code, '')) ||
    '","gst_percent":"' || to_char(round(coalesce(packed.gst_percent, order_item.gst_percent, quote_item.gst_percent, quote.gst_percent), 2), 'FM999999999999990.00') || '"}',
    ',' order by packed.id
  )
  into v_count, v_lines
  from public.packing_list_items packed
  left join public.order_items order_item on order_item.id = packed.order_item_id and order_item.company_id = packed.company_id
  left join public.quote_items quote_item on quote_item.id = packed.quote_item_id and quote_item.company_id = packed.company_id
  left join public.quotes quote on quote.id = quote_item.quote_id and quote.company_id = packed.company_id
  left join public.aluminium_profiles profile on profile.id = packed.profile_id and profile.company_id = packed.company_id
  where packed.company_id = p_company_id and packed.dispatch_id = p_dispatch_id;
  if v_count < 1 or v_count > 5000 then raise exception 'Dispatch manifest is empty or exceeds the review limit'; end if;
  if exists (select 1 from public.packing_list_items packed
      left join public.order_items order_item on order_item.id = packed.order_item_id and order_item.company_id = packed.company_id
      left join public.quote_items quote_item on quote_item.id = packed.quote_item_id and quote_item.company_id = packed.company_id
      left join public.quotes quote on quote.id = quote_item.quote_id and quote.company_id = packed.company_id
      left join public.aluminium_profiles profile on profile.id = packed.profile_id and profile.company_id = packed.company_id
      where packed.company_id = p_company_id and packed.dispatch_id = p_dispatch_id
      and (coalesce(nullif(packed.net_weight_kg, 0), nullif(packed.gross_weight_kg, 0), 0) <= 0
        or coalesce(nullif(packed.net_rate, 0), 0) <= 0
        or coalesce(packed.gst_percent, order_item.gst_percent, quote_item.gst_percent, quote.gst_percent) is null
        or coalesce(packed.gst_percent, order_item.gst_percent, quote_item.gst_percent, quote.gst_percent) < 0
        or coalesce(packed.gst_percent, order_item.gst_percent, quote_item.gst_percent, quote.gst_percent) > 100
        or coalesce(coalesce(nullif(order_item.hsn_code, ''), nullif(quote_item.hsn_code, ''), nullif(profile.hsn_code, '')), '') !~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$')) then
    raise exception 'Every packed line needs a positive weight and rate with a supported GST rate';
  end if;
  v_payload := '{"default_gst_percent":"' || to_char(round(v_default_gst, 2), 'FM999999999999990.00') || '","lines":[' || v_lines || ']}';
  return md5(v_payload);
end;
$$;

create or replace function private.save_reviewed_invoice_atomic(p_invoice_id uuid, p_invoice jsonb, p_items jsonb, p_replace_items boolean)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_order_id uuid := nullif(p_invoice ->> 'order_id', '')::uuid;
  v_dispatch_id uuid := nullif(p_invoice ->> 'dispatch_id', '')::uuid;
  v_fingerprint text := nullif(p_invoice ->> 'source_fingerprint', '');
  v_current_fingerprint text;
  v_invoice_id uuid;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then raise exception 'Permission denied for invoice review saves' using errcode = '42501'; end if;
  if v_order_id is null or v_dispatch_id is null or v_fingerprint !~ '^[0-9a-f]{32}$' then
    raise exception 'Reviewed invoice source and fingerprint are required';
  end if;
  if not exists (select 1 from public.dispatches dispatch where dispatch.id = v_dispatch_id and dispatch.company_id = v_company_id and dispatch.order_id = v_order_id) then
    raise exception 'Dispatch is unavailable for this company and order';
  end if;

  -- Matches the lock used by invoice uniqueness and packing-line mutation guards.
  perform pg_advisory_xact_lock(hashtextextended('dispatch-invoice:' || v_company_id::text || ':' || v_dispatch_id::text, 0));
  v_current_fingerprint := private.reviewed_invoice_source_fingerprint(v_company_id, v_dispatch_id);
  if v_current_fingerprint is distinct from v_fingerprint then
    raise exception 'The dispatch manifest or tax basis changed after review. Review it again before invoicing';
  end if;

  v_invoice_id := public.save_invoice_atomic(p_invoice_id, p_invoice - 'source_fingerprint', p_items, p_replace_items);
  return v_invoice_id;
end;
$$;

create or replace function public.save_reviewed_invoice_atomic(p_invoice_id uuid, p_invoice jsonb, p_items jsonb, p_replace_items boolean)
returns uuid language sql security definer set search_path = public, private
as $$ select private.save_reviewed_invoice_atomic(p_invoice_id, p_invoice, p_items, p_replace_items) $$;

revoke all on function private.reviewed_invoice_source_fingerprint(uuid, uuid), private.save_reviewed_invoice_atomic(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.save_reviewed_invoice_atomic(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.save_reviewed_invoice_atomic(uuid, jsonb, jsonb, boolean) to authenticated;

create or replace function private.reconcile_financial_receipt_event()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_remaining integer;
  v_paid integer;
begin
  if new.receipt_event_id is null or (tg_op = 'UPDATE' and new.payment_status is not distinct from old.payment_status) then
    return new;
  end if;
  select count(*) filter (where payment.payment_status = 'PAID'), count(*)
  into v_paid, v_remaining
  from public.financial_receipt_allocations allocation
  join public.payments payment on payment.id = allocation.payment_id and payment.company_id = allocation.company_id
  where allocation.receipt_event_id = new.receipt_event_id and allocation.company_id = new.company_id;
  if v_remaining > 0 then
    update public.financial_receipt_events
    set status = case when v_paid = 0 then 'reversed' when v_paid < v_remaining then 'partially_reversed' else 'posted' end
    where id = new.receipt_event_id and company_id = new.company_id;
  end if;
  return new;
end;
$$;

revoke all on function private.reconcile_financial_receipt_event() from public, anon, authenticated;
drop trigger if exists reconcile_financial_receipt_event on public.payments;
create trigger reconcile_financial_receipt_event
after update of payment_status on public.payments
for each row execute function private.reconcile_financial_receipt_event();

create or replace function private.enforce_financial_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_receipt_event_id uuid;
  v_receipt_event public.financial_receipt_events%rowtype;
begin
  if tg_op = 'UPDATE' and old.receipt_event_id is not null then
    if row(new.company_id,new.invoice_id,new.amount,new.payment_date,new.payment_method,new.reference_number,new.idempotency_key,new.receipt_event_id)
      is distinct from row(old.company_id,old.invoice_id,old.amount,old.payment_date,old.payment_method,old.reference_number,old.idempotency_key,old.receipt_event_id) then
      raise exception 'Grouped receipt allocation facts are immutable; reverse the payment instead';
    end if;
    v_receipt_event_id := old.receipt_event_id;
  else
    select event.* into v_receipt_event
    from private.financial_receipt_authorizations permit
    join public.financial_receipt_events event on event.id=permit.receipt_event_id
      and event.company_id=permit.company_id
    where permit.transaction_id=txid_current() and permit.company_id=new.company_id
      and permit.invoice_id=new.invoice_id and permit.amount=new.amount
      and permit.idempotency_key=new.idempotency_key and event.created_by=auth.uid()
      and event.payment_method=new.payment_method and event.payment_date=new.payment_date
      and event.reference_number is not distinct from new.reference_number;
    if found then v_receipt_event_id := v_receipt_event.id; end if;
    if new.receipt_event_id is not null and new.receipt_event_id is distinct from v_receipt_event_id then
      raise exception 'Receipt allocation authorization is unavailable' using errcode='42501';
    end if;
    new.receipt_event_id := v_receipt_event_id;
  end if;

  if new.payment_status <> 'PAID' or new.payment_method not in ('bank_transfer', 'upi', 'cheque')
    or nullif(trim(new.reference_number), '') is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text || ':receipt-reference:' || new.payment_method || ':' || new.payment_date::text || ':' || lower(trim(new.reference_number)), 0));

  if exists (select 1 from public.financial_receipt_events event
      where event.company_id = new.company_id and event.payment_method = new.payment_method
        and event.payment_date = new.payment_date and lower(trim(event.reference_number)) = lower(trim(new.reference_number))
        and event.id is distinct from v_receipt_event_id)
    or exists (select 1 from public.payments payment
      where payment.company_id = new.company_id and payment.payment_method = new.payment_method
        and payment.payment_date = new.payment_date and lower(trim(payment.reference_number)) = lower(trim(new.reference_number))
        and payment.payment_status = 'PAID' and payment.id is distinct from new.id
        and (v_receipt_event_id is null or payment.receipt_event_id is distinct from v_receipt_event_id)) then
    raise exception 'This payment reference is already recorded for this company, method, and date';
  end if;

  if v_receipt_event_id is not null then new.receipt_event_id := v_receipt_event_id; end if;
  return new;
end;
$$;

revoke all on function private.enforce_financial_payment_reference() from public, anon, authenticated;
drop trigger if exists enforce_financial_payment_reference on public.payments;
create trigger enforce_financial_payment_reference
before insert or update of company_id, invoice_id, amount, idempotency_key, receipt_event_id, payment_date, payment_method, payment_status, reference_number on public.payments
for each row execute function private.enforce_financial_payment_reference();

create or replace function private.post_financial_receipt_atomic(
  p_receipt jsonb,
  p_allocations jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_event_id uuid;
  v_existing public.financial_receipt_events%rowtype;
  v_amount numeric(14,2);
  v_exact_amount numeric;
  v_payment_date date;
  v_payment_method text;
  v_reference_number text := nullif(trim(p_receipt ->> 'reference_number'), '');
  v_notes text := nullif(trim(p_receipt ->> 'notes'), '');
  v_source_type text := coalesce(nullif(p_receipt ->> 'source_type', ''), 'manual');
  v_source_batch_id uuid := nullif(p_receipt ->> 'source_import_batch_id', '')::uuid;
  v_source_row_number integer := nullif(p_receipt ->> 'source_row_number', '')::integer;
  v_total numeric(14,2) := 0;
  v_count integer := 0;
  v_allocations jsonb;
  v_fingerprint text;
  v_item jsonb;
  v_invoice_id uuid;
  v_allocation_amount numeric(14,2);
  v_allocation_key uuid;
  v_payment jsonb;
  v_payment_id uuid;
  v_payment_result jsonb;
  v_result_allocations jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then raise exception 'Permission denied for financial receipts' using errcode = '42501'; end if;
  if p_idempotency_key is null then raise exception 'Receipt idempotency key is required'; end if;
  if jsonb_typeof(p_receipt) <> 'object' or jsonb_typeof(coalesce(p_allocations, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_allocations) < 1 or jsonb_array_length(p_allocations) > 100 then
    raise exception 'Provide a receipt and between one and one hundred reviewed invoice allocations';
  end if;

  v_exact_amount := nullif(p_receipt ->> 'amount', '')::numeric;
  if v_exact_amount is null or v_exact_amount <= 0 or v_exact_amount > 999999999999.99 or v_exact_amount <> round(v_exact_amount, 2) then
    raise exception 'Receipt amount must be a positive finite INR amount with at most two decimal places';
  end if;
  v_amount := v_exact_amount;
  v_payment_date := nullif(p_receipt ->> 'payment_date', '')::date;
  v_payment_method := nullif(p_receipt ->> 'payment_method', '');
  if v_payment_date is null or v_payment_date > current_date then raise exception 'Receipt date must be valid and cannot be in the future'; end if;
  if v_payment_method is null or v_payment_method not in ('bank_transfer', 'upi', 'cheque', 'cash', 'credit_note', 'other') then raise exception 'Select a valid receipt or credit adjustment method'; end if;
  if v_payment_method in ('bank_transfer', 'upi', 'cheque') and v_reference_number is null then raise exception 'Reference number is required for bank, UPI, and cheque receipts'; end if;
  if v_source_type not in ('manual', 'csv') then raise exception 'Unsupported receipt source'; end if;
  if (v_source_type = 'csv') <> (v_source_batch_id is not null and v_source_row_number is not null) then raise exception 'Receipt import lineage is incomplete'; end if;
  if v_notes is not null and length(v_notes) > 2000 then raise exception 'Receipt notes are too long'; end if;

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Each invoice allocation must be an object'; end if;
    v_invoice_id := nullif(v_item ->> 'invoice_id', '')::uuid;
    v_exact_amount := nullif(v_item ->> 'amount', '')::numeric;
    if v_invoice_id is null or v_exact_amount is null or v_exact_amount <= 0 or v_exact_amount > 999999999999.99
      or v_exact_amount <> round(v_exact_amount, 2) then
      raise exception 'Each invoice allocation requires a positive finite amount with at most two decimal places';
    end if;
    v_total := v_total + v_exact_amount;
    v_count := v_count + 1;
  end loop;
  if (select count(distinct (value ->> 'invoice_id')::uuid) from jsonb_array_elements(p_allocations)) <> v_count then
    raise exception 'Combine duplicate allocations for the same invoice before review';
  end if;
  if v_total <> v_amount then raise exception 'Reviewed invoice allocations must equal the actual receipt amount exactly'; end if;

  select jsonb_agg(jsonb_build_object('invoice_id', (value ->> 'invoice_id')::uuid, 'amount', (value ->> 'amount')::numeric) order by (value ->> 'invoice_id')::uuid)
  into v_allocations from jsonb_array_elements(p_allocations);
  v_fingerprint := md5(jsonb_build_object(
    'receipt', jsonb_build_object('amount', v_amount, 'payment_date', v_payment_date, 'payment_method', v_payment_method,
      'reference_number', v_reference_number, 'notes', v_notes, 'source_type', v_source_type,
      'source_import_batch_id', v_source_batch_id, 'source_row_number', v_source_row_number),
    'allocations', v_allocations
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':financial-receipt:' || p_idempotency_key::text, 0));
  select * into v_existing from public.financial_receipt_events
  where company_id = v_company_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then raise exception 'Receipt retry identity was already used with different receipt or allocations'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'invoice_id', allocation.invoice_id, 'payment_id', allocation.payment_id, 'amount', allocation.amount,
      'payment_status', payment.payment_status, 'balance_due', invoice.balance_due, 'invoice_status', invoice.status
    ) order by allocation.invoice_id), '[]'::jsonb)
    into v_result_allocations
    from public.financial_receipt_allocations allocation
    join public.payments payment on payment.id = allocation.payment_id and payment.company_id = allocation.company_id
    join public.invoices invoice on invoice.id = allocation.invoice_id and invoice.company_id = allocation.company_id
    where allocation.receipt_event_id = v_existing.id and allocation.company_id = v_company_id;
    return jsonb_build_object('receipt_id', v_existing.id, 'received_amount', v_existing.received_amount,
      'payment_method', v_existing.payment_method, 'status', v_existing.status, 'allocations', v_result_allocations,
      'idempotent_replay', true);
  end if;

  if v_reference_number is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':receipt-reference:' || v_payment_method || ':' || v_payment_date::text || ':' || lower(v_reference_number), 0));
    if exists (select 1 from public.financial_receipt_events event
      where event.company_id = v_company_id and event.payment_method = v_payment_method
        and event.payment_date = v_payment_date and lower(trim(event.reference_number)) = lower(v_reference_number))
      or exists (select 1 from public.payments payment
        where payment.company_id = v_company_id and payment.payment_method = v_payment_method
          and payment.payment_date = v_payment_date and lower(trim(payment.reference_number)) = lower(v_reference_number)
          and payment.payment_status = 'PAID') then
      raise exception 'This receipt reference is already recorded for this company, method, and date';
    end if;
  end if;

  -- Lock invoice rows in stable order before the canonical payment writer locks them again.
  for v_item in select value from jsonb_array_elements(v_allocations) order by (value ->> 'invoice_id')::uuid
  loop
    v_invoice_id := (v_item ->> 'invoice_id')::uuid;
    perform private.recalculate_invoice_collection_state(v_invoice_id, v_company_id);
    if not exists (select 1 from public.invoices invoice where invoice.id = v_invoice_id and invoice.company_id = v_company_id
      and invoice.status in ('generated', 'sent', 'partially_paid', 'overdue') and invoice.balance_due >= (v_item ->> 'amount')::numeric) then
      raise exception 'An allocated invoice is unavailable or its open balance changed; review allocations again';
    end if;
  end loop;

  insert into public.financial_receipt_events(company_id, idempotency_key, request_fingerprint, source_type,
    source_import_batch_id, source_row_number, received_amount, payment_date, payment_method, reference_number, notes, created_by)
  values (v_company_id, p_idempotency_key, v_fingerprint, v_source_type, v_source_batch_id, v_source_row_number,
    v_amount, v_payment_date, v_payment_method, v_reference_number, v_notes, auth.uid())
  returning id into v_event_id;
  for v_item in select value from jsonb_array_elements(v_allocations) order by (value ->> 'invoice_id')::uuid
  loop
    v_invoice_id := (v_item ->> 'invoice_id')::uuid;
    v_allocation_amount := (v_item ->> 'amount')::numeric;
    v_allocation_key := (substr(md5(v_event_id::text || ':' || v_invoice_id::text), 1, 8) || '-' ||
      substr(md5(v_event_id::text || ':' || v_invoice_id::text), 9, 4) || '-4' ||
      substr(md5(v_event_id::text || ':' || v_invoice_id::text), 14, 3) || '-8' ||
      substr(md5(v_event_id::text || ':' || v_invoice_id::text), 18, 3) || '-' ||
      substr(md5(v_event_id::text || ':' || v_invoice_id::text), 21, 12))::uuid;
    v_payment := jsonb_build_object('payment_date', v_payment_date, 'amount', v_allocation_amount,
      'payment_method', v_payment_method, 'reference_number', v_reference_number, 'notes', v_notes,
      'idempotency_key', v_allocation_key);
    insert into private.financial_receipt_authorizations(transaction_id,receipt_event_id,company_id,invoice_id,amount,idempotency_key)
    values(txid_current(),v_event_id,v_company_id,v_invoice_id,v_allocation_amount,v_allocation_key);
    v_payment_result := private.record_payment_atomic(v_invoice_id, v_payment);
    delete from private.financial_receipt_authorizations
    where transaction_id=txid_current() and receipt_event_id=v_event_id and invoice_id=v_invoice_id;
    v_payment_id := (v_payment_result ->> 'payment_id')::uuid;
    update public.payments set receipt_event_id = v_event_id
    where id = v_payment_id and company_id = v_company_id;
    insert into public.financial_receipt_allocations(company_id, receipt_event_id, invoice_id, payment_id, amount)
    values (v_company_id, v_event_id, v_invoice_id, v_payment_id, v_allocation_amount);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'invoice_id', allocation.invoice_id, 'payment_id', allocation.payment_id, 'amount', allocation.amount,
    'payment_status', payment.payment_status, 'balance_due', invoice.balance_due, 'invoice_status', invoice.status
  ) order by allocation.invoice_id), '[]'::jsonb)
  into v_result_allocations
  from public.financial_receipt_allocations allocation
  join public.payments payment on payment.id = allocation.payment_id and payment.company_id = allocation.company_id
  join public.invoices invoice on invoice.id = allocation.invoice_id and invoice.company_id = allocation.company_id
  where allocation.receipt_event_id = v_event_id and allocation.company_id = v_company_id;
  return jsonb_build_object('receipt_id', v_event_id, 'received_amount', v_amount, 'payment_method', v_payment_method,
    'status', 'posted', 'allocations', v_result_allocations, 'idempotent_replay', false);
end;
$$;

create or replace function public.post_financial_receipt_atomic(p_receipt jsonb, p_allocations jsonb, p_idempotency_key uuid)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.post_financial_receipt_atomic(p_receipt, p_allocations, p_idempotency_key) $$;

create or replace function private.import_financial_receipt_csv_atomic(
  p_source_fingerprint text,
  p_source_name text,
  p_field_mapping jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_batch public.financial_receipt_import_batches%rowtype;
  v_row jsonb;
  v_row_number integer;
  v_invoice_id uuid;
  v_idempotency_key uuid;
  v_receipt_result jsonb;
  v_error text;
  v_posted integer := 0;
  v_failed integer := 0;
  v_row_results jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts') then raise exception 'Permission denied for financial receipt imports' using errcode = '42501'; end if;
  if p_source_fingerprint !~ '^[0-9a-f]{64}$' or length(coalesce(p_source_name, '')) not between 1 and 160
    or jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500
    or jsonb_typeof(coalesce(p_field_mapping, 'null'::jsonb)) <> 'object' then
    raise exception 'Receipt CSV import must contain a valid fingerprint, mapping, and between one and five hundred rows';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':receipt-import:' || p_source_fingerprint, 0));
  select * into v_batch from public.financial_receipt_import_batches
  where company_id = v_company_id and source_fingerprint = p_source_fingerprint for update;
  if found then
    select count(*) filter (where status = 'posted'), count(*) filter (where status = 'failed')
    into v_posted, v_failed from public.financial_receipt_import_rows where batch_id = v_batch.id and company_id = v_company_id;
    select coalesce(jsonb_agg(jsonb_build_object('row_number', row_number, 'status', status, 'error', error,
      'receipt_event_id', receipt_event_id, 'payment_id', payment_id) order by row_number), '[]'::jsonb)
    into v_row_results from public.financial_receipt_import_rows where batch_id = v_batch.id and company_id = v_company_id;
    return jsonb_build_object('batch_id', v_batch.id, 'source_fingerprint', p_source_fingerprint,
      'row_count', v_batch.row_count, 'posted_count', v_posted, 'failed_count', v_failed,
      'idempotent_replay', true, 'rows', v_row_results);
  end if;

  insert into public.financial_receipt_import_batches(company_id, source_fingerprint, source_name, field_mapping, row_count, imported_by)
  values (v_company_id, p_source_fingerprint, trim(p_source_name), p_field_mapping, jsonb_array_length(p_rows), auth.uid())
  returning * into v_batch;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row_number := coalesce(nullif(v_row ->> 'row_number', '')::integer, 0);
    if v_row_number <= 0 then raise exception 'Receipt import rows require positive source row numbers'; end if;
    insert into public.financial_receipt_import_rows(company_id, batch_id, row_number, row_payload)
    values (v_company_id, v_batch.id, v_row_number, v_row)
    returning idempotency_key into v_idempotency_key;
    v_error := null;
    begin
      if nullif(v_row ->> 'error', '') is not null then raise exception '%', left(v_row ->> 'error', 500); end if;
      if jsonb_typeof(v_row) <> 'object' or length(trim(coalesce(v_row ->> 'invoice_number', ''))) not between 1 and 80 then
        raise exception 'Invoice number is required';
      end if;
      select id into v_invoice_id from public.invoices
      where company_id = v_company_id and invoice_number = trim(v_row ->> 'invoice_number');
      if v_invoice_id is null then raise exception 'Invoice number was not found for this company'; end if;
      if nullif(v_row ->> 'reference_number', '') is not null and exists (
        select 1 from public.financial_receipt_import_rows prior
        where prior.batch_id = v_batch.id and prior.company_id = v_company_id and prior.row_number < v_row_number
          and prior.row_payload ->> 'reference_number' is not null
          and lower(trim(prior.row_payload ->> 'reference_number')) = lower(trim(v_row ->> 'reference_number'))
          and prior.row_payload ->> 'payment_date' = v_row ->> 'payment_date'
          and prior.row_payload ->> 'payment_method' = v_row ->> 'payment_method'
      ) then raise exception 'Duplicate receipt reference in this CSV import'; end if;
      v_receipt_result := private.post_financial_receipt_atomic(
        jsonb_build_object('amount', v_row ->> 'amount', 'payment_date', v_row ->> 'payment_date',
          'payment_method', v_row ->> 'payment_method', 'reference_number', nullif(trim(v_row ->> 'reference_number'), ''),
          'notes', nullif(trim(v_row ->> 'notes'), ''), 'source_type', 'csv',
          'source_import_batch_id', v_batch.id, 'source_row_number', v_row_number),
        jsonb_build_array(jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_row ->> 'amount')),
        v_idempotency_key);
      update public.financial_receipt_import_rows set status = 'posted', receipt_event_id = (v_receipt_result ->> 'receipt_id')::uuid,
        payment_id = (v_receipt_result #>> '{allocations,0,payment_id}')::uuid
      where batch_id = v_batch.id and company_id = v_company_id and row_number = v_row_number;
      v_posted := v_posted + 1;
    exception when others then
      v_error := left(sqlerrm, 500);
      update public.financial_receipt_import_rows set status = 'failed', error = v_error
      where batch_id = v_batch.id and company_id = v_company_id and row_number = v_row_number;
      v_failed := v_failed + 1;
    end;
  end loop;

  update public.financial_receipt_import_batches set posted_count = v_posted, failed_count = v_failed
  where id = v_batch.id and company_id = v_company_id;
  select coalesce(jsonb_agg(jsonb_build_object('row_number', row_number, 'status', status, 'error', error,
    'receipt_event_id', receipt_event_id, 'payment_id', payment_id) order by row_number), '[]'::jsonb)
  into v_row_results from public.financial_receipt_import_rows where batch_id = v_batch.id and company_id = v_company_id;
  return jsonb_build_object('batch_id', v_batch.id, 'source_fingerprint', p_source_fingerprint,
    'row_count', v_batch.row_count, 'posted_count', v_posted, 'failed_count', v_failed,
    'idempotent_replay', false, 'rows', v_row_results);
end;
$$;

create or replace function public.import_financial_receipt_csv_atomic(
  p_source_fingerprint text,
  p_source_name text,
  p_field_mapping jsonb,
  p_rows jsonb
)
returns jsonb language sql security definer set search_path = public, private
as $$ select private.import_financial_receipt_csv_atomic(p_source_fingerprint, p_source_name, p_field_mapping, p_rows) $$;

revoke all on function private.post_financial_receipt_atomic(jsonb, jsonb, uuid), private.import_financial_receipt_csv_atomic(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.post_financial_receipt_atomic(jsonb, jsonb, uuid), public.import_financial_receipt_csv_atomic(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.post_financial_receipt_atomic(jsonb, jsonb, uuid), public.import_financial_receipt_csv_atomic(text, text, jsonb, jsonb) to authenticated;

commit;
