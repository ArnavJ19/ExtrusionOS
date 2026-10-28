import test from "node:test";
import assert from "node:assert/strict";
import { createBulkQueueFixture, qids, qid } from "../scripts/lib/bulk-queue-fixture.mjs";

let f;
test.before(async () => { f = await createBulkQueueFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const task = async (id) => (await f.db.query("select status, assigned_to, due_date::text due, priority, assigned_by_user_id from tasks where id=$1", [id])).rows[0];
const job = async (id) => (await f.db.query("select planned_date::text planned, shift from production_jobs where id=$1", [id])).rows[0];
const assign = (ids, to = qids.operator) => ({ target: "tasks", action: "assign", value: to, ids });

// ---------- Acceptance: eligible records change, every rejection is explained ----------

test("a bulk assignment changes only eligible tasks and explains each rejection", async () => {
  const ids = [qids.tOpen, qids.tProgress, qids.tDone, qids.tDealer, qids.tForeign, qids.tAssignedOp];
  await f.command("bulk.preview", assign(ids));
  assert.equal((await task(qids.tOpen)).assigned_to, null, "preview writes nothing");
  const { preview, applied } = await f.previewAndApply(assign(ids));
  const p = f.byId(preview.results);
  assert.deepEqual([p[qids.tOpen].outcome, p[qids.tProgress].outcome, p[qids.tDone].outcome, p[qids.tDealer].outcome, p[qids.tForeign].outcome, p[qids.tAssignedOp].outcome],
    ["will_change", "will_change", "rejected", "rejected", "unavailable", "unchanged"]);
  assert.equal(p[qids.tDone].message, "Task is completed");
  assert.equal(p[qids.tDealer].message, "Dealer tasks are managed by the dealership");
  assert.equal(preview.changed_count, 0);
  const a = f.byId(applied.results);
  assert.equal(applied.results.length, ids.length, "every selected record has an outcome");
  assert.equal(applied.changed_count, 2);
  assert.deepEqual([a[qids.tOpen].outcome, a[qids.tProgress].outcome], ["changed", "changed"]);
  assert.deepEqual(await task(qids.tOpen), { status: "open", assigned_to: qids.operator, due: null, priority: "normal", assigned_by_user_id: qids.owner });
  assert.equal((await task(qids.tDone)).assigned_to, null);
});

test("duplicated selections are reported, not silently dropped", async () => {
  const { applied } = await f.previewAndApply(assign([qids.tOpen, qids.tOpen]));
  assert.deepEqual(applied.results.map((r) => r.outcome), ["changed", "duplicate_selection"]);
});

test("a record changed after the preview is rejected instead of overwritten", async () => {
  const preview = await f.command("bulk.preview", assign([qids.tOpen, qids.tProgress]));
  const expected = Object.fromEntries(preview.results.map((r) => [r.id, r.fingerprint]));
  await f.db.exec(`update tasks set assigned_to='${qids.operator2}' where id='${qids.tOpen}'`);
  const applied = await f.command("bulk.apply", { ...assign([qids.tOpen, qids.tProgress]), expected, request_id: qid(5000) });
  const a = f.byId(applied.results);
  assert.equal(a[qids.tOpen].outcome, "rejected");
  assert.match(a[qids.tOpen].message, /Changed since the preview/);
  assert.equal(a[qids.tProgress].outcome, "changed");
  assert.equal((await task(qids.tOpen)).assigned_to, qids.operator2, "the newer assignment survives");
});

test("applying without a preview fingerprint for a record rejects that record", async () => {
  const applied = await f.command("bulk.apply", { ...assign([qids.tOpen]), expected: {}, request_id: qid(5000) });
  assert.equal(applied.results[0].outcome, "rejected");
  await assert.rejects(f.command("bulk.apply", { ...assign([qids.tOpen]), request_id: qid(5001) }), /Preview the change before applying/);
});

test("retrying an apply returns the recorded outcome and writes nothing again", async () => {
  const { applied, expected } = await f.previewAndApply(assign([qids.tOpen]));
  await f.db.exec(`update tasks set assigned_to=null where id='${qids.tOpen}'`);
  const retry = await f.command("bulk.apply", { ...assign([qids.tOpen]), expected, request_id: qid(5000) });
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.results, applied.results);
  assert.equal((await task(qids.tOpen)).assigned_to, null, "a replay never reapplies");
  await assert.rejects(f.command("bulk.apply", { ...assign([qids.tOpen], qids.operator2), expected, request_id: qid(5000) }), /already used for different details/);
});

// ---------- Values and limits ----------

test("new values are validated once: employee, dates, priority and shift", async () => {
  await assert.rejects(f.command("bulk.preview", assign([qids.tOpen], qids.inactive)), /active employee/);
  await assert.rejects(f.command("bulk.preview", assign([qids.tOpen], qids.foreign)), /active employee/);
  await assert.rejects(f.command("bulk.preview", assign([qids.tOpen], qids.dealerUser)), /active employee/);
  await assert.rejects(f.command("bulk.preview", { target: "tasks", action: "due_date", value: day(-1), ids: [qids.tOpen] }), /from today up to one year/);
  await assert.rejects(f.command("bulk.preview", { target: "tasks", action: "due_date", value: day(400), ids: [qids.tOpen] }), /from today up to one year/);
  await assert.rejects(f.command("bulk.preview", { target: "tasks", action: "due_date", value: "31/12/2026", ids: [qids.tOpen] }), /valid date/);
  await assert.rejects(f.command("bulk.preview", { target: "tasks", action: "priority", value: "asap", ids: [qids.tOpen] }), /valid priority/);
  await assert.rejects(f.command("bulk.preview", { target: "production_jobs", action: "shift", value: "x".repeat(21), ids: [qids.jPlanned] }), /shift name/);
  await assert.rejects(f.command("bulk.preview", { target: "tasks", action: "planned_date", value: day(1), ids: [qids.tOpen] }), /supported bulk change/);
});

test("selections are bounded to 1-50 valid references", async () => {
  await assert.rejects(f.command("bulk.preview", assign([])), /between 1 and 50/);
  await assert.rejects(f.command("bulk.preview", assign(Array.from({ length: 51 }, (_, i) => qid(9000 + i)))), /between 1 and 50/);
  await assert.rejects(f.command("bulk.preview", assign(["not-a-uuid"])), /invalid record reference/);
  const fifty = await f.command("bulk.preview", assign(Array.from({ length: 50 }, (_, i) => qid(9000 + i))));
  assert.ok(fifty.results.every((r) => r.outcome === "unavailable"));
});

test("due date and priority changes report the before and after values", async () => {
  const due = day(5);
  const { applied } = await f.previewAndApply({ target: "tasks", action: "due_date", value: due, ids: [qids.tProgress, qids.tOpen] });
  assert.deepEqual(applied.results.map((r) => r.message), [`Due 2030-01-01 → ${due}`, `Due not set → ${due}`]);
  const prio = await f.previewAndApply({ target: "tasks", action: "priority", value: "urgent", ids: [qids.tOpen] }, qids.owner, qid(5001));
  assert.equal(prio.applied.results[0].message, "Priority normal → urgent");
  assert.equal((await task(qids.tOpen)).priority, "urgent");
});

// ---------- Supervisor scope and handoff teams ----------

test("a production manager reassigns only within production, and never takes sales work", async () => {
  await assert.rejects(f.command("bulk.preview", assign([qids.tOpen], qids.driver), qids.prodManager), /teams you supervise/);
  const { applied } = await f.previewAndApply(assign([qids.tOpen, qids.tSales, qids.tAssignedOp], qids.operator2), qids.prodManager);
  const a = f.byId(applied.results);
  assert.equal(a[qids.tOpen].outcome, "changed");
  assert.equal(a[qids.tSales].outcome, "rejected");
  assert.equal(a[qids.tSales].message, "Assigned to someone outside the teams you supervise");
  assert.equal(a[qids.tAssignedOp].outcome, "changed", "work of one production employee may move to another");
});

test("a dispatch handoff can be assigned only to the dispatch team", async () => {
  const toProduction = await f.command("bulk.preview", assign([qids.tHandoffDispatch], qids.operator));
  assert.equal(toProduction.results[0].message, "This handoff belongs to the dispatch team");
  const { applied } = await f.previewAndApply(assign([qids.tHandoffDispatch], qids.driver), qids.dispatchManager);
  assert.equal(applied.results[0].outcome, "changed");
});

// ---------- Production jobs ----------

test("only planned jobs that are not on the press schedule are rescheduled; others say why", async () => {
  const date = day(3);
  const { applied } = await f.previewAndApply({ target: "production_jobs", action: "planned_date", value: date, ids: [qids.jPlanned, qids.jPlanned2, qids.jRunning, qids.jScheduled, qids.jReady, qids.jForeign] }, qids.prodManager);
  const a = f.byId(applied.results);
  assert.deepEqual([a[qids.jPlanned].outcome, a[qids.jPlanned2].outcome, a[qids.jRunning].outcome, a[qids.jScheduled].outcome, a[qids.jReady].outcome, a[qids.jForeign].outcome],
    ["changed", "changed", "rejected", "rejected", "rejected", "unavailable"]);
  assert.match(a[qids.jRunning].message, /this job is in progress/);
  assert.match(a[qids.jScheduled].message, /On the press schedule/);
  assert.match(a[qids.jReady].message, /this job is ready/);
  assert.equal(a[qids.jPlanned].message, `Planned 2030-01-10 → ${date}`);
  assert.deepEqual(await job(qids.jPlanned2), { planned: date, shift: null });
  assert.deepEqual(await job(qids.jRunning), { planned: "2030-01-10", shift: "A" });
});

test("shift changes skip jobs already on that shift", async () => {
  const { applied } = await f.previewAndApply({ target: "production_jobs", action: "shift", value: "A", ids: [qids.jPlanned, qids.jPlanned2] });
  assert.deepEqual(applied.results.map((r) => r.outcome), ["unchanged", "changed"]);
  assert.equal((await job(qids.jPlanned2)).shift, "A");
});

// ---------- Roles, tenancy, audit ----------

test("unauthorised roles, dealers, other companies and anonymous callers are refused", async () => {
  for (const actor of [qids.operator, qids.salesRep, qids.viewer, qids.dealerUser]) await assert.rejects(f.command("bulk.preview", assign([qids.tOpen]), actor), /not permitted/);
  await assert.rejects(f.command("bulk.preview", { target: "production_jobs", action: "shift", value: "B", ids: [qids.jPlanned] }, qids.dispatchManager), /not permitted/);
  const foreign = await f.command("bulk.preview", { target: "tasks", action: "priority", value: "low", ids: [qids.tOpen] }, qids.foreign);
  assert.equal(foreign.results[0].outcome, "unavailable");
  await assert.rejects(f.asUser("select public.bulk_queue_command('bulk.preview','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser("update tasks set priority='low'", [], qids.owner), /permission denied/);
});

test("each apply is logged with its outcomes; employees see only their own operations", async () => {
  await f.previewAndApply(assign([qids.tOpen, qids.tDone]));
  await f.previewAndApply({ target: "production_jobs", action: "shift", value: "B", ids: [qids.jPlanned] }, qids.prodManager, qid(5002));
  const log = (await f.db.query("select target, action, changed_count, jsonb_array_length(results) n from bulk_queue_operations order by created_at")).rows;
  assert.deepEqual(log, [{ target: "tasks", action: "assign", changed_count: 1, n: 2 }, { target: "production_jobs", action: "shift", changed_count: 1, n: 1 }]);
  assert.equal((await f.asUser("select id from bulk_queue_operations", [], qids.prodManager)).length, 1);
  assert.equal((await f.asUser("select id from bulk_queue_operations", [], qids.owner)).length, 2);
  assert.equal((await f.asUser("select id from bulk_queue_operations", [], qids.foreign)).length, 0);
});
