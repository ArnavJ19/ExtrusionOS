-- Provide cash-collection analytics without exposing receipt references or notes.

drop policy if exists invoices_finance_read on public.invoices;
create policy invoices_finance_read on public.invoices
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts', 'sales_manager')
  );

create or replace function private.get_financial_collection_events(p_start_date date)
returns table(
  event_id uuid,
  payment_date date,
  amount numeric
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_company_id uuid := private.get_current_user_company_id();
begin
  if v_company_id is null or auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if private.get_current_user_role() not in ('owner', 'admin', 'accounts', 'sales_manager') then
    raise exception 'Permission denied for collection analytics' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.payment_date,
    case when p.payment_type = 'REFUND' then -p.amount else p.amount end
  from public.payments p
  where p.company_id = v_company_id
    and p.payment_status = 'PAID'
    and p.payment_method <> 'credit_note'
    and (p_start_date is null or p.payment_date >= p_start_date)
  order by p.payment_date, p.id;
end;
$$;

create or replace function public.get_financial_collection_events(p_start_date date default null)
returns table(event_id uuid, payment_date date, amount numeric)
language sql
security definer
set search_path = public, private
as $$ select * from private.get_financial_collection_events(p_start_date) $$;

revoke all on function public.get_financial_collection_events(date) from public, anon;
revoke all on function private.get_financial_collection_events(date) from public, anon, authenticated;
grant execute on function public.get_financial_collection_events(date) to authenticated;
