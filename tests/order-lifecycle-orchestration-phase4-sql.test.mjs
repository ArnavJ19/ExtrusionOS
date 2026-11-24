import test from "node:test";
import assert from "node:assert/strict";
import { createAutopilotFixture, apIds as i, nid } from "../scripts/lib/autopilot-batch1-fixture.mjs";

// Order lifecycle orchestration Phase 4 (migration 20261123100000): QC reversal honoured by every approved-kg reader,
// the finance release validity setting, the batch 2 settings save path and the customer-update queue fix.
// Synthetic data only.
let f;
let seq = 40000;
const id = () => `0e400000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const P1 = "0e400000-0000-4000-8000-000000000001";
const DISPATCHER = nid(22);

const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
let inTx = false;
async function seed(sql, p = []) {
  if (!inTx) { await f.db.exec("set session_replication_role = replica"); try { return (await f.db.query(sql, p)).rows; } finally { await f.db.exec("set session_replication_role = origin"); } }
  await f.db.exec("savepoint s4_seed; set session_replication_role = replica");
  try { const r = await f.db.query(sql, p); await f.db.exec("set session_replication_role = origin; release savepoint s4_seed"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s4_seed; set session_replication_role = origin; release savepoint s4_seed"); throw error; }
}
async function raw(sql, p = []) {
  await f.db.exec("savepoint s4_raw");
  try { const r = await f.db.query(sql, p); await f.db.exec("release savepoint s4_raw"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s4_raw; release savepoint s4_raw"); throw error; }
}
const rev = (command, payload = {}, actor = i.quality) => f.call("quality_reversal_command", command, payload, actor);
const qc = (command, payload, actor = i.quality) => f.call("quality_containment_command", command, payload, actor);
const olo = (command, payload = {}, actor = i.owner) => f.call("olo_command", command, payload, actor);
const fin = (command, payload = {}, actor = i.accounts) => f.call("dispatch_finance_command", command, payload, actor);
const comm = (command, payload = {}, actor = DISPATCHER) => f.call("dispatch_comm_command", command, payload, actor);
const denied = e => e.code === "42501";
const num = v => Number(v);
const approvedKg = async job => num((await one("select coalesce(sum(quantity_checked_kg),0) kg from quality_inspections where production_job_id=$1 and status='approved'", [job])).kg);

test.before(async () => {
  f = await createAutopilotFixture();
  await seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active,press_capacity_ton) values($1,$2,'Press C (1460 T)','extrusion_press','active',true,1460)", [P1, i.company]);
});
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); inTx = true; });
test.afterEach(async () => { inTx = false; await f.rollback(); });

/** An order with a completed job of `kg` and one earlier approval of `approved` kg. */
async function order({ kg = 1000, approved = 1000, hoursAgo = 2 } = {}) {
  const o = id(), line = id(), j = id(), ins = id();
  await seed(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,manufacturing_weight_kg,requested_weight_kg,production_quantity_kg,order_value)
    values($1,$2,$3,$4,current_date,current_date+10,'normal','order_confirmed',$5,$5,$5,236000)`, [o, i.company, `SO-P4-${o.slice(-4)}`, i.customer2, kg]);
  await seed("insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,section_weight_kg_per_m) values($1,$2,$3,$4,$5,'Sliding track',100,6,$6,0.95)", [line, i.company, o, i.profile2, i.die, kg]);
  await seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,machine_id,status,planned_date,planned_quantity_kg,actual_quantity_kg,completed_at,job_number)
    values($1,$2,$3,$4,$5,$6,$7,'completed',current_date,$8,$8,now(),$9)`, [j, i.company, o, line, i.profile2, i.die, P1, kg, `JOB-P4-${j.slice(-4)}`]);
  await seed(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,batch_number,inspector_name,surface_finish_ok,weight_per_meter_actual,created_at)
    values($1,$2,$3,$4,now()-make_interval(hours=>$6),$5,'approved','LOT-P4','QA day shift',true,0.95,now()-make_interval(hours=>$6))`, [ins, i.company, j, i.profile2, approved, hoursAgo]);
  return { order: o, line, job: j, ins };
}
const reverse = (a, payload = {}, actor) => rev("reverse", { inspection_id: a.ins, reversed_kg: 1000, reversed_as: "rejected", method: "Webster hardness re-test", reason: "Customer complaint: hardness below 12 HW on site", ...payload }, actor);

test("reversal: a full reversal marks the approval reversed, rejects its kilograms and every reader stops counting them", async () => {
  const a = await order();
  await raw("select private.handoff_for_inspection($1,$2)", [i.company, a.ins]);
  const manual = id();
  await seed("insert into tasks(id,company_id,title,task_type,status,created_by,due_date,related_entity_type,related_entity_id) values($1,$2,'Prepare the mill test certificate','general','open',$3,current_date+1,'production_job',$4)",
    [manual, i.company, i.owner, a.job]);

  await assert.rejects(() => reverse(a, {}, i.sales), denied);
  await assert.rejects(() => reverse(a, {}, i.factory), denied, "QA reverses; management is told");
  await assert.rejects(() => reverse(a, { reason: "short" }), /at least 10 characters/);
  await assert.rejects(() => reverse(a, { reversed_kg: 1200 }), /At most 1000 kg/);
  const preview = await rev("preview", { inspection_id: a.ins });
  assert.deepEqual([preview.can_reverse, num(preview.max_reversible_kg), num(preview.moved_on_kg)], [true, 1000, 0]);

  const r = await reverse(a, { reference: "CC-2026-118" });
  assert.match(r.reversal_number, /^QCR\/.+\/0001$/);
  assert.deepEqual([num(r.reversed_kg), num(r.retained_kg), r.retained_inspection_id], [1000, 0, null]);
  const orig = await one("select status, quantity_checked_kg, inspector_name, batch_number from quality_inspections where id=$1", [a.ins]);
  assert.deepEqual([orig.status, num(orig.quantity_checked_kg), orig.inspector_name], ["reversed", 1000, "QA day shift"], "the original keeps its values");
  const child = await one("select status, quantity_checked_kg, reversal_id, batch_number from quality_inspections where id=$1", [r.reversed_inspection_id]);
  assert.deepEqual([child.status, num(child.quantity_checked_kg), child.reversal_id, child.batch_number], ["rejected", 1000, r.id, "LOT-P4"]);
  assert.equal(await approvedKg(a.job), 0);

  const avail = await one("select available_kg from private.ap4_source_available($1,$2,'production',$3)", [i.company, a.order, a.job]);
  assert.equal(num(avail.available_kg), 0, "dispatch source availability no longer counts the reversed kilograms");
  assert.equal((await one("select private.handoff_for_inspection($1,$2) s", [i.company, a.ins])).s, "not_eligible");
  // Phase 6 (migration 20261125100000): OM-2045 is T5, so its first-stage approval releases the material to ageing and
  // raises no packing handoff at all; any handoff raised earlier is withdrawn by the reversal.
  const handoff = await one("select status from tasks where handoff_key=$1", [`inspection_release:${a.ins}`]);
  assert.ok(handoff === undefined || handoff.status === "cancelled", "no open packing handoff remains");
  const repro = await q("select workflow_department from tasks where workflow_kind='reproduction' and workflow_order_id=$1 and status='open'", [a.order]);
  assert.equal(repro.length, 1, "planning gets a reproduction task for the shortfall");
  assert.equal((await q("select 1 from source_change_reviews where task_id=$1 and source_id=$2 and status='requires_review'", [manual, a.ins])).length, 1,
    "an ordinary task that relied on the approval is held for independent review");
  assert.equal((await q("select 1 from source_change_reviews r join tasks t on t.id=r.task_id where t.workflow_key is not null and r.source_id=$1", [a.ins])).length, 0,
    "engine-verified workflow tasks are not held, so the engine can still close them");
  const alert = await q("select recipient_role from notifications where condition_key=$1", [`olo-qc-reversed:${r.id}`]);
  assert.ok(alert.some(n => n.recipient_role === "factory_manager"));
  assert.ok((await q("select 1 from olo_events where event_type='qc.approval_reversed' and order_id=$1", [a.order])).length === 1);
  const sources = await f.call("remelt_command", "sources", {}, i.quality);
  assert.ok(sources.rows.some(s => s.source_id === r.reversed_inspection_id), "the rejected kilograms can be proposed for remelt");

  await assert.rejects(() => reverse(a), /already reversed/);
  await assert.rejects(() => raw("update quality_inspections set notes='edited' where id=$1", [a.ins]), /reversed QC approval is final/);
  await assert.rejects(() => raw("update quality_reversals set reason='rewritten after the fact' where id=$1", [r.id]), /cannot be changed/);
  await assert.rejects(() => raw("delete from quality_inspections where id=$1", [r.reversed_inspection_id]), /evidence/);
  const detail = await rev("get", { id: r.id }, i.sales);
  assert.equal(detail.reference, "CC-2026-118");
  const list = await rev("list", {}, i.viewer);
  assert.equal(list.total, 1);
  assert.equal(list.can_reverse, false);
});

test("reversal counts: each kilogram is counted once, and the reproduction task carries the final quantities", async () => {
  const a = await order({ kg: 1000, approved: 600 });  // 400 kg of the job has no QC record yet
  const r = await reverse(a, { reversed_kg: 200 });
  assert.equal(num(r.retained_kg), 400);
  const s = (await one("select private.olo_order_supply($1,$2) s", [i.company, a.order])).s;
  assert.deepEqual([num(s.accepted), num(s.rejected), num(s.uninspected), num(s.shortfall)], [400, 200, 400, 200],
    "the reversed record and its children are not counted twice");
  const task = await one("select description from tasks where workflow_kind='reproduction' and workflow_order_id=$1 and status='open'", [a.order]);
  assert.match(task.description, /QC accepted 400 kg/);
  assert.match(task.description, /Shortfall 200 kg/);
  const alert = await one("select body from notifications where condition_key like 'reproduction:%' and body like '%' || $1 || '%' order by created_at desc limit 1",
    [(await one("select order_number from orders where id=$1", [a.order])).order_number]);
  assert.doesNotMatch(alert.body, /QC accepted 0 kg/, "no alert with the half-written quantities");
  assert.ok(Array.isArray((await qc("list", {})).rows), "the containment list reads");
  const candidates = await qc("candidates", {});
  assert.equal(num(candidates.rows.find(x => x.job_id === a.job).open_kg), 400);
  await assert.rejects(() => qc("open", { job_id: a.job, scope_kg: 401, stage: "final", defect: "Wall thickness below drawing minimum", defect_kind: "non_destructive" }), /400 kg of this job not yet dispositioned/);
  assert.ok((await qc("open", { job_id: a.job, scope_kg: 400, stage: "final", defect: "Wall thickness below drawing minimum", defect_kind: "non_destructive" })).id);
});

test("reversal: direct writes cannot mark an approval reversed or forge a reversal child", async () => {
  const a = await order();
  await assert.rejects(() => raw("update quality_inspections set status='reversed' where id=$1", [a.ins]), /Only the QC reversal action/);
  await assert.rejects(() => raw(`insert into quality_inspections(company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,inspector_name)
    values($1,$2,$3,now(),10,'reversed','QA')`, [i.company, a.job, i.profile2]), /Only the QC reversal action/);
  const r = await reverse(a, { reversed_kg: 400 });
  await assert.rejects(() => raw(`insert into quality_inspections(company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,inspector_name,surface_finish_ok,reversal_id)
    values($1,$2,$3,now(),10,'rejected','QA',false,$4)`, [i.company, a.job, i.profile2, r.id]), /must use the QC reversal action/);
  await assert.rejects(() => f.asUser("update quality_inspections set status='reversed' where id=$1", [r.retained_inspection_id], i.quality));
});

test("reversal: only material not yet moved on can be reversed; the retained part stays approved without re-testing the plan", async () => {
  const a = await order();
  await seed(`insert into inspection_plans(id,company_id,profile_id,version,status,sampling_instruction,created_by,approved_by,approved_at) values($1,$2,$3,1,'approved','5 pieces per bundle',$4,$4,now())`,
    [id(), i.company, i.profile2, i.owner]);
  await seed("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PK-P4-1',$3,$4,current_date,10,600,60,'in_progress')", [id(), i.company, a.order, a.job]);
  const preview = await rev("preview", { inspection_id: a.ins });
  assert.deepEqual([num(preview.moved_on_kg), num(preview.max_reversible_kg)], [600, 400]);
  await assert.rejects(() => reverse(a, { reversed_kg: 500 }), /600 kg of this job has already moved.*at most 400 kg/);

  const r = await reverse(a, { reversed_kg: 400, reversed_as: "rework" });
  assert.deepEqual([num(r.reversed_kg), num(r.retained_kg)], [400, 600]);
  const rows = await q("select status, quantity_checked_kg kg, reversal_id from quality_inspections where production_job_id=$1 order by status", [a.job]);
  assert.deepEqual(rows.map(x => [x.status, num(x.kg)]), [["approved", 600], ["reversed", 1000], ["rework", 400]]);
  assert.equal(await approvedKg(a.job), 600);
  assert.equal((await rev("preview", { inspection_id: r.retained_inspection_id })).blocker.includes("already moved"), true, "nothing more can be reversed while 600 kg is packed");

  // The rework part follows the existing rework resolution; its approved child can itself be reversed later.
  const resolution = (await f.asUser("select public.resolve_quality_rework_atomic($1,300,100,'QA night shift','Re-aged and re-tested 300 kg') id", [r.reversed_inspection_id], i.quality))[0].id;
  assert.ok(resolution);
  assert.equal(await approvedKg(a.job), 900);
  await seed("update packaging_jobs set status='cancelled' where production_job_id=$1", [a.job]);
  const child = await one("select id from quality_inspections where resolution_id=$1 and status='approved'", [resolution]);
  const r2 = await rev("reverse", { inspection_id: child.id, reversed_kg: 300, reversed_as: "rejected", method: "Hardness re-test", reason: "Second complaint: re-aged lot still soft" });
  assert.equal(num(r2.retained_kg), 0);
  assert.equal(await approvedKg(a.job), 600);
});

test("reversal under containment: only a revoked approval can be reversed; reversing all of it closes the revocation", async () => {
  const a = await order({ kg: 1000, approved: 400 });
  const c = await qc("open", { job_id: a.job, scope_kg: 600, stage: "final", defect: "Hardness below specification on sample 2", defect_kind: "non_destructive" });
  await assert.rejects(() => reverse(a, { reversed_kg: 400 }), /Review this approval there first/);
  await qc("prior_review", { id: c.id, inspection_id: a.ins, outcome: "revoked", method: "Webster hardness re-test", note: "Below 12 HW on 3 of 5 pieces" });
  let detail = await qc("get", { id: c.id });
  assert.equal(num(detail.suspended_approved_kg), 400);
  assert.equal(detail.can_reverse, true);

  const r = await reverse(a, { reversed_kg: 400 });
  assert.equal(r.revocation_closed, true);
  detail = await qc("get", { id: c.id });
  assert.equal(num(detail.suspended_approved_kg), 0);
  assert.equal(detail.prior_approvals[0].review.close_method, `QC reversal ${r.reversal_number}`);
  assert.deepEqual(detail.reversals.map(x => x.reversal_number), [r.reversal_number]);
  assert.equal((await one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`olo-prior-revoked:${a.ins}`])).n, 0);
  await qc("result", { id: c.id, reference: "L1", result: "accepted", quantity_kg: 600, method: "Hardness on every piece" });
  assert.equal((await qc("release", { id: c.id, note: "Balance re-tested and within specification" })).status, "resolved");
});

test("reversal under containment: a partial reversal keeps the revocation open for management to close", async () => {
  const a = await order({ kg: 1000, approved: 400 });
  const c = await qc("open", { job_id: a.job, scope_kg: 600, stage: "final", defect: "Wall thickness below drawing minimum", defect_kind: "non_destructive" });
  await qc("prior_review", { id: c.id, inspection_id: a.ins, outcome: "revoked", method: "Micrometer re-check", note: "150 kg below the drawing minimum wall" });
  const r = await reverse(a, { reversed_kg: 150 });
  assert.deepEqual([r.revocation_closed, num(r.retained_kg)], [false, 250]);
  assert.equal((await one("select status from quality_inspections where id=$1", [r.retained_inspection_id])).status, "approved", "the retained part is recorded while the lot is held");
  let detail = await qc("get", { id: c.id });
  assert.equal(num(detail.suspended_approved_kg), 400);
  const closed = await qc("prior_close", { id: c.id, review_id: detail.prior_approvals[0].review.id, method: "Re-measured the 250 kg kept", note: "250 kg re-measured piece by piece, all within drawing" }, i.factory);
  assert.equal(num(closed.suspended_approved_kg), 0);
  // While the lot is held, packaging is still refused through the containment.
  await assert.rejects(() => raw("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PK-P4-2',$3,$4,current_date,10,100,60,'scheduled')", [id(), i.company, a.order, a.job]), /under QC containment/);
});

test("settings: the release validity and the batch 2 settings are saved by managers within their ranges", async () => {
  const audits = async () => num((await one("select count(*) n from audit_logs where action='olo_settings.updated'")).n);
  const before = await audits();
  assert.equal((await olo("settings.save", { dispatch_release_hours: 24 }, i.factory)).dispatch_release_hours, 24, "saved even before any settings row exists");
  assert.equal(await audits(), before + 1, "only the Phase 4 change is logged when nothing else changed");
  const s = await olo("settings.save", { dispatch_release_hours: 12, delivery_confirmation_days: 5, reproduction_tolerance_kg: 2.5, ack_sla_hours: 6 }, i.factory);
  assert.deepEqual([s.dispatch_release_hours, s.delivery_confirmation_days, num(s.reproduction_tolerance_kg), s.ack_sla_hours], [12, 5, 2.5, 6]);
  await assert.rejects(() => olo("settings.save", { dispatch_release_hours: 2 }), /4 to 168 hours/);
  await assert.rejects(() => olo("settings.save", { delivery_confirmation_days: 90 }), /1 to 60 days/);
  await assert.rejects(() => olo("settings.save", { dispatch_release_hours: 24 }, i.sales), denied);
  assert.equal((await olo("settings.get")).settings.dispatch_release_hours, 12);
  assert.ok((await q("select 1 from audit_logs where action='olo_settings.updated' and metadata_json->'changes' ? 'dispatch_release_hours'")).length >= 1);

  const a = await order({ kg: 500, approved: 500 });
  await fin("terms.set", { scope: "order", order_id: a.order, terms: "payment_before_dispatch", reason: "Agreed in the order confirmation" });
  const d = id();
  await seed(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles) values($1,$2,$3,'DC-P4-1',current_date,'pending',500,1)`, [d, i.company, a.order]);
  await seed(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,source_kind,source_record_id,source_line_id,net_rate,gst_percent)
    values($1,$2,$3,$4,'B-P4',50,505,5,300,'production',$5,$6,200,18)`, [id(), i.company, d, i.profile2, a.order, a.job]);
  const r = await fin("release", { dispatch_id: d, basis: "payment_confirmed", reference: "UTR-P4-0001", note: "RTGS seen in the bank statement" });
  assert.equal(r.release_hours, 12);
  const row = await one("select extract(epoch from expires_at - released_at)/3600 h from dispatch_finance_releases where id=$1", [r.id]);
  assert.equal(Math.round(num(row.h)), 12);
  assert.equal(r.state, "released");
  assert.equal((await fin("status", { dispatch_id: d })).release_hours, 12);
});

test("communication queue: dispatches of opening-balance orders are not listed", async () => {
  const a = await order({ kg: 500, approved: 500 });
  const cut = id();
  // Seeds run with triggers suspended, so the cutover plan itself is not needed for this check.
  const b = await order({ kg: 500, approved: 500 });
  await seed("update orders set opening_cutover_id=$1 where id=$2", [cut, b.order]);
  for (const [o, n] of [[a.order, "DC-P4-A"], [b.order, "DC-P4-B"]]) {
    await seed(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles,actual_dispatched_at) values($1,$2,$3,$4,current_date,'dispatched',500,1,now())`, [id(), i.company, o, n]);
  }
  const queue = await comm("queue", {});
  const numbers = queue.rows.map(x => x.dispatch_number);
  assert.ok(numbers.includes("DC-P4-A"));
  assert.ok(!numbers.includes("DC-P4-B"), "opening-balance orders never get a task, so they are not queued");
  assert.equal((await comm("queue", { view: "sent" })).view, "sent", "other views still go to the batch 3 command");
});
