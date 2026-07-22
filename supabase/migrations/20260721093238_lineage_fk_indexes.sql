create index if not exists invoice_items_quote_item_fk_idx
  on public.invoice_items(quote_item_id);
create index if not exists dealer_fulfillments_order_item_fk_idx
  on public.order_dealer_stock_fulfillments(order_item_id);
create index if not exists dealer_fulfillments_quote_item_fk_idx
  on public.order_dealer_stock_fulfillments(quote_item_id);
create index if not exists order_items_quote_item_fk_idx
  on public.order_items(quote_item_id);
create index if not exists orders_created_by_dealership_fk_idx
  on public.orders(created_by_dealership_id);
create index if not exists orders_created_by_user_fk_idx
  on public.orders(created_by_user_id);
create index if not exists packing_items_order_item_fk_idx
  on public.packing_list_items(order_item_id);
create index if not exists packing_items_stock_batch_fk_idx
  on public.packing_list_items(profile_stock_batch_id);
create index if not exists packing_items_quote_item_fk_idx
  on public.packing_list_items(quote_item_id);
create index if not exists packing_items_reservation_fk_idx
  on public.packing_list_items(reservation_id);
