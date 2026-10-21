-- EXOS-AUD-033: several write policies checked only the tenant, so any signed-in
-- user of the company (including viewer) could write, and on some tables a
-- tenant-only ALL policy silently overrode the role-restricted policies next to
-- it (permissive policies are OR-ed).
--
-- Role lists follow the application's permission matrix (lib/auth/permissions.ts)
-- so no screen that works today loses its write path:
--   production_jobs           insert: owner, admin, factory_manager, production_manager
--                             update: + production   (the app writes through definer RPCs)
--   company_settings          update: owner, admin   (the redundant tenant policy is dropped)
--   vendors                   insert/update: owner, admin, sales_manager, production_manager
--   documents                 insert/update: any company role except viewer
--   die_nitriding_history     write: owner, admin, sales_manager, production_manager; read: tenant
--   profile_defect_rules      write: owner, admin; read: tenant
--   billet_batches            insert/update: owner, admin, factory_manager, production_manager, production
--   order_dealer_stock_fulfillments: direct insert removed (written only by the
--                             definer RPC private.create_order_from_quote_with_dealer_stock)
--   pcda_master_*             the tenant-only ALL policy is replaced by a tenant
--                             SELECT policy; writes fall back to the existing
--                             owner/admin insert/update/delete policies.
-- Deliberately unchanged (reviewed): audit_logs / audit_logs_enterprise inserts
-- (actor stamped by EXOS-AUD-019), notifications, outbound_messages,
-- dealer_order_status_history (communication/history rows), inventory_movements
-- (closed by EXOS-AUD-022).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- production_jobs
drop policy if exists "production_jobs tenant insert" on public.production_jobs;
drop policy if exists "production_jobs tenant update" on public.production_jobs;
drop policy if exists "production_jobs role insert" on public.production_jobs;
drop policy if exists "production_jobs role update" on public.production_jobs;
create policy "production_jobs role insert" on public.production_jobs for insert
  with check (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager'));
create policy "production_jobs role update" on public.production_jobs for update
  using (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production'))
  with check (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production'));

-- company_settings: "settings update admin" (owner, admin) remains.
drop policy if exists "settings tenant update" on public.company_settings;

-- vendors
drop policy if exists "vendors tenant insert" on public.vendors;
drop policy if exists "vendors tenant update" on public.vendors;
drop policy if exists "vendors role insert" on public.vendors;
drop policy if exists "vendors role update" on public.vendors;
create policy "vendors role insert" on public.vendors for insert
  with check (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager'));
create policy "vendors role update" on public.vendors for update
  using (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager'))
  with check (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager'));

-- documents
drop policy if exists "documents tenant insert" on public.documents;
drop policy if exists "documents tenant update" on public.documents;
drop policy if exists "documents role insert" on public.documents;
drop policy if exists "documents role update" on public.documents;
create policy "documents role insert" on public.documents for insert
  with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() <> 'viewer');
create policy "documents role update" on public.documents for update
  using (company_id = public.get_current_user_company_id() and public.get_current_user_role() <> 'viewer')
  with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() <> 'viewer');

-- die_nitriding_history
drop policy if exists die_nitriding_tenant on public.die_nitriding_history;
drop policy if exists "die nitriding tenant read" on public.die_nitriding_history;
drop policy if exists "die nitriding role write" on public.die_nitriding_history;
create policy "die nitriding tenant read" on public.die_nitriding_history for select
  using (company_id = public.get_current_user_company_id());
create policy "die nitriding role write" on public.die_nitriding_history for all
  using (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager'))
  with check (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','sales_manager','production_manager'));

-- profile_defect_rules
drop policy if exists profile_defect_rules_tenant on public.profile_defect_rules;
drop policy if exists "profile defect rules tenant read" on public.profile_defect_rules;
drop policy if exists "profile defect rules admin write" on public.profile_defect_rules;
create policy "profile defect rules tenant read" on public.profile_defect_rules for select
  using (company_id = public.get_current_user_company_id());
create policy "profile defect rules admin write" on public.profile_defect_rules for all
  using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin'))
  with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner','admin'));

-- billet_batches (legacy register, read by the QR scanner)
drop policy if exists "billet_batches tenant insert" on public.billet_batches;
drop policy if exists "billet_batches tenant update" on public.billet_batches;
drop policy if exists "billet_batches role insert" on public.billet_batches;
drop policy if exists "billet_batches role update" on public.billet_batches;
create policy "billet_batches role insert" on public.billet_batches for insert
  with check (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production'));
create policy "billet_batches role update" on public.billet_batches for update
  using (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production'))
  with check (company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner','admin','factory_manager','production_manager','production'));

-- order_dealer_stock_fulfillments: definer-only writer.
drop policy if exists "order_dealer_stock_fulfillments tenant insert" on public.order_dealer_stock_fulfillments;
revoke insert, update, delete on public.order_dealer_stock_fulfillments from anon, authenticated;

-- pcda_master_*: keep tenant reads, remove the tenant-wide write override.
do $$
declare
  v record;
begin
  for v in
    select p.tablename, p.policyname from pg_policies p
    where p.schemaname = 'public' and p.tablename like 'pcda\_master\_%' and p.cmd = 'ALL'
      and coalesce(p.qual, '') !~ 'get_current_user_role' and coalesce(p.with_check, '') !~ 'get_current_user_role'
  loop
    execute format('drop policy %I on public.%I', v.policyname, v.tablename);
    execute format('drop policy if exists %I on public.%I', v.tablename || '_tenant_read', v.tablename);
    execute format('create policy %I on public.%I for select using (company_id = public.get_current_user_company_id())',
      v.tablename || '_tenant_read', v.tablename);
  end loop;
end $$;

commit;
