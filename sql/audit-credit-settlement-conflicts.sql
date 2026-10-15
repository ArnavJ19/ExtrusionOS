-- Read-only historical review. Run under an authorized finance/audit identity.
-- This does not repair, reverse or rewrite any invoice, payment or credit note.
with adjustments as (
  select company_id, invoice_id, count(*) posted_adjustment_count,
    sum(case when payment_type='REFUND' then -amount else amount end) posted_adjustment_amount
  from public.payments
  where payment_status='PAID' and (payment_method='credit_note' or payment_type='ADJUSTMENT')
  group by company_id, invoice_id
), issued as (
  select company_id, invoice_id, count(*) issued_credit_note_count, sum(grand_total) issued_credit_amount
  from public.credit_notes where status='issued'
  group by company_id, invoice_id
), cash as (
  select company_id, invoice_id,
    greatest(sum(case when payment_type='REFUND' then -amount else amount end),0) cash_receipts_net
  from public.payments
  where payment_status='PAID' and payment_method<>'credit_note' and payment_type is distinct from 'ADJUSTMENT'
  group by company_id, invoice_id
)
select i.company_id, i.id invoice_id, i.invoice_number, i.grand_total,
  a.posted_adjustment_count, a.posted_adjustment_amount,
  c.issued_credit_note_count, c.issued_credit_amount,
  coalesce(cash.cash_receipts_net,0) cash_receipts_net,
  i.customer_credit_due recorded_customer_credit_due,
  greatest(coalesce(cash.cash_receipts_net,0)+c.issued_credit_amount-i.grand_total,0) cash_only_customer_credit_due
from public.invoices i
join adjustments a on a.company_id=i.company_id and a.invoice_id=i.id
join issued c on c.company_id=i.company_id and c.invoice_id=i.id
left join cash on cash.company_id=i.company_id and cash.invoice_id=i.id
order by i.company_id, i.id;
