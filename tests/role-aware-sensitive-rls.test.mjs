import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260715010000_role_aware_sensitive_rls.sql"),
  "utf8"
);
const legacyMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260715011000_legacy_role_rls_observability.sql"),
  "utf8"
);
const documentStorageMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260715040000_documents_storage_role_rls.sql"),
  "utf8"
);
const mixedOwnershipMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260715041000_mixed_ownership_role_rls.sql"),
  "utf8"
);
const authForm = readFileSync(join(process.cwd(), "components/modules/auth-forms.tsx"), "utf8");
const logoutButton = readFileSync(join(process.cwd(), "components/layout/logout-button.tsx"), "utf8");
const reportBuilder = readFileSync(join(process.cwd(), "components/modules/report-builder-client.tsx"), "utf8");
const automationClient = readFileSync(join(process.cwd(), "components/modules/automation-client.tsx"), "utf8");

function policyBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(new RegExp(`create policy "${escaped}"[\\s\\S]*?;`, "i"));
  assert.ok(match, `Expected policy ${name}`);
  return match[0];
}

test("security logs are tenant-scoped, self-attributed, and append-only", () => {
  for (const table of ["login_events", "sensitive_action_logs"]) {
    assert.match(migration, new RegExp(`drop policy if exists "${table}_tenant_isolation" on public\\.${table}`));
    assert.match(policyBody(`${table}_admin_read`), /get_current_user_company_id\(\)[\s\S]*get_current_user_role\(\) in \('owner', 'admin'\)/);
    assert.match(policyBody(`${table}_self_insert`), /user_id = auth\.uid\(\)/);
    assert.doesNotMatch(migration, new RegExp(`create policy "${table}_(?:update|delete)`, "i"));
  }
});

test("entity revisions cannot be rewritten or deleted", () => {
  assert.match(policyBody("entity_revisions_internal_read"), /get_current_user_company_id\(\)/);
  assert.match(policyBody("entity_revisions_actor_insert"), /actor_id = auth\.uid\(\)/);
  assert.doesNotMatch(migration, /create policy "entity_revisions_(?:update|delete)/i);
});

test("technical artifacts use separate read, write, and administrative delete policies", () => {
  assert.match(policyBody("technical_documents_internal_read"), /for select[\s\S]*get_current_user_company_id\(\)/i);
  assert.match(policyBody("technical_documents_technical_insert"), /uploaded_by = auth\.uid\(\)/);
  assert.match(policyBody("technical_documents_technical_update"), /for update[\s\S]*with check/i);
  assert.match(policyBody("technical_documents_admin_delete"), /get_current_user_role\(\) in \('owner', 'admin'\)/);

  assert.match(policyBody("technical_reports_internal_read"), /for select[\s\S]*get_current_user_company_id\(\)/i);
  assert.match(policyBody("technical_reports_authorized_insert"), /generated_by = auth\.uid\(\)/);
  assert.match(policyBody("technical_reports_admin_delete"), /get_current_user_role\(\) in \('owner', 'admin'\)/);
});

test("integration configuration and sync logs are restricted to administrators", () => {
  for (const name of [
    "integrations_admin_read",
    "integrations_admin_insert",
    "integrations_admin_update",
    "sync_logs_admin_read",
    "sync_logs_admin_insert",
    "sync_logs_admin_update"
  ]) {
    const body = policyBody(name);
    assert.match(body, /get_current_user_company_id\(\)/);
    assert.match(body, /get_current_user_role\(\) in \('owner', 'admin'\)/);
  }
  assert.match(policyBody("integrations_owner_delete"), /get_current_user_role\(\) = 'owner'/);
  assert.doesNotMatch(migration, /create policy "sync_logs_delete/i);
});

test("maintenance and energy mutations mirror the protected route roles", () => {
  const tables = [
    "energy_readings",
    "energy_sources",
    "maintenance_schedules",
    "breakdown_logs",
    "maintenance_spare_parts",
    "breakdown_spare_part_usage"
  ];

  for (const table of tables) {
    assert.match(migration, new RegExp(`drop policy if exists "${table}_tenant_isolation" on public\\.${table}`));
    assert.match(policyBody(`${table}_operations_read`), /get_current_user_role\(\) in \('owner', 'admin', 'production_manager'\)/);
    assert.match(policyBody(`${table}_operations_insert`), /get_current_user_role\(\) in \('owner', 'admin', 'production_manager'\)/);
  }

  for (const table of tables.filter((table) => table !== "breakdown_spare_part_usage")) {
    assert.match(policyBody(`${table}_operations_update`), /with check[\s\S]*get_current_user_company_id\(\)/i);
  }
});

test("the hardening migration does not recreate broad FOR ALL tenant policies", () => {
  assert.doesNotMatch(migration, /create policy[\s\S]*?for all/i);
});

test("legacy CRM, tender, technical, compliance, and finance tables use role families", () => {
  assert.match(legacyMigration, /array\['leads', 'opportunities', 'sales_activities'\]/);
  assert.match(legacyMigration, /array\['tenders', 'tender_documents', 'tender_checklist_items'\]/);
  assert.match(legacyMigration, /'technical_drawings', 'drawing_reviews', 'technical_queries',[\s\S]*'document_versions', 'document_packs', 'document_pack_items'/);
  assert.match(legacyMigration, /array\['die_trials', 'die_corrections', 'die_health_metrics'\]/);
  assert.match(legacyMigration, /array\['compliance_standards', 'product_standard_mappings', 'calibration_records', 'compliance_audit_records'\]/);
  assert.match(legacyMigration, /array\['order_cost_breakdown', 'profitability_alerts'\]/);
  assert.match(legacyMigration, /array\['export_orders', 'export_documents'\]/);
  assert.doesNotMatch(legacyMigration, /create policy[\s\S]*?for all/i);
});

test("AI quotation, barcode, and scan policies enforce their route roles and actor identity", () => {
  assert.match(legacyMigration, /create policy "quote_suggestions_sales_insert"[\s\S]*suggested_by = auth\.uid\(\)/);
  assert.match(legacyMigration, /create policy "qr_codes_manager_insert"[\s\S]*created_by = auth\.uid\(\)/);
  assert.match(legacyMigration, /create policy "scan_events_actor_insert"[\s\S]*scanned_by = auth\.uid\(\)/);
  assert.match(legacyMigration, /create policy "qr_codes_operations_update"[\s\S]*'production'[\s\S]*'dispatch'/);
});

test("saved reports enforce creator ownership and visibility", () => {
  assert.match(legacyMigration, /create policy "saved_reports_role_read"[\s\S]*visibility = 'company'[\s\S]*visibility = 'private'[\s\S]*created_by = auth\.uid\(\)[\s\S]*visibility = 'owner_only'/);
  assert.match(legacyMigration, /create policy "saved_reports_creator_insert"[\s\S]*created_by = auth\.uid\(\)/);
  assert.match(reportBuilder, /created_by:\s*\(await supabase\.auth\.getUser\(\)\)\.data\.user\?\.id/);
});

test("automation runs are append-only and data retention is administrative", () => {
  assert.match(automationClient, /created_by:\s*\(await supabase\.auth\.getUser\(\)\)\.data\.user\?\.id/);
  assert.match(legacyMigration, /create policy "automation_runs_admin_read"/);
  assert.match(legacyMigration, /create policy "automation_runs_admin_insert"/);
  assert.doesNotMatch(legacyMigration, /create policy "automation_runs_(?:admin_)?(?:update|delete)"/i);
  assert.match(legacyMigration, /create policy "data_retention_settings_admin_update"[\s\S]*get_current_user_role\(\) in \('owner', 'admin'\)/);
});

test("systems configurator management is no longer granted to every tenant user", () => {
  assert.match(legacyMigration, /drop policy if exists "Users can manage system configs for their company"/);
  assert.match(legacyMigration, /create policy "system_configurations_role_read"[\s\S]*'production_manager'[\s\S]*'viewer'/);
  assert.match(legacyMigration, /create policy "system_configurations_manager_update"[\s\S]*get_current_user_role\(\) in \('owner', 'admin', 'sales_manager'\)/);
});

test("login observability derives tenant ownership inside a restricted RPC", () => {
  assert.match(legacyMigration, /function public\.record_current_login_event\(p_event_type text\)[\s\S]*actor_id uuid := auth\.uid\(\)[\s\S]*from public\.app_users[\s\S]*insert into public\.login_events/);
  assert.match(legacyMigration, /p_event_type not in \('login_success', 'logout', 'password_reset'\)/);
  assert.match(legacyMigration, /revoke all on function public\.record_current_login_event\(text\) from anon/);
  assert.match(legacyMigration, /grant execute on function public\.record_current_login_event\(text\) to authenticated/);
  assert.match(authForm, /record_current_login_event", \{ p_event_type: "login_success" \}/);
  assert.match(logoutButton, /record_current_login_event", \{ p_event_type: "logout" \}[\s\S]*auth\.signOut\(\)/);
});

test("sensitive action triggers derive actor and tenant and cannot be called as RPCs", () => {
  assert.match(legacyMigration, /function public\.log_sensitive_delete_action\(\)[\s\S]*actor_id uuid := auth\.uid\(\)[\s\S]*row_company_id is distinct from actor_company_id/);
  assert.match(legacyMigration, /'customers', 'delete_customer'/);
  assert.match(legacyMigration, /'quotes', 'delete_quote'/);
  assert.match(legacyMigration, /'invoices', 'delete_invoice'/);
  assert.match(legacyMigration, /create trigger audit_company_settings_change/);
  assert.match(legacyMigration, /create trigger audit_user_access_change/);
  assert.match(legacyMigration, /revoke all on function public\.log_sensitive_delete_action\(\) from anon, authenticated/);
});

test("technical document storage uses the same tenant and role boundary as metadata", () => {
  assert.match(documentStorageMigration, /create policy "technical documents storage read"[\s\S]*bucket_id = 'documents'[\s\S]*get_current_user_company_id\(\)[\s\S]*'viewer'/);
  assert.match(documentStorageMigration, /create policy "technical documents storage insert"[\s\S]*get_current_user_role\(\) in \([\s\S]*'production_manager'[\s\S]*'quality'/);
  assert.match(documentStorageMigration, /create policy "technical documents storage update"[\s\S]*for update[\s\S]*with check/i);
  assert.match(documentStorageMigration, /create policy "technical documents storage delete"[\s\S]*get_current_user_role\(\) in \('owner', 'admin'\)/);
});

test("mixed-workflow policies replace remaining broad mutation grants", () => {
  assert.match(mixedOwnershipMigration, /array\['checklist_templates', 'checklist_responses'\]/);
  assert.match(mixedOwnershipMigration, /'pcda_master_alloy_standards'[\s\S]*'pcda_master_production_stages'/);
  assert.match(mixedOwnershipMigration, /create policy invoice_items_finance_update[\s\S]*\('owner', 'admin', 'accounts'\)/);
  assert.match(mixedOwnershipMigration, /create policy "customer_compliance_requirements_team_update"[\s\S]*'sales_manager'[\s\S]*'quality'/);
  assert.doesNotMatch(mixedOwnershipMigration, /create policy[\s\S]*?for all/i);
});

test("portal requests derive customer ownership without recursive table policies", () => {
  assert.match(mixedOwnershipMigration, /function public\.current_portal_user_owns\([\s\S]*where id = auth\.uid\(\)[\s\S]*company_id = p_company_id[\s\S]*customer_id = p_customer_id/);
  assert.match(mixedOwnershipMigration, /revoke all on function public\.current_portal_user_owns\(uuid, uuid\) from anon/);
  assert.match(mixedOwnershipMigration, /array\['quote_requests', 'support_tickets'\]/);
  assert.match(mixedOwnershipMigration, /portal_user_id = auth\.uid\(\) and public\.current_portal_user_owns\(company_id, customer_id\)/);
  assert.doesNotMatch(mixedOwnershipMigration, /get_current_user_dealer_id\(\)/);
});
