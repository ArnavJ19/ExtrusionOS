begin;

-- Explicit default grants survive REVOKE FROM PUBLIC on hosted Supabase.
-- These functions are trigger helpers, never client RPC endpoints.
revoke all on function public.validate_production_plan_slot_tenant() from public,anon,authenticated;
revoke all on function public.validate_profile_stock_batch_profile_company() from public,anon,authenticated;
alter function private.is_valid_delivery_transition(text,text) set search_path=pg_catalog;

commit;
