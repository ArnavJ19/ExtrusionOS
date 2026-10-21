-- EXOS-AUD-017: the low-level dispatch writer public.save_dispatch_atomic was
-- executable by every signed-in user and took a client-supplied p_order_stage,
-- so a pending dispatch with nothing shipped could set an order to 'delivered'.
--
-- The application writes dispatches only through public.save_ready_dispatch_atomic,
-- which calls the private writer with a null stage and lets
-- private.sync_order_delivery_stage derive the order stage. The public wrapper is
-- kept (no drop) but is no longer callable by client roles.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

revoke all on function public.save_dispatch_atomic(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function private.save_dispatch_atomic(uuid, jsonb, jsonb, text) from public, anon, authenticated;

commit;
