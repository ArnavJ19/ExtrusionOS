-- Dealer ownership for quotes/orders and strict dealer data isolation.

alter table public.quotes add column if not exists dealer_id uuid references public.dealers(id) on delete set null;
alter table public.orders add column if not exists dealer_id uuid references public.dealers(id) on delete set null;

create index if not exists quotes_company_dealer_idx on public.quotes(company_id, dealer_id, quote_date desc);
create index if not exists orders_company_dealer_idx on public.orders(company_id, dealer_id, order_date desc);

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

drop policy if exists "quotes tenant read" on public.quotes;
create policy "quotes tenant read" on public.quotes for select using (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
);

drop policy if exists "quotes tenant insert" on public.quotes;
create policy "quotes tenant insert" on public.quotes for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff')
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
);

drop policy if exists "quotes tenant update" on public.quotes;
create policy "quotes tenant update" on public.quotes for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff')
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
) with check (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
);

drop policy if exists "orders tenant read" on public.orders;
create policy "orders tenant read" on public.orders for select using (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
);

drop policy if exists "orders tenant insert" on public.orders;
create policy "orders tenant insert" on public.orders for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff')
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
);

drop policy if exists "orders tenant update" on public.orders;
create policy "orders tenant update" on public.orders for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff','production_manager','production','dispatch_manager','dispatch')
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
) with check (
  company_id = public.get_current_user_company_id()
  and (
    public.get_current_user_dealer_id() is null
    or dealer_id = public.get_current_user_dealer_id()
  )
);

drop policy if exists "quote items tenant all read" on public.quote_items;
create policy "quote items tenant all read" on public.quote_items for select using (
  company_id = public.get_current_user_company_id()
  and exists (
    select 1 from public.quotes q
    where q.id = quote_items.quote_id
      and q.company_id = quote_items.company_id
      and (public.get_current_user_dealer_id() is null or q.dealer_id = public.get_current_user_dealer_id())
  )
);

drop policy if exists "quote items tenant insert" on public.quote_items;
create policy "quote items tenant insert" on public.quote_items for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff')
  and exists (
    select 1 from public.quotes q
    where q.id = quote_items.quote_id
      and q.company_id = quote_items.company_id
      and (public.get_current_user_dealer_id() is null or q.dealer_id = public.get_current_user_dealer_id())
  )
);

drop policy if exists "quote items tenant update" on public.quote_items;
create policy "quote items tenant update" on public.quote_items for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_role() in ('owner','admin','sales_manager','sales','dealer_admin','dealer_staff')
  and exists (
    select 1 from public.quotes q
    where q.id = quote_items.quote_id
      and q.company_id = quote_items.company_id
      and (public.get_current_user_dealer_id() is null or q.dealer_id = public.get_current_user_dealer_id())
  )
) with check (company_id = public.get_current_user_company_id());

drop policy if exists "history tenant read" on public.order_stage_history;
create policy "history tenant read" on public.order_stage_history for select using (
  company_id = public.get_current_user_company_id()
  and exists (
    select 1 from public.orders o
    where o.id = order_stage_history.order_id
      and o.company_id = order_stage_history.company_id
      and (public.get_current_user_dealer_id() is null or o.dealer_id = public.get_current_user_dealer_id())
  )
);
