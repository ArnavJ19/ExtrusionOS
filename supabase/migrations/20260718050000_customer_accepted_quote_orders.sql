-- An internal quote approval is not customer acceptance. Enforce that boundary
-- even when an older client attempts a direct order insert.
create schema if not exists private;

create or replace function private.enforce_customer_accepted_quote_order_link()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_quote_company_id uuid;
  v_quote_customer_id uuid;
  v_quote_status text;
begin
  if new.quote_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     and private.get_current_user_role() not in (
       'owner', 'admin', 'sales', 'sales_manager', 'factory_manager', 'production_manager'
     ) then
    raise exception 'Permission denied for orders' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and old.quote_id is not distinct from new.quote_id
    and old.company_id is not distinct from new.company_id
    and old.customer_id is not distinct from new.customer_id
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order-quote:' || new.quote_id::text, 0));

  select q.company_id, q.customer_id, q.status
  into v_quote_company_id, v_quote_customer_id, v_quote_status
  from public.quotes q
  where q.id = new.quote_id;

  if not found then
    raise exception 'Quote not found';
  end if;
  if v_quote_company_id <> new.company_id or v_quote_customer_id <> new.customer_id then
    raise exception 'Quote does not belong to this company and customer';
  end if;
  if v_quote_status <> 'customer_approved' then
    raise exception 'Only customer-approved quotes can be linked to a new order';
  end if;
  if not exists (
    select 1
    from public.quote_items item
    where item.company_id = new.company_id
      and item.quote_id = new.quote_id
  ) then
    raise exception 'A customer-approved quote must contain at least one item before order creation'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.quote_items item
    where item.company_id = new.company_id
      and item.quote_id = new.quote_id
      and lower(coalesce(item.drawing_approval_status, '')) <> 'approved'
  ) then
    raise exception 'Every quote item drawing must be approved before order creation'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.orders existing
    where existing.company_id = new.company_id
      and existing.quote_id = new.quote_id
      and existing.id <> new.id
  ) then
    raise exception 'An order already exists for this quote';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_customer_accepted_quote_order_link() from public;
drop trigger if exists enforce_customer_accepted_quote_order_link on public.orders;
create trigger enforce_customer_accepted_quote_order_link
before insert or update of quote_id, company_id, customer_id on public.orders
for each row execute function private.enforce_customer_accepted_quote_order_link();
create or replace function private.mark_linked_quote_converted()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.quote_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.quote_id is not distinct from new.quote_id
     and old.company_id is not distinct from new.company_id
     and old.customer_id is not distinct from new.customer_id then
    return new;
  end if;

  update public.quotes
  set status = 'converted_to_order', updated_at = now()
  where id = new.quote_id
    and company_id = new.company_id
    and customer_id = new.customer_id
    and status = 'customer_approved';
  if not found then
    raise exception 'Linked quote could not be finalized as converted to order';
  end if;
  return new;
end;
$$;

revoke all on function private.mark_linked_quote_converted() from public;
drop trigger if exists mark_linked_quote_converted on public.orders;
create trigger mark_linked_quote_converted
after insert or update of quote_id, company_id, customer_id on public.orders
for each row execute function private.mark_linked_quote_converted();

update public.quotes q
set status = 'converted_to_order', updated_at = now()
where q.status = 'customer_approved'
  and exists (
    select 1 from public.orders o
    where o.company_id = q.company_id and o.quote_id = q.id
  );
