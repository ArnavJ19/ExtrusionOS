begin;

create or replace function public.validate_invoice_dispatch_billable()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_dispatch record;
begin
  if new.dispatch_id is null or new.status = 'cancelled' then
    return new;
  end if;

  select company_id, order_id, delivery_status
  into v_dispatch
  from public.dispatches
  where id = new.dispatch_id;

  if not found
     or v_dispatch.company_id <> new.company_id
     or (new.order_id is not null and v_dispatch.order_id <> new.order_id) then
    raise exception 'Invoice dispatch must belong to the invoice company and source order'
      using errcode = '23514';
  end if;

  if v_dispatch.delivery_status in ('returned', 'damaged') then
    raise exception 'Returned or damaged dispatches cannot be invoiced; resolve the return or create a replacement dispatch first'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_invoice_dispatch_billable on public.invoices;
create trigger validate_invoice_dispatch_billable
before insert or update of company_id, order_id, dispatch_id, status
on public.invoices
for each row execute function public.validate_invoice_dispatch_billable();

commit;
