-- BUG (found via UAT): foundry scrap / external source / outsourced billet inserts errored
-- with "trigger functions can only be called as triggers". The dispatcher trigger function
-- public.sync_expense_link_for_sources() delegated by doing `return public.sync_x()` where
-- sync_x is itself a trigger function — which PL/pgSQL cannot call as a plain expression.
-- Every INSERT/UPDATE/DELETE on these three tables therefore failed, breaking scrap intake,
-- external aluminium purchase, and outsourced billet recording (and, downstream, the M4
-- process-scrap recovery loop that inserts into foundry_aluminium_scrap).
--
-- Fix: point each table's trigger directly at its own table-specific trigger function, which
-- runs with proper trigger context. The broken dispatcher is left in place but unused.

drop trigger if exists sync_expense_foundry_scrap on public.foundry_aluminium_scrap;
create trigger sync_expense_foundry_scrap
  after insert or update or delete on public.foundry_aluminium_scrap
  for each row execute function public.sync_scrap_inventory_and_expense();

drop trigger if exists sync_expense_foundry_external_sources on public.foundry_external_aluminium_sources;
create trigger sync_expense_foundry_external_sources
  after insert or update or delete on public.foundry_external_aluminium_sources
  for each row execute function public.sync_external_source_inventory_and_expense();

drop trigger if exists sync_expense_outsourced_billets on public.outsourced_billet_batches;
create trigger sync_expense_outsourced_billets
  after insert or update or delete on public.outsourced_billet_batches
  for each row execute function public.sync_outsourced_billet_expense();
