import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RETURN_REASONS, acceptanceCommandSchema, acceptanceStatusSchema, policyListSchema, withinTolerance } from "../lib/workflow/department-handoffs.ts";
import { createDepartmentHandoffFixture, dids } from "../scripts/lib/department-handoff-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("the tolerance rule matches the database: percentage of the handed-over quantity, minimum 1 g", () => {
  assert.equal(withinTolerance(412.5, 411), true);
  assert.equal(withinTolerance(412.5, 410.4), false);
  assert.equal(withinTolerance(412.5, 414.5, 0.5), true);
  assert.equal(withinTolerance(0, 0.001), true);
  assert.equal(withinTolerance(0, 0.01), false);
  assert.equal(withinTolerance(100, 110, 10), true);
});

test("return reasons match the database's allowed list", () => {
  const sql = readFileSync("supabase/migrations/20261022290000_handoff_acceptance.sql", "utf8");
  const line = sql.split("\n").find((l) => l.includes("reason text not null check (reason in ("));
  for (const reason of Object.keys(RETURN_REASONS)) assert.ok(line.includes(`'${reason}'`), reason);
});

test("acceptance commands validate quantities, reasons, notes and batch size", () => {
  assert.equal(acceptanceCommandSchema.safeParse({ command: "acceptance.accept", task_id: id, received_quantity_kg: -1 }).success, false);
  assert.equal(acceptanceCommandSchema.safeParse({ command: "acceptance.accept", task_id: id, received_quantity_kg: 10 }).success, true);
  assert.equal(acceptanceCommandSchema.safeParse({ command: "acceptance.return", task_id: id, reason: "lunch", note: "something long" }).success, false);
  assert.equal(acceptanceCommandSchema.safeParse({ command: "acceptance.return", task_id: id, reason: "other", note: "no" }).success, false);
  assert.equal(acceptanceCommandSchema.safeParse({ command: "acceptance.status", task_ids: Array(11).fill(id) }).success, false);
  assert.equal(acceptanceCommandSchema.safeParse({ command: "policy.set", team: "packaging", auto_accept: true, quantity_tolerance_percent: 12 }).success, false);
});

let f;
test.before(async () => { f = await createDepartmentHandoffFixture({ acceptance: true }); await f.reset(); });
test.after(async () => { await f?.close(); });
const acc = async (name, payload, actor = dids.packer) => (await f.asUser("select public.handoff_acceptance_command($1,$2) data", [name, payload], actor))[0].data;

test("database status and policy responses parse with the app's schemas, including an open return", async () => {
  await f.db.exec(`update packaging_jobs set status='completed'`);
  await f.asSystem(`insert into quality_inspections(id,company_id,production_job_id,profile_id,quantity_checked_kg,status) values('${dids.inspection}','${dids.company}','${dids.job}','${dids.profile}',100,'approved')`, dids.quality);
  const taskId = (await f.db.query("select id from tasks where handoff_key like 'inspection_release:%'")).rows[0].id;
  const pending = acceptanceStatusSchema.parse(await acc("acceptance.status", { task_ids: [taskId] }));
  assert.equal(pending[0].issues[0].code, "no_packaging_job");
  await acc("acceptance.return", { task_id: taskId, reason: "no_packaging_job", note: "Open a packaging job please" });
  const returned = acceptanceStatusSchema.parse(await acc("acceptance.status", { task_ids: [taskId] }));
  assert.equal(returned[0].open_return.owner_name, "QC Meera");
  assert.equal(policyListSchema.parse(await acc("policy.list", {})).length, 3);
});

test("the action and page are wired with role checks and show database messages as written", () => {
  const action = readFileSync("lib/actions/department-handoffs.ts", "utf8");
  assert.match(action, /command === "policy\.set" \? managers\.includes\(context\.role\)/);
  assert.match(action, /message\.startsWith\("Cannot accept yet:"\) \|\| message\.startsWith\("Received "\)/);
  assert.match(readFileSync("app/(dashboard)/tasks/handoffs/page.tsx", "utf8"), /canAct=\{context\.role !== "viewer"\}/);
});
