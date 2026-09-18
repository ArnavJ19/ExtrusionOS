begin;

alter table public.invoices
  add column if not exists credited_amount numeric(14,2) not null default 0,
  add column if not exists customer_credit_due numeric(14,2)
    generated always as (greatest(amount_paid + credited_amount - grand_total, 0)) stored;

-- balance_due was a generated value, so no historical data is lost by
-- rebuilding it with issued credit notes included in the expression.
alter table public.invoices drop column if exists balance_due;
alter table public.invoices add column balance_due numeric(14,2)
  generated always as (greatest(grand_total - amount_paid - credited_amount, 0)) stored;

alter table public.invoices drop constraint if exists invoice_status_check;
alter table public.invoices add constraint invoice_status_check check (
  status in ('draft','generated','sent','partially_paid','paid','overdue','cancelled','credited')
);

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  dispatch_id uuid not null references public.dispatches(id) on delete restrict,
  credit_note_number text not null,
  credit_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  reason text not null,
  subtotal numeric(14,2) not null,
  tax_total numeric(14,2) not null,
  grand_total numeric(14,2) not null check (grand_total > 0),
  status text not null default 'issued' check (status in ('issued','reversed')),
  item_snapshot jsonb not null default '[]'::jsonb,
  idempotency_key uuid not null,
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, credit_note_number),
  unique(company_id, idempotency_key)
);

create unique index if not exists credit_notes_one_active_dispatch_idx
  on public.credit_notes(company_id, dispatch_id)
  where status = 'issued';
create index if not exists credit_notes_company_invoice_idx
  on public.credit_notes(company_id, invoice_id, created_at desc);

alter table public.credit_notes enable row level security;
drop policy if exists "credit notes tenant read" on public.credit_notes;
create policy "credit notes tenant read" on public.credit_notes
for select to authenticated
using (
  company_id = private.get_current_user_company_id()
  and private.get_current_user_role() in ('owner', 'admin', 'accounts')
);
revoke insert, update, delete on public.credit_notes from anon, authenticated;
grant select on public.credit_notes to authenticated;

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

  v_effective_paid := greatest(0, coalesce(v_effective_paid, 0));
  if v_effective_paid > v_invoice.grand_total then
    raise exception 'Effective receipts exceed the invoice total';
  end if;

  v_next_status := case
    when v_invoice.status = 'cancelled' then 'cancelled'
    when v_invoice.credited_amount >= v_invoice.grand_total and v_invoice.grand_total > 0 then 'credited'
    when v_invoice.grand_total > 0 and v_effective_paid = v_invoice.grand_total then 'paid'
    when v_effective_paid > 0 then 'partially_paid'
    when v_invoice.status in ('draft', 'generated') then v_invoice.status
    when v_invoice.due_date is not null and v_invoice.due_date < (now() at time zone 'Asia/Kolkata')::date then 'overdue'
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

create or replace function private.issue_dispatch_return_credit_note_atomic(
  p_dispatch_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_dispatch public.dispatches%rowtype;
  v_invoice public.invoices%rowtype;
  v_credit_id uuid;
  v_existing uuid;
  v_items jsonb;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','accounts') then
    raise exception 'Permission denied for credit notes' using errcode = '42501';
  end if;
  if p_idempotency_key is null then raise exception 'Credit note idempotency key is required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear return or damage reason'; end if;

  select id into v_existing from public.credit_notes
  where company_id = v_company_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  select * into v_dispatch from public.dispatches
  where id = p_dispatch_id and company_id = v_company_id for update;
  if not found then raise exception 'Dispatch not found for this company'; end if;
  if v_dispatch.delivery_status not in ('returned','damaged') then
    raise exception 'A credit note can only be issued for a returned or damaged dispatch';
  end if;

  select * into v_invoice from public.invoices
  where company_id = v_company_id and dispatch_id = p_dispatch_id and status <> 'cancelled'
  for update;
  if not found then raise exception 'No issued invoice is linked to this dispatch'; end if;
  if v_invoice.status = 'draft' then raise exception 'Cancel the draft invoice instead of issuing a credit note'; end if;
  if exists (select 1 from public.credit_notes where company_id = v_company_id and dispatch_id = p_dispatch_id and status = 'issued') then
    raise exception 'An issued credit note already exists for this dispatch';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) - array['company_id','invoice_id']), '[]'::jsonb)
  into v_items
  from public.invoice_items item
  where item.company_id = v_company_id and item.invoice_id = v_invoice.id;

  insert into public.credit_notes(
    company_id, invoice_id, dispatch_id, credit_note_number, credit_date,
    reason, subtotal, tax_total, grand_total, item_snapshot,
    idempotency_key, created_by
  ) values (
    v_company_id, v_invoice.id, p_dispatch_id,
    private.next_business_number_locked(
      'public.credit_notes'::regclass, 'credit_note_number', v_company_id, 'CN',
      (now() at time zone 'Asia/Kolkata')::date
    ),
    (now() at time zone 'Asia/Kolkata')::date,
    trim(p_reason), v_invoice.subtotal, v_invoice.tax_total, v_invoice.grand_total,
    v_items, p_idempotency_key, auth.uid()
  ) returning id into v_credit_id;

  update public.invoices
  set credited_amount = (
        select coalesce(sum(note.grand_total), 0)
        from public.credit_notes note
        where note.company_id = v_company_id and note.invoice_id = v_invoice.id and note.status = 'issued'
      ),
      updated_at = now()
  where id = v_invoice.id and company_id = v_company_id;
  perform private.recalculate_invoice_collection_state(v_invoice.id, v_company_id);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'dispatch_credit_note_issued', 'credit_note', v_credit_id,
    jsonb_build_object('invoice_id', v_invoice.id, 'dispatch_id', p_dispatch_id, 'amount', v_invoice.grand_total, 'reason', trim(p_reason)));
  return v_credit_id;
end;
$$;

create or replace function private.reverse_credit_note_atomic(
  p_credit_note_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
  v_note public.credit_notes%rowtype;
begin
  if v_company_id is null or auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if private.get_current_user_role() not in ('owner','admin','accounts') then
    raise exception 'Permission denied for credit note reversal' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then raise exception 'Enter a clear credit note reversal reason'; end if;

  select * into v_note from public.credit_notes
  where id = p_credit_note_id and company_id = v_company_id for update;
  if not found then raise exception 'Credit note not found for this company'; end if;
  if v_note.status = 'reversed' then return v_note.id; end if;

  update public.credit_notes set status = 'reversed', reversed_at = now(),
    reversed_by = auth.uid(), reversal_reason = trim(p_reason), updated_at = now()
  where id = v_note.id and company_id = v_company_id;

  update public.invoices
  set credited_amount = (
        select coalesce(sum(note.grand_total), 0)
        from public.credit_notes note
        where note.company_id = v_company_id and note.invoice_id = v_note.invoice_id and note.status = 'issued'
      ),
      updated_at = now()
  where id = v_note.invoice_id and company_id = v_company_id;
  perform private.recalculate_invoice_collection_state(v_note.invoice_id, v_company_id);

  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, metadata_json)
  values (v_company_id, auth.uid(), 'credit_note_reversed', 'credit_note', v_note.id,
    jsonb_build_object('invoice_id', v_note.invoice_id, 'dispatch_id', v_note.dispatch_id, 'amount', v_note.grand_total, 'reason', trim(p_reason)));
  return v_note.id;
end;
$$;

create or replace function public.issue_dispatch_return_credit_note_atomic(
  p_dispatch_id uuid, p_reason text, p_idempotency_key uuid
)
returns uuid language sql security invoker set search_path = public, private
as $$ select private.issue_dispatch_return_credit_note_atomic(p_dispatch_id, p_reason, p_idempotency_key) $$;

create or replace function public.reverse_credit_note_atomic(p_credit_note_id uuid, p_reason text)
returns uuid language sql security invoker set search_path = public, private
as $$ select private.reverse_credit_note_atomic(p_credit_note_id, p_reason) $$;

revoke all on function private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public, anon, authenticated;
revoke all on function private.reverse_credit_note_atomic(uuid,text) from public, anon, authenticated;
revoke all on function public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public, anon;
revoke all on function public.reverse_credit_note_atomic(uuid,text) from public, anon;
grant execute on function public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) to authenticated;
grant execute on function public.reverse_credit_note_atomic(uuid,text) to authenticated;

commit;
