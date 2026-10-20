-- A return credit document and an unlinked credit adjustment cannot settle the same invoice.
begin;

create or replace function private.enforce_invoice_credit_settlement_exclusivity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_table_schema <> 'public' then
    raise exception 'Unsupported credit settlement source';
  end if;

  if tg_table_name = 'payments' then
    if new.payment_status is distinct from 'PAID'
      or not (new.payment_method is not distinct from 'credit_note' or new.payment_type is not distinct from 'ADJUSTMENT') then
      return new;
    end if;
    if tg_op = 'UPDATE' then
      if old.company_id is not distinct from new.company_id and old.invoice_id is not distinct from new.invoice_id
        and old.payment_status is not distinct from new.payment_status and old.payment_method is not distinct from new.payment_method
        and old.payment_type is not distinct from new.payment_type and old.amount is not distinct from new.amount then
        return new;
      end if;
    end if;
  elsif tg_table_name = 'credit_notes' then
    if new.status is distinct from 'issued' then return new; end if;
    if tg_op = 'UPDATE' then
      if old.company_id is not distinct from new.company_id and old.invoice_id is not distinct from new.invoice_id
        and old.status is not distinct from new.status and old.grand_total is not distinct from new.grand_total then
        return new;
      end if;
    end if;
  else
    raise exception 'Unsupported credit settlement source';
  end if;

  -- Both posting paths serialize on the same invoice before inspecting the opposite ledger.
  perform 1 from public.invoices where id=new.invoice_id and company_id=new.company_id for update;
  if not found then raise exception 'Invoice not found for this company' using errcode='23514'; end if;

  if tg_table_name = 'payments' then
    if exists (
      select 1 from public.credit_notes
      where company_id=new.company_id and invoice_id=new.invoice_id and status='issued'
    ) then
      raise exception 'This invoice already has an issued credit note. Reverse that note before recording a standalone credit adjustment.'
        using errcode='23514';
    end if;
  else
    if exists (
      select 1 from public.payments
      where company_id=new.company_id and invoice_id=new.invoice_id and payment_status='PAID'
        and (payment_method='credit_note' or payment_type='ADJUSTMENT')
    ) then
      raise exception 'Reverse the standalone credit adjustment before issuing a return credit note for this invoice.'
        using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_credit_settlement_exclusivity on public.payments;
create trigger payments_credit_settlement_exclusivity
before insert or update on public.payments
for each row execute function private.enforce_invoice_credit_settlement_exclusivity();

drop trigger if exists credit_notes_settlement_exclusivity on public.credit_notes;
create trigger credit_notes_settlement_exclusivity
before insert or update on public.credit_notes
for each row execute function private.enforce_invoice_credit_settlement_exclusivity();

revoke all on function private.enforce_invoice_credit_settlement_exclusivity() from public, anon, authenticated;

commit;
