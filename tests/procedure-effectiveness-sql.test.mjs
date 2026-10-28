import test from "node:test";
import assert from "node:assert/strict";
import { createProcedureEffectivenessFixture, eids } from "../scripts/lib/procedure-effectiveness-fixture.mjs";

let f;
test.before(async () => { f = await createProcedureEffectivenessFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const flag = (task, step = 2, actor = eids.operator, kind = "unclear", note = "Which bolts first?") => f.command("flag.raise", { task_id: task, id: f.nextId(), step_no: step, kind, note }, actor);

// ---------- Outcomes ----------

test("outcomes per version: completion, duration, rework, handovers and exceptions, with data-quality limits", async () => {
  await f.release();
  const done = [];
  for (const hours of [2, 4, 6]) done.push(await f.task({ status: "completed", hours }));
  const noStart = await f.task();
  await f.db.query("update tasks set status='completed', completed_at=now() where id=$1", [noStart]);
  await f.task({ status: "in_progress", hours: 1 });
  await f.db.query("insert into handoff_acceptances values($1,$2,'accepted',0),($3,$2,'accepted',1)", [done[0], eids.company, done[1]]);
  await f.db.query("insert into handoff_returns(company_id,handoff_task_id,reason) values($1,$2,'quantity_mismatch')", [eids.company, done[1]]);
  await f.db.query("update tasks set status='open', completed_at=null where id=$1", [done[2]]);
  await f.db.query("update tasks set status='completed', completed_at=now() where id=$1", [done[2]]);
  const out = (await f.command("outcomes", { procedure_id: eids.sop }, eids.viewer)).versions[0];
  assert.equal(out.tasks, 5);
  assert.equal(out.completed, 4);
  assert.equal(out.duration_sample, 3);
  assert.equal(out.missing_duration, 1, "a task completed without a recorded start is a data gap, not a zero-hour task");
  assert.equal(Number(out.median_hours), 4);
  assert.equal(out.reopened, 1);
  assert.deepEqual([out.first_time_accepted, out.handoffs_accepted, out.handoff_returns], [1, 2, 1]);
  assert.equal(out.comparable, false);
  assert.ok(out.limits.some(l => /Only 4 completed tasks: too few to compare/.test(l)));
  assert.ok(out.limits.some(l => /1 completed task had no recorded start/.test(l)));
});

test("a version with no accepted handovers reports first-time acceptance as not captured", async () => {
  await f.release();
  const out = (await f.command("outcomes", { procedure_id: eids.sop })).versions[0];
  assert.equal(out.handoffs_accepted, 0);
  assert.ok(out.limits.includes("No accepted handovers: first-time acceptance is not captured"));
  assert.equal(out.avg_hours, null, "no durations means no average, not zero");
});

// ---------- Step flags ----------

test("employees who worked a task flag a step of the version it follows; others cannot", async () => {
  await f.release();
  const task = await f.task();
  const raised = await flag(task);
  assert.equal(raised.status, "open");
  await assert.rejects(flag(task), /already flagged this step on this task/);
  await assert.rejects(flag(task, 4), /Choose a step of the version this task follows/);
  await assert.rejects(flag(task, 0), /Choose a step of the version/);
  await assert.rejects(flag(task, 1, eids.operator, "bad"), /Choose what is wrong/);
  await assert.rejects(flag(task, 1, eids.operator2), /Only someone who worked on this task can flag/);
  await assert.rejects(flag(task, 1, eids.viewer), /not permitted for your role/);
  const unbound = (await f.db.query("insert into tasks(company_id,task_type,assigned_to) values($1,'general',$2) returning id", [eids.company, eids.operator])).rows[0].id;
  await assert.rejects(flag(unbound), /follows no procedure version/);
  const listed = await f.command("flags.list", { procedure_id: eids.sop }, eids.viewer);
  assert.equal(listed.rows[0].step_text, "Fit the die");
  assert.equal((await f.command("outcomes", { procedure_id: eids.sop })).step_flags[0].step_no, 2);
});

test("a flag request retried with the same id returns the same flag", async () => {
  await f.release();
  const task = await f.task();
  const id = f.nextId();
  const payload = { task_id: task, id, step_no: 1, kind: "workaround", note: "We skip isolation for small dies" };
  await f.command("flag.raise", payload, eids.operator);
  assert.deepEqual(await f.command("flag.raise", payload, eids.operator), { id, status: "open" });
});

// ---------- Acceptance: problem -> trial -> reviewed revision -> measured outcome ----------

test("acceptance: an improvement is traced from recurring flags through a trial to a reviewed SOP revision and a measured outcome", async () => {
  const v1 = await f.release();
  const flags = [];
  for (let i = 0; i < 5; i++) {
    const task = await f.task({ status: "completed", hours: 6 });
    flags.push((await flag(task, 2, eids.operator, "unclear", `Bolt order unclear ${i}`)).id);
  }
  const improvement = await f.command("improvement.propose", { procedure_id: eids.sop, id: f.nextId(), title: "Clarify bolt order", problem_summary: "Five operators asked which bolts to torque first", flag_ids: flags }, eids.operator);
  assert.equal(improvement.flag_count, 5);
  assert.equal(improvement.baseline_version_no, 1);
  const id = improvement.id;
  await assert.rejects(f.command("improvement.trial", { improvement_id: id, trial_plan: "Night shift tries the diagram" }, eids.operator), /Only the procedure owner, its backup or an owner\/admin/);
  await f.command("improvement.trial", { improvement_id: id, trial_plan: "Night shift on press 2 uses the numbered diagram for one week" });
  await assert.rejects(f.command("improvement.link_release", { improvement_id: id, version_id: v1.id }), /Only an adopted improvement/);
  await f.command("improvement.decide", { improvement_id: id, decision: "adopt", findings: "Trial die changes were 2 hours faster with no rework" });
  await assert.rejects(f.command("improvement.link_release", { improvement_id: id, version_id: v1.id }), /released after the improvement was proposed/);
  const v2 = await f.release("Numbered bolt diagram", [{ text: "Isolate the press" }, { text: "Fit the die, torquing bolts in diagram order" }, { text: "Run a trial billet" }]);
  await assert.rejects(f.command("improvement.measure", { improvement_id: id }), /Only a released improvement can be measured/);
  await f.command("improvement.link_release", { improvement_id: id, version_id: v2.id });
  await assert.rejects(f.command("improvement.measure", { improvement_id: id }), /No task has completed under the improved version yet/);
  for (let i = 0; i < 5; i++) await f.task({ status: "completed", hours: 4 });
  const measured = await f.command("improvement.measure", { improvement_id: id, note: "Sustained after one month" });
  assert.equal(measured.status, "measured");
  assert.equal(measured.outcome.comparable, true);
  assert.equal(Number(measured.outcome.before.median_hours), 6);
  assert.equal(Number(measured.outcome.after.median_hours), 4);
  assert.equal(measured.outcome.before.step_flags, 5);
  assert.equal(measured.resolution_version_no, 2);
  assert.equal(measured.flags.length, 5);
  assert.equal(measured.trial_findings, "Trial die changes were 2 hours faster with no rework");
  // The trace is permanent.
  await assert.rejects(f.db.query("update procedure_improvements set trial_findings='edited' where id=$1", [id]), /cannot be rewritten/);
  await assert.rejects(f.db.query("update procedure_improvements set status='trial' where id=$1", [id]), /not allowed/);
  await assert.rejects(f.db.query("delete from procedure_improvements where id=$1", [id]), /kept as history/);
});

test("rejecting an improvement returns its flags to the open queue", async () => {
  await f.release();
  const task = await f.task();
  const flagId = (await flag(task)).id;
  const imp = await f.command("improvement.propose", { procedure_id: eids.sop, id: f.nextId(), title: "Reorder steps", problem_summary: "Operators want to fit die first", flag_ids: [flagId] });
  await assert.rejects(f.command("improvement.propose", { procedure_id: eids.sop, id: f.nextId(), title: "Again", problem_summary: "Same flag twice", flag_ids: [flagId] }), /no longer open/);
  await assert.rejects(f.command("improvement.decide", { improvement_id: imp.id, decision: "adopt", findings: "Untested" }), /only while the improvement is in trial/);
  await f.command("improvement.decide", { improvement_id: imp.id, decision: "reject", findings: "Isolation first is a safety rule" });
  assert.equal((await f.command("flags.list", { procedure_id: eids.sop })).total_count, 1);
});

test("dismissing a flag needs a reason and a reviewer", async () => {
  await f.release();
  const flagId = (await flag(await f.task())).id;
  await assert.rejects(f.command("flag.dismiss", { flag_id: flagId, reason: "Duplicate" }, eids.operator), /Only the procedure owner/);
  await assert.rejects(f.command("flag.dismiss", { flag_id: flagId, reason: "x" }), /Record why the flag is dismissed/);
  assert.equal((await f.command("flag.dismiss", { flag_id: flagId, reason: "Covered by training" })).status, "dismissed");
  await assert.rejects(f.command("flag.dismiss", { flag_id: flagId, reason: "Again" }), /Only an open flag/);
});

test("proposals need a version in effect; tenancy and dealers are refused", async () => {
  await assert.rejects(f.command("improvement.propose", { procedure_id: eids.sop, id: f.nextId(), title: "Something", problem_summary: "No version yet", flag_ids: [] }), /no version in effect/);
  await f.release();
  await assert.rejects(f.command("outcomes", { procedure_id: eids.sop }, eids.foreign), /Procedure is unavailable/);
  await assert.rejects(f.command("outcomes", { procedure_id: eids.sop }, eids.dealer), /not permitted/);
  await assert.rejects(f.command("improvement.propose", { procedure_id: eids.sop, id: f.nextId(), title: "Something", problem_summary: "Viewer", flag_ids: [] }, eids.viewer), /not permitted/);
  await assert.rejects(f.asUser("select * from procedure_step_flags"), /permission denied/);
});
