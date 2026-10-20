-- Invoice collection-state fix (finance audit FIN #5).
-- When a fully-paid invoice's payment is reversed, effective_paid returns to 0 but the
-- status CASE only saw the current 'paid' status and fell through to 'sent'/'overdue',
-- so a never-sent 'generated' invoice was misrepresented as 'sent'. This preserves an
-- explicit issued/sent state, marks overdue when past due, and otherwise returns an
-- unpaid invoice to its issued 'generated' base rather than fabricating 'sent'.
-- Body is otherwise identical to 20260718010000_financial_closure.sql.

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
    -- Unpaid: keep an explicit issued/sent state, flag overdue if past due, else the issued base.
    when v_invoice.status in ('draft', 'generated', 'sent') then v_invoice.status
    when v_invoice.due_date is not null and v_invoice.due_date < current_date then 'overdue'
    else 'generated'
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
