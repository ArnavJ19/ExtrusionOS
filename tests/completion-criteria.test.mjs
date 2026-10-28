import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SOURCE_STATES, canManageTemplates, canSuperviseCriteria, configProblem, criterionActions, criterionRule, evaluationSchema, parseCriteriaCommand, reviewListSchema, templateListSchema
} from "../lib/workflow/completion-criteria.ts";
import { createCompletionCriteriaFixture, kids, kid } from "../scripts/lib/completion-criteria-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";
const CONFIGS = [
  ["source_state", { source_type: "order", states: ["dispatched"] }], ["source_state", { source_type: "order", states: ["shipped"] }], ["source_state", { source_type: "pallet", states: ["x"] }],
  ["source_state", { source_type: "invoice" }], ["source_state", { source_type: "invoice", states: [] }], ["observation", { unit: "micron", min: 60, max: 120 }], ["observation", { unit: "", min: 1 }],
  ["observation", { unit: "mm" }], ["observation", { unit: "mm", min: 5, max: 1 }], ["observation", { unit: "mm", max: "abc" }], ["observation", { unit: "mm", min: 0 }],
  ["observation", { unit: "a very long unit name here", min: 1 }], ["sign_off", { roles: ["quality", "accounts"] }], ["sign_off", { roles: [] }], ["sign_off", { roles: ["viewer"] }],
  ["sign_off", {}], ["inspection_pass", {}], ["handoff_accepted", {}], ["photo", {}]
];

test("criterion rules and actions describe what the assignee and others can do", () => {
  assert.equal(criterionRule({ kind: "source_state", label: "x", config: { source_type: "order", states: ["dispatched", "delivered"] } }), "order is dispatched or delivered");
  assert.equal(criterionRule({ kind: "observation", label: "x", config: { unit: "micron", min: 60, max: 120 } }), "60 – 120 micron");
  assert.equal(criterionRule({ kind: "observation", label: "x", config: { unit: "HW", min: 12 } }), "at least 12 HW");
  assert.equal(criterionRule({ kind: "sign_off", label: "x", config: { roles: ["quality", "factory_manager"] } }), "sign-off by quality or factory manager, not the assignee");
  const observation = { kind: "observation", config: { unit: "mm", min: 1 } };
  const signOff = { kind: "sign_off", config: { roles: ["quality"] } };
  const open = { status: "open", assigned_to: id };
  assert.deepEqual(criterionActions(observation, { userId: id, role: "production" }, open), { observe: true, signOff: false, remove: false });
  assert.equal(criterionActions(signOff, { userId: id, role: "quality" }, open).signOff, false, "the assignee cannot sign off their own work");
  assert.equal(criterionActions(signOff, { userId: kid(9), role: "quality" }, open).signOff, true);
  assert.deepEqual(criterionActions(observation, { userId: kid(9), role: "production_manager" }, open), { observe: true, signOff: false, remove: true });
  assert.deepEqual(criterionActions(observation, { userId: id, role: "owner" }, { status: "completed", assigned_to: id }), { observe: false, signOff: false, remove: false });
  assert.equal(criterionActions(observation, { userId: kid(9), role: "production" }, { status: "open", assigned_to: null }).observe, false, "an unassigned task is not anyone's to record");
  assert.ok(canManageTemplates("factory_manager") && !canManageTemplates("production_manager") && canSuperviseCriteria("sales_manager") && !canSuperviseCriteria("quality"));
});

test("commands are parsed by name and refuse bad input with a specific message", () => {
  assert.equal(parseCriteriaCommand({ command: "criteria.purge" }).error, "Invalid completion criteria request");
  assert.match(parseCriteriaCommand({ command: "evidence.observe", task_id: id, criterion_id: id, value: "12" }).error, /observed value as a number/);
  assert.match(parseCriteriaCommand({ command: "criteria.add", task_id: id, id, kind: "observation", label: "Coating", config: { unit: "mm", min: 5, max: 1 } }).error, /lower limit is above/);
  assert.match(parseCriteriaCommand({ command: "templates.save", id, task_kind: "anything", kind: "handoff_accepted", label: "Accepted" }).error, /kind of task/);
  assert.match(parseCriteriaCommand({ command: "task.reopen", task_id: id, reason: "no" }).error, /3 to 300/);
  assert.equal(parseCriteriaCommand({ command: "task.evaluate", task_id: id, company_id: id }).success, false);
  assert.equal(parseCriteriaCommand({ command: "templates.save", id, task_kind: "handoff:packaging", kind: "handoff_accepted", label: "Accepted" }).success, true);
});

test("the action shows exactly the database's business messages", () => {
  const sql = readFileSync("supabase/migrations/20261022360000_task_completion_criteria.sql", "utf8");
  const action = readFileSync("lib/actions/completion-criteria.ts", "utf8");
  // Raised errors and settings problems; evaluation reasons are assigned, not raised, and shown in the panel.
  const raised = [...sql.matchAll(/(?:raise exception|return) '([^']+)'/g)].map((m) => m[1])
    .filter((m) => !m.includes("%") && !["Authentication required", "This action is not permitted for your role", "Invalid completion criteria request"].includes(m));
  assert.ok(raised.length > 20);
  for (const message of raised) assert.ok(action.includes(`"${message}"`), message);
});

let f;
test.before(async () => { f = await createCompletionCriteriaFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

test("settings checks and source states match the database exactly", async () => {
  for (const [kind, config] of CONFIGS) {
    const db = (await f.db.query("select private.criterion_config_problem($1,$2) p", [kind, config])).rows[0].p;
    assert.equal(configProblem(kind, config), db, `${kind} ${JSON.stringify(config)}`);
  }
  for (const [type, states] of Object.entries(SOURCE_STATES)) {
    const db = (await f.db.query("select private.task_source_states($1) s", [type])).rows[0].s;
    assert.deepEqual([...states], db, type);
  }
  const statusTypes = readFileSync("types/app.ts", "utf8");
  for (const name of ["OrderStage", "QualityStatus", "ProductionJobStatus", "DeliveryStatus", "QuoteStatus", "InvoiceStatus"]) {
    const values = [...new RegExp(`export type ${name} = ([^;]+);`).exec(statusTypes)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const key = { OrderStage: "order", QualityStatus: "quality_inspection", ProductionJobStatus: "production_job", DeliveryStatus: "dispatch", QuoteStatus: "quote", InvoiceStatus: "invoice" }[name];
    assert.deepEqual([...SOURCE_STATES[key]].sort(), values, `${name} matches the app's status type`);
  }
});

test("database evaluation, template and review responses parse with the app's schemas", async () => {
  assert.equal(evaluationSchema.parse(await f.evaluate(kids.task)).state, "none");
  await f.addCriterion(kids.task, kid(200), "source_state", "Order dispatched", { source_type: "order", states: ["dispatched"] });
  await f.addCriterion(kids.task, kid(201), "observation", "Bundle count", { unit: "bundles", min: 1 });
  const unmet = evaluationSchema.parse(await f.evaluate(kids.task));
  assert.deepEqual([unmet.state, unmet.unmet], ["unmet", 2]);
  const observed = evaluationSchema.parse(await f.command("evidence.observe", { task_id: kids.task, criterion_id: kid(201), value: 12 }, kids.dispatcher));
  assert.equal(observed.criteria[1].evidence.value, 12);
  await f.command("templates.save", { id: kid(300), task_kind: "type:general", kind: "sign_off", label: "Supervisor sign-off", config: { roles: ["production_manager"] } }, kids.factory);
  assert.equal(templateListSchema.parse(await f.command("templates.list", {}, kids.prodMgr)).length, 1);
  await f.db.exec(`update orders set current_stage='dispatched' where id='${kids.order}'`);
  await f.complete(kids.task);
  await f.db.exec(`update orders set current_stage='packing' where id='${kids.order}'`);
  const review = reviewListSchema.parse(await f.command("review.list", {}, kids.factory));
  assert.equal(review.rows[0].evaluation.unmet, 1);
});

test("pages gate on the criteria roles; the task page evaluates only for internal users", () => {
  assert.match(readFileSync("app/(dashboard)/tasks/criteria/page.tsx", "utf8"), /context\.dealerId \|\| !canSuperviseCriteria\(context\.role\)/);
  for (const page of ["new/page.tsx", "[id]/page.tsx"]) assert.match(readFileSync(`app/(dashboard)/tasks/criteria/${page}`, "utf8"), /context\.dealerId \|\| !canManageTemplates\(context\.role\)/);
  const detail = readFileSync("app/(dashboard)/tasks/[id]/page.tsx", "utf8");
  assert.match(detail, /if \(!context\.dealerId && UUID\.test\(id\)\)[\s\S]*task_criteria_command/);
  assert.match(readFileSync("lib/actions/completion-criteria.ts", "utf8"), /if \(context\.dealerId \|\| !allowed\)/);
});
