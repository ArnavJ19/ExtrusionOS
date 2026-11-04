import test from "node:test";
import assert from "node:assert/strict";
import { createNov6Fixture, nids as i } from "../scripts/lib/nov-batch6-fixture.mjs";
import { migrationFiles } from "../scripts/lib/migration-chain-replay.mjs";
import { lifecycleListSchema, lifecycleDetailSchema, lifecycleOutcomeSchema, lifecycleMutationSchema, canReadLifecycle, canUseLifecycleAction, LIFECYCLE_ROLES, LIFECYCLE_VIEWS } from "../lib/workflow/lifecycle.ts";

let f;
test.before(async () => { f = await createNov6Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { lifecycleOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const row = async (view, id, actor = i.owner) => (await detail(view, id, actor)).row;
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
const day = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
/** Isolates one guard on a table: other workflow triggers are disabled for this rolled-back scenario only. */
async function only(table, trigger) { await f.db.exec(`alter table public.${table} disable trigger user; alter table public.${table} enable trigger ${trigger}`); }
const keys = record => record.details.items.map(item => item.key.split(":")[0]);

test("the TypeScript role mirrors match the database matrix for every role, view and action", async () => {
  const roles = [...LIFECYCLE_ROLES, "dealer_admin", "dealer_staff"];
  const actions = lifecycleMutationSchema._def.schema.options.map(option => option.shape.action.value);
  assert.equal(actions.length, 28);
  for (const role of roles) {
    assert.equal((await one("select private.lifecycle_read_allowed($1,null) v", [role])).v, canReadLifecycle(role), `${role} read`);
    for (const view of Object.keys(LIFECYCLE_VIEWS)) assert.equal((await one("select private.lifecycle_read_allowed($1,$2) v", [role, view])).v, canReadLifecycle(role, view), `${role} read ${view}`);
    for (const action of actions) assert.equal((await one("select private.lifecycle_action_allowed($1,$2) v", [role, action])).v, canUseLifecycleAction(role, action), `${role} ${action}`);
  }
});

test("migration replay and every read model match the production contracts", async () => {
  assert.equal(f.applied, migrationFiles().length + 2);
  for (const view of Object.keys(LIFECYCLE_VIEWS)) {
    lifecycleListSchema.parse(await list(view));
    lifecycleListSchema.parse(await f.command("list", { view }, i.owner));
  }
  await assert.rejects(() => list("closure", i.dealer), /Not permitted/);
  await assert.rejects(() => list("promises", i.dispatch), /Not permitted/);
  await assert.rejects(() => list("trace", i.sales), /Not permitted/);
  await assert.rejects(() => list("closure", i.production), /Not permitted/);
  lifecycleListSchema.parse(await list("samples", i.production));
  const constraint = await one("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.profile_stock_batches'::regclass and conname='profile_stock_status_check'");
  assert.match(constraint.d, /transformed/);
  assert.equal(n((await one("select count(*) c from pg_constraint where conrelid='public.profile_stock_batches'::regclass and contype='c' and pg_get_constraintdef(oid) like '%(status = ANY%'")).c), 1);
});

// NOV-058 ---------------------------------------------------------------------------------------
test("NOV-058: a delivered and invoiced order closes operationally with receivables kept open, never finally while a balance is due", async () => {
  const before = await row("closure", i.orderC);
  assert.equal(before.status, "ready"); assert.deepEqual(keys(before), ["receivable"]);
  assert.equal(before.details.items[0].blocking, false); assert.equal(n(before.details.outstanding_inr), 59000);
  assert.ok((await f.command("list", { view: "closure" }, i.owner)).rows.some(r => r.id === i.orderC), "ready orders appear on the active board");
  await assert.rejects(() => f.prepare({ action: "closure.close", order_id: i.orderC, kind: "final", note }, i.salesManager), /Final commercial closure is recorded by accounts/);
  await assert.rejects(() => f.prepare({ action: "closure.close", order_id: i.orderC, kind: "final", note }, i.accounts), /1 item\(s\) are still open, starting with: Invoice INV-NOV6-C has an outstanding balance/);
  await assert.rejects(() => f.prepare({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.accounts), /Operational closure is recorded by sales or factory management/);
  await assert.rejects(() => f.prepare({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.sales), /Not permitted/);
  const preview = await f.prepare({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.salesManager);
  assert.ok(preview.review.warnings.some(w => /INR 59000 stays receivable/.test(w)));
  assert.equal(n((await one("select count(*) c from order_closures")).c), 0, "a preview records nothing");
  confirmed(await f.commit(preview, i.salesManager));
  assert.equal((await one("select current_stage from orders where id=$1", [i.orderC])).current_stage, "closed");
  assert.equal((await one("select stage from order_stage_history where order_id=$1 order by changed_at desc limit 1", [i.orderC])).stage, "closed");
  const closed = await row("closure", i.orderC);
  assert.equal(closed.status, "closed_operational"); assert.equal(closed.details.previous_stage, "delivered");
  assert.deepEqual(keys(closed), ["receivable"], "the reviewed snapshot is retained");
  assert.equal((await one("select balance_due::float8 b from invoices where id=$1", [i.invoiceC])).b, 59000, "finance evidence is unchanged");
  await assert.rejects(() => f.prepare({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.owner), /already closed/);
  assert.equal((await detail("closure", i.orderC)).events[0].action, "closure.close");
});

test("NOV-058: a closed order refuses new work until an owner reopens it to the previous stage", async () => {
  confirmed(await f.apply({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.factory));
  await only("production_jobs", "zzz_guard_closed_order");
  await assert.rejects(() => f.asSystem("insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg) values($1,$2,$3,$4,'planned',100)", [f.nextId(), i.company, i.orderC, i.profile]), /closed through the closure review/);
  await only("dispatches", "zzz_guard_closed_order");
  await assert.rejects(() => f.asSystem("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date) values($1,$2,$3,'D-X',current_date)", [f.nextId(), i.company, i.orderC]), /closed through the closure review/);
  await only("profile_stock_reservations", "zzz_guard_closed_order");
  await assert.rejects(() => f.asSystem("insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,status) values($1,$2,$3,$4,10,'active')", [i.company, i.stock1, i.profile, i.orderC]), /closed through the closure review/);
  await f.asSystem("insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,status) values($1,$2,$3,$4,10,'released')", [i.company, i.stock1, i.profile, i.orderC]);
  await assert.rejects(() => f.prepare({ action: "closure.reopen", order_id: i.orderC, note }, i.salesManager), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "closure.reopen", order_id: i.order, note }, i.owner), /not closed through the closure review/);
  confirmed(await f.apply({ action: "closure.reopen", order_id: i.orderC, note }, i.owner));
  assert.equal((await one("select current_stage from orders where id=$1", [i.orderC])).current_stage, "delivered");
  await f.asSystem("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date) values($1,$2,$3,'D-Y',current_date)", [f.nextId(), i.company, i.orderC]);
  const reopened = await row("closure", i.orderC);
  assert.equal(reopened.status, "blocked", "the new dispatch is an open item again");
  assert.deepEqual(reopened.details.history.map(h => h.status), ["reopened"]);
});

test("NOV-058: every unresolved source blocks closure with its owner, and a short-closed remainder counts as resolved", async () => {
  const check = async (expected) => { const record = await row("closure", i.orderC); assert.ok(keys(record).includes(expected), `${expected} in ${keys(record)}`); assert.equal(record.status, "blocked"); return record; };
  await f.seed("insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number) values($1,$2,$3,$4,'in_progress',100,20,'J-OPEN')", [f.nextId(), i.company, i.orderC, i.profile]);
  const job = await check("job");
  assert.equal(job.details.items.find(x => x.key.startsWith("job:")).owner, "production_manager");
  await f.seed("insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,status) values($1,$2,$3,$4,10,'active')", [i.company, i.stock1, i.profile, i.orderC]);
  await check("reservation");
  await f.seed("insert into finishing_jobs(company_id,order_id,finishing_type,status,input_weight_kg,output_weight_kg) values($1,$2,'anodizing','sent_to_vendor',100,0)", [i.company, i.orderC]);
  await check("finishing");
  await f.seed("insert into prepared_physical_bundles(id,company_id,order_id,source_line_id,source_kind,profile_id,bundle_number,number_of_pieces,net_length_m,gross_weight_kg,tare_weight_kg,recorded_by,payload) values($1,$2,$3,$4,'production',$5,'PB-C2',5,30,40,2,$6,'{}')",
    [f.nextId(), i.company, i.orderC, i.jobC, i.profile, i.owner]);
  await check("bundle");
  await f.seed("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,actual_dispatched_at) values($1,$2,$3,'D-NOV6-T',current_date,'in_transit',now())", [f.nextId(), i.company, i.orderC]);
  const transit = await check("dispatch");
  assert.ok(keys(transit).includes("unbilled"), "a departed dispatch without an issued invoice is unbilled");
  await f.seed("insert into invoices(company_id,customer_id,order_id,invoice_number,status,grand_total,amount_paid,credited_amount) values($1,$2,$3,'INV-DRAFT','draft',100,0,0)", [i.company, i.customer, i.orderC]);
  await check("invoice");
  await f.seed(`insert into connected_return_receipts(id,company_id,packing_list_item_id,dispatch_id,order_id,received_kg,received_pieces,received_metres,received_by,reason,source_snapshot,request_payload,status)
    values($1,$2,$3,$4,$5,20,3,18,$6,'Bent on arrival','{}','{}','received')`, [f.nextId(), i.company, i.packC, i.dispatchC, i.orderC, i.inventory]);
  await check("receipt");
  await assert.rejects(() => f.prepare({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.owner), /item\(s\) are still open/);
});

test("NOV-058: an undispatched remainder blocks until short-closed; a quantity difference stays visible", async () => {
  await f.seed("update order_items set quantity_kg=600 where id=$1", [i.lineC]);
  const short = await row("closure", i.orderC);
  const item = short.details.items.find(x => x.key.startsWith("quantity:"));
  assert.equal(item.blocking, true); assert.equal(n(item.quantity_kg), 100);
  await f.seed("insert into order_delivery_short_closures(company_id,order_id,delivered_weight_kg,required_weight_kg,reason,closed_by,closed_by_role) values($1,$2,500,600,'Customer cancelled balance',$3,'owner')", [i.company, i.orderC, i.owner]);
  const resolved = await row("closure", i.orderC);
  const after = resolved.details.items.find(x => x.key.startsWith("quantity:"));
  assert.equal(after.blocking, false); assert.equal(after.resolved, true); assert.equal(resolved.status, "ready");
  const preview = await f.prepare({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.owner);
  assert.ok(preview.review.warnings.some(w => /differs from ordered by -100 kg/.test(w)));
});

test("NOV-058: only carriable items are carried with a reason; reopening withdraws the carries", async () => {
  const disposition = f.nextId();
  await f.seed("insert into delivery_dispositions(id,company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by) values($1,$2,$3,$4,'damaged',20,'Site store','Photo of bent bundle',$5,$5)",
    [disposition, i.company, i.dispatchC, i.packC, i.dispatchManager]);
  assert.equal((await row("closure", i.orderC)).status, "blocked");
  await assert.rejects(() => f.prepare({ action: "closure.carry", order_id: i.orderC, item_key: `change:${f.nextId()}`, note }, i.owner), /no longer open/);
  await assert.rejects(() => f.prepare({ action: "closure.carry", order_id: i.orderC, item_key: `exception:${disposition}`, note }, i.factory), /Not permitted/);
  confirmed(await f.apply({ action: "closure.carry", order_id: i.orderC, item_key: `exception:${disposition}`, note }, i.salesManager));
  await assert.rejects(() => f.prepare({ action: "closure.carry", order_id: i.orderC, item_key: `exception:${disposition}`, note }, i.salesManager), /already carried/);
  const carried = (await row("closure", i.orderC)).details.items.find(x => x.key === `exception:${disposition}`);
  assert.equal(carried.carried, true); assert.equal(carried.blocking, false); assert.equal(carried.carry_reason, note);
  confirmed(await f.apply({ action: "closure.close", order_id: i.orderC, kind: "operational", note }, i.salesManager));
  assert.equal((await one("select jsonb_array_length(carried) c from order_closures where order_id=$1", [i.orderC])).c, 1);
  confirmed(await f.apply({ action: "closure.reopen", order_id: i.orderC, note }, i.admin));
  assert.equal(n((await one("select count(*) c from order_closure_carries where order_id=$1 and withdrawn_at is null", [i.orderC])).c), 0);
  assert.equal((await row("closure", i.orderC)).details.items.find(x => x.key === `exception:${disposition}`).blocking, true);
});

// NOV-063 ---------------------------------------------------------------------------------------
const assure = async (mutation, actor) => {
  const run = async (name, payload) => (await f.asUser("select public.assurance_command($1,$2) data", [name, payload], actor))[0].data;
  const preview = await run("preview", { request_id: f.nextId(), mutation });
  const result = await run("commit", { request_id: preview.request_id, fingerprint: preview.fingerprint });
  assert.equal(result.state, "confirmed", JSON.stringify(result.result));
};
async function releaseDrawing(label, hash) {
  await assure({ action: "drawing.register", drawing_id: i.drawing, revision_label: label, file_sha256: hash.repeat(64), customer_approval_required: true, profile_id: i.profile, note }, i.quality);
  const id = (await one("select id from drawing_revisions where revision_label=$1", [label])).id;
  await assure({ action: "drawing.customer", revision_id: id, event: "submitted", evidence: "Emailed to customer engineering", note }, i.sales);
  await assure({ action: "drawing.customer", revision_id: id, event: "customer_approved", evidence: "Signed approval PDF", customer_contact: "R. Mehta", note }, i.salesManager);
  await assure({ action: "drawing.release", revision_id: id, note }, i.quality);
  return id;
}
const sampleId = async () => (await one("select id from sample_requirements order by requested_at desc limit 1")).id;
const requireSample = (patch = {}, actor = i.salesManager) => f.apply({ action: "sample.require", order_id: i.order2, profile_id: i.profile2, die_id: i.dieA, reason: "new_die", quantity_pieces: 5,
  authority: "customer", gates_production: true, response_days: 7, note, ...patch }, actor);
const record = (id, event, patch = {}, actor = i.quality) => f.apply({ action: "sample.record", id, event, evidence: "Measured on calibrated vernier", note, ...patch }, actor);
const startJob = id => f.asSystem("update production_jobs set status='in_progress' where id=$1", [id]);
async function sampleJob(kg = 50, die = i.dieA) {
  const id = f.nextId();
  await f.seed("insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number,source_line_id,die_id) values($1,$2,$3,$4,'planned',$5,0,$6,$7,$8)",
    [id, i.company, i.order2, i.profile2, kg, `J-S-${id.slice(-4)}`, i.line2, die]);
  return id;
}

test("NOV-063: a gated line waits for approval; only the sample job runs and measurements precede sending", async () => {
  confirmed(await requireSample());
  const id = await sampleId();
  await assert.rejects(() => f.prepare({ action: "sample.require", order_id: i.order2, profile_id: i.profile2, reason: "new_die", quantity_pieces: 5, authority: "customer", gates_production: true, response_days: 7, note }, i.salesManager), /already exists/);
  await assert.rejects(() => f.prepare({ action: "sample.require", order_id: i.order2, profile_id: i.profile, reason: "new_die", quantity_pieces: 5, authority: "customer", gates_production: true, response_days: 7, note }, i.salesManager), /not on this order/);
  await assert.rejects(() => f.prepare({ action: "sample.require", order_id: i.order, profile_id: i.profile, die_id: i.dieA, reason: "new_die", quantity_pieces: 5, authority: "customer", gates_production: true, response_days: 7, note }, i.salesManager), /die for this profile/);
  await f.seed("update production_jobs set die_id=$2 where id=$1", [i.job3, i.dieA]);
  await only("production_jobs", "zzz_guard_sample_approval");
  await assert.rejects(() => startJob(i.job3), /Sample approval for this order line is required/);
  assert.match((await row("samples", id)).summary, /1 job\(s\) waiting/);
  const sjob = await sampleJob();
  const wrongDie = await sampleJob(50, i.dieB);
  await assert.rejects(() => record(id, "produced", { job_id: wrongDie, sample_tag: "SMP-1", location: "QC lab" }), /different die/);
  await assert.rejects(() => record(id, "sent", { recipient: "Buyer", expected_response: day(5) }), /Measure the current sample/);
  confirmed(await record(id, "produced", { job_id: sjob, sample_tag: "SMP-1", location: "QC lab shelf 2" }, i.productionManager));
  await startJob(sjob);
  await assert.rejects(() => record(id, "sent", { recipient: "Buyer", expected_response: day(5) }), /Measure the current sample/);
  await assert.rejects(() => record(id, "measured", { job_id: sjob }), /recorded only with a produced sample/);
  confirmed(await record(id, "measured"));
  await assert.rejects(() => record(id, "sent", { recipient: "Buyer", expected_response: day(120) }), /within the next 90 days/);
  confirmed(await record(id, "sent", { recipient: "Customer QA, Pune", expected_response: day(5) }, i.dispatchManager));
  await assert.rejects(() => startJob(i.job3), /Sample approval for this order line is sent/);
  const sent = await row("samples", id);
  assert.equal(sent.status, "sent"); assert.equal(sent.details.measured, true); assert.equal(sent.details.events.length, 3);
  await assert.rejects(() => f.prepare({ action: "sample.decide", id, decision: "approved", evidence: "Customer signed the sample card", note }, i.sales), /customer person/);
  confirmed(await f.apply({ action: "sample.decide", id, decision: "approved", evidence: "Customer signed the sample card", customer_contact: "A. Shah, QA", note }, i.sales));
  await assert.rejects(() => f.prepare({ action: "sample.decide", id, decision: "rejected", evidence: "Changed mind", customer_contact: "A. Shah", note }, i.sales), /Only a sample sent for decision/);
  await startJob(i.job3);
  const changed = await sampleJob(50, i.dieB);
  await assert.rejects(() => startJob(changed), /different die from the approved sample/);
  assert.equal((await row("samples", id)).status, "approved");
});

test("NOV-063: conditional approval caps started kg, internal decisions need quality and lost samples restart the iteration", async () => {
  confirmed(await requireSample());
  const id = await sampleId();
  const sjob = await sampleJob();
  confirmed(await record(id, "produced", { job_id: sjob, sample_tag: "SMP-1", location: "QC lab" }));
  confirmed(await record(id, "measured"));
  confirmed(await record(id, "sent", { recipient: "Customer QA", expected_response: day(5) }));
  confirmed(await record(id, "lost", {}, i.dispatchManager));
  assert.equal((await row("samples", id)).status, "lost");
  confirmed(await record(id, "produced", { job_id: sjob, sample_tag: "SMP-2", location: "QC lab" }));
  const second = await row("samples", id);
  assert.equal(second.details.iteration, 2); assert.equal(second.details.measured, false, "the new sample is measured again");
  confirmed(await record(id, "measured"));
  confirmed(await record(id, "sent", { recipient: "Customer QA", expected_response: day(3) }));
  await assert.rejects(() => f.prepare({ action: "sample.decide", id, decision: "conditional", evidence: "Accepted with a radius concession", customer_contact: "A. Shah", note }, i.salesManager), /states the kg it covers/);
  confirmed(await f.apply({ action: "sample.decide", id, decision: "conditional", evidence: "Accepted with a radius concession", customer_contact: "A. Shah", limit_kg: 600, note }, i.salesManager));
  await f.seed("update production_jobs set die_id=$2 where id=$1", [i.job3, i.dieA]);
  await only("production_jobs", "zzz_guard_sample_approval");
  await startJob(i.job3);
  const more = await sampleJob(200);
  await assert.rejects(() => startJob(more), /covers 600 kg; 500 kg is already in production/);
  assert.match((await row("samples", id)).summary, /up to 600 kg/);
  // An internal first-piece check on another line.
  confirmed(await f.apply({ action: "sample.require", order_id: i.order, profile_id: i.profile, reason: "process_change", quantity_pieces: 2, authority: "internal", gates_production: false, response_days: 2, note }, i.quality));
  const internal = await sampleId();
  confirmed(await f.apply({ action: "sample.record", id: internal, event: "produced", job_id: i.job1, sample_tag: "FP-1", location: "Press A table", evidence: "First piece cut", note }, i.quality));
  confirmed(await record(internal, "measured"));
  confirmed(await record(internal, "sent", { recipient: "Quality lab", expected_response: day(1) }));
  await assert.rejects(() => f.prepare({ action: "sample.decide", id: internal, decision: "approved", evidence: "Looks fine to sales", note }, i.salesManager), /Internal first-piece decisions/);
  await assert.rejects(() => f.prepare({ action: "sample.decide", id: internal, decision: "approved", evidence: "All dimensions in tolerance", customer_contact: "Nobody", note }, i.quality), /no customer contact applies/);
  confirmed(await f.apply({ action: "sample.decide", id: internal, decision: "approved", evidence: "All dimensions in tolerance", note }, i.quality));
});

test("NOV-063: overdue responses surface, a superseded drawing needs renewal, invalidation regates and withdrawal removes the gate", async () => {
  const r1 = await releaseDrawing("R1", "a");
  confirmed(await f.apply({ action: "sample.require", order_id: i.order, profile_id: i.profile, drawing_revision_id: r1, reason: "customer_request", quantity_pieces: 3, authority: "customer", gates_production: true, response_days: 5, note }, i.quality));
  const id = await sampleId();
  confirmed(await f.apply({ action: "sample.record", id, event: "produced", job_id: i.job1, sample_tag: "SMP-D1", location: "QC lab", evidence: "Cut from first billet", note }, i.quality));
  confirmed(await record(id, "measured"));
  confirmed(await record(id, "sent", { recipient: "Customer QA", expected_response: day(2) }));
  await f.seed("update sample_events set expected_response=current_date-3 where requirement_id=$1 and event='sent'", [id]);
  const overdue = (await f.command("list", { view: "samples", status: "response_overdue" })).rows;
  assert.deepEqual(overdue.map(r => r.id), [id]);
  confirmed(await f.apply({ action: "sample.decide", id, decision: "approved", evidence: "Signed sample card", customer_contact: "A. Shah", note }, i.salesManager));
  assert.equal((await row("samples", id)).status, "approved");
  await releaseDrawing("R2", "b");
  const renewal = await row("samples", id);
  assert.equal(renewal.status, "renewal_needed"); assert.equal(renewal.details.drawing_state, "superseded");
  await only("production_jobs", "zzz_guard_sample_approval");
  await f.seed("update production_jobs set status='planned' where id=$1", [i.job2]);
  await assert.rejects(() => startJob(i.job2), /renewal needed/);
  await assert.rejects(() => f.prepare({ action: "sample.invalidate", id, note }, i.quality), /Only a current approval/);
  const preview = await f.prepare({ action: "sample.withdraw", id, note }, i.quality);
  assert.ok(preview.review.warnings.some(w => /may start without sample approval/.test(w)));
  confirmed(await f.commit(preview, i.quality));
  await startJob(i.job2);
  await assert.rejects(() => f.prepare({ action: "sample.record", id, event: "measured", evidence: "Late reading", note }, i.quality), /withdrawn/);
  confirmed(await requireSample());
  const gated = await sampleId();
  const sjob = await sampleJob();
  confirmed(await record(gated, "produced", { job_id: sjob, sample_tag: "SMP-9", location: "QC lab" }));
  confirmed(await record(gated, "measured"));
  confirmed(await record(gated, "sent", { recipient: "Customer QA", expected_response: day(4) }));
  confirmed(await f.apply({ action: "sample.decide", id: gated, decision: "approved", evidence: "Signed sample card", customer_contact: "A. Shah", note }, i.salesManager));
  await assert.rejects(() => f.prepare({ action: "sample.invalidate", id: gated, note }, i.sales), /Not permitted/);
  confirmed(await f.apply({ action: "sample.invalidate", id: gated, note }, i.factory));
  await f.seed("update production_jobs set die_id=$2 where id=$1", [i.job3, i.dieA]);
  await assert.rejects(() => startJob(i.job3), /renewal needed/);
});

// NOV-079 ---------------------------------------------------------------------------------------
const createTemplate = (patch = {}, actor = i.quality) => f.apply({ action: "template.create", scope: "company", instructions: "Wrap in stretch film with timber spacers", spacer_required: false,
  label_fields: ["bundle_number", "order_number", "customer", "profile_code", "pieces", "net_kg"], note, ...patch }, actor);
const latestTemplate = async () => (await one("select id from packing_label_templates order by created_at desc limit 1")).id;
async function approvedTemplate(patch = {}) {
  confirmed(await createTemplate(patch));
  const id = await latestTemplate();
  confirmed(await f.apply({ action: "template.approve", id, note }, i.dispatchManager));
  return id;
}
const pack = (patch = {}, actor = i.dispatch) => f.apply({ action: "label.pack", bundle_id: i.packed1, spacers_used: true, wrapping_done: true, note, ...patch }, actor);

test("NOV-079: templates need a second approver and apply by order, project, customer then company", async () => {
  await assert.rejects(() => f.prepare({ action: "label.pack", bundle_id: i.packed1, spacers_used: true, wrapping_done: true, note }, i.dispatch), /No approved packing template/);
  assert.equal((await row("labels", i.packed1)).status, "no_template");
  confirmed(await createTemplate());
  const draft = await latestTemplate();
  assert.equal((await row("templates", draft)).status, "draft");
  await assert.rejects(() => f.prepare({ action: "template.approve", id: draft, note }, i.quality), /second person/);
  await assert.rejects(() => f.prepare({ action: "template.approve", id: draft, note }, i.dispatch), /Not permitted/);
  confirmed(await f.apply({ action: "template.approve", id: draft, note }, i.dispatchManager));
  await assert.rejects(() => f.prepare({ action: "template.create", scope: "customer", instructions: "Customer wrap", spacer_required: false, label_fields: ["bundle_number"], note }, i.quality), /only the record/);
  await assert.rejects(() => f.prepare({ action: "template.create", scope: "company", instructions: "Customer wrap", spacer_required: false, label_fields: ["bundle_number", "unit_rate"], note }, i.quality), /business-safe list/);
  assert.equal((await row("labels", i.packed1)).details.template_scope, "company");
  await approvedTemplate({ scope: "customer", customer_id: i.customer });
  assert.equal((await row("labels", i.packed1)).details.template_scope, "customer");
  await approvedTemplate({ scope: "order", order_id: i.order2 });
  assert.equal((await row("labels", i.packed1)).details.template_scope, "customer", "another order's template does not apply");
  await approvedTemplate({ scope: "project", project_id: i.project });
  assert.equal((await row("labels", i.packed1)).details.template_scope, "project");
  await approvedTemplate({ scope: "order", order_id: i.order });
  const label = await row("labels", i.packed1);
  assert.equal(label.details.template_scope, "order"); assert.equal(label.status, "to_label");
  assert.equal(label.details.preview.customer, "Fixture fabricator");
  confirmed(await createTemplate({ scope: "order", order_id: i.order, instructions: "Revised wrap" }));
  assert.equal((await row("templates", await latestTemplate())).details.revision, 2);
});

test("NOV-079: missing or overlong facts and packing limits are refused unless the dispatch manager records a deviation", async () => {
  await approvedTemplate({ label_fields: ["bundle_number", "customer_profile_ref", "customer"], max_pieces: 20, spacer_required: true, wrapping: "Stretch film" });
  const missing = await row("labels", i.packed1);
  assert.equal(missing.status, "fields_missing"); assert.deepEqual(missing.details.missing, ["customer_profile_ref"]);
  await assert.rejects(() => pack(), /customer profile ref/);
  await f.seed("update aluminium_profiles set customer_profile_reference='FAB-TRK-6000' where id=$1", [i.profile]);
  await f.seed("update customers set customer_name=$2 where id=$1", [i.customer, "Fixture fabricator and glazing systems private limited"]);
  assert.equal((await row("labels", i.packed1)).status, "label_overflow");
  await assert.rejects(() => pack(), /longer than a label line/);
  await f.seed("update customers set customer_name='Fixture fabricator' where id=$1", [i.customer]);
  await assert.rejects(() => pack({ spacers_used: false }), /spacers are required/);
  await assert.rejects(() => pack({ bundle_id: i.packed2 }), /30 pieces exceed the limit of 20/);
  await assert.rejects(() => pack({ bundle_id: i.packed2, deviation: "Customer asked for 30 per bundle" }), /reviewed by the dispatch manager/);
  await assert.rejects(() => pack({ deviation: "Not needed here" }, i.dispatchManager), /no deviation is needed/);
  confirmed(await pack({ bundle_id: i.packed2, deviation: "Customer asked for 30 per bundle" }, i.dispatchManager));
  const labelled = await row("labels", i.packed2);
  assert.equal(labelled.status, "labelled"); assert.equal(labelled.details.active_print.deviation, "Customer asked for 30 per bundle");
  await assert.rejects(() => pack({ bundle_id: i.packed2 }, i.dispatchManager), /already labelled/);
  await assert.rejects(() => pack({ bundle_id: i.packedShipped }, i.dispatchManager), /already been loaded/);
});

test("NOV-079: a reprint keeps the payload, a newer template asks for relabelling and labels never carry commercial fields", async () => {
  const first = await approvedTemplate({ label_fields: ["bundle_number", "order_number", "customer", "profile_code", "pieces", "net_kg", "destination", "project"] });
  await assert.rejects(() => f.prepare({ action: "label.reprint", bundle_id: i.packed1, reason: "damaged", note }, i.dispatch), /no label yet/);
  confirmed(await pack());
  const printed = await row("labels", i.packed1);
  assert.deepEqual(Object.keys(printed.details.active_print.payload).sort(), ["bundle_number", "customer", "destination", "net_kg", "order_number", "pieces", "profile_code", "project"]);
  assert.equal(printed.details.active_print.payload.destination, "Riverside site"); assert.equal(printed.details.active_print.payload.net_kg, "60");
  for (const forbidden of ["price", "rate", "cost", "margin", "amount", "value"]) assert.equal(JSON.stringify(printed.details.active_print.payload).toLowerCase().includes(forbidden), false, forbidden);
  confirmed(await f.apply({ action: "label.reprint", bundle_id: i.packed1, reason: "damaged", note }, i.quality));
  const reprinted = await row("labels", i.packed1);
  assert.equal(reprinted.details.active_print.print_number, 2); assert.equal(reprinted.details.active_print.reason, "damaged");
  assert.deepEqual(reprinted.details.active_print.payload, printed.details.active_print.payload);
  assert.equal(reprinted.details.prints.length, 2);
  confirmed(await createTemplate({ label_fields: ["bundle_number", "pieces"] }));
  const second = await latestTemplate();
  confirmed(await f.apply({ action: "template.approve", id: second, note }, i.admin));
  assert.equal((await row("templates", first)).status, "superseded");
  assert.equal((await row("labels", i.packed1)).status, "relabel_needed");
  const preview = await f.prepare({ action: "label.reprint", bundle_id: i.packed1, reason: "reprint", note }, i.dispatch);
  assert.equal(preview.review.facts.Reason, "relabel to current template");
  confirmed(await f.commit(preview, i.dispatch));
  const relabelled = await row("labels", i.packed1);
  assert.equal(relabelled.status, "labelled"); assert.equal(relabelled.details.active_print.reason, "relabel");
  assert.deepEqual(Object.keys(relabelled.details.active_print.payload).sort(), ["bundle_number", "pieces"]);
});

// NOV-021 ---------------------------------------------------------------------------------------
const istAt = (offset, hour, minute = 0) => new Date(`${day(offset)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`).toISOString();
const propose = (tranches, order = i.orderP, actor = i.salesManager) => f.apply({ action: "promise.propose", order_id: order, tranches, note }, actor);
const latestPromise = async () => (await one("select id from delivery_promises order by proposed_at desc limit 1")).id;
const promiseRow = async () => row("promises", await latestPromise());
async function limitPress(kg = 1000) { await f.seed("update factory_shift_capacities set capacity_kg=$2 where machine_id=$1", [i.press1, kg]); }

test("NOV-021: free compatible capacity decides feasibility; maintenance removes days, material shortage is a risk and nothing is reserved", async () => {
  await limitPress();
  const counts = async () => one("select (select count(*) from profile_stock_reservations) r,(select count(*) from production_plan_slots) s");
  const before = await counts();
  confirmed(await propose([{ date: day(1), kg: 2000 }], i.orderP, i.sales));
  const feasible = await promiseRow();
  assert.equal(feasible.status, "proposed"); assert.equal(feasible.details.verdict, "feasible");
  assert.equal(n(feasible.details.evaluation.checks[0].free_capacity_kg), 2000, "only the compatible press counts");
  assert.ok(feasible.details.evaluation.assumptions.some(a => /reserves nothing/.test(a)));
  assert.deepEqual(await counts(), before, "a proposal reserves stock and slots for nobody");
  confirmed(await propose([{ date: day(0), kg: 2000 }]));
  const short = await promiseRow();
  assert.equal(short.details.verdict, "infeasible"); assert.match(short.details.evaluation.reasons[0], /cover 1000 kg/);
  await f.seed("insert into factory_maintenance_blocks(company_id,machine_id,starts_at,ends_at,reason,status,created_by) values($1,$2,$3,$4,'Container liner change','planned',$5)", [i.company, i.press1, istAt(1, 0, 30), istAt(1, 12), i.factory]);
  confirmed(await propose([{ date: day(1), kg: 2000 }]));
  assert.equal((await promiseRow()).details.verdict, "infeasible", "a maintenance block removes the day from capacity");
  confirmed(await propose([{ date: day(2), kg: 2000 }]));
  assert.equal((await promiseRow()).details.verdict, "feasible");
  await f.seed("update orders set billet_allocation_status='shortage',billets_short=3 where id=$1", [i.orderP]);
  confirmed(await propose([{ date: day(2), kg: 2000 }]));
  const risk = await promiseRow();
  assert.equal(risk.details.verdict, "at_risk"); assert.equal(risk.details.evaluation.material_confirmed, false);
  await f.seed("insert into production_plan_slots(company_id,production_job_id,machine_id,planned_start_at,planned_end_at,capacity_kg,status) values($1,$2,$3,$4,$5,1000,'scheduled')", [i.company, i.job3, i.press1, istAt(2, 9), istAt(2, 17)]);
  confirmed(await propose([{ date: day(2), kg: 2000 }]));
  assert.equal((await promiseRow()).details.verdict, "infeasible", "another order's slot consumes the day");
  await assert.rejects(() => f.prepare({ action: "promise.propose", order_id: i.orderC, tranches: [{ date: day(2), kg: 10 }], note }, i.salesManager), /still to be fulfilled/);
  await assert.rejects(() => f.prepare({ action: "promise.propose", order_id: i.orderP, tranches: [{ date: day(2), kg: 10 }], note }, i.dispatch), /Not permitted/);
});

test("NOV-021: finishing lead time is required and shortens the production window", async () => {
  await limitPress();
  await f.seed("update order_items set finishing_type='anodizing' where id=$1", [i.lineP]);
  confirmed(await propose([{ date: day(10), kg: 2000 }]));
  const incomplete = await promiseRow();
  assert.equal(incomplete.details.verdict, "incomplete"); assert.match(incomplete.details.evaluation.reasons[0], /No finishing lead time is configured for anodizing/);
  assert.equal(incomplete.details.evaluation.earliest_full_date, null);
  const incompleteId = await latestPromise();
  await assert.rejects(() => f.prepare({ action: "promise.accept", id: incompleteId, note }, i.salesManager), /no longer feasible: No finishing lead time/);
  await f.seed("insert into factory_finishing_lead_times(company_id,finishing_type,lead_days,updated_by) values($1,'anodizing',3,$2)", [i.company, i.owner]);
  confirmed(await propose([{ date: day(2), kg: 2000 }]));
  const late = await promiseRow();
  assert.equal(late.details.verdict, "infeasible"); assert.match(late.details.evaluation.reasons[0], /finishing lead time \(3 days\) leaves no production time/);
  confirmed(await propose([{ date: day(5), kg: 2000 }]));
  const ok = await promiseRow();
  assert.equal(ok.details.verdict, "feasible"); assert.equal(ok.details.evaluation.checks[0].production_by, day(2));
  assert.equal(ok.details.evaluation.earliest_full_date, day(4));
});

test("NOV-021: tranches are validated, other accepted promises claim capacity and acceptance moves the order date once", async () => {
  await limitPress();
  await assert.rejects(() => f.prepare({ action: "promise.propose", order_id: i.orderP, tranches: [{ date: day(5), kg: 1000 }, { date: day(4), kg: 1000 }], note }, i.salesManager), /must increase/);
  await assert.rejects(() => f.prepare({ action: "promise.propose", order_id: i.orderP, tranches: [{ date: day(5), kg: 1500 }, { date: day(6), kg: 1000 }], note }, i.salesManager), /Only 2000 kg remains/);
  await assert.rejects(() => f.prepare({ action: "promise.propose", order_id: i.orderP, tranches: [{ date: day(-1), kg: 100 }], note }, i.salesManager), /cannot be in the past/);
  await assert.rejects(() => f.prepare({ action: "promise.propose", order_id: i.orderP, tranches: [{ date: day(130), kg: 100 }], note }, i.salesManager), /120 days ahead/);
  await assert.rejects(() => f.prepare({ action: "promise.propose", order_id: i.orderP, tranches: [{ date: day(5), kg: 100, extra: 1 }], note }, i.salesManager), /date and kg/);
  await f.seed("update order_items set finishing_type='mill_finish' where id=$1", [i.line2]);
  confirmed(await propose([{ date: day(1), kg: 600 }], i.order2));
  const other = await latestPromise();
  await assert.rejects(() => f.prepare({ action: "promise.accept", id: other, note }, i.sales), /Not permitted/);
  confirmed(await f.apply({ action: "promise.accept", id: other, note }, i.salesManager));
  assert.equal((await one("select expected_dispatch_date::text d from orders where id=$1", [i.order2])).d, day(1));
  confirmed(await propose([{ date: day(1), kg: 2000 }]));
  const claimed = await promiseRow();
  assert.equal(claimed.details.verdict, "infeasible"); assert.equal(n(claimed.details.evaluation.checks[0].claimed_by_others_kg), 600);
  assert.ok(claimed.details.evaluation.assumptions.some(a => /1 accepted promise/.test(a)));
  confirmed(await propose([{ date: day(5), kg: 1000 }, { date: day(10), kg: 1000 }]));
  const first = await latestPromise();
  const accepted = confirmed(await f.apply({ action: "promise.accept", id: first, note }, i.salesManager));
  assert.ok(accepted);
  assert.equal((await one("select expected_dispatch_date::text d from orders where id=$1", [i.orderP])).d, day(10));
  confirmed(await propose([{ date: day(12), kg: 2000 }]));
  const second = await latestPromise();
  const preview = await f.prepare({ action: "promise.accept", id: second, note }, i.owner);
  assert.ok(preview.review.warnings.some(w => /earlier accepted promise/.test(w)));
  confirmed(await f.commit(preview, i.owner));
  assert.equal((await row("promises", first)).status, "superseded");
  const current = await row("promises", second);
  assert.equal(current.status, "accepted"); assert.equal(current.details.previous_expected_date, day(10)); assert.equal(current.details.order_expected_date, day(12));
  await assert.rejects(() => f.prepare({ action: "promise.accept", id: second, note }, i.owner), /Only a proposed promise/);
  confirmed(await propose([{ date: day(20), kg: 2000 }]));
  const stale = await latestPromise();
  await f.seed("update delivery_promises set expires_at=now()-interval '1 minute' where id=$1", [stale]);
  assert.equal((await row("promises", stale)).status, "expired");
  await assert.rejects(() => f.prepare({ action: "promise.accept", id: stale, note }, i.owner), /expired/);
  confirmed(await f.apply({ action: "promise.withdraw", id: second, note }, i.sales));
  assert.equal((await one("select expected_dispatch_date::text d from orders where id=$1", [i.orderP])).d, day(12), "withdrawal does not move the order date");
});

test("NOV-021: an accepted promise that loses its capacity is flagged at risk", async () => {
  await limitPress();
  confirmed(await propose([{ date: day(3), kg: 2000 }]));
  const id = await latestPromise();
  confirmed(await f.apply({ action: "promise.accept", id, note }, i.salesManager));
  assert.equal((await row("promises", id)).status, "accepted");
  await f.seed("insert into factory_maintenance_blocks(company_id,machine_id,starts_at,ends_at,reason,status,created_by) values($1,$2,$3,$4,'Press overhaul','planned',$5)", [i.company, i.press1, istAt(0, 0), istAt(3, 23, 59), i.factory]);
  const risk = await row("promises", id);
  assert.equal(risk.status, "promise_at_risk"); assert.equal(risk.details.current.verdict, "infeasible");
  assert.ok((await f.command("list", { view: "promises" })).rows.some(r => r.id === id && r.status === "promise_at_risk"));
});

// NOV-027 ---------------------------------------------------------------------------------------
const openTrace = (node_type, node_id, actor = i.quality) => f.apply({ action: "trace.open", node_type, node_id, note }, actor);
const latestTrace = async () => (await one("select id from trace_investigations order by opened_at desc limit 1")).id;
const nodeKeys = snapshot => snapshot.nodes.map(x => x.key);

test("NOV-027: backward and forward traversal follow recorded identities only and mark unlinked sources", async () => {
  confirmed(await openTrace("stock_batch", i.stockJob));
  const back = await row("trace", await latestTrace());
  const keys = nodeKeys(back.details.snapshot);
  for (const expected of [`production_job:${i.job2}`, `foundry_billet:${i.billet}`, `outsourced_batch:${i.billetBatch}`]) assert.ok(keys.includes(expected), expected);
  assert.equal(keys.includes(`stock_batch:${i.stock1}`), false, "similar stock is never matched");
  confirmed(await openTrace("foundry_billet", i.billet));
  const forward = (await row("trace", await latestTrace())).details.snapshot;
  for (const expected of [`production_job:${i.job2}`, `stock_batch:${i.stockJob}`, `prepared_bundle:${i.packed1}`, `prepared_bundle:${i.packedShipped}`, `packing_item:${i.bundle1}`, `dispatch:${i.dispatch1}`, `customer:${i.customer}`, `inspection:${i.inspection}`])
    assert.ok(nodeKeys(forward).includes(expected), expected);
  assert.equal(forward.truncated, false);
  confirmed(await openTrace("production_job", i.job1));
  const unknown = (await row("trace", await latestTrace())).details.snapshot.unknown;
  assert.match(unknown[0].note, /No billet issue is recorded for this job/);
  await assert.rejects(() => f.prepare({ action: "trace.open", node_type: "production_job", node_id: i.foreignJob, note }, i.quality), /starting record is unavailable/);
  await assert.rejects(() => f.prepare({ action: "trace.open", node_type: "production_job", node_id: i.job1, note }, i.inventory), /Not permitted/);
});

test("NOV-027: evidenced links are traversed after recording; mismatched or duplicate mappings are refused", async () => {
  await assert.rejects(() => f.prepare({ action: "trace.link", from_type: "production_job", from_id: i.job3, to_type: "stock_batch", to_id: i.stock1, evidence: "Bundle tag log page 14", note }, i.inventory), /profile differs/);
  await assert.rejects(() => f.prepare({ action: "trace.link", from_type: "production_job", from_id: i.job1, to_type: "stock_batch", to_id: i.stockJob, evidence: "Bundle tag log page 14", note }, i.inventory), /already records its production job/);
  await assert.rejects(() => f.prepare({ action: "trace.link", from_type: "foundry_billet", from_id: i.billet, to_type: "stock_batch", to_id: i.stock1, evidence: "Bundle tag log page 14", note }, i.inventory), /Only billet-to-job and job-to-stock/);
  await assert.rejects(() => f.prepare({ action: "trace.link", from_type: "foundry_billet", from_id: i.billet, to_type: "production_job", to_id: i.foreignJob, evidence: "Issue slip 77", note }, i.inventory), /belong to this company/);
  confirmed(await f.apply({ action: "trace.link", from_type: "foundry_billet", from_id: i.billet, to_type: "production_job", to_id: i.job1, quantity_kg: 40, evidence: "Billet issue slip 77 signed by press operator", note }, i.inventory));
  await assert.rejects(() => f.prepare({ action: "trace.link", from_type: "foundry_billet", from_id: i.billet, to_type: "production_job", to_id: i.job1, evidence: "Issue slip 77 again", note }, i.inventory), /already recorded/);
  confirmed(await f.apply({ action: "trace.link", from_type: "production_job", from_id: i.job1, to_type: "stock_batch", to_id: i.stock1, evidence: "Bundle tag log page 14", note }, i.factory));
  confirmed(await openTrace("stock_batch", i.stock1));
  const keys = nodeKeys((await row("trace", await latestTrace())).details.snapshot);
  for (const expected of [`production_job:${i.job1}`, `foundry_billet:${i.billet}`, `outsourced_batch:${i.billetBatch}`]) assert.ok(keys.includes(expected), expected);
});

test("NOV-027: holds apply only to available released stock in the snapshot, and traversal is bounded", async () => {
  confirmed(await openTrace("foundry_billet", i.billet));
  const id = await latestTrace();
  await assert.rejects(() => f.prepare({ action: "trace.hold", id, stock_batch_id: i.stock1, note }, i.quality), /found by this investigation/);
  await assert.rejects(() => f.prepare({ action: "trace.hold", id, stock_batch_id: i.stockJob, note }, i.inventory), /Not permitted/);
  confirmed(await f.apply({ action: "trace.hold", id, stock_batch_id: i.stockJob, note }, i.quality));
  assert.equal((await one("select qc_status from profile_stock_batches where id=$1", [i.stockJob])).qc_status, "on_hold");
  await assert.rejects(() => f.prepare({ action: "trace.hold", id, stock_batch_id: i.stockJob, note }, i.quality), /already on QC on hold/);
  const record = await row("trace", id);
  assert.equal(record.details.holds.length, 1); assert.equal(record.details.holds[0].previous_qc_status, "released");
  assert.ok(record.details.current, "the detail recomputes the current graph");
  confirmed(await f.apply({ action: "trace.close", id, note }, i.factory));
  assert.equal((await one("select qc_status from profile_stock_batches where id=$1", [i.stockJob])).qc_status, "on_hold", "closing keeps holds");
  await assert.rejects(() => f.prepare({ action: "trace.hold", id, stock_batch_id: i.stockJob, note }, i.quality), /investigation is closed/);
  await f.seed(`insert into profile_stock_batches(company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,bundle_number,location,status,origin_type,production_job_id,qc_status,piece_length_m)
    select $1,$2,'mill_finish',6,1,7.2,'BULK-'||g,'Rack 9','available','production_surplus',$3,'released',6 from generate_series(1,230) g`, [i.company, i.profile, i.job1]);
  const preview = await f.prepare({ action: "trace.open", node_type: "production_job", node_id: i.job1, note }, i.quality);
  assert.ok(preview.review.warnings.some(w => /200-record limit/.test(w)));
  confirmed(await f.commit(preview, i.quality));
  const capped = (await row("trace", await latestTrace())).details.snapshot;
  assert.equal(capped.truncated, true); assert.equal(capped.nodes.length, 200);
});

// NOV-068 ---------------------------------------------------------------------------------------
const split = (outputs, patch = {}, actor = i.inventory) => f.apply({ action: "bundle.split", stock_batch_id: i.stock2, outputs, note, ...patch }, actor);
const latestBundle = async () => (await one("select id from bundle_transformations order by recorded_at desc limit 1")).id;
const stock = async id => one("select status,quantity_pieces,total_weight_kg::float8 kg,qc_status,bundle_number from profile_stock_batches where id=$1", [id]);

test("NOV-068: a split conserves pieces and weight, links lineage and consumes the old tag", async () => {
  await assert.rejects(() => split([{ bundle_number: "S2-A", pieces: 8, kg: 57.6 }, { bundle_number: "S2-B", pieces: 11, kg: 86.4 }]), /exactly the 20 pieces/);
  await assert.rejects(() => split([{ bundle_number: "S2-A", pieces: 8, kg: 60 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }]), /more than the 144 kg going in/);
  await assert.rejects(() => split([{ bundle_number: "S2-A", pieces: 8, kg: 57 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }]), /0.6 kg less than the input/);
  await assert.rejects(() => split([{ bundle_number: "S2-A", pieces: 8, kg: 57.6 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }], { variance_reason: "Nothing lost here" }), /no variance reason is needed/);
  for (const taken of ["S1", "B1", "S2"]) await assert.rejects(() => split([{ bundle_number: taken, pieces: 8, kg: 57.6 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }]), /already in use/);
  await assert.rejects(() => split([{ bundle_number: "s2-a", pieces: 8, kg: 57.6 }, { bundle_number: "S2-A", pieces: 12, kg: 86.4 }]), /its own tag/);
  await assert.rejects(() => split([{ bundle_number: "S2-A", pieces: 8, kg: 57.6 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }], {}, i.dispatch), /Not permitted/);
  const preview = await f.prepare({ action: "bundle.split", stock_batch_id: i.stock2, outputs: [{ bundle_number: "s2-a", pieces: 8, kg: 57.6 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }], note }, i.inventory);
  confirmed(await f.commit(preview, i.inventory));
  assert.equal((await f.commit(preview, i.inventory)).state, "confirmed", "a retried confirmation returns the recorded outcome");
  assert.equal(n((await one("select count(*) c from bundle_transformations")).c), 1, "a lost response replay does not split twice");
  assert.equal((await stock(i.stock2)).status, "transformed");
  const outputs = (await f.db.query("select bundle_number,quantity_pieces q,total_weight_kg::float8 kg,status,qc_status,location,finish,length_m::float8 len from profile_stock_batches where bundle_number like 'S2-%' order by bundle_number")).rows;
  assert.deepEqual(outputs, [{ bundle_number: "S2-A", q: 8, kg: 57.6, status: "available", qc_status: "released", location: "Rack 4", finish: "mill_finish", len: 48 },
    { bundle_number: "S2-B", q: 12, kg: 86.4, status: "available", qc_status: "released", location: "Rack 4", finish: "mill_finish", len: 72 }]);
  assert.equal(n((await one("select count(*) c from material_lineage_links where from_id=$1 and relation='split_into'", [i.stock2])).c), 2);
  const record = await row("bundles", await latestBundle());
  assert.equal(record.status, "completed"); assert.equal(record.details.lines.length, 3); assert.equal(n(record.details.variance_kg), 0);
  const lookup = await f.command("lookup", { kind: "stock", search: "S2" }, i.inventory);
  assert.deepEqual(lookup.map(x => x.label.split(" · ")[0]).sort(), ["S2-A", "S2-B"], "the consumed tag is not offered as free stock");
});

test("NOV-068: held, reserved and packed bundles are refused; a weight deficit needs a reason and is recorded as variance", async () => {
  await f.seed("update profile_stock_batches set qc_status='on_hold' where id=$1", [i.stock3]);
  await assert.rejects(() => f.prepare({ action: "bundle.split", stock_batch_id: i.stock3, outputs: [{ bundle_number: "S3-A", pieces: 2, kg: 14.4 }, { bundle_number: "S3-B", pieces: 3, kg: 21.6 }], note }, i.inventory), /on QC on hold/);
  await f.seed("insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,status) values($1,$2,$3,$4,10,'active')", [i.company, i.stock1, i.profile, i.order]);
  await assert.rejects(() => f.prepare({ action: "bundle.split", stock_batch_id: i.stock1, outputs: [{ bundle_number: "S1-A", pieces: 5, kg: 36 }, { bundle_number: "S1-B", pieces: 5, kg: 36 }], note }, i.inventory), /reserved for an order/);
  confirmed(await split([{ bundle_number: "S2-A", pieces: 8, kg: 57.4 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }], { variance_reason: "Saw cut loss on damaged end" }));
  const record = await row("bundles", await latestBundle());
  assert.equal(n(record.details.variance_kg), -0.2); assert.match(record.summary, /variance -0.2 kg: Saw cut loss/);
});

test("NOV-068: merges need identical identity; reversal restores inputs only while outputs are unused and loops stay finite", async () => {
  await assert.rejects(() => f.prepare({ action: "bundle.merge", stock_batch_ids: [i.stock1, i.stockJob], bundle_number: "M-1", output_kg: 158.4, note }, i.inventory), /same profile, finish/);
  await f.seed("update profile_stock_batches set location='Rack 5' where id=$1", [i.stock3]);
  await assert.rejects(() => f.prepare({ action: "bundle.merge", stock_batch_ids: [i.stock1, i.stock3], bundle_number: "M-1", output_kg: 108, note }, i.inventory), /same profile, finish/);
  await f.seed("update profile_stock_batches set location='Rack 4' where id=$1", [i.stock3]);
  const other = f.nextId();
  await f.seed(`insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,bundle_number,location,status,origin_type,production_job_id,qc_status,piece_length_m)
    values($1,$2,$3,'mill_finish',12,2,14.4,'SJ-2','Rack 4','available','production_surplus',$4,'released',6)`, [other, i.company, i.profile, i.job1]);
  await assert.rejects(() => f.prepare({ action: "bundle.merge", stock_batch_ids: [i.stockJob, other], bundle_number: "M-1", output_kg: 100.8, note }, i.inventory), /different jobs/);
  await assert.rejects(() => f.prepare({ action: "bundle.merge", stock_batch_ids: [i.stock1, i.stock1], bundle_number: "M-1", output_kg: 72, note }, i.inventory), /scanned twice/);
  confirmed(await f.apply({ action: "bundle.merge", stock_batch_ids: [i.stock1, i.stock3], bundle_number: "M-1", output_kg: 108, note }, i.dispatchManager));
  const merge = await latestBundle();
  const merged = await one("select id,quantity_pieces q,total_weight_kg::float8 kg from profile_stock_batches where bundle_number='M-1'");
  assert.deepEqual([merged.q, merged.kg], [15, 108]);
  assert.deepEqual([(await stock(i.stock1)).status, (await stock(i.stock3)).status], ["transformed", "transformed"]);
  await assert.rejects(() => f.prepare({ action: "bundle.reverse", id: merge, note }, i.dispatchManager), /Not permitted/);
  confirmed(await f.apply({ action: "bundle.reverse", id: merge, note }, i.inventory));
  assert.deepEqual([(await stock(i.stock1)).status, (await stock(i.stock3)).status, (await stock(merged.id)).status], ["available", "available", "transformed"]);
  assert.equal((await row("bundles", merge)).status, "reversed");
  await assert.rejects(() => f.prepare({ action: "bundle.reverse", id: merge, note }, i.inventory), /already reversed/);
  confirmed(await openTrace("stock_batch", i.stock1));
  const loop = (await row("trace", await latestTrace())).details.snapshot;
  assert.ok(nodeKeys(loop).includes(`stock_batch:${merged.id}`)); assert.equal(loop.truncated, false, "split-and-reverse loops terminate");
  confirmed(await split([{ bundle_number: "S2-A", pieces: 8, kg: 57.6 }, { bundle_number: "S2-B", pieces: 12, kg: 86.4 }]));
  const splitId = await latestBundle();
  const out = (await one("select id from profile_stock_batches where bundle_number='S2-A'")).id;
  await f.seed("insert into profile_stock_reservations(company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,status) values($1,$2,$3,$4,10,'active')", [i.company, out, i.profile, i.order]);
  await assert.rejects(() => f.prepare({ action: "bundle.reverse", id: splitId, note }, i.inventory), /used, changed or reserved/);
});

test("NOV-068: a split of production stock is not counted again when more job output is moved to stock", async () => {
  await f.seed("update production_jobs set status='completed',actual_quantity_kg=500,finishing_type='mill_finish' where id=$1", [i.job2]);
  await f.seed("update quality_inspections set status='approved' where id=$1", [i.inspection]);
  confirmed(await f.apply({ action: "bundle.split", stock_batch_id: i.stockJob, outputs: [{ bundle_number: "SJ-1A", pieces: 6, kg: 43.2 }, { bundle_number: "SJ-1B", pieces: 6, kg: 43.2 }], note }, i.inventory));
  const stockIn = kg => f.asUser("select public.create_stock_from_production_surplus($1,$2,30,6,$3,'Rack 4',null) id", [i.job2, kg, `SJ-N${kg}`], i.inventory);
  await assert.rejects(() => stockIn(214), /Only 213.60* kg/);
  assert.ok((await stockIn(213.6))[0].id, "300 kg released less 86.4 kg stocked once leaves 213.6 kg");
});

// NOV-060 ---------------------------------------------------------------------------------------
const openJourney = (patch = {}, actor = i.factory) => f.apply({ action: "journey.open", order_id: i.orderC, title: "SO-NOV6-C walk-through", participants: "Sales, press, dispatch, accounts", baseline_from: day(-30), baseline_to: day(-1), note, ...patch }, actor);
const latestJourney = async () => (await one("select id from journey_reviews order by opened_at desc limit 1")).id;

test("NOV-060: the recorded journey shows real events and gaps; private observations stay private", async () => {
  await assert.rejects(() => f.prepare({ action: "journey.open", order_id: i.orderC, title: "Future review", participants: "Sales", baseline_from: day(-3), baseline_to: day(2), note }, i.factory), /cannot end in the future/);
  await assert.rejects(() => f.prepare({ action: "journey.open", order_id: i.orderC, title: "Future review", participants: "Sales", baseline_from: day(-3), baseline_to: day(2), note }, i.dispatch), /Not permitted/);
  confirmed(await openJourney());
  const id = await latestJourney();
  const record = await row("journeys", id);
  assert.equal(record.status, "scoping");
  const labels = record.details.timeline.events.map(e => e.label);
  for (const expected of ["Order SO-NOV6-C created", "Dispatch D-NOV6-C departed", "Dispatch D-NOV6-C delivered", "Invoice INV-NOV6-C issued"]) assert.ok(labels.includes(expected), expected);
  assert.ok(record.details.timeline.missing.some(m => /No quotation is linked/.test(m)));
  assert.ok(record.details.timeline.missing.some(m => /No payment receipt/.test(m)));
  confirmed(await f.apply({ action: "journey.annotate", id, kind: "waiting", private: true, minutes: 240, note: "Supervisor waited for die approval call" }, i.productionManager));
  confirmed(await f.apply({ action: "journey.annotate", id, kind: "information_search", private: false, minutes: 30, note: "Looked for the packing instruction" }, i.dispatchManager));
  const visible = async actor => (await detail("journeys", id, actor)).row.details.annotations.length;
  assert.equal(await visible(i.dispatchManager), 1, "another reader sees only shared observations");
  for (const actor of [i.productionManager, i.factory, i.owner, i.admin]) assert.equal(await visible(actor), 2);
  const events = (await detail("journeys", id, i.dispatchManager)).events;
  assert.ok(events.some(e => e.note === "Private observation recorded"), "history does not leak the private text");
  assert.equal(JSON.stringify(events).includes("die approval call"), false);
  assert.deepEqual((await row("journeys", id)).details.time_by_kind, { waiting: 240, information_search: 30 });
  await assert.rejects(() => f.asUser("select count(*) from journey_annotations", [], i.owner), /permission denied/);
});

test("NOV-060: actions are owned, measures are comparable and never overwritten, and closure needs evidence", async () => {
  confirmed(await openJourney());
  const id = await latestJourney();
  await assert.rejects(() => f.prepare({ action: "journey.close", id, note }, i.factory), /at least one observation/);
  confirmed(await f.apply({ action: "journey.annotate", id, kind: "rework", private: false, note: "Bundle relabelled twice at dispatch" }, i.dispatchManager));
  await assert.rejects(() => f.prepare({ action: "journey.action", id, finding: "Print labels from the order", owner_id: i.foreign, due_date: day(10), note }, i.factory), /active employee/);
  await assert.rejects(() => f.prepare({ action: "journey.action", id, finding: "Print labels from the order", owner_id: i.productionManager, due_date: day(-1), note }, i.factory), /cannot be in the past/);
  confirmed(await f.apply({ action: "journey.action", id, finding: "Print labels from the approved template", owner_id: i.productionManager, due_date: day(10), note }, i.factory));
  const action = (await one("select id from journey_actions")).id;
  await assert.rejects(() => f.prepare({ action: "journey.close", id, note }, i.factory), /Finish or drop every improvement action/);
  await assert.rejects(() => f.prepare({ action: "journey.progress", action_id: action, status: "trial", note }, i.inventory), /action owner or the review owner/);
  confirmed(await f.apply({ action: "journey.progress", action_id: action, status: "trial", note }, i.productionManager));
  await assert.rejects(() => f.prepare({ action: "journey.progress", action_id: action, status: "trial", note }, i.productionManager), /cannot move from trial to trial/);
  confirmed(await f.apply({ action: "journey.progress", action_id: action, status: "done", note }, i.factory));
  await assert.rejects(() => f.prepare({ action: "journey.progress", action_id: action, status: "dropped", note }, i.factory), /cannot move from done/);
  assert.equal((await row("journeys", id)).status, "awaiting_trial_measure");
  await assert.rejects(() => f.prepare({ action: "journey.close", id, note }, i.factory), /Compare a trial measure/);
  const measure = patch => ({ action: "journey.measure", id, phase: "baseline", metric: "relabel_count", value: 6, unit: "count", sample_size: 20, limitations: "Twenty orders from one month", note, ...patch });
  await assert.rejects(() => f.prepare(measure({ phase: "trial" }), i.quality), /Record the baseline/);
  confirmed(await f.apply(measure(), i.quality));
  await assert.rejects(() => f.prepare(measure({ value: 5 }), i.quality), /not overwritten/);
  await assert.rejects(() => f.prepare(measure({ phase: "trial", unit: "percent", value: 10 }), i.quality), /same unit/);
  await assert.rejects(() => f.prepare(measure({ phase: "trial", value: 1 }), i.dispatchManager), /Not permitted/);
  confirmed(await f.apply(measure({ phase: "trial", value: 1, sample_size: 12 }), i.quality));
  assert.equal((await row("journeys", id)).details.measures.length, 2);
  confirmed(await f.apply({ action: "journey.close", id, note }, i.factory));
  assert.equal((await row("journeys", id)).status, "closed");
  await assert.rejects(() => f.prepare({ action: "journey.annotate", id, kind: "waiting", private: false, note }, i.factory), /review is closed/);
});

// NOV-008 ---------------------------------------------------------------------------------------
test("NOV-008: personal defaults are scoped to the user and company, and a remembered press must stay valid", async () => {
  assert.deepEqual(await f.defaults("load", { form_keys: ["production.machine_id", "production.shift"] }, i.production), {});
  assert.deepEqual(await f.defaults("set", { form_key: "production.machine_id", value: i.press1 }, i.production), { form_key: "production.machine_id", value: i.press1 });
  await f.defaults("set", { form_key: "production.shift", value: "Night" }, i.production);
  await f.defaults("set", { form_key: "production.shift", value: "Day" }, i.production);
  assert.deepEqual(await f.defaults("load", { form_keys: ["production.machine_id", "production.shift", "dispatches.transporter_name"] }, i.production), { "production.machine_id": i.press1, "production.shift": "Day" });
  assert.deepEqual(await f.defaults("load", { form_keys: ["production.machine_id", "production.shift"] }, i.production2), {}, "another user does not see the default");
  assert.equal(n((await f.asUser("select count(*) c from user_form_defaults", [], i.production2))[0].c), 0);
  await assert.rejects(() => f.defaults("set", { form_key: "production.machine_id", value: f.nextId() }, i.production), /active extrusion press/);
  await assert.rejects(() => f.defaults("set", { form_key: "quotes.unit_rate", value: "210" }, i.production), /Invalid defaults request/);
  await assert.rejects(() => f.defaults("set", { form_key: "production.shift", value: "Day", company_id: i.foreignCompany }, i.production), /Invalid defaults request/);
  await assert.rejects(() => f.defaults("set", { form_key: "production.shift", value: "  " }, i.production), /1 to 120 characters/);
  await assert.rejects(() => f.defaults("set", { form_key: "production.machine_id", value: i.press1 }, i.foreign), /active extrusion press/);
  await assert.rejects(() => f.defaults("load", { form_keys: [] }, i.dealer), /Not permitted/);
  await f.seed("update machines set is_active=false where id=$1", [i.press1]);
  assert.deepEqual(await f.defaults("load", { form_keys: ["production.machine_id"] }, i.production), {}, "an inactive remembered press is not suggested");
  await f.defaults("clear", { form_key: "production.shift" }, i.production);
  assert.deepEqual(await f.defaults("load", { form_keys: ["production.shift"] }, i.production), {});
  await assert.rejects(() => f.asUser("insert into user_form_defaults(company_id,user_id,form_key,value) values($1,$2,'production.shift','Day')", [i.company, i.production], i.production), /permission denied/);
});

// Shared protocol --------------------------------------------------------------------------------
test("shared protocol: request identity, stale sources, expiry, abandonment, tenant isolation and direct table access", async () => {
  const mutation = { action: "closure.close", order_id: i.orderC, kind: "operational", note };
  const preview = await f.prepare(mutation, i.salesManager);
  assert.deepEqual(await f.command("preview", { request_id: preview.request_id, mutation }, i.salesManager), preview, "replaying a preview returns the same review");
  await assert.rejects(() => f.command("preview", { request_id: preview.request_id, mutation: { ...mutation, kind: "final" } }, i.salesManager), /different details/);
  await assert.rejects(() => f.command("outcome", { request_id: preview.request_id }, i.foreign), /Not permitted/);
  await assert.rejects(() => f.commit({ ...preview, fingerprint: "0".repeat(32) }, i.salesManager), /does not match/);
  await f.seed("update invoices set amount_paid=1000 where id=$1", [i.invoiceC]);
  rejected(await f.commit(preview, i.salesManager), /source changed/);
  const blocked = await f.prepare(mutation, i.salesManager);
  await f.seed("insert into production_jobs(id,company_id,order_id,profile_id,status,planned_quantity_kg,actual_quantity_kg,job_number) values($1,$2,$3,$4,'planned',50,0,'J-LATE')", [f.nextId(), i.company, i.orderC, i.profile]);
  rejected(await f.commit(blocked, i.salesManager), /still open, starting with: Production job J-LATE/);
  assert.equal((await one("select current_stage from orders where id=$1", [i.orderC])).current_stage, "delivered");
  await f.seed("delete from production_jobs where job_number='J-LATE'");
  const expiring = await f.prepare(mutation, i.salesManager);
  await f.db.query("update lifecycle_requests set expires_at=now()-interval '1 minute' where request_id=$1", [expiring.request_id]);
  rejected(await f.commit(expiring, i.salesManager), /expired/);
  const second = await f.prepare(mutation, i.salesManager);
  assert.equal((await f.command("abandon", { request_id: second.request_id }, i.salesManager)).state, "abandoned");
  assert.equal((await f.commit(second, i.salesManager)).state, "abandoned", "an abandoned review cannot be committed");
  assert.equal((await f.command("outcome", { request_id: f.nextId() }, i.salesManager)).state, "not_recorded");
  await assert.rejects(() => f.prepare(mutation, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare(mutation, i.dealer), /Not permitted/);
  await assert.rejects(() => f.prepare({ ...mutation, company_id: i.foreignCompany }, i.salesManager), /Review the required action details/);
  await assert.rejects(() => f.prepare({ ...mutation, note: "x" }, i.salesManager), /Review the required action details/);
  await assert.rejects(() => f.command("list", { view: "closure", company_id: i.foreignCompany }, i.salesManager), /Invalid lifecycle request/);
  await assert.rejects(() => f.prepare(mutation, i.foreign), /unavailable/);
  confirmed(await f.apply(mutation, i.salesManager));
  assert.equal(n((await f.asUser("select count(*) c from order_closures", [], i.salesManager))[0].c), 1);
  assert.equal(n((await f.asUser("select count(*) c from order_closures", [], i.foreign))[0].c), 0);
  assert.equal(n((await f.asUser("select count(*) c from order_closures", [], i.production))[0].c), 0, "roles outside the view read nothing directly");
  await assert.rejects(() => detail("closure", i.orderC, i.foreign), /unavailable/);
  await assert.rejects(() => f.asUser("select count(*) c from lifecycle_events", [], i.owner), /permission denied/, "history is only projected through the command");
  await assert.rejects(() => f.asUser("insert into order_closures(id,company_id,order_id,kind,previous_stage,readiness,carried,closed_by,close_note) values($1,$2,$3,'final','delivered','[]','[]',$4,'x')", [f.nextId(), i.company, i.orderC, i.owner], i.owner), /permission denied/);
  await assert.rejects(() => f.asUser("update delivery_promises set status='accepted'", [], i.owner), /permission denied/);
  lifecycleDetailSchema.parse(await detail("closure", i.orderC, i.salesManager));
  const lookups = await f.command("lookup", { kind: "orders", search: "NOV6", filter: "promises" }, i.salesManager);
  assert.deepEqual(lookups.map(x => x.label), ["SO-NOV6-P"], "closed and delivered orders are not offered for promises");
  await assert.rejects(() => f.command("lookup", { kind: "stock", search: "" }, i.sales), /Not permitted/);
});
