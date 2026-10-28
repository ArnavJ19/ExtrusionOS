import test from "node:test";
import assert from "node:assert/strict";
import { createCompletionCriteriaFixture, kids, kid } from "../scripts/lib/completion-criteria-fixture.mjs";

let f;
test.before(async () => { f = await createCompletionCriteriaFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const dispatched = { source_type: "order", states: ["dispatched", "delivered"] };
const status = async (task) => (await f.db.query("select status from tasks where id=$1", [task])).rows[0].status;

// ---------- Source state, wrong source, reversal ----------

test("a task cannot close until its linked order is dispatched; completion records the evaluation", async () => {
  await f.addCriterion(kids.task, kid(200), "source_state", "Order dispatched", dispatched);
  await assert.rejects(f.complete(kids.task), /cannot be completed yet: The order is packing; it must be dispatched or delivered/);
  assert.equal(await status(kids.task), "open");
  await f.db.exec(`update orders set current_stage='dispatched' where id='${kids.order}'`);
  await f.complete(kids.task);
  const checks = (await f.db.query("select event, evaluation from task_completion_checks where task_id=$1", [kids.task])).rows;
  assert.deepEqual(checks.map((c) => [c.event, c.evaluation.state]), [["completed", "met"]]);
});

test("re-linking a task to another record fails the criterion, even in the same update as completion", async () => {
  await f.addCriterion(kids.task, kid(200), "source_state", "Order dispatched", dispatched);
  await f.db.exec(`update orders set current_stage='dispatched' where id='${kids.order}'`);
  await assert.rejects(f.db.query(`update tasks set related_entity_id='${kids.order2}', status='completed' where id='${kids.task}'`), /different record than the one this criterion checks/);
  await f.db.exec(`update tasks set related_entity_id='${kids.foreignOrder}' where id='${kids.task}'`);
  const evaluation = await f.evaluate(kids.task);
  assert.match(evaluation.criteria[0].reason, /different record/, "a foreign order already dispatched does not satisfy it");
  await f.db.exec(`update tasks set related_entity_id='${kids.order}' where id='${kids.task}'`);
  await f.complete(kids.task);
});

test("a completed task whose outcome is reversed appears for review and can be reopened with a reason", async () => {
  await f.addCriterion(kids.task, kid(200), "source_state", "Order dispatched", dispatched);
  await f.db.exec(`update orders set current_stage='dispatched' where id='${kids.order}'`);
  await f.complete(kids.task);
  assert.equal((await f.command("review.list", {}, kids.prodMgr)).total_count, 0);
  await f.db.exec(`update orders set current_stage='packing' where id='${kids.order}'`);
  const review = await f.command("review.list", {}, kids.prodMgr);
  assert.equal(review.total_count, 1);
  assert.match(review.rows[0].evaluation.criteria[0].reason, /order is packing/);
  await assert.rejects(f.command("task.reopen", { task_id: kids.task, reason: "x" }, kids.prodMgr), /3 to 300 characters/);
  await assert.rejects(f.command("task.reopen", { task_id: kids.task, reason: "Dispatch reversed" }, kids.dispatcher), /not permitted/);
  await f.command("task.reopen", { task_id: kids.task, reason: "Dispatch reversed at gate" }, kids.prodMgr);
  assert.equal(await status(kids.task), "open");
  const note = (await f.db.query("select recipient_user_id, body from notifications where notification_type='task_reopened'")).rows[0];
  assert.deepEqual([note.recipient_user_id, note.body], [kids.dispatcher, "Prod Mgr Rao: Dispatch reversed at gate"]);
  await assert.rejects(f.command("task.reopen", { task_id: kids.task, reason: "Again please" }, kids.prodMgr), /Only a completed task can be reopened/);
  assert.deepEqual((await f.db.query("select event from task_completion_checks where task_id=$1 order by created_at", [kids.task])).rows.map((r) => r.event), ["completed", "reopened"]);
});

test("source states: a paid-off invoice counts as paid; a breakdown with an end time counts as resolved", async () => {
  const state = async (type, id) => (await f.db.query("select private.task_source_state($1,$2,$3) s", [kids.company, type, id])).rows[0].s;
  assert.equal(await state("invoice", kids.invoice), "sent");
  await f.db.exec(`update invoices set balance_due=0 where id='${kids.invoice}'`);
  assert.equal(await state("invoice", kids.invoice), "paid");
  assert.equal(await state("breakdown_log", kids.breakdown), "in_progress");
  await f.db.exec(`update breakdown_logs set end_time=now() where id='${kids.breakdown}'`);
  assert.equal(await state("breakdown_log", kids.breakdown), "resolved");
  assert.equal(await state("order", kids.foreignOrder), null, "another company's record is missing to this company");
  assert.equal(await state("dispatch", kids.dispatch), "in_transit");
});

// ---------- Evidence sources ----------

test("an inspection criterion needs every planned result recorded and within limits, and no rejection", async () => {
  const { items, record } = await f.approvedPlan();
  await f.addCriterion(kids.inspectionTask, kid(201), "inspection_pass", "Lot inspected to plan");
  await assert.rejects(f.complete(kids.inspectionTask), /2 of 2 inspection results are missing/);
  await record([{ item_id: items[0].id, observed: 1.7 }, { item_id: items[1].id, visual_ok: true }]);
  await assert.rejects(f.complete(kids.inspectionTask), /1 inspection result\(s\) are outside limits/);
  await record([{ item_id: items[0].id, observed: 1.6 }]);
  assert.equal((await f.evaluate(kids.inspectionTask)).state, "met");
  await f.db.exec(`update quality_inspections set status='rejected' where id='${kids.inspection}'`);
  assert.match((await f.evaluate(kids.inspectionTask)).criteria[0].reason, /inspection was rejected/);
  await assert.rejects(f.addCriterion(kids.task, kid(202), "inspection_pass", "Wrong kind of link").then(() => f.complete(kids.task)), /checks a linked quality inspection, but the task links a different kind of record \(order\)/);
});

test("without an applicable plan, the inspection must simply be approved", async () => {
  await f.addCriterion(kids.inspectionTask, kid(201), "inspection_pass", "Lot inspected");
  assert.match((await f.evaluate(kids.inspectionTask)).criteria[0].reason, /No inspection plan applies, and the inspection is not approved yet/);
  await f.db.exec(`update quality_inspections set status='approved' where id='${kids.inspection}'`);
  await f.complete(kids.inspectionTask);
});

test("a handoff criterion needs the receiving team's acceptance", async () => {
  await f.addCriterion(kids.handoffTask, kid(203), "handoff_accepted", "Packaging accepted the material");
  await assert.rejects(f.complete(kids.handoffTask), /receiving team has not accepted the handoff/);
  await f.db.exec(`update handoff_acceptances set state='returned' where task_id='${kids.handoffTask}'`);
  assert.match((await f.evaluate(kids.handoffTask)).criteria[0].reason, /returned for a missing prerequisite/);
  await f.db.exec(`update handoff_acceptances set state='accepted' where task_id='${kids.handoffTask}'`);
  await f.complete(kids.handoffTask);
  await f.addCriterion(kids.plainTask, kid(204), "handoff_accepted", "Not a handoff");
  assert.match((await f.evaluate(kids.plainTask)).criteria[0].reason, /not a department handoff/);
});

test("an observation must be recorded within limits by the assignee or a supervisor; the latest value counts", async () => {
  await f.addCriterion(kids.plainTask, kid(205), "observation", "Coating thickness", { unit: "micron", min: 60, max: 120 });
  await assert.rejects(f.complete(kids.plainTask), /Record Coating thickness \(micron\)/);
  await assert.rejects(f.command("evidence.observe", { task_id: kids.plainTask, criterion_id: kid(205), value: 80 }, kids.dispatcher), /Only the assignee or a supervisor/);
  await assert.rejects(f.command("evidence.observe", { task_id: kids.plainTask, criterion_id: kid(205), value: "eighty" }, kids.operator), /observed value as a number/);
  const low = await f.command("evidence.observe", { task_id: kids.plainTask, criterion_id: kid(205), value: 55, note: "edge reading" }, kids.operator);
  assert.equal(low.criteria[0].reason, "Coating thickness 55 micron is outside 60 to 120");
  const ok = await f.command("evidence.observe", { task_id: kids.plainTask, criterion_id: kid(205), value: 82.5 }, kids.prodMgr);
  assert.deepEqual([ok.state, ok.criteria[0].evidence.recorded_by_name, Number(ok.criteria[0].evidence.value)], ["met", "Prod Mgr Rao", 82.5]);
  assert.equal((await f.db.query("select count(*)::int c from task_criterion_evidence where superseded_at is null")).rows[0].c, 1);
  await assert.rejects(f.command("evidence.sign_off", { task_id: kids.plainTask, criterion_id: kid(205) }, kids.quality), /does not take a sign-off/);
  await f.complete(kids.plainTask);
  await assert.rejects(f.command("evidence.observe", { task_id: kids.plainTask, criterion_id: kid(205), value: 90 }, kids.operator), /only while the task is open/);
});

test("a sign-off is by a named role other than the assignee, and later results invalidate it", async () => {
  await f.addCriterion(kids.inspectionTask, kid(206), "observation", "Hardness", { unit: "HW", min: 12 });
  await f.addCriterion(kids.inspectionTask, kid(207), "sign_off", "QC sign-off", { roles: ["quality"] });
  await f.command("evidence.observe", { task_id: kids.inspectionTask, criterion_id: kid(206), value: 13 }, kids.quality);
  await assert.rejects(f.command("evidence.sign_off", { task_id: kids.inspectionTask, criterion_id: kid(207) }, kids.quality), /assignee cannot sign off their own work/);
  await assert.rejects(f.command("evidence.sign_off", { task_id: kids.inspectionTask, criterion_id: kid(207) }, kids.prodMgr), /Your role cannot sign off/);
  assert.equal((await f.command("evidence.sign_off", { task_id: kids.inspectionTask, criterion_id: kid(207), note: "Checked 3 pieces" }, kids.quality2)).state, "met");
  const after = await f.command("evidence.observe", { task_id: kids.inspectionTask, criterion_id: kid(206), value: 14 }, kids.quality);
  assert.equal(after.criteria[1].reason, "Results changed after the sign-off; sign off again");
  await f.command("evidence.sign_off", { task_id: kids.inspectionTask, criterion_id: kid(207) }, kids.quality2);
  await f.complete(kids.inspectionTask);
});

// ---------- Templates, adding and removing ----------

test("templates attach to new tasks of their kind, bound to the linked record; a task inserted as completed is checked", async () => {
  const saved = await f.command("templates.save", { id: kid(300), task_kind: "type:dispatch_follow_up", kind: "source_state", label: "Order dispatched", config: dispatched }, kids.factory);
  await f.db.exec(`insert into tasks(id,company_id,task_type,title,related_entity_type,related_entity_id) values('${kid(120)}','${kids.company}','dispatch_follow_up','Follow up SO-0043','order','${kids.order2}')`);
  const evaluation = await f.evaluate(kid(120));
  assert.deepEqual([evaluation.total, evaluation.criteria[0].source_id, evaluation.criteria[0].from_template], [1, kids.order2, true]);
  await assert.rejects(f.db.query(`insert into tasks(company_id,task_type,title,status,related_entity_type,related_entity_id) values('${kids.company}','dispatch_follow_up','Pre-closed','completed','order','${kids.order2}')`), /cannot be completed yet/);
  await f.db.exec(`insert into tasks(id,company_id,task_type,title,dealership_id,related_entity_type,related_entity_id) values('${kid(123)}','${kids.company}','dispatch_follow_up','Dealer follow-up','${kid(700)}','order','${kids.order2}')`);
  assert.equal((await f.db.query(`select count(*)::int c from task_completion_criteria where task_id='${kid(123)}'`)).rows[0].c, 0, "dealer tasks never receive criteria they cannot see");
  await f.complete(kid(123));
  await f.command("templates.save", { id: kid(301), task_kind: "handoff:packaging", kind: "handoff_accepted", label: "Accepted by packaging" }, kids.factory);
  await f.db.exec(`insert into tasks(id,company_id,task_type,title,handoff_key,handoff_team) values('${kid(121)}','${kids.company}','department_handoff','Pack 100 kg','k2','packaging')`);
  assert.equal((await f.evaluate(kid(121))).criteria[0].kind, "handoff_accepted");
  await assert.rejects(f.command("templates.save", { id: kid(300), task_kind: "type:dispatch_follow_up", kind: "source_state", label: "Renamed", config: dispatched }, kids.factory), /changed by someone else/);
  await f.command("templates.save", { id: kid(300), task_kind: "type:dispatch_follow_up", kind: "source_state", label: "Order dispatched", config: dispatched, is_active: false, expected_updated_at: saved.updated_at }, kids.factory);
  await f.db.exec(`insert into tasks(id,company_id,task_type,title) values('${kid(122)}','${kids.company}','dispatch_follow_up','After deactivation')`);
  assert.equal((await f.evaluate(kid(122))).state, "none", "an inactive template attaches nothing");
});

test("criterion settings are validated", async () => {
  const save = (kind, config, extra = {}) => f.command("templates.save", { id: kid(310), task_kind: "type:general", kind, label: "Check it", config, ...extra }, kids.factory);
  await assert.rejects(save("source_state", { source_type: "order", states: ["shipped"] }), /does not exist for this kind of record/);
  await assert.rejects(save("source_state", { source_type: "pallet", states: ["done"] }), /Choose the kind of record/);
  await assert.rejects(save("source_state", { source_type: "order", states: [] }), /at least one required state/);
  await assert.rejects(save("observation", { min: 1 }), /unit of the observation/);
  await assert.rejects(save("observation", { unit: "mm" }), /at least one observation limit/);
  await assert.rejects(save("observation", { unit: "mm", min: 5, max: 1 }), /lower limit is above/);
  await assert.rejects(save("observation", { unit: "mm", min: "five" }), /must be numbers/);
  await assert.rejects(save("sign_off", { roles: ["viewer"] }), /Only supervisors, quality or accounts/);
  await assert.rejects(save("photo", {}), /supported criterion/);
  await assert.rejects(save("sign_off", { roles: ["quality"] }, { task_kind: "anything" }), /kind of task/);
  await assert.rejects(save("sign_off", { roles: ["quality"] }, { label: "x" }), /3 to 120/);
  await assert.rejects(f.command("templates.save", { id: kid(311), task_kind: "type:general", kind: "inspection_pass", label: "By supervisor" }, kids.prodMgr), /not permitted/);
  for (let i = 0; i < 10; i += 1) await f.command("templates.save", { id: kid(320 + i), task_kind: "type:general", kind: "handoff_accepted", label: `Template ${i}` }, kids.factory);
  await assert.rejects(f.command("templates.save", { id: kid(330), task_kind: "type:general", kind: "handoff_accepted", label: "Eleventh" }, kids.factory), /at most 10 active criteria/);
});

test("criteria are added and removed only while the task is open; removal needs a reason; adds replay safely", async () => {
  await assert.rejects(f.addCriterion(kids.plainTask, kid(210), "source_state", "Order dispatched", dispatched), /not linked to a record/);
  await f.addCriterion(kids.task, kid(211), "source_state", "Order dispatched", dispatched);
  assert.equal((await f.addCriterion(kids.task, kid(211), "source_state", "Order dispatched", dispatched)).replayed, true);
  await assert.rejects(f.addCriterion(kids.plainTask, kid(211), "observation", "Reused id", { unit: "mm", min: 1 }), /Invalid completion criteria request/);
  await assert.rejects(f.command("criteria.remove", { task_id: kids.task, criterion_id: kid(211), reason: "no" }, kids.prodMgr), /3 to 300 characters/);
  await assert.rejects(f.command("criteria.remove", { task_id: kids.task, criterion_id: kid(211), reason: "Customer collects" }, kids.dispatcher), /not permitted/);
  await f.command("criteria.remove", { task_id: kids.task, criterion_id: kid(211), reason: "Customer collects from factory" }, kids.prodMgr);
  assert.equal((await f.evaluate(kids.task)).state, "none");
  await f.complete(kids.task);
  await assert.rejects(f.addCriterion(kids.task, kid(212), "observation", "Too late", { unit: "mm", min: 1 }), /only while the task is open/);
});

test("a refusal names the first two unmet criteria and counts the rest, within 240 characters", async () => {
  for (let i = 0; i < 4; i += 1) await f.addCriterion(kids.plainTask, kid(220 + i), "observation", `Measurement number ${i + 1}`, { unit: "mm", min: 1 });
  const error = await f.complete(kids.plainTask).then(() => null, (e) => e.message);
  assert.equal(error, "This task cannot be completed yet: Record Measurement number 1 (mm); Record Measurement number 2 (mm) (and 2 more)");
  assert.ok(error.length <= 240);
});

// ---------- Access ----------

test("company, role and dealer boundaries", async () => {
  await f.addCriterion(kids.task, kid(230), "source_state", "Order dispatched", dispatched);
  assert.equal((await f.evaluate(kids.task, kids.viewer)).total, 1, "anyone internal can see why a task is open");
  await assert.rejects(f.addCriterion(kids.task, kid(231), "observation", "By viewer", { unit: "mm", min: 1 }, kids.viewer), /not permitted/);
  await assert.rejects(f.evaluate(kids.task, kids.dealer), /not permitted/);
  await assert.rejects(f.evaluate(kids.task, kids.foreign), /Task is unavailable/);
  await assert.rejects(f.evaluate(kids.foreignTask), /Task is unavailable/);
  assert.equal((await f.asUser("select id from task_completion_criteria", [], kids.foreign)).length, 0, "row security hides other companies' criteria");
  await assert.rejects(f.asUser(`insert into task_completion_criteria(id,company_id,task_id,seq,kind,label) values('${kid(232)}','${kids.company}','${kids.task}',9,'handoff_accepted','Direct')`), /permission denied/);
  await assert.rejects(f.asUser(`update task_completion_criteria set removed_at=now(), remove_reason='x' where id='${kid(230)}'`), /permission denied/);
  await assert.rejects(f.asUser("select public.task_criteria_command('task.evaluate','{}'::jsonb)", [], ""), /Authentication required/);
});
