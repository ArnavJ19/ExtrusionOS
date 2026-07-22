-- Extend role-aware RLS to legacy enterprise modules whose route permissions
-- already define an unambiguous owning team.

-- CRM: sales users manage pipeline records; destructive actions remain admin-only.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['leads', 'opportunities', 'sales_activities']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_isolation', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_sales_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_sales_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_sales_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);

    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales''))',
      table_name || '_sales_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales''))',
      table_name || '_sales_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales''))',
      table_name || '_sales_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

drop policy if exists "sales_targets_tenant_isolation" on public.sales_targets;
drop policy if exists "sales_targets_sales_read" on public.sales_targets;
drop policy if exists "sales_targets_manager_insert" on public.sales_targets;
drop policy if exists "sales_targets_manager_update" on public.sales_targets;
drop policy if exists "sales_targets_admin_delete" on public.sales_targets;

create policy "sales_targets_sales_read" on public.sales_targets
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'sales')
  );
create policy "sales_targets_manager_insert" on public.sales_targets
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager')
  );
create policy "sales_targets_manager_update" on public.sales_targets
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager')
  ) with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager')
  );
create policy "sales_targets_admin_delete" on public.sales_targets
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin')
  );

-- AI quotation artifacts are restricted to the quotation-assistant roles.
drop policy if exists "Users can view AI interactions for their company" on public.ai_interactions;
drop policy if exists "Users can create AI interactions for their company" on public.ai_interactions;
drop policy if exists "ai_interactions_sales_read" on public.ai_interactions;
drop policy if exists "ai_interactions_sales_insert" on public.ai_interactions;
create policy "ai_interactions_sales_read" on public.ai_interactions
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'sales')
  );
create policy "ai_interactions_sales_insert" on public.ai_interactions
  for insert with check (
    company_id = public.get_current_user_company_id()
    and user_id = auth.uid()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'sales')
  );

drop policy if exists "Users can view quote suggestions for their company" on public.quote_suggestions;
drop policy if exists "Users can manage quote suggestions for their company" on public.quote_suggestions;
drop policy if exists "quote_suggestions_sales_read" on public.quote_suggestions;
drop policy if exists "quote_suggestions_sales_insert" on public.quote_suggestions;
drop policy if exists "quote_suggestions_sales_update" on public.quote_suggestions;
drop policy if exists "quote_suggestions_admin_delete" on public.quote_suggestions;
create policy "quote_suggestions_sales_read" on public.quote_suggestions
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'sales')
  );
create policy "quote_suggestions_sales_insert" on public.quote_suggestions
  for insert with check (
    company_id = public.get_current_user_company_id()
    and suggested_by = auth.uid()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'sales')
  );
create policy "quote_suggestions_sales_update" on public.quote_suggestions
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'sales')
  ) with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'sales')
  );
create policy "quote_suggestions_admin_delete" on public.quote_suggestions
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin')
  );

-- Barcode management and scan-event capture follow their protected routes.
drop policy if exists "Users can view qr_codes for their company" on public.qr_codes;
drop policy if exists "Users can manage qr_codes for their company" on public.qr_codes;
drop policy if exists "qr_codes_operations_read" on public.qr_codes;
drop policy if exists "qr_codes_manager_insert" on public.qr_codes;
drop policy if exists "qr_codes_operations_update" on public.qr_codes;
drop policy if exists "qr_codes_admin_delete" on public.qr_codes;
create policy "qr_codes_operations_read" on public.qr_codes
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in (
      'owner', 'admin', 'production_manager', 'production',
      'dispatch_manager', 'dispatch'
    )
  );
create policy "qr_codes_manager_insert" on public.qr_codes
  for insert with check (
    company_id = public.get_current_user_company_id()
    and created_by = auth.uid()
    and public.get_current_user_role() in ('owner', 'admin', 'production_manager', 'dispatch_manager')
  );
create policy "qr_codes_operations_update" on public.qr_codes
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in (
      'owner', 'admin', 'production_manager', 'production',
      'dispatch_manager', 'dispatch'
    )
  ) with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in (
      'owner', 'admin', 'production_manager', 'production',
      'dispatch_manager', 'dispatch'
    )
  );
create policy "qr_codes_admin_delete" on public.qr_codes
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin')
  );

drop policy if exists "Users can view scan_events for their company" on public.scan_events;
drop policy if exists "Users can insert scan_events for their company" on public.scan_events;
drop policy if exists "scan_events_operations_read" on public.scan_events;
drop policy if exists "scan_events_actor_insert" on public.scan_events;
create policy "scan_events_operations_read" on public.scan_events
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in (
      'owner', 'admin', 'production_manager', 'production',
      'dispatch_manager', 'dispatch'
    )
  );
create policy "scan_events_actor_insert" on public.scan_events
  for insert with check (
    company_id = public.get_current_user_company_id()
    and scanned_by = auth.uid()
    and public.get_current_user_role() in (
      'owner', 'admin', 'production_manager', 'production',
      'dispatch_manager', 'dispatch'
    )
  );

-- Tenders: the tender route is owner/admin/sales-manager only.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['tenders', 'tender_documents', 'tender_checklist_items']
  loop
    execute format('drop policy if exists %I on public.%I', case when table_name = 'tender_checklist_items' then 'tender_checklist_tenant_isolation' else table_name || '_tenant_isolation' end, table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_team_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_team_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_team_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);

    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager''))',
      table_name || '_team_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager''))',
      table_name || '_team_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager''))',
      table_name || '_team_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

-- Export records are owned by sales management and dispatch management.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['export_orders', 'export_documents']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_isolation', table_name);
    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''dispatch_manager''))',
      table_name || '_team_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''dispatch_manager''))',
      table_name || '_team_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''dispatch_manager'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''dispatch_manager''))',
      table_name || '_team_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

-- Saved-report visibility is enforced in PostgreSQL. Legacy private reports
-- with no creator remain visible only to administrators because ownership
-- cannot be reconstructed safely.
drop policy if exists "saved_reports_tenant_isolation" on public.saved_reports;
drop policy if exists "saved_reports_role_read" on public.saved_reports;
drop policy if exists "saved_reports_creator_insert" on public.saved_reports;
drop policy if exists "saved_reports_creator_update" on public.saved_reports;
drop policy if exists "saved_reports_creator_delete" on public.saved_reports;

create policy "saved_reports_role_read" on public.saved_reports
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'accounts')
    and (
      visibility = 'company'
      or (visibility = 'private' and (created_by = auth.uid() or public.get_current_user_role() in ('owner', 'admin')))
      or (visibility = 'owner_only' and public.get_current_user_role() in ('owner', 'admin'))
    )
  );

create policy "saved_reports_creator_insert" on public.saved_reports
  for insert with check (
    company_id = public.get_current_user_company_id()
    and created_by = auth.uid()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'accounts')
    and (visibility <> 'owner_only' or public.get_current_user_role() in ('owner', 'admin'))
  );

create policy "saved_reports_creator_update" on public.saved_reports
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'accounts')
    and (created_by = auth.uid() or public.get_current_user_role() in ('owner', 'admin'))
  ) with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'accounts')
    and (created_by = auth.uid() or public.get_current_user_role() in ('owner', 'admin'))
    and (visibility <> 'owner_only' or public.get_current_user_role() in ('owner', 'admin'))
  );

create policy "saved_reports_creator_delete" on public.saved_reports
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager', 'accounts')
    and (created_by = auth.uid() or public.get_current_user_role() in ('owner', 'admin'))
  );

-- Automation definitions are configuration; run history is append-only.
drop policy if exists "automation_rules_tenant_isolation" on public.automation_rules;
drop policy if exists "automation_rules_admin_read" on public.automation_rules;
drop policy if exists "automation_rules_admin_insert" on public.automation_rules;
drop policy if exists "automation_rules_admin_update" on public.automation_rules;
drop policy if exists "automation_rules_admin_delete" on public.automation_rules;

create policy "automation_rules_admin_read" on public.automation_rules
  for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));
create policy "automation_rules_admin_insert" on public.automation_rules
  for insert with check (company_id = public.get_current_user_company_id() and created_by = auth.uid() and public.get_current_user_role() in ('owner', 'admin'));
create policy "automation_rules_admin_update" on public.automation_rules
  for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'))
  with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));
create policy "automation_rules_admin_delete" on public.automation_rules
  for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));

drop policy if exists "automation_runs_tenant_isolation" on public.automation_runs;
drop policy if exists "automation_runs_admin_read" on public.automation_runs;
drop policy if exists "automation_runs_admin_insert" on public.automation_runs;

create policy "automation_runs_admin_read" on public.automation_runs
  for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));
create policy "automation_runs_admin_insert" on public.automation_runs
  for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));

-- Data retention and export settings are company administration controls.
drop policy if exists "data_retention_settings_tenant_isolation" on public.data_retention_settings;
drop policy if exists "data_retention_settings_admin_read" on public.data_retention_settings;
drop policy if exists "data_retention_settings_admin_insert" on public.data_retention_settings;
drop policy if exists "data_retention_settings_admin_update" on public.data_retention_settings;
drop policy if exists "data_retention_settings_owner_delete" on public.data_retention_settings;

create policy "data_retention_settings_admin_read" on public.data_retention_settings
  for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));
create policy "data_retention_settings_admin_insert" on public.data_retention_settings
  for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));
create policy "data_retention_settings_admin_update" on public.data_retention_settings
  for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'))
  with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in ('owner', 'admin'));
create policy "data_retention_settings_owner_delete" on public.data_retention_settings
  for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() = 'owner');

-- Systems configurator access mirrors its navigation and server-action roles.
drop policy if exists "Users can view system configs for their company" on public.system_configurations;
drop policy if exists "Users can manage system configs for their company" on public.system_configurations;
drop policy if exists "system_configurations_role_read" on public.system_configurations;
drop policy if exists "system_configurations_manager_insert" on public.system_configurations;
drop policy if exists "system_configurations_manager_update" on public.system_configurations;
drop policy if exists "system_configurations_admin_delete" on public.system_configurations;

create policy "system_configurations_role_read" on public.system_configurations
  for select using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in (
      'owner', 'admin', 'sales_manager', 'sales',
      'production_manager', 'production', 'viewer'
    )
  );
create policy "system_configurations_manager_insert" on public.system_configurations
  for insert with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager')
  );
create policy "system_configurations_manager_update" on public.system_configurations
  for update using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager')
  ) with check (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin', 'sales_manager')
  );
create policy "system_configurations_admin_delete" on public.system_configurations
  for delete using (
    company_id = public.get_current_user_company_id()
    and public.get_current_user_role() in ('owner', 'admin')
  );

-- Technical drawing and review modules.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'technical_drawings', 'drawing_reviews', 'technical_queries',
    'document_versions', 'document_packs', 'document_pack_items'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_isolation', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_technical_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_technical_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_technical_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);

    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''production_manager'',''quality''))',
      table_name || '_technical_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''production_manager'',''quality''))',
      table_name || '_technical_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''production_manager'',''quality'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''production_manager'',''quality''))',
      table_name || '_technical_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

-- Die lifecycle records are visible wherever die details are visible, but only
-- production management and quality may mutate them.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['die_trials', 'die_corrections', 'die_health_metrics']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_isolation', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_internal_read', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_lifecycle_insert', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_lifecycle_update', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_admin_delete', table_name);

    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''sales_manager'',''sales'',''production_manager'',''production'',''accounts'',''quality'',''viewer''))',
      table_name || '_internal_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''production_manager'',''quality''))',
      table_name || '_lifecycle_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''production_manager'',''quality'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''production_manager'',''quality''))',
      table_name || '_lifecycle_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

-- Compliance center and profitability center follow their route role matrices.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['compliance_standards', 'product_standard_mappings', 'calibration_records', 'compliance_audit_records']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_isolation', table_name);
    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''quality''))',
      table_name || '_quality_read', table_name
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
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;

  foreach table_name in array array['order_cost_breakdown', 'profitability_alerts']
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_tenant_isolation', table_name);
    execute format(
      'create policy %I on public.%I for select using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''accounts''))',
      table_name || '_finance_read', table_name
    );
    execute format(
      'create policy %I on public.%I for insert with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''accounts''))',
      table_name || '_finance_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''accounts'')) with check (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin'',''accounts''))',
      table_name || '_finance_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete using (company_id = public.get_current_user_company_id() and public.get_current_user_role() in (''owner'',''admin''))',
      table_name || '_admin_delete', table_name
    );
  end loop;
end $$;

-- Authenticated users can record only their own successful login/logout events.
-- The company is derived in the database and is never accepted from the caller.
create or replace function public.record_current_login_event(p_event_type text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_company_id uuid;
begin
  if actor_id is null or auth.role() <> 'authenticated' then
    raise exception 'Authentication required';
  end if;

  if p_event_type not in ('login_success', 'logout', 'password_reset') then
    raise exception 'Unsupported login event type';
  end if;

  select company_id into actor_company_id
  from public.app_users
  where id = actor_id and is_active = true;

  if actor_company_id is null then
    return;
  end if;

  insert into public.login_events (company_id, user_id, event_type)
  values (actor_company_id, actor_id, p_event_type);
end;
$$;

revoke all on function public.record_current_login_event(text) from public;
revoke all on function public.record_current_login_event(text) from anon;
grant execute on function public.record_current_login_event(text) to authenticated;

-- Database-owned audit triggers capture high-impact actions regardless of
-- which UI or API path initiated them. The actor and company are derived from
-- the authenticated database session.
create or replace function public.log_sensitive_delete_action()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor_company_id uuid := public.get_current_user_company_id();
  row_company_id uuid;
  row_id text;
begin
  if tg_op = 'DELETE' then
    row_company_id := (to_jsonb(old)->>'company_id')::uuid;
    row_id := to_jsonb(old)->>'id';
  else
    if (to_jsonb(old)->>'deleted_at') is not null or (to_jsonb(new)->>'deleted_at') is null then
      return new;
    end if;
    row_company_id := (to_jsonb(new)->>'company_id')::uuid;
    row_id := to_jsonb(new)->>'id';
  end if;

  if actor_id is null or actor_company_id is null or row_company_id is distinct from actor_company_id then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  insert into public.sensitive_action_logs (
    company_id, user_id, action_type, entity_type, entity_id, description
  ) values (
    row_company_id, actor_id, tg_argv[0], tg_table_name, row_id,
    case when tg_op = 'DELETE' then 'Record permanently deleted' else 'Record soft-deleted' end
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.log_sensitive_delete_action() from public;
revoke all on function public.log_sensitive_delete_action() from anon, authenticated;

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('customers', 'delete_customer'),
      ('aluminium_profiles', 'delete_profile'),
      ('dies', 'delete_die'),
      ('quotes', 'delete_quote'),
      ('orders', 'delete_order'),
      ('invoices', 'delete_invoice')
    ) as actions(table_name, action_type)
  loop
    execute format('drop trigger if exists %I on public.%I', 'audit_' || target.table_name || '_delete', target.table_name);
    execute format(
      'create trigger %I after delete on public.%I for each row execute function public.log_sensitive_delete_action(%L)',
      'audit_' || target.table_name || '_delete', target.table_name, target.action_type
    );
    execute format('drop trigger if exists %I on public.%I', 'audit_' || target.table_name || '_soft_delete', target.table_name);
    execute format(
      'create trigger %I after update of deleted_at on public.%I for each row execute function public.log_sensitive_delete_action(%L)',
      'audit_' || target.table_name || '_soft_delete', target.table_name, target.action_type
    );
  end loop;
end $$;

create or replace function public.log_company_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is not null
    and new.company_id = public.get_current_user_company_id()
    and to_jsonb(old) is distinct from to_jsonb(new)
  then
    insert into public.sensitive_action_logs (
      company_id, user_id, action_type, entity_type, entity_id, description
    ) values (
      new.company_id, actor_id, 'change_company_settings', 'company_settings', new.id::text,
      'Company settings changed'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.log_company_settings_change() from public;
revoke all on function public.log_company_settings_change() from anon, authenticated;
drop trigger if exists audit_company_settings_change on public.company_settings;
create trigger audit_company_settings_change
  after update on public.company_settings
  for each row execute function public.log_company_settings_change();

create or replace function public.log_user_access_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null
    or new.company_id is null
    or new.company_id is distinct from public.get_current_user_company_id()
  then
    return new;
  end if;

  if old.role is distinct from new.role then
    insert into public.sensitive_action_logs (
      company_id, user_id, action_type, entity_type, entity_id, description
    ) values (
      new.company_id, actor_id, 'change_user_role', 'app_users', new.id::text,
      format('User role changed from %s to %s', old.role, new.role)
    );
  end if;

  if old.is_active and not new.is_active then
    insert into public.sensitive_action_logs (
      company_id, user_id, action_type, entity_type, entity_id, description
    ) values (
      new.company_id, actor_id, 'disable_user', 'app_users', new.id::text,
      'User access disabled'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_user_access_change() from public;
revoke all on function public.log_user_access_change() from anon, authenticated;
drop trigger if exists audit_user_access_change on public.app_users;
create trigger audit_user_access_change
  after update of role, is_active on public.app_users
  for each row execute function public.log_user_access_change();
