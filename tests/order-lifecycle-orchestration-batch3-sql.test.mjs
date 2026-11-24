import test from "node:test";
import assert from "node:assert/strict";
import { createAutopilotFixture, apIds as i, nid } from "../scripts/lib/autopilot-batch1-fixture.mjs";

// Order lifecycle orchestration batch 3 / Phase 3 (migration 20261122100000): dispatch finance clearance by payment
// terms, customer dispatch communication with sent / delivered / read / failed states, and the per-approval review of
// QC approvals recorded before a containment (reconfirm or revoke). Synthetic data only.
let f;
let seq = 30000;
const id = () => `0e300000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const P1 = "0e300000-0000-4000-8000-000000000001";
const DISPATCHER = nid(22);  // the dispatch-role user (apIds.dispatch is a dispatch record)

const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
let inTx = false;
async function seed(sql, p = []) {
  if (!inTx) { await f.db.exec("set session_replication_role = replica"); try { return (await f.db.query(sql, p)).rows; } finally { await f.db.exec("set session_replication_role = origin"); } }
  await f.db.exec("savepoint s3_seed; set session_replication_role = replica");
  try { const r = await f.db.query(sql, p); await f.db.exec("set session_replication_role = origin; release savepoint s3_seed"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s3_seed; set session_replication_role = origin; release savepoint s3_seed"); throw error; }
}
async function raw(sql, p = []) {
  await f.db.exec("savepoint s3_raw");
  try { const r = await f.db.query(sql, p); await f.db.exec("release savepoint s3_raw"); return r.rows; }
  catch (error) { await f.db.exec("rollback to savepoint s3_raw; release savepoint s3_raw"); throw error; }
}
const fin = (command, payload = {}, actor = i.accounts) => f.call("dispatch_finance_command", command, payload, actor);
const comm = (command, payload = {}, actor = DISPATCHER) => f.call("dispatch_comm_command", command, payload, actor);
const qc = (command, payload, actor = i.quality) => f.call("quality_containment_command", command, payload, actor);
const olo = (command, payload = {}, actor = i.owner) => f.call("olo_command", command, payload, actor);
const denied = e => e.code === "42501";
const num = v => Number(v);

test.before(async () => {
  f = await createAutopilotFixture();
  await seed("insert into machines(id,company_id,machine_name,machine_type,status,is_active,press_capacity_ton) values($1,$2,'Press B (1800 T)','extrusion_press','active',true,1800)", [P1, i.company]);
  await seed("update customers set whatsapp_number='+91 98200 11223', phone='02024440000', email='purchase@sharma.invalid', contact_person='Mr Sharma' where id=$1", [i.customer2]);
});
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); inTx = true; });
test.afterEach(async () => { inTx = false; await f.rollback(); });

/** An order (value INR 2,36,000) with a completed 1000 kg job. */
async function order({ kg = 1000 } = {}) {
  const o = id(), line = id(), j = id();
  await seed(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,current_stage,manufacturing_weight_kg,requested_weight_kg,production_quantity_kg,order_value)
    values($1,$2,$3,$4,current_date,current_date+10,'normal','order_confirmed',$5,$5,$5,236000)`, [o, i.company, `SO-B3-${o.slice(-4)}`, i.customer2, kg]);
  await seed("insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,section_weight_kg_per_m) values($1,$2,$3,$4,$5,'Sliding track',100,6,$6,0.95)", [line, i.company, o, i.profile2, i.die, kg]);
  await seed(`insert into production_jobs(id,company_id,order_id,source_line_id,profile_id,die_id,machine_id,status,planned_date,planned_quantity_kg,actual_quantity_kg,completed_at,job_number)
    values($1,$2,$3,$4,$5,$6,$7,'completed',current_date,$8,$8,now(),$9)`, [j, i.company, o, line, i.profile2, i.die, P1, kg, `JOB-B3-${j.slice(-4)}`]);
  return { order: o, line, job: j };
}
/** A dispatch with one 500 kg bundle at INR 200/kg + 18% GST (INR 1,18,000). */
async function dispatch(a, { status = "pending", rate = 200, daysAgo = 0 } = {}) {
  const d = id();
  await seed(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles,actual_dispatched_at,lr_number,transporter_name,vehicle_number,driver_name,driver_phone,eway_bill_number)
    values($1,$2,$3,$4,current_date,$5,500,1,$6,'LR-310','VRL Logistics','MH12AB1234','Ramesh','9822000111','EWB-881')`,
    [d, i.company, a.order, `DC-B3-${d.slice(-4)}`, status, status === "pending" ? null : new Date(Date.now() - daysAgo * 86400000).toISOString()]);
  await bundle(d, a, rate);
  return d;
}
async function bundle(d, a, rate = 200) {
  await seed(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,source_kind,source_record_id,source_line_id,net_rate,gst_percent,customer_component_code,internal_cost,supplier_rate)
    values($1,$2,$3,$4,$5,50,505,5,300,'production',$6,$7,$8,18,'SH-TRACK-6',150,180)`, [id(), i.company, d, i.profile2, `B-${seq}`, a.order, a.job, rate]);
}
/** pending -> dispatched with only the finance clearance guard live (stock posting is out of scope here). */
async function gateOut(d) {
  await f.db.exec("alter table dispatches disable trigger user; alter table dispatches enable trigger b_olo_guard_dispatch_finance");
  try { return await raw("update dispatches set delivery_status='dispatched', actual_dispatched_at=now() where id=$1", [d]); }
  finally { await f.db.exec("alter table dispatches enable trigger user"); }
}
const setTerms = (payload, actor = i.accounts) => fin("terms.set", { reason: "Agreed in the order confirmation", ...payload }, actor);

test("terms: credit terms change nothing; payment before dispatch blocks the gate until accounts confirm a payment", async () => {
  const a = await order();
  const d = await dispatch(a);
  assert.equal((await fin("status", { dispatch_id: d })).state, "not_required");
  await gateOut(d);  // credit terms: only the existing credit-limit checks apply

  const d2 = await dispatch(a);
  await assert.rejects(() => setTerms({ scope: "customer", customer_id: i.customer2, terms: "payment_before_dispatch" }, i.sales), denied);
  await assert.rejects(() => setTerms({ scope: "customer", customer_id: i.customer2, terms: "advance_part" }), /advance percentage/);
  const t = await setTerms({ scope: "customer", customer_id: i.customer2, terms: "payment_before_dispatch" });
  assert.equal(t.label, "payment before dispatch");

  const asDispatch = await fin("status", { dispatch_id: d2 }, DISPATCHER);
  assert.equal(asDispatch.state, "blocked");
  assert.equal(asDispatch.amounts, undefined, "non-finance staff never see amounts");
  assert.equal(asDispatch.can_release, false);
  const asAccounts = await fin("status", { dispatch_id: d2 });
  assert.equal(num(asAccounts.amounts.dispatch_value), 118000);
  assert.equal(num(asAccounts.amounts.required), 236000, "everything dispatched so far plus this dispatch");
  assert.equal(num(asAccounts.amounts.shortfall), 236000);

  const task = await one("select workflow_department, description, status from tasks where workflow_kind='dispatch_clearance' and workflow_source_id=$1", [d2]);
  assert.equal(task.workflow_department, "finance");
  assert.doesNotMatch(task.description, /118|236|₹|INR/, "task text carries no amounts");
  await assert.rejects(() => gateOut(d2), /Finance clearance is needed before dispatch DC-B3-.*payment before dispatch/);
  await assert.rejects(() => raw("update tasks set status='completed' where workflow_kind='dispatch_clearance' and workflow_source_id=$1", [d2]), /payment covers the dispatch/);

  await assert.rejects(() => fin("release", { dispatch_id: d2, basis: "payment_confirmed", note: "Customer paid by RTGS this morning" }), /payment reference/);
  await assert.rejects(() => fin("release", { dispatch_id: d2, basis: "approved_exception", note: "Long-standing customer, pays weekly" }), denied);
  await assert.rejects(() => fin("release", { dispatch_id: d2, basis: "payment_confirmed", reference: "UTR99", note: "ok" }, DISPATCHER), denied);
  const r = await fin("release", { dispatch_id: d2, basis: "payment_confirmed", reference: "UTR-HDFC-55120", note: "RTGS seen in the bank statement, not yet posted" });
  assert.equal(r.state, "released");
  assert.equal((await one("select status, system_resolution from tasks where workflow_kind='dispatch_clearance' and workflow_source_id=$1", [d2])).status, "completed");
  assert.equal(num((await one("select count(*) n from dispatch_finance_releases where dispatch_id=$1", [d2])).n), 1);
  await gateOut(d2);
  assert.ok((await one("select consumed_at from dispatch_finance_releases where id=$1", [r.id])).consumed_at, "a release is used once");
  assert.equal((await fin("status", { dispatch_id: d2 })).state, "dispatched");
});

test("terms: order terms override the customer's; advances and order payments cover the requirement; owner exceptions", async () => {
  const a = await order();
  await setTerms({ scope: "company", terms: "advance_part", advance_percent: 30 });
  const d = await dispatch(a);
  await olo("evaluate");
  let s = await fin("status", { dispatch_id: d });
  assert.equal(s.terms.scope, "company");
  assert.equal(num(s.amounts.required), 70800, "30% of the order value");
  assert.equal(s.state, "blocked");
  await seed("insert into customer_on_account_credits(company_id,customer_id,source,payment_method,reference,received_on,amount,created_by) values($1,$2,'receipt','bank_transfer','NEFT-1',current_date,80000,$3)", [i.company, i.customer2, i.accounts]);
  await olo("evaluate");
  s = await fin("status", { dispatch_id: d });
  assert.equal(s.state, "covered");
  assert.equal((await one("select status, system_resolution from tasks where workflow_kind='dispatch_clearance' and workflow_source_id=$1", [d])).system_resolution, "Verified: receipts cover the dispatch under the customer's terms");
  await assert.rejects(() => fin("release", { dispatch_id: d, basis: "payment_confirmed", reference: "UTR-1", note: "Not needed but trying anyway" }), /No release is needed/);

  await setTerms({ scope: "order", order_id: a.order, terms: "payment_before_dispatch" });
  s = await fin("status", { dispatch_id: d });
  assert.deepEqual([s.terms.scope, s.state], ["order", "blocked"]);
  const exc = await fin("release", { dispatch_id: d, basis: "approved_exception", note: "Owner approves: payment promised against the LC" }, i.owner);
  assert.equal(exc.state, "released");
  await bundle(d, a);  // the dispatch grows after the release
  s = await fin("status", { dispatch_id: d });
  assert.equal(s.state, "blocked", "a release covers only the dispatch value at the time");
  assert.equal(s.release.value_grown, true);
  await assert.rejects(() => gateOut(d), /Finance clearance is needed/);

  const list = await fin("terms.list", {}, i.sales);
  assert.equal(list.rows.length, 2);
  assert.equal(list.can_set_terms, false);
  await fin("terms.clear", { id: list.rows.find(r => r.scope === "order").id, reason: "Order back on company terms" });
  assert.equal((await fin("status", { dispatch_id: d })).terms.scope, "company");

  const life = await olo("lifecycle.order", { order_id: a.order }, i.production);
  assert.equal(life.dispatch_terms.label, "advance of 30% before dispatch");
});

test("terms: an expired release no longer clears; releases are visible to finance only", async () => {
  const a = await order({ kg: 500 });
  await seed("insert into quality_inspections(company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,inspector_name) values($1,$2,$3,now(),500,'approved','QA')", [i.company, a.job, i.profile2]);
  await setTerms({ scope: "order", order_id: a.order, terms: "payment_before_dispatch" });
  const d = await dispatch(a);
  const r = await fin("release", { dispatch_id: d, basis: "payment_confirmed", reference: "CHQ-004512", note: "Cheque deposited, clearing tomorrow" });
  const n = async actor => (await f.asUser("select count(*)::int n from dispatch_finance_releases", [], actor))[0].n;
  assert.equal(await n(i.accounts), 1);
  assert.equal(await n(DISPATCHER), 0);
  const life = await olo("lifecycle.order", { order_id: a.order }, DISPATCHER);
  assert.equal(life.domains.find(x => x.key === "finance_clearance").status, "cleared");
  await seed("update dispatch_finance_releases set released_at=now()-interval '3 days', expires_at=now()-interval '1 day' where id=$1", [r.id]);
  const s = await fin("status", { dispatch_id: d });
  assert.equal(s.state, "blocked");
  assert.equal(s.release.expired, true);
  const blocked = await olo("lifecycle.order", { order_id: a.order }, DISPATCHER);
  assert.equal(blocked.domains.find(x => x.key === "finance_clearance").status, "dispatch_blocked");
  assert.equal(blocked.next_action.department, "finance");
  assert.match(blocked.next_action.link, /^\/dispatches\/clearance\//);
  const queue = await fin("queue", {}, DISPATCHER);
  assert.equal(queue.rows[0].state, "blocked");
  assert.equal(queue.rows[0].amounts, undefined);
});

test("communication: a dispatch that left gets one task; the message carries no prices and is recorded with its states", async () => {
  const a = await order();
  const d = await dispatch(a, { status: "dispatched", daysAgo: 1 });
  await olo("evaluate");
  const task = await one("select workflow_department, status, workflow_cycle from tasks where workflow_kind='dispatch_intimation' and workflow_source_id=$1", [d]);
  assert.deepEqual([task.workflow_department, task.status], ["dispatch", "open"]);

  const facts = await comm("facts", { dispatch_id: d });
  assert.deepEqual([facts.vehicle_number, facts.lr_number, facts.eway_bill_number, facts.bundles, num(facts.net_weight_kg)], ["MH12AB1234", "LR-310", "EWB-881", 1, 500]);
  assert.equal(facts.items[0].component_code, "SH-TRACK-6");
  assert.ok(facts.expected_delivery);
  assert.ok(facts.recipients.some(r => r.channel === "whatsapp"));
  assert.doesNotMatch(JSON.stringify(facts), /net_rate|internal_cost|supplier_rate|"150"|"180"|margin/, "customer facts never carry prices or costs");
  assert.equal(facts.can_send, true);

  const body = "Dispatch DC-B3 for your order has left our factory. Vehicle MH12AB1234, LR LR-310.";
  await assert.rejects(() => comm("record_sent", { dispatch_id: d, channel: "whatsapp", recipient: "98200 11223", body }, i.quality), denied);
  await assert.rejects(() => comm("record_sent", { dispatch_id: d, channel: "whatsapp", recipient: "12345", body }), /10 to 15 digits/);
  await assert.rejects(() => comm("record_sent", { dispatch_id: d, channel: "email", recipient: "not-an-email", body }), /valid email/);
  await assert.rejects(() => comm("record_sent", { dispatch_id: d, channel: "whatsapp", recipient: "+91 98200 11223", body: "too short" }), /20 to 2000/);
  const sent = await comm("record_sent", { dispatch_id: d, channel: "whatsapp", recipient: "+91 98200 11223", body, language: "en" });
  assert.equal(sent.status, "sent");
  const out = await one("select status, recipient_phone, related_entity_type from outbound_messages where related_entity_id=$1", [d]);
  assert.deepEqual([out.status, out.recipient_phone, out.related_entity_type], ["manually_logged", "919820011223", "dispatch"]);
  assert.equal((await one("select status from tasks where workflow_kind='dispatch_intimation' and workflow_source_id=$1", [d])).status, "completed");

  await assert.rejects(() => raw("update dispatch_communications set message_body='changed after the fact, oops' where id=$1", [sent.id]), /cannot be changed/);
  await comm("mark", { id: sent.id, status: "delivered" });
  const read = await comm("mark", { id: sent.id, status: "read" });
  assert.equal(read.status, "read");
  assert.equal((await one("select status from outbound_messages where related_entity_id=$1", [d])).status, "read");
  await assert.rejects(() => comm("mark", { id: sent.id, status: "delivered" }), /cannot be marked delivered/);
  const timeline = (await olo("lifecycle.order", { order_id: a.order }, i.sales)).timeline.map(e => e.summary).join(" | ");
  assert.match(timeline, /Customer informed of dispatch DC-B3-/);
});

test("communication: a failed message re-opens the task as a new cycle; a phone call counts as delivered", async () => {
  const a = await order();
  const d = await dispatch(a, { status: "dispatched", daysAgo: 0 });
  await olo("evaluate");
  const sent = await comm("record_sent", { dispatch_id: d, channel: "sms", recipient: "02024440000", body: "Your material left today in vehicle MH12AB1234." });
  await assert.rejects(() => comm("mark", { id: sent.id, status: "failed" }), /why the message failed/);
  await comm("mark", { id: sent.id, status: "failed", note: "Landline cannot receive SMS" });
  const tasks = await q("select workflow_cycle, status from tasks where workflow_kind='dispatch_intimation' and workflow_source_id=$1 order by workflow_cycle", [d]);
  assert.deepEqual(tasks.map(t => [t.workflow_cycle, t.status]), [[1, "completed"], [2, "open"]]);
  const call = await comm("record_sent", { dispatch_id: d, channel: "phone_call", recipient: "+91 98200 11223", body: "Called Mr Sharma and gave vehicle, LR and expected delivery." });
  assert.equal(call.status, "delivered");
  assert.equal((await one("select status from tasks where workflow_kind='dispatch_intimation' and workflow_source_id=$1 and workflow_cycle=2", [d])).status, "completed");
  await assert.rejects(() => comm("mark", { id: call.id, status: "read" }), /phone call/);
  const old = await dispatch(a, { status: "dispatched", daysAgo: 20 });
  await olo("evaluate");
  assert.equal((await q("select 1 from tasks where workflow_kind='dispatch_intimation' and workflow_source_id=$1", [old])).length, 0, "history older than a week raises no burst");
});

test("prior approvals: each earlier approval is reconfirmed or revoked before the lot resolves; reconfirming lifts the suspension", async () => {
  const a = await order();
  const ins = id();
  await seed("insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,batch_number,inspector_name) values($1,$2,$3,$4,now()-interval '1 hour',500,'approved','LOT-EARLY','QA day shift')", [ins, i.company, a.job, i.profile2]);
  const c = await qc("open", { job_id: a.job, scope_kg: 500, stage: "final", defect: "Wall thickness below drawing minimum", defect_kind: "non_destructive" });
  let detail = await qc("get", { id: c.id });
  assert.deepEqual(detail.prior_approvals.map(p => [p.inspection_id, num(p.quantity_kg), p.review]), [[ins, 500, null]]);
  assert.equal(detail.can_review, true);
  await qc("result", { id: c.id, reference: "L1", result: "accepted", quantity_kg: 500, method: "Micrometer on every piece" });
  await assert.rejects(() => qc("release", { id: c.id, note: "All 500 kg re-measured and within drawing", prior_approved_confirmed: true }), /not yet reviewed. Reconfirm or revoke each earlier approval/);
  await assert.rejects(() => qc("prior_review", { id: c.id, inspection_id: ins, outcome: "reconfirmed", method: "Re-sampled 5 pieces", note: "All within drawing tolerance" }, i.production), denied);
  await assert.rejects(() => qc("prior_review", { id: c.id, inspection_id: id(), outcome: "reconfirmed", method: "Re-sampled", note: "All within drawing tolerance" }), /recorded before the containment opened/);
  const rv = await qc("prior_review", { id: c.id, inspection_id: ins, outcome: "reconfirmed", method: "Re-sampled 5 pieces from each bundle", note: "All within drawing tolerance" });
  assert.equal(num(rv.suspended_approved_kg), 0);
  await assert.rejects(() => qc("prior_review", { id: c.id, inspection_id: ins, outcome: "revoked", method: "x1", note: "Trying a second review" }), /already reviewed/);
  await assert.rejects(() => raw("delete from containment_prior_reviews"), /cannot be changed/);
  const done = await qc("release", { id: c.id, note: "All 500 kg re-measured and within drawing" });
  assert.equal(done.status, "resolved");
  detail = await qc("get", { id: c.id });
  assert.equal(detail.prior_approvals[0].review.outcome, "reconfirmed");
});

test("prior approvals: a revoked approval stays blocked until a second person closes it with evidence; moved-on material is flagged", async () => {
  const a = await order();
  const ins = id();
  await seed("insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,batch_number,inspector_name) values($1,$2,$3,$4,now()-interval '1 hour',400,'approved','LOT-EARLY2','QA day shift')", [ins, i.company, a.job, i.profile2]);
  await seed("insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PK-B3-1',$3,$4,current_date,10,100,60,'in_progress')", [id(), i.company, a.order, a.job]);
  const c = await qc("open", { job_id: a.job, scope_kg: 600, stage: "final", defect: "Hardness below specification on sample 2", defect_kind: "non_destructive" });
  const rv = await qc("prior_review", { id: c.id, inspection_id: ins, outcome: "revoked", method: "Webster hardness re-test", note: "Below 12 HW on 3 of 5 pieces" });
  assert.deepEqual([rv.outcome, num(rv.suspended_approved_kg), num(rv.moved_on_kg)], ["revoked", 400, 100]);
  assert.equal((await one("select status from quality_inspections where id=$1", [ins])).status, "approved", "the QC record itself stays immutable");
  const alert = await q("select recipient_role, severity, body from notifications where condition_key=$1", [`olo-prior-revoked:${ins}`]);
  assert.ok(alert.some(n => n.recipient_role === "factory_manager") && alert.some(n => n.recipient_role === "dispatch_manager"), "moved-on material reaches dispatch too");
  assert.equal(alert[0].severity, "critical");
  assert.match(alert[0].body, /100 kg of this job has already moved/);

  await qc("result", { id: c.id, reference: "L1", result: "accepted", quantity_kg: 600, method: "Hardness on every piece" });
  await assert.rejects(() => qc("release", { id: c.id, note: "Balance re-tested and within specification" }), /1 revoked earlier approval\(s\) are still open/);
  let detail = await qc("get", { id: c.id }, i.factory);
  const review = detail.prior_approvals[0].review;
  assert.equal(review.can_close, true);
  await assert.rejects(() => qc("prior_close", { id: c.id, review_id: review.id, method: "Re-aged", note: "Re-aged at 185 C and re-tested" }, i.quality), denied);
  await assert.rejects(() => qc("prior_close", { id: c.id, review_id: review.id, method: "Re-aged", note: "short" }, i.factory), /re-verification evidence/);
  await assert.rejects(() => raw("update containment_prior_reviews set note='rewritten after the fact' where id=$1", [review.id]), /cannot be changed/);
  const closed = await qc("prior_close", { id: c.id, review_id: review.id, method: "Re-aged and hardness re-tested", note: "Re-aged at 185 C for 4 h; 5 of 5 pieces above 12 HW" }, i.factory);
  assert.deepEqual([closed.closed, num(closed.suspended_approved_kg)], [true, 0]);
  assert.equal((await one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`olo-prior-revoked:${ins}`])).n, 0);
  const done = await qc("release", { id: c.id, note: "Balance re-tested and within specification" });
  assert.equal(done.status, "resolved");
  detail = await qc("get", { id: c.id });
  assert.equal(detail.prior_approvals[0].review.closed_by_name, "Fixture factory");
  const events = (await q("select event_type from olo_events where production_job_id=$1", [a.job])).map(e => e.event_type);
  assert.ok(events.includes("qc.prior_approval_revoked") && events.includes("qc.prior_revocation_closed"));
});

test("terms: one customer advance never clears two orders; it first covers goods already sent on other orders", async () => {
  await setTerms({ scope: "customer", customer_id: i.customer2, terms: "payment_before_dispatch" });
  await seed("insert into customer_on_account_credits(company_id,customer_id,source,payment_method,reference,received_on,amount,created_by) values($1,$2,'receipt','bank_transfer','NEFT-ADV',current_date,118000,$3)", [i.company, i.customer2, i.accounts]);
  const a = await order(), b = await order();
  const da = await dispatch(a), db = await dispatch(b);
  assert.equal((await fin("status", { dispatch_id: da })).state, "covered");
  assert.equal((await fin("status", { dispatch_id: db })).state, "covered", "both look covered while neither has left");
  await gateOut(da);
  const s = await fin("status", { dispatch_id: db });
  assert.equal(s.state, "blocked", "the advance is now used by the goods sent on the first order");
  assert.deepEqual([num(s.amounts.customer_advance), num(s.amounts.other_obligations), num(s.amounts.advance_available)], [118000, 118000, 0]);
  await assert.rejects(() => gateOut(db), /Finance clearance is needed/);
});
