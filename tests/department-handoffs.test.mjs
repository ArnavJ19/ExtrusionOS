import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canReadHandoffs, canReprocessHandoffs, handoffCommandSchema, handoffOverdue, handoffQueueSchema, handoffSourceHref, teamsForRole } from "../lib/workflow/department-handoffs.ts";
import { createDepartmentHandoffFixture, dids, did } from "../scripts/lib/department-handoff-fixture.mjs";

test("team membership mirrors the database's team roles", () => {
  assert.deepEqual(teamsForRole("production"), ["packaging", "production"]);
  assert.deepEqual(teamsForRole("dispatch_manager"), ["dispatch"]);
  assert.deepEqual(teamsForRole("quality"), ["quality"]);
  assert.deepEqual(teamsForRole("factory_manager"), ["packaging", "production", "dispatch", "quality"]);
  assert.deepEqual(teamsForRole("viewer"), []);
  const sql = readFileSync("supabase/migrations/20261022260000_department_handoffs.sql", "utf8");
  for (const [team, roles] of [["packaging", ["production_manager", "production"]], ["dispatch", ["dispatch_manager", "dispatch"]], ["quality", ["quality_manager", "quality"]]]) {
    const line = sql.split("\n").find((l) => l.includes(`when '${team}' then array[`));
    for (const role of roles) assert.ok(line.includes(`'${role}'`), `${team} includes ${role}`);
  }
});

test("readers and reprocessors exclude sales, accounts and dealers", () => {
  for (const role of ["sales", "accounts", "dealer_admin", "dealer_staff", "inventory_manager"]) assert.ok(!canReadHandoffs(role), role);
  assert.ok(canReadHandoffs("viewer") && !canReprocessHandoffs("viewer"));
  assert.ok(!canReprocessHandoffs("production") && canReprocessHandoffs("production_manager"));
});

test("command schema rejects unknown teams, statuses and sources", () => {
  assert.equal(handoffCommandSchema.safeParse({ command: "handoff.list", team: "billing" }).success, false);
  assert.equal(handoffCommandSchema.safeParse({ command: "handoff.list", status: "deleted" }).success, false);
  assert.equal(handoffCommandSchema.safeParse({ command: "handoff.reprocess", source_type: "invoice", source_id: dids.job }).success, false);
  assert.equal(handoffCommandSchema.safeParse({ command: "handoff.take", task_id: "x" }).success, false);
  assert.deepEqual(handoffCommandSchema.parse({ command: "handoff.list" }), { command: "handoff.list", status: "active", page: 1 });
});

test("source links open existing pages and overdue applies only to unfinished work", () => {
  assert.equal(handoffSourceHref({ handoff_source_type: "quality_inspection", handoff_source_id: "a" }), "/quality/a");
  assert.equal(handoffSourceHref({ handoff_source_type: "finishing_job", handoff_source_id: "b" }), "/production/finishing/b");
  assert.equal(handoffSourceHref({ handoff_source_type: "packaging_job", handoff_source_id: "c" }), "/packaging/c");
  assert.equal(handoffOverdue({ due_date: "2026-10-21", status: "open" }, "2026-10-22"), true);
  assert.equal(handoffOverdue({ due_date: "2026-10-21", status: "completed" }, "2026-10-22"), false);
  assert.equal(handoffOverdue({ due_date: "2026-10-22", status: "in_progress" }, "2026-10-22"), false);
  assert.equal(handoffOverdue({ due_date: null, status: "open" }, "2026-10-22"), false);
});

let f;
test.before(async () => { f = await createDepartmentHandoffFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("the database queue parses with the app's schema before and after a handoff is taken", async () => {
  await f.asSystem(`insert into quality_inspections(id,company_id,production_job_id,profile_id,quantity_checked_kg,status) values('${did(70)}','${dids.company}','${dids.job}','${dids.profile}',100,'approved')`);
  const queue = handoffQueueSchema.parse(await f.command("handoff.list", {}, dids.packer));
  assert.equal(queue.rows[0].can_take, true);
  await f.command("handoff.take", { task_id: queue.rows[0].id }, dids.packer);
  const after = handoffQueueSchema.parse(await f.command("handoff.list", {}, dids.packer));
  assert.equal(after.rows[0].status, "in_progress");
});

test("the page and action gate on the same roles and exclude dealer sessions", () => {
  const action = readFileSync("lib/actions/department-handoffs.ts", "utf8");
  assert.match(action, /if \(context\.dealerId \|\| !allowed\)/);
  assert.match(action, /canReadHandoffs\(context\.role\) && context\.role !== "viewer"/);
  assert.match(readFileSync("app/(dashboard)/tasks/handoffs/page.tsx", "utf8"), /if \(context\.dealerId \|\| !canReadHandoffs\(context\.role\)\) redirect\("\/tasks"\)/);
});
