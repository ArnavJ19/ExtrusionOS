-- Conservative role hardening for mixed-workflow legacy tables.

-- Mobile checklists: operational roles may read; checklist administration and
-- recorded responses are managed by owner/admin/quality as the approved matrix.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['checklist_templates', 'checklist_responses']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_isolation', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_internal_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_quality_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_quality_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_quality_delete', table_name);

    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''factory_manager'',''production_manager'',''production'',''dispatch_manager'',''dispatch'',''quality''))',
      table_name || '_internal_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''quality''))',
      table_name || '_quality_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''quality'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''quality''))',
      table_name || '_quality_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''quality''))',
      table_name || '_quality_delete', table_name
    );
  end loop;
end $$;

-- PCDA catalogs are shared reference data. All internal roles may read them,
-- while only owner/admin may alter the company-wide definitions.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pcda_master_alloy_standards', 'pcda_master_alloys', 'pcda_master_tempers',
    'pcda_master_uoms', 'pcda_master_packing_modes', 'pcda_master_qty_methods',
    'pcda_master_profile_categories', 'pcda_master_die_types',
    'pcda_master_finish_types', 'pcda_master_surface_treatments',
    'pcda_master_defect_types', 'pcda_master_quality_parameters',
    'pcda_master_cost_components', 'pcda_master_document_types',
    'pcda_master_compliance_types', 'pcda_master_machine_types',
    'pcda_master_production_stages'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_modify', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_internal_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);

    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales'',''factory_manager'',''production_manager'',''production'',''inventory_manager'',''dispatch_manager'',''dispatch'',''accounts'',''quality'',''viewer''))',
      table_name || '_internal_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

-- Invoice line writes normally use the atomic SECURITY DEFINER invoice RPC.
-- Direct access is therefore limited to finance administrators.
drop policy if exists invoice_items_select on public.invoice_items;
drop policy if exists invoice_items_modify on public.invoice_items;
drop policy if exists invoice_items_internal_read on public.invoice_items;
drop policy if exists invoice_items_finance_insert on public.invoice_items;
drop policy if exists invoice_items_finance_update on public.invoice_items;
drop policy if exists invoice_items_finance_delete on public.invoice_items;

create policy invoice_items_internal_read on public.invoice_items
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in (
      'owner', 'admin', 'sales_manager', 'sales', 'factory_manager',
      'production_manager', 'production', 'inventory_manager',
      'dispatch_manager', 'dispatch', 'accounts', 'quality', 'viewer'
    )
  );
create policy invoice_items_finance_insert on public.invoice_items
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );
create policy invoice_items_finance_update on public.invoice_items
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  ) with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );
create policy invoice_items_finance_delete on public.invoice_items
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'accounts')
  );

-- Customer compliance requirements bridge sales and quality workflows.
drop policy if exists "customer_compliance_requirements_select" on public.customer_compliance_requirements;
drop policy if exists "customer_compliance_requirements_modify" on public.customer_compliance_requirements;
drop policy if exists "customer_compliance_requirements_internal_read" on public.customer_compliance_requirements;
drop policy if exists "customer_compliance_requirements_team_insert" on public.customer_compliance_requirements;
drop policy if exists "customer_compliance_requirements_team_update" on public.customer_compliance_requirements;
drop policy if exists "customer_compliance_requirements_team_delete" on public.customer_compliance_requirements;

create policy "customer_compliance_requirements_internal_read" on public.customer_compliance_requirements
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in (
      'owner', 'admin', 'sales_manager', 'sales', 'production_manager',
      'production', 'accounts', 'quality', 'viewer'
    )
  );
create policy "customer_compliance_requirements_team_insert" on public.customer_compliance_requirements
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'quality')
  );
create policy "customer_compliance_requirements_team_update" on public.customer_compliance_requirements
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'quality')
  ) with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'quality')
  );
create policy "customer_compliance_requirements_team_delete" on public.customer_compliance_requirements
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'quality')
  );

-- Resolve portal ownership without a recursive portal_users RLS subquery.
create or replace function public.current_portal_user_owns(
  p_company_id uuid,
  p_customer_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.portal_users
    where id = auth.uid()
      and is_active = true
      and company_id = p_company_id
      and customer_id = p_customer_id
  );
$$;

revoke all on function public.current_portal_user_owns(uuid, uuid) from public;
revoke all on function public.current_portal_user_owns(uuid, uuid) from anon;
grant execute on function public.current_portal_user_owns(uuid, uuid) to authenticated;

-- Internal support access and customer-portal access remain separate policies.
do $$
declare
  table_name text;
  portal_read_policy text;
  portal_insert_policy text;
begin
  foreach table_name in array array['quote_requests', 'support_tickets']
  loop
    portal_read_policy := case when table_name = 'quote_requests'
      then 'Portal users can view org quote requests' else 'Portal users can view org tickets' end;
    portal_insert_policy := case when table_name = 'quote_requests'
      then 'Portal users can create quote requests' else 'Portal users can create tickets' end;

    execute format('drop policy if exists %I on public.%I', case when table_name = 'quote_requests' then 'Internal users can view quote requests' else 'Internal users can view tickets' end, table_name);
    execute format('drop policy if exists %I on public.%I', case when table_name = 'quote_requests' then 'Internal users can manage quote requests' else 'Internal users can manage tickets' end, table_name);
    execute format('drop policy if exists %I on public.%I', portal_read_policy, table_name);
    execute format('drop policy if exists %I on public.%I', portal_insert_policy, table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_internal_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_internal_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_internal_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_portal_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_portal_insert', table_name);

    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales''))',
      table_name || '_internal_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales''))',
      table_name || '_internal_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales''))',
      table_name || '_internal_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
    execute format(
      'create policy %I on public.%I for select using (public.current_portal_user_owns(company_id, customer_id))',
      table_name || '_portal_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (portal_user_id = auth.uid() and public.current_portal_user_owns(company_id, customer_id))',
      table_name || '_portal_insert', table_name
    );
  end loop;
end $$;
