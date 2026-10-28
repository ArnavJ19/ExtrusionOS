import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TRIGGER_EVENTS, canManageTriggerRules, canUseTriggers, isRetryableRunError, parseTriggerCommand, recoveryResultSchema, ruleListSchema, ruleProblem, ruleSummary,
  runResultSchema, sourceHref, triggerScope, triggeredTaskListSchema
} from "../lib/workflow/task-triggers.ts";
import { createTaskTriggerFixture, xids } from "../scripts/lib/task-trigger-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";
const ROLES = ["owner", "admin", "factory_manager", "production_manager", "production", "dispatch_manager", "dispatch", "quality", "sales_manager", "sales", "accounts", "viewer", "inventory_manager"];

test("rule checks mirror the database: thresholds per event and eligible roles", () => {
  const base = { event_type: "order_dispatch_overdue", threshold: 2, assignee_mode: "role", assignee_role: "dispatch", assignee_user_id: null };
  assert.equal(ruleProblem(base), null);
  assert.match(ruleProblem({ ...base, threshold: 366 }), /0 to 365 days late/);
  assert.match(ruleProblem({ ...base, event_type: "breakdown_open", threshold: 0, assignee_role: "production" }), /1 to 720 hours open/);
  assert.match(ruleProblem({ ...base, event_type: "inspection_rejected", threshold: 1, assignee_role: "quality" }), /no threshold/);
  assert.match(ruleProblem({ ...base, assignee_role: "accounts" }), /accounts role cannot take/);
  assert.match(ruleProblem({ ...base, assignee_mode: "person", assignee_role: null }), /Choose the employee/);
  assert.equal(ruleProblem({ ...base, assignee_mode: "person", assignee_role: null, assignee_user_id: id }), null, "a named employee needs no fallback");
  assert.match(ruleProblem({ ...base, assignee_role: null }), /Choose the role/);
});

test("commands are parsed by name; no client company, whole numbers only", () => {
  assert.equal(parseTriggerCommand({ command: "rules.delete", id }).error, "Invalid task trigger request");
  assert.equal(parseTriggerCommand({ command: "triggers.run", request_id: "x" }).success, false);
  assert.equal(parseTriggerCommand({ command: "tasks.list", company_id: id }).success, false);
  const rule = { command: "rules.save", id, name: "Late dispatch", event_type: "order_dispatch_overdue", threshold: 2.5, assignee_mode: "role", assignee_role: "dispatch", assignee_user_id: null, due_days: 1, due_calendar: "calendar", priority: "normal", is_active: true };
  assert.match(parseTriggerCommand(rule).error, /whole numbers/);
  assert.match(parseTriggerCommand({ ...rule, threshold: Number.NaN }).error, /whole numbers/);
  assert.match(parseTriggerCommand({ ...rule, threshold: 2, due_days: 31 }).error, /within 30 days/);
  assert.equal(parseTriggerCommand({ ...rule, threshold: 2 }).success, true);
});

test("summaries, links and retry classification", () => {
  assert.equal(ruleSummary({ event_type: "order_dispatch_overdue", threshold: 2, assignee_mode: "role", assignee_role: "dispatch", assignee_name: null, due_days: 1, due_calendar: "working_days" }),
    "2 days late · least-loaded Dispatch · due in 1 working day");
  assert.equal(ruleSummary({ event_type: "inspection_rejected", threshold: 0, assignee_mode: "person", assignee_role: "quality", assignee_name: "QC Meera", due_days: 0, due_calendar: "calendar" }),
    "as soon as it happens · QC Meera, else Quality · due the same day");
  assert.equal(sourceHref("order", id), `/orders/${id}`);
  assert.equal(sourceHref("breakdown_log", id), "/maintenance");
  const action = readFileSync("lib/actions/task-triggers.ts", "utf8");
  const lost = /error: "(The task trigger request could not be completed\. Check your session and retry\.)"/.exec(action)?.[1];
  assert.ok(lost && isRetryableRunError(lost), "a lost response is retried with the same request id");
  assert.equal(isRetryableRunError("Trigger rule is unavailable"), false);
  const button = readFileSync("components/modules/tasks/task-triggers.tsx", "utf8");
  assert.match(button, /request\.current \?\?= crypto\.randomUUID\(\)/);
  assert.match(button, /isRetryableRunError\(result\.error\)\) result = await taskTriggerAction\(\{ command: "triggers\.run", request_id: request\.current \}\)/);
});

test("the action shows exactly the database's business messages", () => {
  const sql = readFileSync("supabase/migrations/20261022350000_task_trigger_rules.sql", "utf8");
  const action = readFileSync("lib/actions/task-triggers.ts", "utf8");
  const raised = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1])
    .filter((m) => !m.includes("%") && !["Authentication required", "This action is not permitted for your role", "Invalid task trigger request", "The trigger reference of a task cannot be changed"].includes(m));
  for (const message of raised) assert.ok(action.includes(`"${message}"`), message);
});

let f;
test.before(async () => { f = await createTaskTriggerFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

test("event roles and role scopes match the database functions exactly", async () => {
  for (const [event, meta] of Object.entries(TRIGGER_EVENTS)) {
    const roles = (await f.db.query("select private.task_trigger_event_roles($1) r", [event])).rows[0].r;
    assert.deepEqual([...meta.roles].sort(), [...roles].sort(), event);
  }
  for (const role of ROLES) {
    const scope = (await f.db.query("select private.task_trigger_scope($1) s", [role])).rows[0].s;
    assert.deepEqual(triggerScope(role).sort(), [...scope].sort(), role);
    assert.equal(canUseTriggers(role), scope.length > 0, role);
  }
  assert.ok(canManageTriggerRules("factory_manager") && !canManageTriggerRules("dispatch_manager"));
});

test("threshold limits match the database check at each boundary", async () => {
  const names = { order_dispatch_overdue: "dispatch", inspection_rejected: "quality", breakdown_open: "production", quote_expiring: "sales", invoice_overdue: "accounts" };
  let n = 500;
  for (const [event, meta] of Object.entries(TRIGGER_EVENTS)) {
    for (const threshold of [meta.min - 1, meta.min, meta.max, meta.max + 1]) {
      const input = { event_type: event, threshold, assignee_mode: "role", assignee_role: names[event], assignee_user_id: null };
      const appOk = ruleProblem(input) === null;
      const dbOk = await f.rule(`00000000-0000-4000-8000-${String(n++).padStart(12, "0")}`, { name: `Boundary ${event}`, ...input }).then(() => true, () => false);
      assert.equal(appOk, dbOk, `${event} threshold ${threshold}`);
    }
  }
});

test("database responses parse with the app's schemas", async () => {
  await f.rule(xids.dispatchRule, { name: "Late dispatch", event_type: "order_dispatch_overdue", threshold: 2, assignee_mode: "role", assignee_role: "dispatch" });
  await f.rule(xids.quoteRule, { name: "Quote expiry", event_type: "quote_expiring", threshold: 3, assignee_mode: "role", assignee_role: "admin" });
  assert.equal(ruleListSchema.parse(await f.command("rules.list", {})).last_run, null);
  const result = runResultSchema.parse(await f.command("triggers.run", { request_id: crypto.randomUUID() }));
  assert.deepEqual([result.created, result.unassigned], [1, 1]);
  const rules = ruleListSchema.parse(await f.command("rules.list", {}));
  assert.deepEqual([rules.last_run.created, rules.rows.find((r) => r.id === xids.quoteRule).unassigned_tasks], [1, 1]);
  triggeredTaskListSchema.parse(await f.command("tasks.list", {}));
  const recovery = triggeredTaskListSchema.parse(await f.command("recovery.list", {}));
  recoveryResultSchema.parse(await f.command("recovery.retry", { task_id: recovery.rows[0].id }));
  recoveryResultSchema.parse(await f.command("recovery.assign", { task_id: recovery.rows[0].id, assignee_id: xids.sales }));
});

test("pages gate on the trigger roles and never take a company from the client", () => {
  assert.match(readFileSync("app/(dashboard)/tasks/triggers/page.tsx", "utf8"), /context\.dealerId \|\| !canUseTriggers\(context\.role\)/);
  for (const page of ["new/page.tsx", "[id]/page.tsx"]) assert.match(readFileSync(`app/(dashboard)/tasks/triggers/${page}`, "utf8"), /context\.dealerId \|\| !canManageTriggerRules\(context\.role\)/);
  assert.match(readFileSync("lib/actions/task-triggers.ts", "utf8"), /if \(context\.dealerId \|\| !allowed\)/);
  assert.doesNotMatch(readFileSync("components/modules/tasks/task-triggers.tsx", "utf8"), /company_id/);
});
