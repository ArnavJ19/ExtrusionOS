import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBusinessDateBoundaries, resolveBusinessTimeZone } from "../lib/utils/business-date.ts";
import { calculateIssuedBilletRecovery } from "../lib/command-center/metrics.ts";
import { coreExportPlan, exportCoreTables } from "../lib/data-export/core-export.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("core data export isolates table failures and records a complete manifest", async () => {
  const result = await exportCoreTables([
    { table: "customers" },
    { table: "purchase_orders", skipReason: "unsupported" },
    { table: "orders" },
  ], async (table) => {
    if (table === "orders") throw new Error("permission denied");
    return [{ id: "customer-1" }];
  });

  assert.deepEqual(result.data, { customers: [{ id: "customer-1" }] });
  assert.deepEqual(result.manifest.successful, [{ table: "customers", rows: 1 }]);
  assert.deepEqual(result.manifest.skipped, [{ table: "purchase_orders", reason: "unsupported" }]);
  assert.equal(result.manifest.errors[0].table, "orders");
  assert.match(result.manifest.errors[0].error, /permission denied/);
  assert.ok(coreExportPlan.some((item) => item.table === "purchase_orders" && item.skipReason));
});

test("data center does not advertise an unsupported standalone purchase order export", () => {
  const component = read("components/modules/data-center-client.tsx");
  assert.doesNotMatch(component, /purchase_orders:\s*"purchase_orders"/);
  assert.match(component, /manifest:\s*result\.manifest/);
  assert.match(component, /toast\.warning/);
});

test("enterprise settings sends invitations to the canonical access workflow", () => {
  const component = read("components/modules/enterprise-foundation-client.tsx");
  const page = read("app/(dashboard)/settings/enterprise/page.tsx");
  assert.match(component, /href="\/settings\/access"/);
  assert.doesNotMatch(component, /createInvitation|Record invitation|userInvitationSchema/);
  assert.doesNotMatch(page, /from\("user_invitations"\)/);
});

test("business boundaries default to India and do not follow the UTC calendar date", () => {
  const boundaries = getBusinessDateBoundaries(new Date("2026-07-31T20:00:00.000Z"));
  assert.equal(boundaries.timeZone, "Asia/Kolkata");
  assert.equal(boundaries.today, "2026-08-01");
  assert.equal(boundaries.monthStart, "2026-08-01");
  assert.equal(boundaries.lastMonthStart, "2026-07-01");
  assert.equal(boundaries.lastMonthEnd, "2026-07-31");
  assert.equal(boundaries.monthStartIso, "2026-07-31T18:30:00.000Z");
  assert.equal(boundaries.tomorrowStartIso, "2026-08-01T18:30:00.000Z");
  assert.equal(resolveBusinessTimeZone("Invalid/Zone"), "Asia/Kolkata");
});

test("tenant users cannot assign their own subscription entitlements", () => {
  const component = read("components/modules/enterprise-foundation-client.tsx");
  const migration = read("supabase/migrations/20260723050000_subscription_entitlement_guard.sql");

  assert.doesNotMatch(component, /saveSubscription|Subscription assignment saved|company_subscriptions"\)\.update|company_subscriptions"\)\.insert/);
  assert.match(component, /managed through the billing service/);
  assert.match(migration, /drop policy if exists "company subscriptions tenant insert admin"/);
  assert.match(migration, /drop policy if exists "company subscriptions tenant update admin"/);
  assert.match(migration, /revoke insert, update, delete on table public\.company_subscriptions from anon, authenticated/);
});

test("factory date defaults use the shared business calendar", () => {
  const businessDateConsumers = [
    "app/(dashboard)/dealer-orders/page.tsx",
    // AP-043: the die health loader moved from the Die Intelligence page into the die module library.
    "lib/dies/intelligence.ts",
    "app/(dashboard)/energy/page.tsx",
    "components/modules/maintenance/maintenance-workspace-client.tsx",
    "components/modules/task-create-form.tsx",
    "app/(dashboard)/orders/page.tsx",
    "app/portal/dashboard/page.tsx",
    "components/modules/tasks-dashboard-client.tsx",
    "components/modules/dies/die-nitriding-form.tsx",
    "components/modules/dies/dies-overview-client.tsx",
    "components/modules/orders/quote-order-form-client.tsx",
    "components/modules/operations/record-form-client.tsx",
    "components/modules/financials/payment-form-client.tsx",
    "lib/calculations/quote.ts",
    "lib/calculations/operations.ts",
    "app/api/dealer-orders/[id]/workflow/route.ts",
  ];

  for (const path of businessDateConsumers) {
    const source = read(path);
    assert.match(source, /getBusinessDateBoundaries/);
    assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  }
});

test("recovery uses linked issued billet input and becomes not captured when any job lacks input", () => {
  const captured = calculateIssuedBilletRecovery(
    [{ id: "job-1", actual_quantity_kg: 900 }],
    [{ production_job_id: "job-1", weight_kg: 1000 }],
  );
  assert.equal(captured.percent, 90);
  assert.equal(captured.issuedInputKg, 1000);

  const incomplete = calculateIssuedBilletRecovery(
    [
      { id: "job-1", actual_quantity_kg: 900 },
      { id: "job-2", actual_quantity_kg: 450 },
    ],
    [{ production_job_id: "job-1", weight_kg: 1000 }],
  );
  assert.equal(incomplete.percent, null);
  assert.equal(incomplete.capturedJobCount, 1);
  assert.equal(incomplete.missingJobCount, 1);
});

test("command center reads every KPI from the one KPI path (FS-132): canonical collections and linked billet input live there", () => {
  const page = read("app/(dashboard)/command-center/page.tsx");
  const client = read("components/modules/command-center-client.tsx");
  const kpi = read("supabase/migrations/20261119110000_fs_batch4_kpi_dictionary.sql");
  assert.match(page, /getBusinessDateBoundaries\(new Date\(\)\)/);
  assert.match(page, /rpc\("fs_kpi", \{ p_command: "values"/);
  for (const key of ["order_intake", "collections", "receivables_outstanding", "shipped_kg", "production_completed_kg", "scrap_kg"]) assert.ok(page.includes(`value(k, "${key}")`), key);
  assert.doesNotMatch(page, /from\("payments"\)/);
  assert.doesNotMatch(page, /from\("foundry_billets"\)|from\("scrap_records"\)/, "no KPI arithmetic over raw tables on the page");
  assert.doesNotMatch(page, /< 85|below 85%|< 20/, "no invented targets");
  // The rules the page used to apply now live in the SQL definition.
  assert.match(kpi, /from public\.foundry_billets b[\s\S]*b\.status in \('issued', 'consumed'\)/);
  assert.match(kpi, /payment_status = 'PAID' and payment_method <> 'credit_note'/);
  assert.match(kpi, /scrap_record_reversals/);
  assert.match(client, /emptyLabel="Not captured"/);
});
