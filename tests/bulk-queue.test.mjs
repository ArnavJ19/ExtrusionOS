import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BULK_LIMIT, bulkCommandSchema, bulkOutcomeSchema, canAssignTo, canBulkJobs, canBulkTasks, expectedFromPreview, summariseOutcome } from "../lib/workflow/bulk-queue.ts";
import { createBulkQueueFixture, qids, qid } from "../scripts/lib/bulk-queue-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("bulk roles: supervisors for tasks, planning leads for production jobs", () => {
  for (const role of ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "sales_manager"]) assert.ok(canBulkTasks(role), role);
  for (const role of ["production", "sales", "dispatch", "viewer", "accounts", "dealer_admin"]) assert.ok(!canBulkTasks(role), role);
  assert.ok(canBulkJobs("production_manager") && !canBulkJobs("dispatch_manager"));
});

test("assignable employees mirror the database's supervision rule", () => {
  assert.equal(canAssignTo("production_manager", "production"), true);
  assert.equal(canAssignTo("production_manager", "dispatch"), false);
  assert.equal(canAssignTo("dispatch_manager", "dispatch"), true);
  assert.equal(canAssignTo("sales_manager", "production"), false);
  assert.equal(canAssignTo("factory_manager", "quality"), true);
  assert.equal(canAssignTo("owner", "sales"), true);
  assert.equal(canAssignTo("owner", "dealer_staff"), false);
  const sql = readFileSync("supabase/migrations/20261022270000_bulk_queue_actions.sql", "utf8");
  assert.match(sql, /when 'production_manager' then array\['production_manager','production'\]/);
  assert.match(sql, /when 'dispatch_manager' then array\['dispatch_manager','dispatch'\]/);
});

test("command schema: target/action pairs, 1-50 ids, fingerprints required to apply", () => {
  const change = { target: "tasks", action: "priority", value: "high" };
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.preview", change, ids: [id] }).success, true);
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.preview", change: { target: "tasks", action: "planned_date", value: "2026-11-01" }, ids: [id] }).success, false);
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.preview", change: { target: "production_jobs", action: "assign", value: id }, ids: [id] }).success, false);
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.preview", change, ids: [] }).success, false);
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.preview", change, ids: Array(BULK_LIMIT + 1).fill(id) }).success, false);
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.apply", change, ids: [id], request_id: id }).success, false, "an apply without fingerprints is rejected");
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.apply", change, ids: [id], expected: { [id]: "a".repeat(32) }, request_id: id }).success, true);
  assert.equal(bulkCommandSchema.safeParse({ command: "bulk.preview", change, ids: [id], company_id: id }).success, false);
});

test("outcome summary and expected fingerprints come only from evaluated records", () => {
  const preview = { results: [
    { id: "a", outcome: "will_change", message: "x", fingerprint: "f1" }, { id: "b", outcome: "rejected", message: "y", fingerprint: "f2" },
    { id: "c", outcome: "unavailable", message: "z" }, { id: "a", outcome: "duplicate_selection", message: "d" }
  ], changed_count: 0, replayed: false };
  assert.deepEqual(expectedFromPreview(preview), { a: "f1", b: "f2" });
  assert.deepEqual(summariseOutcome(preview), { will_change: 1, changed: 0, unchanged: 0, rejected: 1, unavailable: 1, duplicate_selection: 1 });
});

let f;
test.before(async () => { f = await createBulkQueueFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database previews and applies parse with the app's outcome schema", async () => {
  const payload = { target: "tasks", action: "assign", value: qids.operator, ids: [qids.tOpen, qids.tDone, qids.tForeign, qids.tOpen] };
  const preview = bulkOutcomeSchema.parse(await f.command("bulk.preview", payload));
  const applied = bulkOutcomeSchema.parse(await f.command("bulk.apply", { ...payload, expected: expectedFromPreview(preview), request_id: qid(5100) }));
  assert.equal(applied.changed_count, 1);
  assert.equal(applied.results.length, 4);
});

test("pages and the action gate on the bulk roles and exclude dealer sessions", () => {
  const action = readFileSync("lib/actions/bulk-queue.ts", "utf8");
  assert.match(action, /change\.target === "tasks" \? canBulkTasks\(context\.role\) : canBulkJobs\(context\.role\)/);
  assert.match(action, /if \(context\.dealerId \|\| !allowed\)/);
  assert.match(readFileSync("app/(dashboard)/tasks/bulk/page.tsx", "utf8"), /if \(context\.dealerId \|\| !canBulkTasks\(context\.role\)\) redirect/);
  assert.match(readFileSync("app/(dashboard)/production/bulk/page.tsx", "utf8"), /if \(context\.dealerId \|\| !canBulkJobs\(context\.role\)\) redirect/);
  assert.match(readFileSync("app/(dashboard)/production/bulk/page.tsx", "utf8"), /\.range\(\(page - 1\) \* size, page \* size - 1\)/, "server-side pagination");
});
