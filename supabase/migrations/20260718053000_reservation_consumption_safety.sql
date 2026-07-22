begin;

-- Packing rows currently identify a production job or dealer-stock fulfillment,
-- not the exact reservation and stock batch physically consumed. Direct inserts
-- could therefore consume an unrelated reservation and make dispatched stock
-- available for sale again. Keep the ledger read-only until an atomic,
-- source-linked reservation-consumption RPC is introduced.
drop policy if exists "profile_stock_consumptions tenant insert"
  on public.profile_stock_consumptions;
drop policy if exists "profile_stock_consumptions tenant update"
  on public.profile_stock_consumptions;
drop policy if exists "profile_stock_consumptions tenant delete"
  on public.profile_stock_consumptions;

commit;
