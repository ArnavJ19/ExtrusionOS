import test from "node:test";
import assert from "node:assert/strict";
import { createDispatchFixture, dIds as i } from "../scripts/lib/autopilot-batch4-fixture.mjs";

// Review fixes for orchestration batches 2 and 3 (migration 20261123200000), through the real dispatch writer:
//   1. a dispatch cannot leave while any bundle comes from a job under open QC containment;
//   2. a dispatch whose payment terms are not met is kept pending (not rolled back), so accounts can release it;
//   3. a containment with an open revocation cannot be cancelled. Synthetic data only.
let f;
test.before(async () => { f = await createDispatchFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const dispatch = (command, payload = {}, actor = i.dispatchUser) => f.call("ap_dispatch", command, payload, actor);
const fin = (command, payload = {}, actor = i.accounts) => f.call("dispatch_finance_command", command, payload, actor);
const qc = (command, payload, actor = i.quality) => f.call("quality_containment_command", command, payload, actor);
const gateOut = d => f.asUser("select public.transition_dispatch_delivery_atomic($1,'dispatched') id", [d], i.dispatchUser);

/** A ready order (570 kg job, QC-approved and packaged), two bundles scanned onto a vehicle and written as a dispatch. */
async function loaded({ terms } = {}) {
  const o = await f.order({});
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570 });
  for (const tag of ["RF-A1", "RF-A2"]) await f.bundle({ order: o.order, job, tag });
  if (terms) await fin("terms.set", { scope: "order", order_id: o.order, terms, reason: "Agreed in the order confirmation" });
  const s = await dispatch("start", { order_id: o.order, vehicle_number: "MH12AB1234", transporter_id: i.transporter });
  for (const tag of ["RF-A1", "RF-A2"]) await dispatch("scan", { session_id: s.id, tag });
  const d = await f.writeDispatch(s.id);
  return { ...o, job, session: s.id, dispatch: d };
}
/** An open containment on the job, seeded directly (the material was packed and loaded before QA held the lot). */
async function contain(job, orderId) {
  const id = f.next();
  await f.seed(`insert into quality_containments(id,company_id,containment_number,production_job_id,order_id,stage,defect,defect_kind,inspection_mode,scope_kg,status,opened_by)
    values($1,$2,'QCH/RF/0001',$3,$4,'final','Hardness below specification on sample 2','non_destructive','full_inspection',100,'open',$5)`, [id, i.company, job, orderId, i.quality]);
  return id;
}

test("finance: a dispatch whose payment terms are not met is kept pending, released by accounts, then sent out", async () => {
  const a = await loaded({ terms: "payment_before_dispatch" });
  const d = await one("select delivery_status, actual_dispatched_at, number_of_bundles from dispatches where id=$1", [a.dispatch]);
  assert.deepEqual([d.delivery_status, d.actual_dispatched_at, d.number_of_bundles], ["pending", null, 2], "recorded, not rolled back, and not left");
  assert.equal((await one("select count(*)::int n from packing_list_items where dispatch_id=$1", [a.dispatch])).n, 2);
  assert.equal((await fin("status", { dispatch_id: a.dispatch })).state, "blocked");
  assert.equal((await one("select count(*)::int n from tasks where workflow_kind='dispatch_clearance' and workflow_source_id=$1 and status='open'", [a.dispatch])).n, 1,
    "finance gets the clearance task for the kept dispatch");
  await assert.rejects(() => dispatch("complete", { id: a.session, dispatch_id: a.dispatch }), /does not belong to this load/, "the load stays open until the dispatch leaves");
  await assert.rejects(() => gateOut(a.dispatch), /Finance clearance is needed before dispatch/, "the gate still refuses it");

  const r = await fin("release", { dispatch_id: a.dispatch, basis: "payment_confirmed", reference: "UTR-RF-0001", note: "RTGS seen in the bank statement" });
  assert.equal(r.state, "released");
  await gateOut(a.dispatch);
  const left = await one("select delivery_status, actual_dispatched_at from dispatches where id=$1", [a.dispatch]);
  assert.equal(left.delivery_status, "dispatched");
  assert.ok(left.actual_dispatched_at);
  assert.ok((await one("select consumed_at from dispatch_finance_releases where id=$1", [r.id])).consumed_at, "the release is used at the gate");
  assert.equal((await dispatch("complete", { id: a.session, dispatch_id: a.dispatch })).status, "completed");
});

test("finance: on credit terms the writer still activates the dispatch at once", async () => {
  const a = await loaded();
  assert.equal((await one("select delivery_status from dispatches where id=$1", [a.dispatch])).delivery_status, "dispatched");
});

test("containment: a dispatch packed before the lot was held cannot leave until QA resolves it", async () => {
  const a = await loaded({ terms: "payment_before_dispatch" });
  await fin("release", { dispatch_id: a.dispatch, basis: "payment_confirmed", reference: "UTR-RF-0002", note: "RTGS seen in the bank statement" });
  const c = await contain(a.job, a.order);
  await assert.rejects(() => gateOut(a.dispatch), /cannot leave: 2 bundle\(s\) come from job .* under QC containment QCH\/RF\/0001/);
  assert.equal((await one("select delivery_status from dispatches where id=$1", [a.dispatch])).delivery_status, "pending");
  assert.equal((await one("select consumed_at from dispatch_finance_releases where dispatch_id=$1", [a.dispatch])).consumed_at, null, "a refused gate-out does not use the release");
  await f.seed("update quality_containments set status='resolved', resolved_at=now() where id=$1", [c]);
  await gateOut(a.dispatch);
  assert.equal((await one("select delivery_status from dispatches where id=$1", [a.dispatch])).delivery_status, "dispatched");
});

test("containment: bundles drawn from stock made from a held job are caught too", async () => {
  const a = await loaded({ terms: "payment_before_dispatch" });
  await contain(a.job, a.order);
  const d = f.next(), batch = f.next();
  await f.seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles) values($1,$2,$3,'DC-RF-STOCK',current_date,'pending',114,1)", [d, i.company, a.order]);
  await f.seed("insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,total_weight_kg,quantity_pieces,status,origin_type,production_job_id) values($1,$2,$3,'mill_finish',120,114,20,'available','production_surplus',$4)", [batch, i.company, i.profile2, a.job]);
  await f.seed(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,source_kind,source_record_id,profile_stock_batch_id)
    values($1,$2,$3,$4,'RF-S1',20,120,6,120,'dealer_stock',$5,$6)`, [f.next(), i.company, d, i.profile2, a.order, batch]);
  const k = (await one("select private.olo_dispatch_contained_material($1,$2) k", [i.company, d])).k;
  assert.deepEqual([k.containment_number, Number(k.bundles)], ["QCH/RF/0001", 1]);
  assert.equal((await one("select private.olo_dispatch_contained_material($1,$2) k", [i.company, a.dispatch])).k.containment_number, "QCH/RF/0001");
});

test("containment: an open revocation blocks cancelling; once closed, cancelling is allowed again", async () => {
  const o = await f.order({});
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570, approvedKg: 200, packagedKg: 0 });
  const ins = (await one("select id from quality_inspections where production_job_id=$1 and status='approved'", [job])).id;
  await f.seed("update quality_inspections set created_at=now()-interval '1 hour', inspector_name='QA day shift', surface_finish_ok=true where id=$1", [ins]);
  const c = await qc("open", { job_id: job, scope_kg: 370, stage: "final", defect: "Wall thickness below drawing minimum", defect_kind: "non_destructive" });
  assert.equal((await qc("get", { id: c.id })).can_cancel, true);
  await qc("prior_review", { id: c.id, inspection_id: ins, outcome: "revoked", method: "Micrometer re-check", note: "Wall below the drawing minimum on 3 pieces" });
  const detail = await qc("get", { id: c.id });
  assert.deepEqual([detail.can_cancel, detail.open_revocations], [false, 1]);
  await assert.rejects(() => qc("cancel", { id: c.id, reason: "Opened against the wrong job" }), /1 revoked earlier approval\(s\) are still open, so this containment cannot be cancelled/);
  assert.equal((await one("select status from quality_containments where id=$1", [c.id])).status, "open", "the job stays held");
  await qc("prior_close", { id: c.id, review_id: detail.prior_approvals[0].review.id, method: "Re-measured every piece", note: "All 200 kg re-measured piece by piece, within drawing" }, i.factory);
  assert.equal((await qc("get", { id: c.id })).can_cancel, true);
  assert.equal((await qc("cancel", { id: c.id, reason: "Opened against the wrong job" })).status, "cancelled");
});
