-- ============================================================
-- ExtrusionOS Pro – MASTER SEED RUNNER
-- ============================================================
-- Run each file in order in the Supabase SQL Editor:
--
--   1. supabase/seed/01_company_and_settings.sql
--   2. supabase/seed/02_customers.sql
--   3. supabase/seed/03_profiles_dies_machines.sql
--   4. supabase/seed/04_quotes_orders_dispatches.sql
--   5. supabase/seed/05_inventory_production_quality.sql
--
-- ============================================================
-- DATA SUMMARY:
-- ============================================================
--   Company:              1 (uses your existing signup)
--   Company Settings:     1
--   Customers:            1,000
--   Aluminium Profiles:   120
--   Dies:                 400
--   Machines:             8
--   Vendors:              20
--   Quotes:               70 (with ~200 line items)
--   Orders:               150
--   Dispatches:           10
--   Inventory Items:      300
--   Production Jobs:      80
--   Quality Inspections:  50
--   Invoices:             40
--   Payments:             ~10
--   Billet Batches:       30
--   Scrap Records:        60
-- ============================================================
--
-- IMPORTANT:
-- - You must have signed up at least once (companies + app_users must have 1 row)
-- - Run files in order (foreign keys depend on prior inserts)
-- - Safe to re-run: will create duplicates, so run on a fresh DB or truncate first
--
-- TO RESET (run before re-seeding):
/*
  do $$ declare v_cid uuid;
  begin
    select id into v_cid from public.companies limit 1;
    delete from public.scrap_records where company_id = v_cid;
    delete from public.finishing_jobs where company_id = v_cid;
    delete from public.quality_inspections where company_id = v_cid;
    delete from public.production_jobs where company_id = v_cid;
    delete from public.packing_list_items where company_id = v_cid;
    delete from public.payments where company_id in (select company_id from public.invoices where company_id = v_cid);
    delete from public.invoices where company_id = v_cid;
    delete from public.inventory_movements where company_id = v_cid;
    delete from public.inventory_items where company_id = v_cid;
    delete from public.billet_batches where company_id = v_cid;
    delete from public.profile_stock_batches where company_id = v_cid;
    delete from public.order_stage_history where company_id = v_cid;
    delete from public.dispatches where company_id = v_cid;
    delete from public.orders where company_id = v_cid;
    delete from public.quote_items where company_id = v_cid;
    delete from public.quote_revisions where company_id = v_cid;
    delete from public.quotes where company_id = v_cid;
    delete from public.dies where company_id = v_cid;
    delete from public.aluminium_profiles where company_id = v_cid;
    delete from public.machines where company_id = v_cid;
    delete from public.vendors where company_id = v_cid;
    delete from public.customers where company_id = v_cid;
    raise notice 'All seed data cleared for company %', v_cid;
  end $$;
*/
