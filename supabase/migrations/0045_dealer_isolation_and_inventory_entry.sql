-- Enforce dealer isolation at RLS level and support quote-order linkage to native dealer orders.

alter table public.dealer_orders add column if not exists linked_order_id uuid references public.orders(id) on delete set null;
alter table public.dealer_orders add column if not exists quote_id uuid references public.quotes(id) on delete set null;

create unique index if not exists dealer_orders_company_linked_order_unique
  on public.dealer_orders(company_id, linked_order_id)
  where linked_order_id is not null;
create index if not exists dealer_orders_company_quote_idx on public.dealer_orders(company_id, quote_id);

drop policy if exists "dealer orders tenant read" on public.dealer_orders;
create policy "dealer orders tenant read" on public.dealer_orders for select using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('view_orders'))
  )
);

drop policy if exists "dealer orders tenant insert" on public.dealer_orders;
create policy "dealer orders tenant insert" on public.dealer_orders for insert with check (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('create_orders'))
  )
);

drop policy if exists "dealer orders tenant update" on public.dealer_orders;
create policy "dealer orders tenant update" on public.dealer_orders for update using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('edit_orders'))
  )
) with check (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('edit_orders'))
  )
);

drop policy if exists "dealer order items tenant read" on public.dealer_order_items;
create policy "dealer order items tenant read" on public.dealer_order_items for select using (
  exists (
    select 1 from public.dealer_orders o
    where o.id = dealer_order_items.dealer_order_id
      and o.company_id = public.get_current_user_company_id()
      and (
        (public.get_current_user_dealer_id() is not null and o.dealer_id = public.get_current_user_dealer_id())
        or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('view_orders'))
      )
  )
);

drop policy if exists "dealer order items tenant insert" on public.dealer_order_items;
create policy "dealer order items tenant insert" on public.dealer_order_items for insert with check (
  company_id = public.get_current_user_company_id()
  and exists (
    select 1 from public.dealer_orders o
    where o.id = dealer_order_items.dealer_order_id
      and o.company_id = dealer_order_items.company_id
      and (
        (public.get_current_user_dealer_id() is not null and o.dealer_id = public.get_current_user_dealer_id())
        or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('create_orders'))
      )
  )
);

drop policy if exists "inventory transactions tenant read" on public.inventory_transactions;
create policy "inventory transactions tenant read" on public.inventory_transactions for select using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and (to_owner_id = public.get_current_user_dealer_id() or from_owner_id = public.get_current_user_dealer_id()))
    or (public.get_current_user_dealer_id() is null and (public.current_user_has_permission('view_inventory') or public.current_user_has_permission('view_dealer_inventory')))
  )
);

drop policy if exists "shipments tenant read" on public.shipments;
create policy "shipments tenant read" on public.shipments for select using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and (public.current_user_has_permission('manage_shipments') or public.current_user_has_permission('view_dealer_inventory')))
  )
);

drop policy if exists "shipment items tenant read" on public.shipment_items;
create policy "shipment items tenant read" on public.shipment_items for select using (
  exists (
    select 1 from public.shipments s
    where s.id = shipment_items.shipment_id
      and s.company_id = public.get_current_user_company_id()
      and (
        (public.get_current_user_dealer_id() is not null and s.dealer_id = public.get_current_user_dealer_id())
        or (public.get_current_user_dealer_id() is null and (public.current_user_has_permission('manage_shipments') or public.current_user_has_permission('view_dealer_inventory')))
      )
  )
);

drop policy if exists "discrepancies tenant read" on public.inventory_discrepancies;
create policy "discrepancies tenant read" on public.inventory_discrepancies for select using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('view_dealer_inventory'))
  )
);

drop policy if exists "discrepancies tenant manage" on public.inventory_discrepancies;
create policy "discrepancies tenant manage" on public.inventory_discrepancies for all using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('approve_inventory_adjustments'))
  )
) with check (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.current_user_has_permission('approve_inventory_adjustments'))
  )
);

drop policy if exists "profile_stock_batches tenant read" on public.profile_stock_batches;
create policy "profile_stock_batches tenant read" on public.profile_stock_batches for select using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or public.get_current_user_dealer_id() is null
  )
);

drop policy if exists "profile_stock_batches tenant insert" on public.profile_stock_batches;
create policy "profile_stock_batches tenant insert" on public.profile_stock_batches for insert with check (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.get_current_user_role() in ('owner','admin','inventory_manager','production_manager'))
  )
);

drop policy if exists "profile_stock_batches tenant update" on public.profile_stock_batches;
create policy "profile_stock_batches tenant update" on public.profile_stock_batches for update using (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.get_current_user_role() in ('owner','admin','inventory_manager','production_manager'))
  )
) with check (
  company_id = public.get_current_user_company_id()
  and (
    (public.get_current_user_dealer_id() is not null and dealer_id = public.get_current_user_dealer_id())
    or (public.get_current_user_dealer_id() is null and public.get_current_user_role() in ('owner','admin','inventory_manager','production_manager'))
  )
);

drop policy if exists "inventory_items tenant read" on public.inventory_items;
create policy "inventory_items tenant read" on public.inventory_items for select using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
);

drop policy if exists "inventory_items tenant insert" on public.inventory_items;
create policy "inventory_items tenant insert" on public.inventory_items for insert with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.get_current_user_role() in ('owner','admin','inventory_manager','production_manager')
);

drop policy if exists "inventory_items tenant update" on public.inventory_items;
create policy "inventory_items tenant update" on public.inventory_items for update using (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.get_current_user_role() in ('owner','admin','inventory_manager','production_manager')
) with check (
  company_id = public.get_current_user_company_id()
  and public.get_current_user_dealer_id() is null
  and public.get_current_user_role() in ('owner','admin','inventory_manager','production_manager')
);
