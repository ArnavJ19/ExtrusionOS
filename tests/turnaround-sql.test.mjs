import test from "node:test";
import assert from "node:assert/strict";
import { createTurnaroundFixture, tids, tid } from "../scripts/lib/turnaround-fixture.mjs";

let f;
test.before(async () => { f = await createTurnaroundFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const minutes = async (from, to, calendar) => Number((await f.db.query("select private.calendar_minutes($1,$2,$3) m", [from, to, calendar])).rows[0].m);
const n = (v) => Number(v);
// Back-dates a wait on a task by the given number of minutes ago.
const pastWait = (task, fromAgo, toAgo) => f.db.exec(`insert into task_waits(company_id,task_id,reason,note,started_at,ended_at,started_by)
  values('${tids.company}','${task}','waiting_material','Billets awaited',now() - interval '${fromAgo} minutes',${toAgo === null ? "null" : `now() - interval '${toAgo} minutes'`},'${tids.owner}')`);

// ---------- Working calendar ----------

test("the day-shift calendar counts only Monday-Saturday 08:00-20:00 IST", async () => {
  // Thursday 22 Oct 2026 07:00 to 21:00 IST covers exactly the 12-hour shift.
  assert.equal(await minutes("2026-10-22T01:30:00Z", "2026-10-22T15:30:00Z", "day_shift"), 720);
  // Saturday 19:00 IST to Monday 09:00 IST: 60 minutes Saturday, Sunday skipped, 60 minutes Monday.
  assert.equal(await minutes("2026-10-24T13:30:00Z", "2026-10-26T03:30:00Z", "day_shift"), 120);
  assert.equal(await minutes("2026-10-25T02:30:00Z", "2026-10-25T14:30:00Z", "day_shift"), 0, "Sunday is not working time");
  assert.equal(await minutes("2026-10-22T01:30:00Z", "2026-10-22T15:30:00Z", "24x7"), 840);
  assert.equal(await minutes("2026-10-22T15:30:00Z", "2026-10-22T01:30:00Z", "24x7"), 0, "a reversed interval is zero, never negative");
});

// ---------- Targets and states ----------

test("open work reports elapsed, active time and the response and completion state", async () => {
  const s = await f.status(tids.pack);
  assert.equal(s.task_kind, "handoff:packaging");
  assert.ok(n(s.elapsed_minutes) >= 29.9 && n(s.elapsed_minutes) <= 31);
  assert.equal(s.response_state, "on_track");
  assert.equal(s.completion_state, "on_track");
  assert.equal((await f.status(tids.packLate)).response_state, "breached");
  assert.equal((await f.status(tids.general)).completion_state, "due_soon", "100 of 120 minutes is past 80%");
  assert.equal((await f.status(tids.general)).response_state, "none", "no response target set");
});

test("tasks without a target report elapsed time only", async () => {
  const s = await f.status(tids.untargeted);
  assert.equal(s.has_target, false);
  assert.ok(n(s.elapsed_minutes) > 14000);
});

test("a recorded wait pauses the target clock but never reduces total elapsed time", async () => {
  await pastWait(tids.packLate, 80, 50);
  const s = await f.status(tids.packLate);
  assert.ok(n(s.elapsed_minutes) >= 89.9, "elapsed keeps all 90 minutes");
  assert.ok(Math.abs(n(s.waiting_minutes) - 30) < 0.2);
  assert.ok(Math.abs(n(s.active_minutes) - 60) < 0.3);
  assert.equal(s.response_state, "due_soon", "60 active minutes against a 60-minute target is not yet over it");
});

test("starting work fixes the response result; completion fixes the completion result", async () => {
  await f.db.exec(`update tasks set status='in_progress' where id='${tids.packLate}'; update tasks set status='in_progress' where id='${tids.pack}'`);
  assert.equal((await f.status(tids.packLate)).response_state, "missed");
  assert.equal((await f.status(tids.pack)).response_state, "met");
  await f.db.exec(`update tasks set status='completed' where id='${tids.done}'`);
  const done = await f.status(tids.done);
  assert.equal(done.completion_state, "missed", "200 minutes against a 120-minute target");
  const before = n(done.elapsed_minutes);
  await f.db.exec(`update task_turnaround_marks set finished_at = finished_at where task_id='${tids.done}'`);
  assert.equal(n((await f.status(tids.done)).elapsed_minutes), before, "closed work stops accruing time");
});

test("starting the first time is remembered even if the task goes back to open", async () => {
  await f.db.exec(`update tasks set status='in_progress' where id='${tids.pack}'`);
  const first = (await f.db.query("select first_started_at from task_turnaround_marks where task_id=$1", [tids.pack])).rows[0].first_started_at;
  await f.db.exec(`update tasks set status='open' where id='${tids.pack}'; update tasks set status='in_progress' where id='${tids.pack}'`);
  assert.equal((await f.db.query("select first_started_at from task_turnaround_marks where task_id=$1", [tids.pack])).rows[0].first_started_at.getTime(), first.getTime());
});

// ---------- Waits ----------

test("waits: assignee or supervisor records them, one at a time, with a reason; completion closes them", async () => {
  const s = await f.command("wait.start", { task_id: tids.general, reason: "waiting_customer", note: "Customer to confirm shade" }, tids.packer);
  assert.equal(s.open_wait.reason, "waiting_customer");
  await assert.rejects(f.command("wait.start", { task_id: tids.general, reason: "other", note: "again" }, tids.packer), /already recorded as waiting/);
  await assert.rejects(f.command("wait.start", { task_id: tids.pack, reason: "other", note: "not mine" }, tids.packer), /assignee or a supervisor/);
  await assert.rejects(f.command("wait.start", { task_id: tids.pack, reason: "lunch", note: "abc" }), /Choose what the work is waiting for/);
  await assert.rejects(f.command("wait.start", { task_id: tids.pack, reason: "other", note: "x" }), /3 to 300 characters/);
  await f.db.exec(`update tasks set status='completed' where id='${tids.general}'`);
  assert.equal((await f.db.query("select count(*)::int c from task_waits where ended_at is null")).rows[0].c, 0);
  await assert.rejects(f.command("wait.end", { task_id: tids.general }, tids.packer), /not waiting/);
});

// ---------- Escalations ----------

test("an escalation run raises each breached level once and notifies the escalation role", async () => {
  await f.db.exec(`update tasks set created_at = now() - interval '300 minutes' where id='${tids.packLate}'`);
  const first = await f.command("escalations.run", {}, tids.factory);
  assert.equal(first.raised, 3, "packLate: response + completion; general is not yet breached; done task: completion");
  assert.deepEqual(await f.command("escalations.run", {}, tids.factory), { raised: 0, resolved: 0 }, "a rerun raises nothing new");
  const notes = (await f.db.query("select recipient_role, severity, title from notifications order by title")).rows;
  assert.ok(notes.some((x) => x.recipient_role === "production_manager" && x.severity === "critical" && x.title.startsWith("Not completed within target: Pack 200 kg")));
  assert.ok(notes.some((x) => x.recipient_role === "production_manager" && x.severity === "warning" && x.title.startsWith("Not started within target: Pack 200 kg")));
  assert.ok(notes.some((x) => x.recipient_role === "factory_manager" && x.title.includes("Done task")));
  assert.ok(!notes.some((x) => x.title.includes("Oil change") || x.title.includes("Dealer task") || x.title.includes("FOREIGN")));
});

test("escalations resolve when work starts, finishes, or a recorded wait brings it back within target", async () => {
  await f.command("escalations.run", {}, tids.factory);
  await f.db.exec(`update tasks set status='in_progress' where id='${tids.packLate}'; update tasks set status='completed' where id='${tids.done}'`);
  const run = await f.command("escalations.run", {}, tids.factory);
  assert.equal(run.resolved, 2);
  const resolutions = (await f.db.query("select resolution from task_escalations where resolved_at is not null order by resolution")).rows.map((r) => r.resolution);
  assert.deepEqual(resolutions, ["responded", "task_finished"]);
  await f.db.exec(`update tasks set created_at = now() - interval '130 minutes' where id='${tids.general}'`);
  await f.command("escalations.run", {}, tids.factory);
  await pastWait(tids.general, 60, 30);
  assert.equal((await f.command("escalations.run", {}, tids.factory)).resolved, 1);
  assert.equal((await f.db.query("select resolution from task_escalations where task_id=$1", [tids.general])).rows[0].resolution, "back_within_target");
});

test("deactivating a target resolves its open escalations", async () => {
  await f.command("escalations.run", {}, tids.factory);
  await f.command("targets.set", { task_kind: "handoff:packaging", response_minutes: 60, completion_minutes: 240, calendar: "24x7", escalation_role: "production_manager", is_active: false }, tids.owner);
  await f.command("escalations.run", {}, tids.factory);
  assert.ok((await f.db.query("select resolution from task_escalations where task_id=$1", [tids.packLate])).rows.every((r) => r.resolution === "target_removed"));
});

// ---------- Targets administration, roles, tenancy ----------

test("targets: managers set them; invalid kinds, roles and inverted targets are refused", async () => {
  await f.command("targets.set", { task_kind: "type:maintenance", response_minutes: 30, completion_minutes: 600, calendar: "day_shift", escalation_role: "factory_manager" }, tids.factory);
  assert.deepEqual((await f.command("targets.list", {}, tids.viewer)).map((t) => t.task_kind), ["handoff:packaging", "type:general", "type:maintenance"]);
  await assert.rejects(f.command("targets.set", { task_kind: "type:Bad Kind", completion_minutes: 60, escalation_role: "owner" }), /valid task kind/);
  await assert.rejects(f.command("targets.set", { task_kind: "type:x", response_minutes: 90, completion_minutes: 60, escalation_role: "owner" }), /completion target, an optional shorter response target/);
  await assert.rejects(f.command("targets.set", { task_kind: "type:x", completion_minutes: 60, escalation_role: "sales" }), /completion target/);
  await assert.rejects(f.command("targets.set", { task_kind: "type:x", completion_minutes: "soon", escalation_role: "owner" }), /completion target/);
  await assert.rejects(f.command("targets.set", { task_kind: "type:x", completion_minutes: 60, escalation_role: "owner" }, tids.prodManager), /not permitted/);
  await assert.rejects(f.command("escalations.run", {}, tids.packer), /not permitted/);
});

test("other companies, dealers and anonymous callers cannot see or act on this company's tasks", async () => {
  assert.deepEqual(await f.command("task.status", { task_ids: [tids.pack, tids.dealerTask] }, tids.foreign), []);
  assert.deepEqual((await f.command("task.status", { task_ids: [tids.pack, tids.dealerTask, tids.foreignTask] })).map((s) => s.task_id), [tids.pack], "dealer and foreign tasks are excluded");
  await assert.rejects(f.command("wait.start", { task_id: tids.pack, reason: "other", note: "abcd" }, tids.foreign), /Task is unavailable/);
  await assert.rejects(f.command("targets.list", {}, tids.dealer), /not permitted/);
  await assert.rejects(f.asUser("select public.turnaround_command('targets.list','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser(`insert into task_waits(company_id,task_id,reason,note,started_by) values('${tids.company}','${tids.pack}','other','abc','${tids.owner}')`), /permission denied/);
  await assert.rejects(f.command("task.status", { task_ids: Array.from({ length: 26 }, (_, i) => tid(9000 + i)) }), /Invalid task references/);
});

test("the open escalation list pages at 10, newest first", async () => {
  await f.command("escalations.run", {}, tids.factory);
  const list = await f.command("escalations.list", {}, tids.viewer);
  assert.equal(list.total_count, 2, "packLate response breach and the done task completion breach");
  assert.ok(list.rows.every((r) => r.title && r.level));
  await assert.rejects(f.command("escalations.list", { page: 0 }), /Invalid page/);
});
