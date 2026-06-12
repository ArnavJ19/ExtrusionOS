-- Security hardening for SECURITY DEFINER functions

create schema if not exists private;

-- Move RPC functions to private schema and expose invoker wrappers.
alter function public.allocate_billet_to_order(uuid, uuid) set schema private;
alter function private.allocate_billet_to_order(uuid, uuid) security definer;
alter function private.allocate_billet_to_order(uuid, uuid) set search_path = public;
revoke execute on function private.allocate_billet_to_order(uuid, uuid) from PUBLIC, anon;
grant execute on function private.allocate_billet_to_order(uuid, uuid) to authenticated;

create or replace function public.allocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.allocate_billet_to_order(p_billet_id, p_order_id);
$$;

revoke execute on function public.allocate_billet_to_order(uuid, uuid) from PUBLIC, anon;
grant execute on function public.allocate_billet_to_order(uuid, uuid) to authenticated;

alter function public.reallocate_billet_to_order(uuid, uuid) set schema private;
alter function private.reallocate_billet_to_order(uuid, uuid) security definer;
alter function private.reallocate_billet_to_order(uuid, uuid) set search_path = public;
revoke execute on function private.reallocate_billet_to_order(uuid, uuid) from PUBLIC, anon;
grant execute on function private.reallocate_billet_to_order(uuid, uuid) to authenticated;

create or replace function public.reallocate_billet_to_order(p_billet_id uuid, p_order_id uuid)
returns uuid
language sql
security invoker
set search_path = public, private
as $$
  select private.reallocate_billet_to_order(p_billet_id, p_order_id);
$$;

revoke execute on function public.reallocate_billet_to_order(uuid, uuid) from PUBLIC, anon;
grant execute on function public.reallocate_billet_to_order(uuid, uuid) to authenticated;

-- Restrict SECURITY DEFINER helper/trigger functions from direct execution.
revoke execute on function public.allocate_billets_by_priority(uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.apply_expense_approval_policy() from PUBLIC, anon, authenticated;
revoke execute on function public.apply_packaging_material_stock() from PUBLIC, anon, authenticated;
revoke execute on function public.apply_packaging_material_stock_from_materials() from PUBLIC, anon, authenticated;
revoke execute on function public.ensure_inventory_item_for_expense_source(uuid, text, text, text, text) from PUBLIC, anon, authenticated;
revoke execute on function public.expense_apply_totals() from PUBLIC, anon, authenticated;
revoke execute on function public.expense_generate_number() from PUBLIC, anon, authenticated;
revoke execute on function public.handle_available_billet_allocation() from PUBLIC, anon, authenticated;
revoke execute on function public.handle_order_billet_requirements() from PUBLIC, anon, authenticated;
revoke execute on function public.handle_packaging_job_status_change() from PUBLIC, anon, authenticated;
revoke execute on function public.link_billets_to_production_job() from PUBLIC, anon, authenticated;
revoke execute on function public.log_expense_audit() from PUBLIC, anon, authenticated;
revoke execute on function public.log_expense_payment_audit() from PUBLIC, anon, authenticated;
revoke execute on function public.log_production_efficiency_change() from PUBLIC, anon, authenticated;
revoke execute on function public.notify_billet_allocation(uuid, text, text, text, uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.prevent_direct_edit_approved_expense() from PUBLIC, anon, authenticated;
revoke execute on function public.rebuild_order_billet_requirements(uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.refresh_foundry_batch_calculations() from PUBLIC, anon, authenticated;
revoke execute on function public.refresh_order_billet_allocations(uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.refresh_production_billet_requirement() from PUBLIC, anon, authenticated;
revoke execute on function public.repair_order_billet_requirement_links(uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.set_order_production_pieces_from_quote() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_breakdown_expense() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_energy_reading_expense() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_expense_link_for_sources() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_expense_payment_totals() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_external_source_inventory_and_expense() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_foundry_billets() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_foundry_external_source_usage() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_foundry_scrap_usage() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_outsourced_billet_expense() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_outsourced_billets() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_packaging_purchase_inventory_and_expense() from PUBLIC, anon, authenticated;
revoke execute on function public.sync_scrap_inventory_and_expense() from PUBLIC, anon, authenticated;
revoke execute on function public.upsert_source_expense(uuid, text, text, text, uuid, text, text, text, uuid, text, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, text, date, date, uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.validate_production_job_die() from PUBLIC, anon, authenticated;
