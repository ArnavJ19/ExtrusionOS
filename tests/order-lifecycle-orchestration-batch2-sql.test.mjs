import test from "node:test";
import assert from "node:assert/strict";
import { createAutopilotFixture, apIds as i } from "../scripts/lib/autopilot-batch1-fixture.mjs";

// Order lifecycle orchestration batch 2 (migration 20261120200000): QC containment with 100% inspection and expanded
// sampling, child lots and traceability, the downstream hold, remelt approval by the factory manager or owner with
// foundry receipt and mass reconciliation, reproduction of shortfalls, delivery confirmation and acceptance follow-up,
// order-change revalidation and priority-change approval. Synthetic data only.
let f;
let seq = 20000;
const id = () => `0e200000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const P1 = "0e200000-0000-4000-8000-000000000001";

const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
let inTx = false;
async function seed(sql, p = []) {
  if (!inTx) { await f.db.exec("set session_replication_role = replica"); try { return (await f.db.query(sql, p)).rows; } finally { await f.db.exec("set session_replication_role = origin"); } }
  await f.db.exec("savepoint s2_seed; set session_replication_role = replica");
  try { const r = await f.db.query(sql, p); await f.db.exec("set session_replication_role = origin; release savepoint s2_seed"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s2_seed; set session_replication_role = origin; release savepoint s2_seed"); throw error; }
}
async function raw(sql, p = []) {
  await f.db.exec("savepoint s2_raw");
  try { const r = await f.db.query(sql, p); await f.db.exec("release savepoint s2_raw"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s2_raw; release savepoint s2_raw"); throw error; }
}
const cmd = (fn, command, payload = {}, actor = i.quality) => f.call(fn, command, payload, actor);
const qc = (command, payload, actor = i.quality) => cmd("quality_containment_command", command, payload, actor);
const remelt = (command, payload, actor) => cmd("remelt_command", command, payload, actor);
const prio = (command, payload, actor) => cmd("priority_request_command", command, payload, actor);
const olo = (command, payload = {}, actor = i.owner) => cmd("olo_command", command, payload, actor);
const denied = e => e.code === "42501";
const num = v => Number(v);

test.before(async () => {
  f = await createAutopilotFixture();
  await seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active,press_capacity_ton) values($1,$2,'Press A (1500 T)','extrusion_press','active',true,1500)", [P1, i.company]);
  await seed("update aluminium_profiles set billet_diameter_required_inch=7, drawing_approval_status='approved' where id=$1", [i.profile2]);
  await seed("update dies set die_type='solid', die_status='active' where id=$1", [i.die]);
});
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); inTx = true; });
test.afterEach(async () => { inTx = false; await f.rollback(); });

/** An order with a completed job of `kg` output (or a planned job when `status` is given). */
async function order({ kg = 1000, status = "completed", hours = null, billets = 0 } = {}) {
  const o = id(), line = id(), j = id();
  await seed(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,manufacturing_weight_kg,requested_weight_kg,production_quantity_kg)
    values($1,$2,$3,$4,current_date,current_date+10,'normal','order_confirmed',$5,$5,$5)`, [o, i.company, `SO-B2-${o.slice(-4)}`, i.customer2, kg]);
  await seed("insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,section_weight_kg_per_m) values($1,$2,$3,$4,$5,'Sliding track',100,6,$6,0.95)", [line, i.company, o, i.profile2, i.die, kg]);
  if (billets) await seed(`insert into order_billet_requirements(company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billet_length_mm,required_weight_kg,billet_weight_kg,extrusion_efficiency_percent,billets_required,billets_allocated,billets_short,status)
    values($1,$2,$3,'6063','T5',7,800,$4,60,80,$5,0,$5,'pending')`, [i.company, o, i.profile2, kg, billets]);
  await seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,machine_id,status,planned_date,planned_quantity_kg,actual_quantity_kg,completed_at,job_number)
    values($1,$2,$3,$4,$5,$6,$7,$8,current_date,$9,$10,$11,$12)`, [j, i.company, o, line, i.profile2, i.die, P1, status, kg, status === "completed" ? kg : 0, status === "completed" ? new Date().toISOString() : null, `JOB-B2-${j.slice(-4)}`]);
  if (hours !== null) await seed("insert into production_plan_slots(company_id,production_job_id,machine_id,planned_start_at,planned_end_at,status,sequence_number,created_by,capacity_kg) values($1,$2,$3,now()+make_interval(mins=>($4::numeric*60)::int),now()+make_interval(mins=>($4::numeric*60+30)::int),'scheduled',0,$5,$6)", [i.company, j, P1, hours, i.owner, kg]);
  return { order: o, line, job: j };
}
const open = (job, extra = {}) => qc("open", { job_id: job, scope_kg: 1000, stage: "final", defect: "Wall thickness below drawing minimum on sample 3", defect_kind: "non_destructive", ...extra });
async function results(id, list) { for (const [ref, result, kg] of list) await qc("result", { id, reference: ref, result, quantity_kg: kg, method: "Micrometer on every piece" }); }
/** A packaging job insert with only the containment guard live. */
async function pack(order, job) {
  await f.db.exec("alter table packaging_jobs disable trigger user; alter table packaging_jobs enable trigger zzz_guard_olo_containment");
  try { return await raw("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,$3,$4,$5,current_date,10,100,60,'scheduled')", [id(), i.company, `PK-${seq}`, order, job]); }
  finally { await f.db.exec("alter table packaging_jobs enable trigger user"); }
}

test("containment: a failed sample holds the lot, opens an NCR and a QA task, and stops packaging and new approvals", async () => {
  const a = await order();
  const c = await open(a.job);
  assert.match(c.containment_number, /^QCH\//);
  assert.equal(c.inspection_mode, "full_inspection");
  const ncr = await one("select status, source_kind, checked_qty from quality_ncrs where id=$1", [c.ncr_id]);
  assert.deepEqual([ncr.status, ncr.source_kind, num(ncr.checked_qty)], ["open", "job", 1000]);
  const task = await one("select workflow_department, priority, description from tasks where workflow_kind='containment' and workflow_source_id=$1", [c.id]);
  assert.equal(task.workflow_department, "quality");
  assert.match(task.description, /Inspect every piece or identifiable sublot/);
  const roles = (await q("select distinct recipient_role from notifications where condition_key like $1 order by 1", [`containment:${c.id}:%`])).map(r => r.recipient_role);
  assert.ok(roles.includes("quality") && roles.includes("factory_manager") && roles.includes("owner"), `final-stage failures reach management: ${roles}`);
  await assert.rejects(() => pack(a.order, a.job), /under QC containment QCH\//);
  await assert.rejects(() => raw("insert into quality_inspections(company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,inspector_name) values($1,$2,$3,now(),100,'approved','QA lead')", [i.company, a.job, i.profile2]),
    /Release accepted material through the containment/);
  await assert.rejects(() => open(a.job), /already has an active containment/);
  await assert.rejects(() => qc("result", { id: c.id, reference: "P1", result: "accepted", quantity_kg: 10, method: "Micrometer" }, i.production), denied);
  await assert.rejects(() => open(a.job, { scope_kg: 1200 }), /already has an active containment|not yet dispositioned/);
});

test("containment: 700 accepted, 200 rejected, 100 still held — child lots, partial fulfilment and a reproduction task", async () => {
  const a = await order();
  const c = await open(a.job);
  await results(c.id, [...Array(7)].map((_, n) => [`B${n + 1}`, "accepted", 100]).concat([["B8", "rejected", 100], ["B9", "rejected", 100]]));
  await assert.rejects(() => qc("result", { id: c.id, reference: "B10", result: "accepted", quantity_kg: 150, method: "Micrometer" }), /exceed the contained 1000 kg/);
  await assert.rejects(() => qc("result", { id: c.id, reference: "b1", result: "accepted", quantity_kg: 10, method: "Micrometer" }), /duplicate|unique/i);
  await assert.rejects(() => qc("release", { id: c.id, note: "ok" }), /disposition basis/);
  const r = await qc("release", { id: c.id, note: "Pieces measured individually; B8 and B9 below minimum wall" });
  assert.deepEqual([r.status, num(r.accepted_kg), num(r.rejected_kg), num(r.held_kg)], ["partially_resolved", 700, 200, 100]);
  const insp = await q("select status, quantity_checked_kg::float kg, batch_number from quality_inspections where production_job_id=$1 order by status", [a.job]);
  assert.deepEqual(insp.map(x => [x.status, x.kg]), [["approved", 700], ["rejected", 200]]);
  const lots = await q("select kind, quantity_kg::float kg, status, parent_lot_id is not null child from material_lots where containment_id=$1 order by created_at", [c.id]);
  assert.deepEqual(lots.map(l => [l.kind, l.kg, l.status, l.child]), [["production", 1000, "held", false], ["accepted", 700, "released", true], ["rejected", 200, "rejected", true]]);
  const accepted = await one("select id from material_lots where containment_id=$1 and kind='accepted'", [c.id]);
  assert.ok(insp.every(x => x.batch_number?.startsWith("LOT-")));
  assert.ok(accepted.id);
  await pack(a.order, a.job);  // nothing was approved before the containment, so released material may move on

  const life = await olo("lifecycle.order", { order_id: a.order }, i.production);
  assert.deepEqual([life.quantities.qc_accepted_kg, life.quantities.qc_rejected_kg, life.quantities.qc_held_kg].map(num), [700, 200, 100]);
  assert.equal(life.domains.find(d => d.key === "quality").status, "held");
  assert.equal(life.domains.find(d => d.key === "nonconforming").status, "contained");
  assert.equal(life.next_action.department, "quality");
  assert.notEqual(life.overall, "fully_closed");
  const rep = await one("select description, workflow_department from tasks where workflow_kind='reproduction' and workflow_source_id=$1", [a.order]);
  assert.equal(rep.workflow_department, "production_planning");
  assert.match(rep.description, /held in containment 100 kg/);
  assert.match(rep.description, /Shortfall 200 kg/);

  await results(c.id, [["B10", "rejected", 100]]);
  const done = await qc("release", { id: c.id, note: "Remaining sublot measured; below minimum" });
  assert.equal(done.status, "resolved");
  assert.equal((await one("select status from tasks where workflow_kind='containment' and workflow_source_id=$1", [c.id])).status, "completed");
  assert.equal((await one("select status from material_lots where containment_id=$1 and kind='production'", [c.id])).status, "split");
  const detail = await qc("get", { id: c.id });
  assert.equal(detail.trace.machine_name, "Press A (1500 T)");
  assert.equal(detail.lots.length, 4);
});

test("containment: material approved before the hold stays blocked until the whole lot is resolved", async () => {
  const a = await order();
  await seed("insert into quality_inspections(company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status) values($1,$2,$3,now()-interval '1 hour',500,'approved')", [i.company, a.job, i.profile2]);
  await assert.rejects(() => open(a.job), /500 kg of this job not yet dispositioned/);
  const c = await open(a.job, { scope_kg: 500 });
  assert.equal(num((await one("select suspended_approved_kg from quality_containments where id=$1", [c.id])).suspended_approved_kg), 500);
  await results(c.id, [["L1", "accepted", 300]]);
  await qc("release", { id: c.id, note: "First 300 kg re-measured and within drawing" });
  await assert.rejects(() => pack(a.order, a.job), /under QC containment/, "the earlier approval stays suspended");
  await results(c.id, [["L2", "accepted", 200]]);
  await assert.rejects(() => qc("release", { id: c.id, note: "Balance re-measured and within drawing" }), /500 kg of this job was approved before the containment and is not yet reviewed/);
  // Batch 3: the blanket confirmation is replaced by a review of each earlier approval.
  await assert.rejects(() => qc("release", { id: c.id, note: "Balance re-measured; earlier 500 kg re-checked by sampling", prior_approved_confirmed: true }), /not yet reviewed/);
  const prior = (await qc("get", { id: c.id })).prior_approvals[0];
  await qc("prior_review", { id: c.id, inspection_id: prior.inspection_id, outcome: "reconfirmed", method: "Sampling of the earlier lot", note: "Earlier 500 kg re-checked and within drawing" });
  await qc("release", { id: c.id, note: "Balance re-measured; earlier 500 kg re-checked by sampling" });
  await pack(a.order, a.job);
});

test("expanded sampling: one passing replacement sample never releases a lot; a failure blocks acceptance", async () => {
  const a = await order();
  await assert.rejects(() => open(a.job, { defect_kind: "destructive", defect: "Tensile below specification on sample 1" }), /expanded sampling plan reference/);
  const c = await open(a.job, { defect_kind: "destructive", defect: "Tensile below specification on sample 1", sampling_reference: "QAP-07 table 3", required_samples: 3 });
  assert.equal(c.inspection_mode, "expanded_sampling");
  await qc("result", { id: c.id, reference: "S1", result: "accepted", method: "Tensile test, UTM" });
  await assert.rejects(() => qc("release", { id: c.id, decision: "accept_lot", note: "Replacement sample passed" }), /needs 3 passing samples; 1 recorded/);
  await qc("result", { id: c.id, reference: "S2", result: "rejected", method: "Tensile test, UTM" });
  await qc("result", { id: c.id, reference: "S3", result: "accepted", method: "Tensile test, UTM" });
  await qc("result", { id: c.id, reference: "S4", result: "accepted", method: "Tensile test, UTM" });
  await assert.rejects(() => qc("release", { id: c.id, decision: "accept_lot", note: "Three passing samples" }), /A sample failed/);
  const r = await qc("release", { id: c.id, decision: "reject_lot", note: "Expanded sampling failed; lot rejected for remelt review" });
  assert.deepEqual([r.status, num(r.rejected_kg)], ["resolved", 1000]);

  const b = await order();
  const c2 = await open(b.job, { defect_kind: "destructive", defect: "Hardness low on one sample", sampling_reference: "QAP-07 table 3", required_samples: 2 });
  for (const ref of ["H1", "H2"]) await qc("result", { id: c2.id, reference: ref, result: "accepted", method: "Webster hardness" });
  const ok = await qc("release", { id: c2.id, decision: "accept_lot", note: "Two further samples per QAP-07 within limits" });
  assert.deepEqual([ok.status, num(ok.accepted_kg)], ["resolved", 1000]);
});

test("remelt: nobody below the factory manager scraps rejected material; approval, foundry weigh-in and reconciliation", async () => {
  const a = await order();
  const c = await open(a.job);
  await results(c.id, [["B1", "accepted", 800], ["B2", "rejected", 200]]);
  await qc("release", { id: c.id, note: "Measured each sublot; B2 below minimum wall" });
  const rejected = (await one("select id from quality_inspections where production_job_id=$1 and status='rejected'", [a.job])).id;

  await assert.rejects(() => f.asUser("select public.record_material_disposition('qc_reject',$1,null,'scrap',200,null,'Wall below minimum')", [rejected], i.quality), /factory manager or owner to approve/);
  await assert.rejects(() => remelt("propose", { source_type: "qc_reject", source_id: rejected, quantity_kg: 250, reason: "Wall below minimum" }, i.quality), /Only 200 kg/);
  const p = await remelt("propose", { source_type: "qc_reject", source_id: rejected, quantity_kg: 200, reason: "Wall below minimum", evidence: "QC report on B2" }, i.quality);
  const t = await one("select workflow_department, description from tasks where workflow_kind='remelt_approval' and workflow_source_id=$1", [p.id]);
  assert.equal(t.workflow_department, "factory_management");
  assert.match(t.description, /only the factory manager or owner may decide/);
  assert.deepEqual((await q("select distinct recipient_role from notifications where condition_key like $1 order by 1", [`remelt_approval:${p.id}:%`])).map(r => r.recipient_role), ["factory_manager", "owner"]);
  await assert.rejects(() => remelt("propose", { source_type: "qc_reject", source_id: rejected, quantity_kg: 1, reason: "Second request" }, i.quality), /Only 0 kg/);
  await assert.rejects(() => remelt("decide", { id: p.id, decision: "approve", note: "Agreed" }, i.productionManager), denied);
  await assert.rejects(() => remelt("decide", { id: p.id, decision: "approve", note: "Agreed" }, i.quality), denied);

  const d = await remelt("decide", { id: p.id, decision: "approve", note: "Confirmed against the QC report" }, i.factory);
  assert.equal(d.status, "awaiting_receipt");
  const disp = await one("select disposition, weight_kg::float kg, foundry_scrap_id from material_dispositions where id=$1", [d.disposition_id]);
  assert.deepEqual([disp.disposition, disp.kg], ["scrap", 200]);
  assert.equal((await one("select status from foundry_aluminium_scrap where id=$1", [disp.foundry_scrap_id])).status, "reserved", "not available for melt before the foundry weighs it in");
  assert.equal((await one("select status from tasks where workflow_kind='remelt_approval' and workflow_source_id=$1", [p.id])).status, "completed");
  assert.equal((await one("select workflow_department from tasks where workflow_kind='remelt_receipt' and workflow_source_id=$1", [p.id])).workflow_department, "foundry");

  await assert.rejects(() => remelt("receive", { id: p.id, received_kg: 195 }, i.production), /differs from the approved 200 kg/);
  const rec = await remelt("receive", { id: p.id, received_kg: 195, weighbridge_reference: "WB-551", variance_note: "Offcuts retained by QC as retention samples" }, i.production);
  assert.equal(num(rec.variance_kg), 5);
  assert.equal((await one("select status from foundry_aluminium_scrap where id=$1", [disp.foundry_scrap_id])).status, "available");
  assert.deepEqual((await q("select recipient_role, severity from notifications where condition_key=$1", [`olo-remelt-variance:${p.id}`])).map(n => [n.recipient_role, n.severity]), [["factory_manager", "critical"]]);
  const recon = (await remelt("get", { id: p.id }, i.factory)).reconciliation;
  assert.deepEqual([num(recon.rejected_kg), num(recon.approved_kg), num(recon.dispositioned_kg), num(recon.received_kg), num(recon.variance_kg)], [200, 200, 200, 195, 5]);
  const timeline = (await olo("lifecycle.order", { order_id: a.order }, i.production)).timeline.map(e => e.summary).join(" | ");
  assert.match(timeline, /remelt of 200 kg requested/);
  assert.match(timeline, /approved by the factory manager/);
  assert.match(timeline, /weighed in at the foundry: 195 kg \(variance 5 kg\)/);
});

test("remelt: a proposer cannot approve their own request; a factory manager recording scrap directly is captured as an approval", async () => {
  const a = await order();
  const c = await open(a.job);
  await results(c.id, [["B1", "rejected", 1000]]);
  await qc("release", { id: c.id, note: "Whole lot below minimum wall" });
  const rejected = (await one("select id from quality_inspections where production_job_id=$1 and status='rejected'", [a.job])).id;
  const p = await remelt("propose", { source_type: "qc_reject", source_id: rejected, quantity_kg: 400, reason: "Wall below minimum" }, i.factory);
  await assert.rejects(() => remelt("decide", { id: p.id, decision: "approve", note: "Agreed" }, i.factory), /cannot also approve/);
  await remelt("decide", { id: p.id, decision: "reject", note: "Hold for customer concession review" }, i.owner);
  await f.asUser("select public.record_material_disposition('qc_reject',$1,null,'scrap',300,null,'Scrap after customer refused concession')", [rejected], i.factory);
  const auto = await one("select status, decided_by_role, proposed_by=decided_by self from remelt_approvals where quality_inspection_id=$1 and status<>'rejected'", [rejected]);
  assert.deepEqual([auto.status, auto.decided_by_role, auto.self], ["awaiting_receipt", "factory_manager", true]);
});

test("reproduction: held material is counted; when it is later rejected the shortfall re-opens instead of being produced twice", async () => {
  const a = await order();
  const c = await open(a.job);
  await results(c.id, [["B1", "accepted", 700], ["B2", "rejected", 200]]);
  await qc("release", { id: c.id, note: "Sublots measured; B2 below minimum" });
  const [t1] = await q("select id, status from tasks where workflow_kind='reproduction' and workflow_source_id=$1", [a.order]);
  assert.equal(t1.status, "open");
  // Planning covers the 200 kg: the task closes.
  await seed("insert into production_jobs(company_id,order_id,profile_id,die_id,status,planned_date,planned_quantity_kg,job_number) values($1,$2,$3,$4,'planned',current_date+2,200,'JOB-B2-RP')", [i.company, a.order, i.profile2, i.die]);
  await olo("evaluate");
  assert.equal((await one("select status from tasks where id=$1", [t1.id])).status, "completed");
  // The 100 kg still held is rejected later: a second cycle opens for that balance only.
  await results(c.id, [["B3", "rejected", 100]]);
  await qc("release", { id: c.id, note: "Last sublot below minimum" });
  const cycles = await q("select workflow_cycle, status, description from tasks where workflow_kind='reproduction' and workflow_source_id=$1 order by workflow_cycle", [a.order]);
  assert.deepEqual(cycles.map(x => [x.workflow_cycle, x.status]), [[1, "completed"], [2, "open"]]);
  assert.match(cycles[1].description, /Shortfall 100 kg/);
});

test("delivery: overdue confirmation goes to dispatch; delivery opens the customer acceptance follow-up, closed by dispositions", async () => {
  const a = await order();
  const d = id(), item = id();
  await seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles,actual_dispatched_at,lr_number,transporter_name) values($1,$2,$3,'DC-B2-1',current_date-5,'dispatched',500,1,now()-interval '5 days','LR-77','VRL Logistics')", [d, i.company, a.order]);
  await seed("insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,source_kind,source_record_id) values($1,$2,$3,$4,'B-B2-1',50,505,5,300,'production',$5)", [item, i.company, d, i.profile2, a.order]);
  await olo("evaluate");
  const t = await one("select id, workflow_department, description from tasks where workflow_kind='delivery_confirmation' and workflow_source_id=$1", [d]);
  assert.equal(t.workflow_department, "dispatch");
  assert.match(t.description, /LR LR-77/);
  assert.ok((await q("select 1 from notifications where condition_key like $1 and recipient_role='sales'", [`delivery_confirmation:${d}:%`])).length > 0);
  await olo("evaluate");
  assert.equal((await one("select count(*)::int n from tasks where workflow_kind='delivery_confirmation' and workflow_source_id=$1", [d])).n, 1);

  const pod = `${i.company}/dispatches/${d}/proof-of-delivery/pod.jpg`;
  await seed("insert into technical_documents(company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,storage_bucket,storage_path,approval_status,uploaded_by) values($1,'proof_of_delivery','dispatch',$2,'pod.jpg',$3,'documents',$3,'approved',$4)", [i.company, d, pod, i.owner]);
  await f.db.query("update dispatches set delivery_status='delivered', delivered_at=now(), proof_of_delivery_url=$2 where id=$1", [d, pod]);
  assert.equal((await one("select status from tasks where id=$1", [t.id])).status, "completed");
  const follow = await one("select id, workflow_department, description from tasks where workflow_kind='delivery_followup' and workflow_source_id=$1", [d]);
  assert.equal(follow.workflow_department, "sales");
  assert.match(follow.description, /A transporter's delivery report is not customer acceptance/);
  await seed("insert into delivery_dispositions(company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by) values($1,$2,$3,'accepted',500,'Mr Sharma','Signed delivery challan copy',$4,$4)", [i.company, d, item, i.sales]);
  await olo("evaluate");
  assert.equal((await one("select status from tasks where id=$1", [follow.id])).status, "completed");
});

test("change control: an approved order change withdraws stale billet work and re-evaluates it as a new cycle", async () => {
  const a = await order({ status: "planned", hours: 1, billets: 4 });
  await olo("evaluate");
  const [t1] = await q("select id from tasks where workflow_kind='billet_allocation' and workflow_job_id=$1", [a.job]);
  assert.ok(t1);
  const p = id();
  await seed("insert into order_change_proposals(id,company_id,order_id,order_item_id,changes,reason,line_fingerprint,status,proposed_by) values($1,$2,$3,$4,'{\"quantity_kg\":1200}','Customer increased quantity','x','assessed',$5)", [p, i.company, a.order, a.line, i.sales]);
  await f.db.query("update order_change_proposals set status='approved', decided_by=$2, decided_at=now(), decision_note='Approved by planning' where id=$1", [p, i.productionManager]);
  const tasks = await q("select workflow_cycle, status, system_resolution from tasks where workflow_kind='billet_allocation' and workflow_job_id=$1 order by workflow_cycle", [a.job]);
  assert.deepEqual(tasks.map(x => [x.workflow_cycle, x.status]), [[1, "cancelled"], [2, "open"]]);
  assert.match(tasks[0].system_resolution, /order change was approved/);
  assert.ok((await one("select 1 x from olo_events where event_type='order.change_approved' and order_id=$1", [a.order])).x);
  assert.equal((await one("select count(*)::int n from olo_engine_errors")).n, 0);
});

test("priority: a reasoned request decided by planning authority, never by the requester", async () => {
  const a = await order({ status: "planned", hours: 1 });
  await olo("evaluate");
  await assert.rejects(() => prio("request", { order_id: a.order, to_priority: "urgent", reason: "short" }, i.sales), /at least 10 characters/);
  const r = await prio("request", { order_id: a.order, to_priority: "urgent", reason: "Customer site handover moved forward by a week" }, i.sales);
  await assert.rejects(() => prio("request", { order_id: a.order, to_priority: "high", reason: "Another request for the same order" }, i.salesManager), /already pending/);
  const req = await one("select impact from priority_change_requests where id=$1", [r.id]);
  assert.equal(req.impact[0].queue_rank, 1);
  await assert.rejects(() => prio("decide", { id: r.id, decision: "approve", note: "Fine" }, i.sales), denied);
  await prio("decide", { id: r.id, decision: "approve", note: "Press A has room after the current run" }, i.productionManager);
  assert.equal((await one("select priority from orders where id=$1", [a.order])).priority, "urgent");
  assert.ok((await one("select 1 x from audit_logs where action='order.priority_changed' and entity_id=$1", [a.order])).x);
  assert.equal((await one("select status from tasks where workflow_kind='priority_approval' and workflow_source_id=$1", [r.id])).status, "completed");
  assert.equal((await one("select count(*)::int n from notifications where recipient_user_id=$1 and notification_type='olo_priority_decision'", [i.sales])).n, 1);

  const own = await prio("request", { order_id: a.order, to_priority: "high", reason: "Rebalance after the urgent run is planned" }, i.productionManager);
  await assert.rejects(() => prio("decide", { id: own.id, decision: "approve", note: "Self" }, i.productionManager), /cannot decide their own/);
  await prio("decide", { id: own.id, decision: "reject", note: "Keep urgent until dispatch" }, i.factory);
  assert.equal((await one("select priority from orders where id=$1", [a.order])).priority, "urgent");
});
