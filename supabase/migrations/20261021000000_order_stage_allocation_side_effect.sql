-- EXOS-AUD-009: an order-stage change must not be vetoed by the billet allocator's
-- caller-role guard. Delivery updates by dispatch, dispatch_manager and
-- inventory_manager users (and quote conversion by sales) fire this trigger, and
-- the allocator rejected them with "Permission denied to allocate billets",
-- rolling back the business transaction.
--
-- Requirements are still rebuilt for every caller. Automatic allocation now runs
-- only for system contexts and the factory roles that the allocator itself
-- authorizes; for any other caller it is deferred to the next factory or
-- foundry event (billet cast, factory order update, manual allocation). This
-- extends the existing direct-order rule to every order instead of raising.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.handle_order_billet_requirements()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform public.rebuild_order_billet_requirements(new.id);
  -- Factory roles retain billet allocation; other roles defer it instead of failing.
  if auth.uid() is null
    or private.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production') then
    perform public.allocate_billets_by_priority(new.company_id);
  end if;
  return new;
end;
$$;

revoke all on function public.handle_order_billet_requirements() from public, anon, authenticated;
commit;
