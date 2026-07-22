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

test("command center uses canonical collection events and linked billet input", () => {
  const page = read("app/(dashboard)/command-center/page.tsx");
  const client = read("components/modules/command-center-client.tsx");
  assert.match(page, /getBusinessDateBoundaries\(now\)/);
  assert.match(page, /rpc\("get_financial_collection_events"/);
  assert.doesNotMatch(page, /from\("payments"\).*gte\("payment_date"/s);
  assert.match(page, /from\("foundry_billets"\)/);
  assert.match(page, /\.in\("status", \["issued", "consumed"\]\)/);
  assert.doesNotMatch(page, /totalProduced \+ totalScrap/);
  assert.match(client, /emptyLabel="Not captured"/);
});
