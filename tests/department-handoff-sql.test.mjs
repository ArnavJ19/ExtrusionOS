import test from "node:test";
import assert from "node:assert/strict";
import { createDepartmentHandoffFixture, dids, did } from "../scripts/lib/department-handoff-fixture.mjs";

let f;
test.before(async () => { f = await createDepartmentHandoffFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const inspect = (status = "approved", id = dids.inspection, kg = 412.5) =>
  f.asSystem(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,batch_number,quantity_checked_kg,status,inspector_name)
    values('${id}','${dids.company}','${dids.job}','${dids.profile}',now(),'B-77',${kg},'${status}','QC Meera')`);

// ---------- QC release -> packaging ----------

test("an approved inspection creates one packaging handoff with the released quantity, deadline and source", async () => {
  await inspect();
  const [h] = await f.handoffs();
  assert.equal(h.handoff_key, `inspection_release:${dids.inspection}`);
  assert.equal(h.handoff_team, "packaging");
  assert.equal(h.qty, 412.5);
  assert.equal(h.handoff_source_type, "quality_inspection");
  assert.equal(h.related_entity_id, dids.inspection);
  assert.equal(h.priority, "urgent", "inherits the order's priority");
  assert.equal(h.due, "2030-01-15", "deadline is the order's expected dispatch date");
  assert.match(h.title, /^Pack 412\.500 kg released by QC · PJ-0007 · SO-0042$/);
  assert.match(h.description, /batch B-77\. Open packaging: PKG-0001\./);
});

test("reprocessing the same release event never creates a second handoff", async () => {
  await inspect();
  await f.asSystem(`update quality_inspections set status='approved', notes='touched' where id='${dids.inspection}'`);
  assert.deepEqual(await f.command("handoff.reprocess", { source_type: "quality_inspection", source_id: dids.inspection }), { outcome: "existing" });
  assert.deepEqual(await f.command("handoff.reprocess", { source_type: "quality_inspection", source_id: dids.inspection }, dids.quality), { outcome: "existing" });
  assert.equal((await f.handoffs()).length, 1);
});

test("a pending inspection creates nothing until it is released", async () => {
  await inspect("pending");
  assert.equal((await f.handoffs()).length, 0);
  assert.deepEqual(await f.command("handoff.reprocess", { source_type: "quality_inspection", source_id: dids.inspection }), { outcome: "not_eligible" });
  await f.asSystem(`update quality_inspections set status='approved' where id='${dids.inspection}'`);
  assert.equal((await f.handoffs()).length, 1);
});

test("a rework resolved through the real action hands over only the approved kilograms", async () => {
  await inspect("rework", dids.reworkInspection, 500);
  await f.asUser("select public.resolve_quality_rework_atomic($1,$2,$3,$4,$5)", [dids.reworkInspection, 430, 70, "QC Meera", "Re-straightened and re-checked"], dids.quality);
  const handoffs = await f.handoffs();
  assert.equal(handoffs.length, 1, "the rejected child creates no packaging work");
  assert.equal(handoffs[0].qty, 430);
  assert.match(handoffs[0].description, /after a rework resolution/);
});

test("a deadline already in the past, or no order date, becomes a deadline that can still be met", async () => {
  await f.db.exec(`update orders set expected_dispatch_date='2020-01-01' where id='${dids.order}'`);
  await inspect();
  assert.equal((await f.handoffs())[0].due, today());
  await f.db.exec(`update orders set expected_dispatch_date=null where id='${dids.order}'`);
  await inspect("approved", did(72), 10);
  const due = (await f.handoffs())[1].due;
  assert.equal(due, new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
});

test("if the source write fails, no handoff is left behind (same transaction)", async () => {
  await assert.rejects(f.asSystem(`insert into quality_inspections(id,company_id,production_job_id,profile_id,quantity_checked_kg,status) values('${dids.inspection}','${dids.company}','${dids.job}','${dids.profile}',100,'approved');
    insert into quality_inspections(id,company_id,quantity_checked_kg,status) values('${dids.inspection}','${dids.company}',1,'approved');`));
  assert.equal((await f.handoffs()).length, 0);
});

// ---------- Finishing receipt -> quality, packaging complete -> dispatch ----------

test("a finishing receipt asks quality to inspect once, even when it moves from received to completed", async () => {
  await f.asSystem(`insert into finishing_jobs values('${dids.finishing}','${dids.company}','${dids.order}','${dids.job}','powder_coating','RAL 9016','sent_to_vendor',null,null)`);
  assert.equal((await f.handoffs()).length, 0);
  await f.asSystem(`update finishing_jobs set status='received', output_weight_kg=388.2, rejection_weight_kg=11.8 where id='${dids.finishing}'`);
  await f.asSystem(`update finishing_jobs set status='completed' where id='${dids.finishing}'`);
  const handoffs = await f.handoffs();
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].handoff_team, "quality");
  assert.equal(handoffs[0].qty, 388.2);
  assert.match(handoffs[0].description, /11\.800 kg rejected by the vendor \(shade RAL 9016\)/);
});

test("a finishing receipt with no accepted output hands nothing to quality", async () => {
  await f.asSystem(`insert into finishing_jobs values('${dids.finishing}','${dids.company}','${dids.order}','${dids.job}','anodizing',null,'received',0,50)`);
  assert.equal((await f.handoffs()).length, 0);
});

test("completed packaging hands the packed kilograms to dispatch once", async () => {
  await f.asSystem(`update packaging_jobs set status='in_progress' where id='${dids.openPackaging}'`);
  await f.asSystem(`update packaging_jobs set status='completed' where id='${dids.openPackaging}'`);
  await f.asSystem(`update packaging_jobs set pieces=pieces where id='${dids.openPackaging}'`);
  const handoffs = await f.handoffs();
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].handoff_team, "dispatch");
  assert.equal(handoffs[0].qty, 400);
  assert.match(handoffs[0].title, /^Dispatch 400\.000 kg packed · PKG-0001 · SO-0042$/);
});

// ---------- Queue and claiming ----------

test("each team sees its own handoffs; managers and viewers see every team", async () => {
  await inspect();
  await f.asSystem(`update packaging_jobs set status='completed' where id='${dids.openPackaging}'`);
  assert.deepEqual((await f.command("handoff.list", {}, dids.packer)).rows.map((r) => r.handoff_team), ["packaging"]);
  assert.deepEqual((await f.command("handoff.list", {}, dids.dispatcher)).rows.map((r) => r.handoff_team), ["dispatch"]);
  assert.equal((await f.command("handoff.list", {}, dids.quality)).total_count, 0);
  assert.equal((await f.command("handoff.list", {}, dids.viewer)).total_count, 2);
  assert.equal((await f.command("handoff.list", { team: "dispatch" }, dids.owner)).total_count, 1);
});

test("a team member takes a handoff once; another team or a second taker is refused", async () => {
  await inspect();
  const [row] = (await f.command("handoff.list", {}, dids.packer)).rows;
  assert.equal(row.can_take, true);
  await assert.rejects(f.command("handoff.take", { task_id: row.id }, dids.dispatcher), /belongs to another team/);
  assert.deepEqual(await f.command("handoff.take", { task_id: row.id }, dids.packer), { id: row.id, status: "in_progress" });
  assert.deepEqual(await f.command("handoff.take", { task_id: row.id }, dids.packer), { id: row.id, status: "in_progress" }, "a retry by the same person is a no-op");
  await assert.rejects(f.command("handoff.take", { task_id: row.id }, dids.supervisor), /already taken or closed/);
  const [mine] = (await f.command("handoff.list", {}, dids.packer)).rows;
  assert.deepEqual([mine.mine, mine.assigned_to_name, mine.can_take], [true, "Packer Sunil", false]);
  await assert.rejects(f.command("handoff.take", { task_id: row.id }, dids.viewer), /not permitted/);
});

test("the queue filters by status and pages at 10 rows", async () => {
  for (let i = 0; i < 12; i++) await inspect("approved", did(800 + i), 10 + i);
  const page1 = await f.command("handoff.list", {}, dids.packer);
  assert.equal(page1.total_count, 12);
  assert.equal(page1.rows.length, 10);
  assert.equal((await f.command("handoff.list", { page: 2 }, dids.packer)).rows.length, 2);
  await f.db.exec(`update tasks set status='completed' where handoff_key like 'inspection_release:%' and handoff_quantity_kg < 12`);
  assert.equal((await f.command("handoff.list", {}, dids.packer)).total_count, 10, "active = open + in progress");
  assert.equal((await f.command("handoff.list", { status: "completed" }, dids.packer)).total_count, 2);
  await assert.rejects(f.command("handoff.list", { team: "billing" }), /Invalid handoff queue request/);
});

// ---------- Roles and tenancy ----------

test("roles outside the factory teams, dealers, other companies and anonymous callers are refused", async () => {
  await inspect();
  const [row] = (await f.command("handoff.list", {}, dids.packer)).rows;
  for (const actor of [dids.sales, dids.dealer]) await assert.rejects(f.command("handoff.list", {}, actor), /not permitted/);
  assert.equal((await f.command("handoff.list", {}, dids.foreign)).total_count, 0);
  await assert.rejects(f.command("handoff.take", { task_id: row.id }, dids.foreign), /Handoff is unavailable/);
  assert.deepEqual(await f.command("handoff.reprocess", { source_type: "quality_inspection", source_id: dids.inspection }, dids.foreign), { outcome: "not_eligible" }, "another company's source is invisible");
  await assert.rejects(f.command("handoff.reprocess", { source_type: "quality_inspection", source_id: dids.inspection }, dids.packer), /not permitted/);
  await assert.rejects(f.command("handoff.reprocess", { source_type: "invoice", source_id: dids.inspection }), /Choose a quality inspection/);
  await assert.rejects(f.asUser("select public.department_handoff_command('handoff.list','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser("select private.raise_department_handoff($1,'x','packaging','quality_inspection',$2,1,null,'t','d')", [dids.company, dids.inspection]), /permission denied/);
});

test("handoff columns must be complete and consistent", async () => {
  await assert.rejects(f.db.exec(`insert into tasks(company_id,task_type,title,handoff_key) values('${dids.company}','x','t','k')`), /tasks_handoff_shape_check/);
  await assert.rejects(f.db.exec(`insert into tasks(company_id,task_type,title,handoff_key,handoff_team,handoff_quantity_kg,handoff_source_type,handoff_source_id) values('${dids.company}','x','t','k','billing',1,'packaging_job','${dids.job}')`), /tasks_handoff_shape_check/);
  await f.db.exec(`insert into tasks(company_id,task_type,title) values('${dids.company}','general','Ordinary task')`);
});
