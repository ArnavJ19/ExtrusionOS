import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("staging E2E fails closed unless an explicit local skip is requested", () => {
  const runner = read("scripts/run-staging-e2e.ts");
  assert.match(runner, /E2E_STAGING_ALLOW_SKIP === "true"/);
  assert.match(runner, /STAGING E2E GATE FAILED/);
  assert.match(runner, /process\.exit\(1\)/);
});

test("dealer workflow boundaries enforce mutation permissions and complete receipt coverage", () => {
  const commentsRoute = read("app/api/dealer-orders/[id]/comments/route.ts");
  const receiptRoute = read("app/api/shipments/receipt/route.ts");
  const inventoryRoute = read("app/api/dealer-inventory/items/route.ts");

  assert.match(commentsRoute, /can\(context\.role, "create", "dealer_orders"\)/);
  assert.match(receiptRoute, /validatedLines\.length !== shipmentItems\.length/);
  assert.match(inventoryRoute, /\.eq\("company_id", context\.companyId\)/);
  assert.match(inventoryRoute, /\.eq\("is_active", true\)/);
});

test("dealer boundary migration hardens RLS, duplicate receipts, and profile lineage", () => {
  const migration = read("supabase/migrations/20260810000000_tenant_boundary_and_dealer_workflow_hardening.sql");
  const baselineRls = read("supabase/rls.sql");

  assert.match(baselineRls, /companies insert authenticated[\s\S]*created_by = auth\.uid\(\)/);
  assert.match(migration, /current_user_has_permission\('create_orders'\)/);
  assert.match(migration, /dealer_receipts_company_shipment_unique/);
  assert.match(migration, /validate_profile_stock_batch_profile_company/);
});

test("receipt posting is atomic, idempotent, and cannot accept partial shipment lines", () => {
  const workflow = read("lib/enterprise/dealer-workflows.ts");
  const migration = read("supabase/migrations/20260810000000_tenant_boundary_and_dealer_workflow_hardening.sql");

  assert.match(workflow, /rpc\("submit_dealer_receipt_atomic"/);
  assert.doesNotMatch(workflow, /from\("dealer_receipts"\)\.insert/);
  assert.match(migration, /submit_dealer_receipt_atomic[\s\S]*for update/);
  assert.match(migration, /idempotent.*true/);
  assert.match(migration, /validated|line_count|v_line_count/);
  assert.match(migration, /insert into public\.inventory_transactions/);
  assert.match(migration, /insert into public\.audit_logs_enterprise/);
});

test("production status changes are server-owned and require a released press slot", () => {
  const action = read("lib/actions/production.ts");
  const migration = read("supabase/migrations/20260810000000_tenant_boundary_and_dealer_workflow_hardening.sql");
  const statusGuard = read("supabase/migrations/20260810010000_manufacturing_reference_and_material_guards.sql");

  assert.match(action, /rpc\("transition_production_job_atomic"/);
  assert.doesNotMatch(action, /from\("production_jobs"\)\.update/);
  assert.match(migration, /production_job_status_history/);
  assert.match(migration, /slot\.status = 'released'/);
  assert.match(migration, /Illegal production status transition/);
  assert.match(statusGuard, /guard_production_job_status/);
  assert.match(statusGuard, /New production jobs must start in planned status/);
  assert.match(migration, /revoke update on public\.production_jobs from anon, authenticated/);
});

test("manufacturing references and billet material are database-validated", () => {
  const migration = read("supabase/migrations/20260810010000_manufacturing_reference_and_material_guards.sql");
  const allocation = read("supabase/migrations/20260515005600_order_billet_requirements_and_allocation.sql");
  const queue = read("supabase/migrations/20260723060000_exact_dispatch_manifest_and_consolidation.sql");

  assert.match(migration, /validate_production_job_references/);
  assert.match(migration, /v_die_profile_id <> new\.profile_id/);
  assert.match(migration, /validate_foundry_billet_lineage/);
  assert.match(migration, /alloy, temper, and diameter must match/);
  assert.match(migration, /validate_order_billet_requirement_material/);
  assert.match(migration, /silent 6063\/T6\/6-inch fallback/);
  assert.match(allocation, /lower\(coalesce\(temper, ''\)\) = lower\(coalesce\(v_req\.temper, ''\)\)/);
  assert.match(allocation, /lower\(coalesce\(r\.temper, ''\)\) = lower\(coalesce\(v_billet\.temper, ''\)\)/);
  assert.match(queue, /select round\(coalesce\(manufacturing_weight_kg, 0\), 3\)/);
  assert.doesNotMatch(queue, /select round\(coalesce\(production_quantity_kg, 0\), 3\)/);
});

test("legacy dealer order APIs use atomic creation and legal workflow RPCs", () => {
  const createRoute = read("app/api/dealer-orders/route.ts");
  const workflowRoute = read("app/api/dealer-orders/[id]/workflow/route.ts");
  const migration = read("supabase/migrations/20260810020000_atomic_dealer_order_creation_and_workflow.sql");

  assert.match(createRoute, /rpc\("create_dealer_order_atomic"/);
  assert.doesNotMatch(createRoute, /from\("dealer_orders"\)\.insert/);
  assert.doesNotMatch(createRoute, /from\("dealer_order_items"\)\.insert/);
  assert.match(workflowRoute, /rpc\("transition_dealer_order_atomic"/);
  assert.doesNotMatch(workflowRoute, /from\("dealer_orders"\)\.update/);
  assert.match(migration, /next_business_number_locked/);
  assert.match(migration, /Illegal dealer order transition/);
  assert.match(migration, /dealer_order_status_history/);
  assert.match(migration, /audit_logs_enterprise/);
});

test("quote and order financial fields are database-owned", () => {
  const migration = read("supabase/migrations/20260810030000_quote_and_order_financial_integrity.sql");
  const orderAction = read("lib/actions/quotes-orders.ts");

  assert.match(migration, /recalculate_quote_item_financials/);
  assert.match(migration, /new\.line_total_before_gst := v_line_total/);
  assert.match(migration, /derive_order_value_from_quote/);
  assert.match(migration, /new\.order_value := coalesce\(v_quote\.grand_total, 0\)/);
  assert.match(migration, /'public\.order_items'::regclass/);
  assert.match(migration, /'quote_item_id'/);
  assert.match(orderAction, /rpc\("save_quote_atomic"/);
  assert.match(orderAction, /rpc\("save_order_atomic"/);
});

test("auth and invite failures preserve tenant boundaries and avoid false onboarding", () => {
  const auth = read("lib/auth.ts");
  const proxy = read("proxy.ts");
  const inviteRoute = read("app/api/access/invites/route.ts");
  const errors = read("lib/utils/errors.ts");

  assert.match(auth, /maybeSingle\(\)/);
  assert.match(auth, /appUserError.*account-unavailable/);
  assert.match(proxy, /appUserError/);
  assert.match(proxy, /pathname = "\/account-unavailable"/);
  assert.match(inviteRoute, /from\("roles"\).*company_id/);
  assert.match(inviteRoute, /from\("dealers"\).*company_id/);
  assert.match(inviteRoute, /from\("branches"\).*company_id/);
  assert.match(errors, /jwt\|invalid api key\|supabase/);
});

test("storage and master-data policies use one tenant and role matrix", () => {
  const migration = read("supabase/migrations/20260810040000_storage_and_catalog_policy_alignment.sql");
  const baselineRls = read("supabase/rls.sql");

  assert.match(migration, /technical-drawings/);
  assert.match(migration, /maintenance-bills/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\] = public\.get_current_user_company_id\(\)::text/);
  assert.match(migration, /public\.get_current_user_role\(\) in \('owner','admin','sales_manager','sales','production_manager','production','quality','viewer'\)/);
  assert.match(migration, /public\.get_current_user_role\(\) in \('owner','admin'\)/);
  assert.match(baselineRls, /profiles tenant insert[\s\S]*production_manager','production/);
});

test("mobile operational queues paginate server-side and distinguish query errors", () => {
  for (const file of [
    "app/(dashboard)/mobile/jobs/page.tsx",
    "app/(dashboard)/mobile/dispatch/page.tsx",
    "app/(dashboard)/mobile/quality/page.tsx",
    "app/(dashboard)/mobile/tasks/page.tsx"
  ]) {
    const page = read(file);
    assert.match(page, /searchParams/);
    assert.match(page, /count: "exact"/);
    assert.match(page, /\.range\(/);
    assert.match(page, /MobilePagination/);
    assert.match(page, /<ErrorState/);
  }
});

test("factory minimum runtime RPC uses canonical manufacturing weight", () => {
  const migration = read("supabase/migrations/20260810050000_factory_queue_weight_runtime_fix.sql");
  assert.match(migration, /create or replace function private\.create_order_from_quote_with_dealer_workflow_atomic/);
  assert.match(migration, /coalesce\(manufacturing_weight_kg, 0\)/);
  assert.doesNotMatch(migration, /coalesce\(production_quantity_kg, 0\)/);
  assert.match(migration, /factory_load_consolidations/);
});

test("mobile dispatch distinguishes query failure from an empty queue", () => {
  const page = read("app/(dashboard)/mobile/dispatch/page.tsx");
  assert.match(page, /data: dispatches, error/);
  assert.match(page, /<ErrorState/);
  assert.match(page, /No active dispatches/);
});

test("scanner labels telemetry as a scan event instead of a state transition", () => {
  const page = read("app/(dashboard)/scan/page.tsx");
  assert.match(page, /Log Dispatch Scan/);
  assert.match(page, /Log Stock Audit Scan/);
  assert.match(page, /Log Die Check Scan/);
  assert.doesNotMatch(page, /Load for Dispatch|Mark as Audited|Mark Die Checked/);
});
