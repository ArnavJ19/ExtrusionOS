import test from "node:test";
import assert from "node:assert/strict";
import { createDepartmentHandoffFixture, dids, did } from "../scripts/lib/department-handoff-fixture.mjs";

let f;
test.before(async () => { f = await createDepartmentHandoffFixture({ acceptance: true }); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const acc = async (name, payload, actor = dids.packer) => (await f.asUser("select public.handoff_acceptance_command($1,$2) data", [name, payload], actor))[0].data;
const release = (actor = dids.quality, id = dids.inspection, kg = 412.5) =>
  f.asSystem(`insert into quality_inspections(id,company_id,production_job_id,profile_id,quantity_checked_kg,status) values('${id}','${dids.company}','${dids.job}','${dids.profile}',${kg},'approved')`, actor);
const handoffId = async (key = `inspection_release:${dids.inspection}`) => (await f.db.query("select id from tasks where handoff_key=$1", [key])).rows[0].id;
const status = async (id, actor = dids.packer) => (await acc("acceptance.status", { task_ids: [id] }, actor))[0];
const state = async (id) => (await f.db.query("select state, return_count, auto_accepted, received_quantity_kg::float8 kg from handoff_acceptances where task_id=$1", [id])).rows[0];

// ---------- Acceptance ----------

test("a new handoff waits for explicit acceptance by default and cannot be started before it", async () => {
  await release();
  const id = await handoffId();
  assert.equal((await state(id)).state, "pending");
  await assert.rejects(f.command("handoff.take", { task_id: id }, dids.packer), /Accept this handoff before starting/);
  await assert.rejects(f.db.exec(`update tasks set status='completed' where id='${id}'`), /Accept this handoff/, "the ordinary task path is guarded too");
});

test("a team member accepts once with the received quantity; then the handoff can be taken", async () => {
  await release();
  const id = await handoffId();
  assert.deepEqual(await acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }), { task_id: id, state: "accepted", replayed: false });
  assert.deepEqual(await acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }), { task_id: id, state: "accepted", replayed: true });
  await assert.rejects(acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }, dids.supervisor), /already accepted/);
  assert.equal((await f.command("handoff.take", { task_id: id }, dids.packer)).status, "in_progress");
});

test("a received quantity outside the team tolerance must be returned as a mismatch", async () => {
  await release();
  const id = await handoffId();
  await assert.rejects(acc("acceptance.accept", { task_id: id, received_quantity_kg: 400 }), /differs from the handed-over 412.5 kg by more than 0.5 percent/);
  assert.equal((await acc("acceptance.accept", { task_id: id, received_quantity_kg: 411 })).state, "accepted", "411 kg is within 0.5% of 412.5 kg");
});

test("unmet prerequisites block acceptance and say exactly what is missing", async () => {
  await f.db.exec(`update packaging_jobs set status='completed' where id='${dids.openPackaging}'`);
  await release();
  const id = await handoffId();
  const s = await status(id);
  assert.deepEqual(s.issues.map((i) => i.code), ["no_packaging_job"]);
  assert.equal(s.issues[0].message, "No packaging job is open for PJ-0007");
  await assert.rejects(acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }), /Cannot accept yet: No packaging job is open for PJ-0007/);
  await f.db.exec(`update orders set current_stage='cancelled' where id='${dids.order}'`);
  assert.deepEqual((await status(id)).issues.map((i) => i.code), ["no_packaging_job", "order_not_live"]);
});

test("a team set to auto-accept accepts only when every prerequisite holds", async () => {
  await acc("policy.set", { team: "packaging", auto_accept: true, quantity_tolerance_percent: 1 }, dids.owner);
  await release();
  const accepted = await state(await handoffId());
  assert.deepEqual([accepted.state, accepted.auto_accepted, accepted.kg], ["accepted", true, 412.5]);
  await f.db.exec(`update packaging_jobs set status='cancelled'`);
  await release(dids.quality, did(71), 50);
  assert.equal((await state(await handoffId(`inspection_release:${did(71)}`))).state, "pending", "a missing packaging job still needs a person");
});

// ---------- Returns ----------

test("returning a packaging handoff names the missing prerequisite and creates one owned task for the source", async () => {
  await f.db.exec(`update packaging_jobs set status='completed'`);
  await release(dids.quality);
  const id = await handoffId();
  const result = await acc("acceptance.return", { task_id: id, reason: "no_packaging_job", note: "No PKG job open for PJ-0007; create one" });
  assert.deepEqual([result.state, result.owner_assigned], ["returned", true]);
  const [ret] = (await f.db.query("select task_type, handoff_team, assigned_to, title, status from tasks where id=$1", [result.return_task_id])).rows;
  assert.deepEqual([ret.task_type, ret.handoff_team, ret.assigned_to, ret.status], ["handoff_return", "quality", dids.quality, "open"], "owned by the QC person who released it");
  assert.match(ret.title, /^Resolve returned handoff: no packaging job/);
  const s = await status(id);
  assert.equal(s.state, "returned");
  assert.equal(s.open_return.reason, "no_packaging_job");
  assert.equal(s.open_return.owner_name, "QC Meera");
  await assert.rejects(acc("acceptance.return", { task_id: id, reason: "other", note: "again please" }), /already has an open return/);
  await assert.rejects(acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }), /waiting for its return to be resolved/);
  assert.equal((await f.db.query("select count(*)::int n from handoff_returns where resolved_at is null")).rows[0].n, 1);
});

test("if the source person is no longer eligible, the return still belongs to the source team", async () => {
  await release(dids.owner);
  const id = await handoffId();
  await f.db.exec(`update app_users set is_active=false where id='${dids.owner}'`);
  const result = await acc("acceptance.return", { task_id: id, reason: "documents_missing", note: "Mill test certificate missing" });
  assert.equal(result.owner_assigned, false);
  const [ret] = (await f.db.query("select assigned_to, handoff_team from tasks where id=$1", [result.return_task_id])).rows;
  assert.deepEqual(ret, { assigned_to: null, handoff_team: "quality" });
});

test("completing the return task resolves it and puts the handoff back for acceptance", async () => {
  await f.db.exec(`update packaging_jobs set status='completed'`);
  await release(dids.quality);
  const id = await handoffId();
  const { return_task_id } = await acc("acceptance.return", { task_id: id, reason: "no_packaging_job", note: "Create the packaging job" });
  await f.db.exec(`update packaging_jobs set status='scheduled' where id='${dids.openPackaging}';
    update tasks set status='completed', description='PKG-0001 reopened for this material' where id='${return_task_id}'`);
  const s = await state(id);
  assert.deepEqual([s.state, s.return_count], ["pending", 1]);
  const [r] = (await f.db.query("select resolved_at is not null resolved, resolution_note from handoff_returns")).rows;
  assert.deepEqual(r, { resolved: true, resolution_note: "PKG-0001 reopened for this material" });
  assert.equal((await acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 })).state, "accepted");
});

test("return validation: reason, note, and only unstarted handoffs", async () => {
  await release();
  const id = await handoffId();
  await assert.rejects(acc("acceptance.return", { task_id: id, reason: "lunch", note: "something" }), /Choose what is missing/);
  await assert.rejects(acc("acceptance.return", { task_id: id, reason: "other", note: "no" }), /5 to 500 characters/);
  await acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 });
  await f.command("handoff.take", { task_id: id }, dids.packer);
  await assert.rejects(acc("acceptance.return", { task_id: id, reason: "other", note: "Changed my mind" }), /not been started/);
});

// ---------- Roles, policy and tenancy ----------

test("only the receiving team acts; viewers read; other companies see nothing", async () => {
  await release();
  const id = await handoffId();
  await assert.rejects(acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }, dids.dispatcher), /belongs to another team/);
  await assert.rejects(acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }, dids.viewer), /not permitted/);
  assert.equal((await status(id, dids.viewer)).state, "pending");
  assert.deepEqual(await acc("acceptance.status", { task_ids: [id] }, dids.dispatcher), [], "another team's handoff is not described");
  assert.deepEqual(await acc("acceptance.status", { task_ids: [id] }, dids.foreign), []);
  await assert.rejects(acc("acceptance.accept", { task_id: id, received_quantity_kg: 412.5 }, dids.foreign), /Handoff is unavailable/);
  for (const actor of [dids.sales, dids.dealer]) await assert.rejects(acc("policy.list", {}, actor), /not permitted/);
  await assert.rejects(acc("acceptance.status", { task_ids: Array(11).fill(id) }), /Invalid handoff references/);
});

test("team policy: only managers change it, within 0-10 percent; defaults are explicit acceptance at 0.5%", async () => {
  assert.deepEqual((await acc("policy.list", {}, dids.viewer)).map((p) => [p.team, p.auto_accept, Number(p.quantity_tolerance_percent)]),
    [["dispatch", false, 0.5], ["packaging", false, 0.5], ["quality", false, 0.5]]);
  await assert.rejects(acc("policy.set", { team: "packaging", auto_accept: true, quantity_tolerance_percent: 1 }, dids.packer), /not permitted/);
  await assert.rejects(acc("policy.set", { team: "packaging", auto_accept: true, quantity_tolerance_percent: 11 }, dids.owner), /between 0 and 10/);
  await assert.rejects(acc("policy.set", { team: "billing", auto_accept: true, quantity_tolerance_percent: 1 }, dids.owner), /Choose a team/);
});

test("handoffs created before acceptance existed keep working", async () => {
  await release();
  const id = await handoffId();
  await f.db.exec(`delete from handoff_acceptances where task_id='${id}'`);
  assert.equal((await status(id)).legacy, true);
  assert.equal((await f.command("handoff.take", { task_id: id }, dids.packer)).status, "in_progress");
});
