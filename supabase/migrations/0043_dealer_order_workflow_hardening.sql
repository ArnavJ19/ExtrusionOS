-- Harden dealer quote/order ownership and make dealer-originated orders visible in Dealer Orders.

create or replace function public.assign_current_dealer_to_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dealer_id uuid;
begin
  v_dealer_id := public.get_current_user_dealer_id();
  if v_dealer_id is not null then
    new.dealer_id := v_dealer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_current_dealer_to_quote_trigger on public.quotes;
create trigger assign_current_dealer_to_quote_trigger before insert or update on public.quotes for each row execute function public.assign_current_dealer_to_quote();

create or replace function public.assign_dealer_to_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dealer_id uuid;
begin
  v_dealer_id := public.get_current_user_dealer_id();
  if v_dealer_id is not null then
    new.dealer_id := v_dealer_id;
  elsif new.dealer_id is null and new.quote_id is not null then
    select dealer_id into new.dealer_id
    from public.quotes
    where id = new.quote_id and company_id = new.company_id;
  elsif new.dealer_id is null and new.created_by is not null then
    select dealer_id into new.dealer_id
    from public.app_users
    where id = new.created_by and company_id = new.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_dealer_to_order_trigger on public.orders;
create trigger assign_dealer_to_order_trigger before insert or update on public.orders for each row execute function public.assign_dealer_to_order();

update public.quotes q
set dealer_id = u.dealer_id
from public.app_users u
where q.created_by = u.id
  and q.company_id = u.company_id
  and q.dealer_id is null
  and u.dealer_id is not null;

update public.orders o
set dealer_id = q.dealer_id
from public.quotes q
where o.quote_id = q.id
  and o.company_id = q.company_id
  and o.dealer_id is null
  and q.dealer_id is not null;

update public.orders o
set dealer_id = u.dealer_id
from public.app_users u
where o.created_by = u.id
  and o.company_id = u.company_id
  and o.dealer_id is null
  and u.dealer_id is not null;
