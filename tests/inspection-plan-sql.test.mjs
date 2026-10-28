import test from "node:test";
import assert from "node:assert/strict";
import { createInspectionPlanFixture, iids, iid } from "../scripts/lib/inspection-plan-fixture.mjs";

let f;
test.before(async () => { f = await createInspectionPlanFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const plan = (inspection = iids.inspection, actor = iids.inspector) => f.command("inspection.plan", { inspection_id: inspection }, actor);
async function record(values, inspection = iids.inspection, actor = iids.inspector) {
  const ids = await f.itemIds();
  const results = values.map((value, index) => (ids[index].characteristic === "Surface finish" ? { item_id: ids[index].id, visual_ok: value } : { item_id: ids[index].id, observed: value })).filter((_, index) => values[index] !== undefined);
  return f.command("results.record", { inspection_id: inspection, plan_id: iids.plan, results }, actor);
}

// ---------- Plans ----------

test("a draft plan is versioned, approved once, and supersedes the previous approved version", async () => {
  assert.deepEqual(await f.saveDraft(), { id: iids.plan, version: 1 });
  assert.equal((await plan()).state, "no_plan", "a draft never applies");
  await f.command("plan.approve", { plan_id: iids.plan }, iids.inspector);
  await assert.rejects(f.command("plan.approve", { plan_id: iids.plan }, iids.inspector), /Only a draft plan can be approved/);
  const v2 = await f.saveDraft({ plan_id: iid(60), sampling_instruction: "5 pieces per lot" });
  assert.equal(v2.version, 2);
  await f.command("plan.approve", { plan_id: iid(60) }, iids.inspector);
  const statuses = (await f.db.query("select version, status from inspection_plans order by version")).rows;
  assert.deepEqual(statuses, [{ version: 1, status: "superseded" }, { version: 2, status: "approved" }]);
});

test("editing the draft replaces its characteristics; approved versions cannot be edited", async () => {
  await f.saveDraft();
  await f.saveDraft({ items: f.items.slice(0, 2) });
  assert.equal((await f.itemIds()).length, 2);
  await f.command("plan.approve", { plan_id: iids.plan }, iids.inspector);
  const next = await f.saveDraft({ plan_id: iid(61) });
  assert.equal(next.version, 2, "saving again starts a new draft version instead of changing the approved one");
  assert.equal((await f.itemIds()).length, 2);
  await assert.rejects(f.command("plan.discard_draft", { plan_id: iids.plan }), /Only a draft plan can be discarded/);
  assert.deepEqual(await f.command("plan.discard_draft", { plan_id: iid(61) }), { discarded: true });
});

test("characteristic rules: limits enclose the nominal, visual checks have none, units are known", async () => {
  const bad = [
    [{ characteristic: "Wall", unit: "mm", nominal: 2, lower_limit: 1.5, upper_limit: 1.8 }],
    [{ characteristic: "Wall", unit: "mm", lower_limit: 2, upper_limit: 1 }],
    [{ characteristic: "Wall", unit: "mm" }],
    [{ characteristic: "Finish", unit: "visual", upper_limit: 1 }],
    [{ characteristic: "Wall", unit: "inch", lower_limit: 1 }],
    [{ characteristic: "W", unit: "mm", lower_limit: 1 }],
    [{ characteristic: "Wall", unit: "mm", lower_limit: "thin" }]
  ];
  for (const items of bad) await assert.rejects(f.saveDraft({ items }), /Characteristic 1 needs/, JSON.stringify(items));
  await assert.rejects(f.saveDraft({ items: [] }), /between 1 and 50/);
  await assert.rejects(f.saveDraft({ sampling_instruction: "x" }), /sampling instruction/);
  await assert.rejects(f.saveDraft({ profile_id: iids.foreignProfile }), /Profile is unavailable/);
});

test("the profile's own plan applies before the company default; profiles without either have no plan", async () => {
  await f.saveDraft({ plan_id: iids.defaultPlan, profile_id: null, items: [{ characteristic: "Surface finish", unit: "visual" }] });
  await f.command("plan.approve", { plan_id: iids.defaultPlan }, iids.inspector);
  assert.equal((await plan(iids.noPlanInspection)).plan_scope, "default");
  await f.approvedPlan();
  const own = await plan();
  assert.deepEqual([own.plan_scope, own.total, own.state, own.missing], ["profile", 4, "incomplete", 4]);
  assert.ok(own.items.every((item) => item.outcome === "missing" && item.observed === null), "nothing is pre-filled");
});

// ---------- Results and approval ----------

test("results are judged against the limits; an inspection approves only when every result is recorded and passes", async () => {
  await f.approvedPlan();
  await assert.rejects(f.setStatus(iids.inspection, "approved"), /4 of 4 planned results are missing/);
  const partial = await record([1.6, 0.95]);
  assert.deepEqual([partial.state, partial.missing], ["incomplete", 2]);
  await assert.rejects(f.setStatus(iids.inspection, "approved"), /2 of 4 planned results are missing/);
  const failing = await record([1.6, 0.95, 11, true]);
  assert.deepEqual([failing.state, failing.failed], ["fail", 1]);
  assert.equal(failing.items.find((item) => item.characteristic === "Hardness").outcome, "fail");
  await assert.rejects(f.setStatus(iids.inspection, "approved"), /1 result\(s\) are outside the plan limits. Record a rework or rejection/);
  await f.setStatus(iids.inspection, "rework");
  assert.equal((await f.db.query("select status from quality_inspections where id=$1", [iids.inspection])).rows[0].status, "rework", "failing material can still be dispositioned");
});

test("a fully passing inspection approves; boundary values on the limits pass", async () => {
  await f.approvedPlan();
  const result = await record([1.52, 0.98, 12, true]);
  assert.equal(result.state, "pass");
  await f.setStatus(iids.inspection, "approved");
});

test("a visual failure blocks approval", async () => {
  await f.approvedPlan();
  await record([1.6, 0.95, 14, false]);
  await assert.rejects(f.setStatus(iids.inspection, "approved"), /outside the plan limits/);
});

test("inserting an inspection directly as approved is refused when a plan applies", async () => {
  await f.approvedPlan();
  await assert.rejects(f.db.exec(`insert into quality_inspections(company_id,profile_id,quantity_checked_kg,status) values('${iids.company}','${iids.profile}',10,'approved')`), /Record the inspection plan results before approving/);
  await f.db.exec(`insert into quality_inspections(company_id,profile_id,quantity_checked_kg,status) values('${iids.company}','${iids.profile2}',10,'approved')`);
});

test("the approved child of a rework resolution is not blocked; its disposition is already decided", async () => {
  await f.approvedPlan();
  await f.asUser("select public.resolve_quality_rework_atomic($1,$2,$3,$4,$5)", [iids.reworkInspection, 80, 20, "Inspector Meera", "Re-straightened and re-checked"], iids.inspector);
  assert.equal((await f.db.query("select count(*)::int c from quality_inspections where resolution_id is not null and status='approved'")).rows[0].c, 1);
});

test("results are recorded only while pending, only against the current applicable plan", async () => {
  await f.approvedPlan();
  await record([1.6]);
  await f.saveDraft({ plan_id: iid(62) });
  await f.command("plan.approve", { plan_id: iid(62) }, iids.inspector);
  await assert.rejects(record([1.6]), /applicable inspection plan changed/);
  const fresh = await plan();
  assert.equal(fresh.missing, 4, "results recorded under a superseded version do not count for the new one");
  await f.setStatus(iids.inspection2, "rejected");
  await assert.rejects(f.command("results.record", { inspection_id: iids.inspection2, plan_id: iid(62), results: [{ item_id: (await f.itemIds(iid(62)))[0].id, observed: 1.6 }] }), /only while the inspection is pending/);
});

test("result input is validated per characteristic", async () => {
  await f.approvedPlan();
  const ids = await f.itemIds();
  await assert.rejects(f.command("results.record", { inspection_id: iids.inspection, plan_id: iids.plan, results: [{ item_id: ids[0].id, observed: "thick" }] }, iids.inspector), /Enter the measured value for Wall thickness/);
  await assert.rejects(f.command("results.record", { inspection_id: iids.inspection, plan_id: iids.plan, results: [{ item_id: ids[3].id }] }, iids.inspector), /Record pass or fail for Surface finish/);
  await assert.rejects(f.command("results.record", { inspection_id: iids.inspection, plan_id: iids.plan, results: [{ item_id: iid(999), observed: 1 }] }, iids.inspector), /outside the applicable plan/);
  await assert.rejects(f.command("results.record", { inspection_id: iids.noPlanInspection, plan_id: iids.plan, results: [{ item_id: ids[0].id, observed: 1 }] }, iids.inspector), /No approved inspection plan/);
});

test("re-recording a result replaces it and keeps who recorded it", async () => {
  await f.approvedPlan();
  await record([1.4]);
  const after = await record([1.6], iids.inspection, iids.qcManager);
  const wall = after.items.find((item) => item.characteristic === "Wall thickness");
  assert.deepEqual([Number(wall.observed), wall.outcome, wall.recorded_by_name], [1.6, "pass", "QC Manager Leela"]);
});

// ---------- Roles and tenancy ----------

test("inspectors record, only quality managers approve plans, others read; other companies see nothing", async () => {
  await assert.rejects(f.saveDraft({}, iids.prodManager), /not permitted/);
  await assert.rejects(f.saveDraft({}, iids.sales), /not permitted/);
  await f.saveDraft({}, iids.inspector);
  await assert.rejects(f.command("plan.approve", { plan_id: iids.plan }, iids.inspector), /Another person must approve the plan you drafted/);
  await assert.rejects(f.command("plan.approve", { plan_id: iids.plan }, iids.prodManager), /not permitted/);
  await f.command("plan.approve", { plan_id: iids.plan }, iids.qcManager);
  assert.equal((await plan(iids.inspection, iids.viewer)).total, 4);
  await assert.rejects(record([1.6], iids.inspection, iids.viewer), /not permitted/);
  await assert.rejects(plan(iids.inspection, iids.foreign), /Inspection is unavailable/);
  await assert.rejects(f.command("plan.load", { plan_id: iids.plan }, iids.foreign), /unavailable/);
  assert.equal((await f.command("plan.list", {}, iids.foreign)).total_count, 0);
  await assert.rejects(f.asUser(`insert into inspection_results(company_id,inspection_id,plan_id,item_id,observed,outcome,recorded_by,recorded_by_name) values('${iids.company}','${iids.inspection}','${iids.plan}','${(await f.itemIds())[0].id}',1.6,'pass','${iids.inspector}','x')`, [], iids.inspector), /permission denied/);
  await assert.rejects(f.asUser("select public.inspection_plan_command('plan.list','{}'::jsonb)", [], ""), /Authentication required/);
});

test("the plan list shows drafts and approved plans, default first, paged at 10", async () => {
  await f.saveDraft({ plan_id: iids.defaultPlan, profile_id: null, items: [{ characteristic: "Surface finish", unit: "visual" }] });
  await f.approvedPlan();
  const list = await f.command("plan.list", {}, iids.viewer);
  assert.deepEqual(list.rows.map((r) => [r.profile_code, r.status, Number(r.item_count)]), [[null, "draft", 1], ["EX-101", "approved", 4]]);
  await assert.rejects(f.command("plan.list", { page: 0 }), /Invalid page/);
});
