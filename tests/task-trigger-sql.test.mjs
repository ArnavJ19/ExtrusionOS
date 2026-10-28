import test from "node:test";
import assert from "node:assert/strict";
import { createTaskTriggerFixture, xids, xid } from "../scripts/lib/task-trigger-fixture.mjs";

let f;
test.before(async () => { f = await createTaskTriggerFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const run = (request = crypto.randomUUID(), actor) => f.command("triggers.run", { request_id: request }, actor);
const dispatchRule = (fields = {}) => f.rule(xids.dispatchRule, { name: "Overdue dispatch follow-up", event_type: "order_dispatch_overdue", threshold: 2, assignee_mode: "role", assignee_role: "dispatch", ...fields });

// ---------- Creation, assignment and deduplication ----------

test("an overdue order creates one task for the least-loaded dispatcher; reruns create nothing", async () => {
  await f.db.exec(`insert into tasks(company_id,title,assigned_to) values('${xids.company}','Existing work','${xids.dispatcherA}')`);
  await dispatchRule();
  const first = await run();
  assert.deepEqual([first.created, first.existing, first.unassigned, first.replayed], [1, 0, 0, false]);
  const [task] = await f.tasks();
  assert.equal(task.assigned_to, xids.dispatcherB, "Arjun already has open work, so Bina gets it");
  assert.equal(task.task_type, "dispatch_follow_up");
  assert.match(task.title, /^Dispatch overdue: SO-0042/);
  assert.equal(task.trigger_source_id, xids.overdueOrder);
  const note = (await f.db.query(`select recipient_user_id, action_link from notifications where notification_type='task_trigger_assigned'`)).rows;
  assert.deepEqual(note.map((n) => n.recipient_user_id), [xids.dispatcherB]);
  const second = await run();
  assert.deepEqual([second.created, second.existing], [0, 1]);
  assert.equal((await f.tasks()).length, 1, "on time, dispatched and other companies' orders are ignored");
});

test("retrying the same request after a lost response returns the original result without side effects", async () => {
  await dispatchRule();
  const request = crypto.randomUUID();
  const first = await run(request);
  await f.db.exec(`update orders set expected_dispatch_date = current_date - 6 where id='${xids.overdueOrder}'`);
  const retry = await run(request);
  assert.deepEqual({ ...retry, replayed: false }, first, "same counts as the original run");
  assert.equal(retry.replayed, true);
  assert.equal((await f.tasks()).length, 1, "the replay did not evaluate the new due date");
  await assert.rejects(run(request, xids.foreign), /Invalid task trigger request/, "another company cannot read a run by id");
  await assert.rejects(f.command("triggers.run", { request_id: "not-a-uuid" }), /Invalid task trigger request/);
});

test("a rescheduled order that falls overdue again is a new occurrence; the first task keeps its event reference", async () => {
  await dispatchRule();
  await run();
  const [original] = await f.tasks();
  await f.db.exec(`update orders set expected_dispatch_date = current_date - 3 where id='${xids.overdueOrder}'`);
  assert.equal((await run()).created, 1);
  const all = await f.tasks();
  assert.equal(all.length, 2);
  assert.deepEqual(all[0].trigger_event_at, original.trigger_event_at);
  await assert.rejects(f.db.query(`update tasks set trigger_source_id='${xids.onTimeOrder}' where id='${original.id}'`), /trigger reference of a task cannot be changed/);
  await assert.rejects(f.db.query(`update tasks set trigger_key='x' where id='${original.id}'`), /cannot be changed/);
  await f.db.query(`update tasks set status='completed' where id='${original.id}'`);
});

test("a named employee falls back to the role when unavailable; without a fallback the work is unassigned and reported", async () => {
  await assert.rejects(dispatchRule({ assignee_mode: "person", assignee_role: null, assignee_user_id: xids.leftDispatcher }), /inactive or cannot take/);
  await assert.rejects(dispatchRule({ assignee_mode: "person", assignee_role: null, assignee_user_id: xids.quality }), /inactive or cannot take/, "QC cannot take dispatch work");
  await dispatchRule({ assignee_mode: "person", assignee_role: "dispatch", assignee_user_id: xids.dispatcherA });
  await f.db.exec(`update app_users set is_active=false where id='${xids.dispatcherA}'`);
  await run();
  const [task] = await f.tasks();
  assert.deepEqual([task.assigned_to, task.trigger_assignment, task.trigger_assignment_note], [xids.dispatcherB, "assigned", "The named employee was unavailable, so the fallback role was used"]);

  await f.reset();
  await dispatchRule({ assignee_mode: "person", assignee_role: null, assignee_user_id: xids.dispatcherA });
  await f.db.exec(`update app_users set is_active=false where id='${xids.dispatcherA}'`);
  const result = await run();
  assert.equal(result.unassigned, 1);
  const [lost] = await f.tasks();
  assert.deepEqual([lost.assigned_to, lost.trigger_assignment], [null, "unassigned"]);
  assert.match(lost.trigger_assignment_note, /no fallback role/);
  const alert = (await f.db.query(`select recipient_role, severity from notifications where notification_type='task_trigger_unassigned'`)).rows;
  assert.deepEqual(alert, [{ recipient_role: "dispatch_manager", severity: "warning" }]);
});

// ---------- Recovery ----------

test("unassigned work is listed for recovery and assigned only to an eligible employee, once", async () => {
  await f.rule(xids.quoteRule, { name: "Quote expiry follow-up", event_type: "quote_expiring", threshold: 3, assignee_mode: "role", assignee_role: "admin" });
  assert.equal((await run()).unassigned, 1, "no admin user exists");
  const list = await f.command("recovery.list", {}, xids.salesMgr);
  assert.equal(list.total_count, 1);
  const row = list.rows[0];
  assert.match(row.assignment_note, /No active admin employee/);
  assert.deepEqual(row.eligible.map((e) => e.role).sort(), ["sales", "sales_manager"], "a sales manager may assign within the sales team only");
  await assert.rejects(f.command("recovery.assign", { task_id: row.id, assignee_id: xids.dispatcherA }, xids.salesMgr), /cannot take this work/);
  await assert.rejects(f.command("recovery.assign", { task_id: row.id, assignee_id: xids.owner }, xids.salesMgr), /cannot take this work/, "outside the supervisor's team");
  await f.command("recovery.assign", { task_id: row.id, assignee_id: xids.sales }, xids.salesMgr);
  await assert.rejects(f.command("recovery.assign", { task_id: row.id, assignee_id: xids.sales }, xids.salesMgr), /already assigned or closed/);
  assert.equal((await f.command("recovery.list", {}, xids.salesMgr)).total_count, 0);
  await assert.rejects(f.command("recovery.assign", { task_id: row.id, assignee_id: xids.sales }, xids.dispatchMgr), /Triggered task is unavailable/, "a dispatch manager cannot see quote work");
});

test("retrying assignment applies the rule again once someone eligible is available", async () => {
  await f.rule(xids.quoteRule, { name: "Quote expiry follow-up", event_type: "quote_expiring", threshold: 3, assignee_mode: "role", assignee_role: "admin" });
  await run();
  const [task] = await f.tasks();
  const still = await f.command("recovery.retry", { task_id: task.id });
  assert.equal(still.assigned_to, null);
  await f.db.exec(`insert into app_users values('${xid(80)}','${xids.company}','admin',true,'New Admin',null)`);
  const retried = await f.command("recovery.retry", { task_id: task.id });
  assert.equal(retried.assigned_to, xid(80));
  assert.equal((await f.tasks())[0].trigger_assignment, "assigned");
});

// ---------- Event types ----------

test("a rejected inspection raises its task in the same transaction; re-rejection does not duplicate it", async () => {
  await f.rule(xids.qualityRule, { name: "Rejected lot disposition", event_type: "inspection_rejected", threshold: 0, assignee_mode: "role", assignee_role: "quality", priority: "high" });
  await f.db.exec(`insert into quality_inspections(id,company_id,batch_number,quantity_checked_kg) values('${xids.inspection}','${xids.company}','B-77',412.5)`);
  await f.db.exec(`update quality_inspections set status='rejected' where id='${xids.inspection}'`);
  let [task] = await f.tasks();
  assert.deepEqual([task.assigned_to, task.priority, task.title], [xids.quality, "high", "Rejected inspection: batch B-77 · 412.500 kg"]);
  await f.db.exec(`update quality_inspections set status='rework' where id='${xids.inspection}'; update quality_inspections set status='rejected' where id='${xids.inspection}'`);
  assert.equal((await f.tasks()).length, 1);
  assert.equal((await run()).existing, 1, "the scheduled scan sees the same task");
  await f.db.exec(`insert into quality_inspections(id,company_id,status,inspection_date) values('${xid(41)}','${xids.company}','rejected',now() - interval '30 days')`);
  [task] = await f.tasks();
  assert.equal((await f.tasks()).length, 2, "a direct insert as rejected is an event too");
  await f.db.exec(`delete from tasks where trigger_source_id='${xid(41)}'`);
  assert.equal((await run()).created, 0, "the scan ignores rejections older than the look-back");
});

test("breakdown, quote and invoice rules use their thresholds; working-day due dates skip Sunday", async () => {
  await f.rule(xids.breakdownRule, { name: "Breakdown escalation", event_type: "breakdown_open", threshold: 4, assignee_mode: "role", assignee_role: "production_manager" });
  await f.rule(xids.quoteRule, { name: "Quote expiry", event_type: "quote_expiring", threshold: 3, assignee_mode: "role", assignee_role: "sales" });
  await f.rule(xids.invoiceRule, { name: "Collections", event_type: "invoice_overdue", threshold: 30, assignee_mode: "role", assignee_role: "accounts", due_days: 2, due_calendar: "working_days" });
  const result = await run();
  assert.equal(result.created, 3);
  const titles = (await f.tasks()).map((t) => t.title).sort();
  assert.match(titles[0], /^Breakdown open over 4 h: PRESS-2/);
  assert.match(titles[1], /^Payment overdue: INV-0009/);
  assert.match(titles[2], /^Quotation expiring: QT-0101/);
  const invoiceTask = (await f.tasks()).find((t) => t.trigger_source_type === "invoice");
  assert.equal(invoiceTask.assigned_to, xids.accounts);
  assert.notEqual(new Date(`${invoiceTask.due}T00:00:00Z`).getUTCDay(), 0, "never due on a Sunday");
  const due = async (from, days, calendar) => (await f.db.query(`select private.task_trigger_due($1::date,$2,$3)::text d`, [from, days, calendar])).rows[0].d;
  assert.equal(await due("2026-10-24", 1, "working_days"), "2026-10-26", "Saturday + 1 working day is Monday");
  assert.equal(await due("2026-10-25", 0, "working_days"), "2026-10-26", "work found on Sunday is due Monday");
  assert.equal(await due("2026-10-24", 1, "calendar"), "2026-10-25");
  assert.equal(await due("2026-10-23", 2, "working_days"), "2026-10-26", "Friday + 2 working days skips Sunday");
});

test("the task list shows whether the source condition still holds", async () => {
  await dispatchRule();
  await run();
  assert.equal((await f.command("tasks.list", {})).rows[0].source_open, true);
  await f.db.exec(`update orders set current_stage='dispatched' where id='${xids.overdueOrder}'`);
  const row = (await f.command("tasks.list", { rule_id: xids.dispatchRule })).rows[0];
  assert.equal(row.source_open, false, "dispatched since: the follow-up can be closed");
  assert.deepEqual(row.eligible, [], "assignee choices are only listed for recovery");
});

// ---------- Rule validation ----------

test("rules are validated: event roles, thresholds, stale edits, immutable event", async () => {
  await assert.rejects(dispatchRule({ assignee_role: "quality" }), /quality role cannot take this kind of work/);
  await assert.rejects(f.rule(xids.breakdownRule, { name: "Breakdown", event_type: "breakdown_open", threshold: 0, assignee_mode: "role", assignee_role: "production" }), /threshold within the range/);
  await assert.rejects(f.rule(xids.qualityRule, { name: "QC rejects", event_type: "inspection_rejected", threshold: 2, assignee_mode: "role", assignee_role: "quality" }), /threshold within the range/);
  await assert.rejects(dispatchRule({ name: "x" }), /Name the rule/);
  await assert.rejects(dispatchRule({ event_type: "order_cancelled" }), /supported trigger event/);
  await assert.rejects(dispatchRule({ assignee_mode: "role", assignee_role: null }), /Choose who receives the work/);
  await assert.rejects(dispatchRule({ threshold: "two" }), /whole numbers/);
  const saved = await dispatchRule();
  await assert.rejects(dispatchRule({ name: "Renamed" }), /changed by someone else/, "an edit must name the version it read");
  await assert.rejects(dispatchRule({ name: "Renamed", expected_updated_at: "2020-01-01T00:00:00Z" }), /changed by someone else/);
  await assert.rejects(dispatchRule({ event_type: "quote_expiring", threshold: 1, assignee_role: "sales", expected_updated_at: saved.updated_at }), /event of an existing rule cannot be changed/);
  const renamed = await dispatchRule({ name: "Renamed", threshold: 10, expected_updated_at: saved.updated_at });
  assert.notEqual(renamed.updated_at, saved.updated_at);
  assert.equal((await run()).created, 0, "SO-0042 is only 5 days late, under the new 10-day threshold");
  await assert.rejects(f.rule(xids.dispatchRule, { name: "Hijack", event_type: "order_dispatch_overdue", threshold: 1, assignee_mode: "role", assignee_role: "dispatch" }, xids.foreign), /Trigger rule is unavailable/);
});

test("an inactive rule creates nothing; a company keeps at most 50 rules", async () => {
  await dispatchRule({ is_active: false });
  assert.equal((await run()).created, 0);
  for (let i = 0; i < 49; i += 1) await f.rule(xid(200 + i), { name: `Rule ${i}`, event_type: "quote_expiring", threshold: 1, assignee_mode: "role", assignee_role: "sales", is_active: false });
  await assert.rejects(f.rule(xid(300), { name: "One too many", event_type: "quote_expiring", threshold: 1, assignee_mode: "role", assignee_role: "sales" }), /at most 50/);
});

// ---------- Access ----------

test("only managers edit rules; supervisors see their own events; others and other companies see nothing", async () => {
  await dispatchRule();
  await f.rule(xids.quoteRule, { name: "Quote expiry", event_type: "quote_expiring", threshold: 3, assignee_mode: "role", assignee_role: "sales" });
  for (const actor of [xids.viewer, xids.sales, xids.dealer, xids.accounts, xids.dispatcherA]) await assert.rejects(f.command("rules.list", {}, actor), /not permitted/);
  await assert.rejects(f.rule(xid(301), { name: "Supervisor rule", event_type: "order_dispatch_overdue", threshold: 1, assignee_mode: "role", assignee_role: "dispatch" }, xids.dispatchMgr), /not permitted/);
  assert.deepEqual((await f.command("rules.list", {}, xids.dispatchMgr)).rows.map((r) => r.event_type), ["order_dispatch_overdue"]);
  const supervisorRun = await run(undefined, xids.dispatchMgr);
  assert.deepEqual(supervisorRun.rules.map((r) => r.rule_id), [xids.dispatchRule], "a supervisor's run covers only their events");
  assert.deepEqual((await f.command("rules.list", {}, xids.foreign)).rows, []);
  assert.deepEqual(await f.asUser("select id from task_trigger_rules", [], xids.sales), [], "row security hides rules");
  await assert.rejects(f.asUser(`insert into task_trigger_rules(id,company_id,name,event_type,assignee_mode,assignee_role,created_by,updated_by) values('${xid(302)}','${xids.company}','Direct','quote_expiring','role','sales','${xids.owner}','${xids.owner}')`), /permission denied/);
  await assert.rejects(f.asUser("select public.task_trigger_command('rules.list','{}'::jsonb)", [], ""), /Authentication required/);
});

test("the scheduler entry point runs every company's rules once and cannot be called through the API", async () => {
  await dispatchRule();
  assert.equal((await f.db.query("select private.run_task_triggers_for_all() n")).rows[0].n, 1);
  assert.equal((await f.db.query("select private.run_task_triggers_for_all() n")).rows[0].n, 1);
  assert.equal((await f.tasks()).length, 1, "scheduled reruns create nothing twice");
  const runs = (await f.db.query("select started_by, result from task_trigger_runs order by started_at")).rows;
  assert.deepEqual(runs.map((r) => [r.started_by, r.result.created, r.result.existing, r.result.scheduled]), [[null, 1, 0, true], [null, 0, 1, true]]);
  const last = (await f.command("rules.list", {})).last_run;
  assert.equal(last.created, 0, "the last run shown is the most recent scheduled one");
  await assert.rejects(f.asUser("select private.run_task_triggers_for_all()"), /permission denied/);
});
