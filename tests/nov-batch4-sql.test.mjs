import test from "node:test";
import assert from "node:assert/strict";
import { createNov4Fixture, nids as i } from "../scripts/lib/nov-batch4-fixture.mjs";
import { migrationFiles } from "../scripts/lib/migration-chain-replay.mjs";
import { controlListSchema, controlDetailSchema, controlOutcomeSchema, ledgerSchema } from "../lib/workflow/operations-control.ts";

let f;
test.before(async () => { f = await createNov4Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { controlOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const row = async (view, id, actor = i.owner) => (await detail(view, id, actor)).row;
const ledger = async (order = i.order, actor = i.owner) => ledgerSchema.parse((await f.asUser("select public.order_fulfilment_ledger($1) data", [order], actor))[0].data);
const line = (value, id) => value.lines.find(entry => entry.id === id);
const n = value => Number(value);
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function dispatch(id, status, departed = true) {
  await f.seed(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,number_of_bundles,total_weight_kg,delivery_status,actual_dispatched_at,last_status_changed_at)
    values($1,$2,$3,$4,current_date,1,0,$5,$6,now())`, [id, i.company, i.order, `DSP-${id.slice(-3)}`, status, departed ? new Date().toISOString() : null]);
}
async function packed(dispatchId, itemId, net, bundle) {
  const id = f.nextId();
  await f.seed(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,order_item_id,net_length_m)
    values($1,$2,$3,$4,$5,10,$6,2,$7,60)`, [id, i.company, dispatchId, i.profile, bundle, net + 2, itemId]);
  return id;
}
async function finishing(id, status, input, output, rejection, patch = {}) {
  await f.seed(`insert into finishing_jobs(id,company_id,order_id,production_job_id,finishing_type,vendor_id,status,input_weight_kg,output_weight_kg,rejection_weight_kg,sent_date,received_date,retry_of_finishing_job_id)
    values($1,$2,$3,$4,'anodizing',$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, i.company, i.order, patch.job ?? i.job1, i.vendor, status, input, output, rejection, patch.sent ?? null, patch.received ?? null, patch.retry ?? null]);
}

test("migration replay and every read model match the production contracts", async () => {
  assert.equal(f.applied, migrationFiles().length + 2);
  for (const view of ["ledger", "inheritance", "handoffs", "procurement", "wip", "custody", "authority", "contracts", "rollouts"]) controlListSchema.parse(await list(view));
  controlDetailSchema.parse(await detail("ledger", i.order));
});

test("NOV-005: ledger aggregates each source separately across lines, holds, departures, delivery and returns", async () => {
  await dispatch(i.dispatch1, "dispatched"); await dispatch(i.dispatch2, "delivered");
  const packing = await packed(i.dispatch1, i.line1, 300, "B1"); await packed(i.dispatch2, i.line1, 200, "B2"); await packed(i.dispatch1, null, 40, "LEGACY");
  await f.seed(`insert into connected_return_receipts(id,company_id,packing_list_item_id,dispatch_id,order_id,order_item_id,received_kg,received_pieces,received_metres,received_by,reason,status,source_snapshot,request_payload)
    values($1,$2,$3,$4,$5,$6,50,2,12,$7,'Damaged in transit','received','{}','{}')`, [f.nextId(), i.company, packing, i.dispatch1, i.order, i.line1, i.dispatch]);
  await f.seed(`insert into production_job_holds(id,company_id,production_job_id,reason,note,material_condition,resume_condition,responsible_user_id,responsible_name,previous_status,recorded_output_kg,issued_billet_count,issued_billet_kg,status,held_by,held_by_name)
    values($1,$2,$3,'die_problem','','Material on rack','Die corrected',$4,'Fixture productionManager','in_progress',120,4,200,'active',$4,'Fixture productionManager')`, [f.nextId(), i.company, i.job3, i.productionManager]);
  await f.seed(`insert into profile_stock_batches(id,company_id,profile_id,finish,length_m,quantity_pieces,total_weight_kg,status,origin_type,production_job_id,qc_status)
    values($1,$2,$3,'mill_finish',6,20,100,'available','production_surplus',$4,'on_hold')`, [f.nextId(), i.company, i.profile, i.job1]);
  const value = await ledger(), first = line(value, i.line1), second = line(value, i.line2);
  assert.equal(value.status, "on_hold");
  assert.deepEqual([first.packed_kg, first.departed_kg, first.delivered_kg, first.returned_kg, first.held_jobs, first.held_output_kg, first.qc_hold_kg], [500, 500, 200, 50, 1, 120, 100]);
  assert.equal(first.remaining_to_depart_kg, 500, "a return does not reduce departure or restore entitlement");
  assert.equal(first.open_returns, 1);
  assert.deepEqual([second.ordered_kg, second.departed_kg, second.remaining_to_depart_kg], [600, 0, 600]);
  assert.deepEqual([value.unlinked.packing_rows, value.unlinked.packing_kg, value.unlinked.jobs], [1, 40, 1]);
  assert.equal(value.departed_kg, 500, "legacy unlinked packing is not proportionally assigned to a line");
  assert.equal(Object.values(value.sources).every(state => state === "available"), true);
});

test("NOV-005: an unreadable source is reported unavailable, never as zero", async () => {
  await f.db.exec("alter table public.connected_return_receipts rename to connected_return_receipts_offline");
  const value = await ledger();
  assert.equal(value.status, "source_unavailable"); assert.equal(value.sources.returns, "unavailable");
  assert.equal(line(value, i.line1).returned_kg, null); assert.equal(line(value, i.line1).open_returns, null);
  assert.equal(line(value, i.line1).departed_kg, 0, "other sources still report");
});

test("NOV-005: over-departure is flagged, pagination is bounded and other tenants and dealers are denied", async () => {
  await dispatch(i.dispatch1, "in_transit"); await packed(i.dispatch1, i.line2, 650, "OVER");
  const value = await ledger();
  assert.equal(line(value, i.line2).over_departed, true); assert.equal(line(value, i.line2).remaining_to_depart_kg, 0);
  await dispatch(i.dispatch2, "pending", false); await packed(i.dispatch2, i.line1, 100, "WAITING");
  assert.equal(line(await ledger(), i.line1).packed_kg, 100); assert.equal(line(await ledger(), i.line1).departed_kg, 0);
  await assert.rejects(() => ledger(i.order, i.foreign), /unavailable/);
  await assert.rejects(() => ledger(i.foreignOrder, i.owner), /unavailable/);
  await assert.rejects(() => ledger(i.order, i.dealer), /not permitted/);
  await assert.rejects(() => detail("ledger", i.foreignOrder), /unavailable/);
  assert.equal((await list("ledger", i.foreign)).rows.some(entry => [i.order, i.order2].includes(entry.id)), false);
});

test("NOV-007: drift classifies unstarted, started and unlinked jobs; refresh copies only line facts", async () => {
  await f.asSystem("update order_items set drawing_revision='R2',packing_instruction='Wrap and edge-protect' where id in ($1,$2)", [i.line1, i.line2]);
  const rows = (await list("inheritance", i.owner, { state: "active" })).rows;
  assert.deepEqual(rows.map(entry => [entry.id, entry.status]), [[i.job2, "drifted"], [i.job1, "drift_locked"], [i.job3, "drift_locked"]].sort((a, b) => (a[1] === "drifted" ? -1 : b[1] === "drifted" ? 1 : a[0].localeCompare(b[0]))));
  const fields = (await row("inheritance", i.job2)).details.fields.map(entry => entry.field).sort();
  assert.deepEqual(fields, ["drawing_revision", "packing_instruction"]);
  confirmed(await f.apply({ action: "facts.refresh", job_id: i.job2, note }, i.productionManager));
  const job = (await f.db.query("select drawing_revision,packing_instruction,planned_quantity_kg::float8 kg,status from production_jobs where id=$1", [i.job2])).rows[0];
  assert.deepEqual(job, { drawing_revision: "R2", packing_instruction: "Wrap and edge-protect", kg: 600, status: "planned" });
  const record = await detail("inheritance", i.job2);
  assert.equal(record.row.status, "matches"); assert.equal(record.events[0].action, "facts.refresh");
  await assert.rejects(() => f.prepare({ action: "facts.refresh", job_id: i.job1, note }), /keep the facts they were made with/);
  await assert.rejects(() => f.prepare({ action: "facts.refresh", job_id: i.jobUnlinked, note }), /no available order line/);
  await assert.rejects(() => f.prepare({ action: "facts.refresh", job_id: i.job2, note }), /already matches/);
});

test("NOV-007: deliberate differences hold until the line changes again; stale reviews and roles are rejected", async () => {
  await f.asSystem("update order_items set drawing_revision='R2' where id=$1", [i.line1]);
  confirmed(await f.apply({ action: "facts.keep", job_id: i.job3, note }, i.factory));
  assert.equal((await row("inheritance", i.job3)).status, "overridden");
  await f.asSystem("update order_items set drawing_revision='R3' where id=$1", [i.line1]);
  assert.equal((await row("inheritance", i.job3)).status, "drift_locked");
  await f.asSystem("update order_items set cut_length=5800 where id=$1", [i.line2]);
  const stale = await f.prepare({ action: "facts.refresh", job_id: i.job2, note });
  await f.asSystem("update order_items set cut_length=5900 where id=$1", [i.line2]);
  rejected(await f.commit(stale), /source changed/);
  assert.equal(n((await f.db.query("select cut_length from production_jobs where id=$1", [i.job2])).rows[0].cut_length), 6000);
  await assert.rejects(() => f.prepare({ action: "facts.refresh", job_id: i.job2, note }, i.production), /Not permitted/);
  await assert.rejects(() => list("inheritance", i.accounts), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "facts.refresh", job_id: i.foreignJob, note }), /unavailable/);
});

async function finishingHandoff(status = "received", output = 300) {
  await finishing(i.finishing, status, 320, output, 0, { sent: day(-2), received: day(-1) });
  await f.asSystem("select private.handoff_for_finishing($1,$2)", [i.company, i.finishing]);
  return (await f.db.query("select id,status,handoff_quantity_kg::float8 qty from tasks where handoff_key=$1", [`finishing_receipt:${i.finishing}`])).rows[0];
}
const reviews = async task => (await f.db.query("select kind,outcome,status,previous_quantity_kg::float8 prev,current_quantity_kg::float8 cur from handoff_source_reconciliations where task_id=$1 order by created_at,id", [task])).rows;

test("NOV-015: unaccepted handoffs follow corrected quantities and are cancelled when the source is withdrawn", async () => {
  const task = await finishingHandoff();
  assert.equal(task.qty, 300);
  await f.asSystem("update finishing_jobs set output_weight_kg=280 where id=$1", [i.finishing]);
  assert.equal((await f.db.query("select handoff_quantity_kg::float8 q from tasks where id=$1", [task.id])).rows[0].q, 280);
  await f.asSystem("update finishing_jobs set status='rejected',output_weight_kg=0,rejection_weight_kg=320,remarks='Shade failed; whole lot rejected' where id=$1", [i.finishing]);
  assert.equal((await f.db.query("select status from tasks where id=$1", [task.id])).rows[0].status, "cancelled");
  assert.deepEqual((await reviews(task.id)).map(entry => [entry.kind, entry.outcome, entry.status]), [["quantity_changed", "quantity_updated", "resolved"], ["withdrawn", "cancelled_unaccepted", "resolved"]]);
});

test("NOV-015: accepted work keeps responsibility, blocks completion until the receiving team resolves the review", async () => {
  const task = await finishingHandoff();
  await f.asUser("select public.handoff_acceptance_command('acceptance.accept',$1)", [{ task_id: task.id, received_quantity_kg: 300, note: "Counted at QC bay" }], i.quality);
  await f.asSystem("update orders set current_stage='cancelled' where id=$1", [i.order]);
  let state = (await f.db.query("select status from tasks where id=$1", [task.id])).rows[0].status;
  assert.notEqual(state, "cancelled");
  const [review] = await reviews(task.id); assert.deepEqual([review.kind, review.outcome, review.status], ["withdrawn", "review_required", "open"]);
  await f.asSystem("select private.reconcile_handoff_task($1)", [task.id]);
  assert.equal((await reviews(task.id)).length, 1, "replay does not duplicate an open review");
  await assert.rejects(() => f.asSystem("update tasks set status='completed',completed_at=now() where id=$1", [task.id]), /Resolve the source review/);
  const id = (await f.db.query("select id from handoff_source_reconciliations where task_id=$1", [task.id])).rows[0].id;
  assert.equal((await list("handoffs", i.quality, { state: "active" })).rows[0].id, id);
  await assert.rejects(() => f.prepare({ action: "handoff.resolve", id, note }, i.dispatch), /Not permitted/);
  confirmed(await f.apply({ action: "handoff.resolve", id, note: "Material physically held at QC bay for return" }, i.quality));
  assert.equal((await row("handoffs", id)).status, "resolved");
  await f.asSystem("update tasks set status='completed',completed_at=now() where id=$1", [task.id]);
  state = (await f.db.query("select status from tasks where id=$1", [task.id])).rows[0].status; assert.equal(state, "completed");
  await assert.rejects(() => f.prepare({ action: "handoff.resolve", id, note }, i.quality), /already resolved/);
});

test("NOV-015: a corrected source quantity after acceptance opens one review instead of changing accepted work", async () => {
  const task = await finishingHandoff();
  await f.asUser("select public.handoff_acceptance_command('acceptance.accept',$1)", [{ task_id: task.id, received_quantity_kg: 300, note: "Counted at QC bay" }], i.quality);
  await f.asSystem("update finishing_jobs set output_weight_kg=290 where id=$1", [i.finishing]);
  await f.asSystem("update finishing_jobs set output_weight_kg=285 where id=$1", [i.finishing]);
  assert.equal((await f.db.query("select handoff_quantity_kg::float8 q from tasks where id=$1", [task.id])).rows[0].q, 300, "accepted quantity is not rewritten");
  assert.deepEqual((await reviews(task.id)).map(entry => [entry.kind, entry.outcome, entry.status, entry.prev, entry.cur]), [["quantity_changed", "review_required", "open", 300, 290]]);
  assert.match((await list("handoffs", i.quality, { state: "active" })).rows[0].summary, /Accepted quantity 300 kg; source now 290 kg/);
});

test("NOV-015: a reconciliation-cancelled handoff reopens when its source stands again; manual cancellation is preserved", async () => {
  const task = await finishingHandoff();
  await f.asSystem("update orders set current_stage='cancelled' where id=$1", [i.order]);
  assert.equal((await f.db.query("select status from tasks where id=$1", [task.id])).rows[0].status, "cancelled");
  await f.asSystem("update orders set current_stage='packing' where id=$1", [i.order]);
  const reopened = (await f.db.query("select t.status,t.assigned_to,a.state from tasks t join handoff_acceptances a on a.task_id=t.id where t.id=$1", [task.id])).rows[0];
  assert.deepEqual(reopened, { status: "open", assigned_to: null, state: "pending" });
  assert.deepEqual((await reviews(task.id)).map(entry => entry.outcome), ["cancelled_unaccepted", "reopened"]);
  await f.asSystem("update tasks set status='cancelled' where id=$1", [task.id]);
  await f.asSystem("update orders set current_stage='cancelled' where id=$1", [i.order]);
  await f.asSystem("update orders set current_stage='packing' where id=$1", [i.order]);
  assert.equal((await f.db.query("select status from tasks where id=$1", [task.id])).rows[0].status, "cancelled");
});

async function billetDemand() {
  await f.seed("delete from order_billet_requirements where company_id=$1", [i.company]);
  for (const [order, alloy, inch, short, weight] of [[i.order, "6063", 7, 10, 50], [i.order2, "6063", 7, 4, 50], [i.order, "6061", 8, 2, 60]]) {
    await f.seed(`insert into order_billet_requirements(id,company_id,order_id,profile_id,alloy,billet_diameter_inch,billet_length_mm,required_weight_kg,billet_weight_kg,extrusion_efficiency_percent,billets_required,billets_allocated,billets_short,status)
      values($1,$2,$3,$4,$5,$6,600,$7,$8,85,$9,0,$9,'shortage')`, [f.nextId(), i.company, order, i.profile, alloy, inch, short * weight, weight, short]);
  }
  await f.seed("update orders set expected_dispatch_date=null where id=$1", [i.order2]);
  for (const [diameter, status, kg] of [[177.8, "available", 150], [null, "available", 90], [177.8, "reserved", 500]]) {
    await f.seed(`insert into billet_batches(id,company_id,batch_number,alloy,temper,diameter_mm,total_weight_kg,available_weight_kg,received_date,status) values($1,$2,$3,'6063','T6',$4,$5,$5,current_date,$6)`,
      [f.nextId(), i.company, `BB-${f.nextId().slice(-4)}`, diameter, kg, status]);
  }
  const receipt = f.nextId();
  await f.seed("insert into purchase_receipts(id,company_id,purchase_order_id,receipt_date,idempotency_key,request_hash,created_by) values($1,$2,$3,current_date,$4,'x',$5)", [receipt, i.company, i.po, f.nextId(), i.owner]);
  await f.seed("insert into purchase_receipt_lines(id,company_id,receipt_id,purchase_order_id,purchase_order_line_id,received_quantity,accepted_quantity,rejected_quantity,held_quantity) values($1,$2,$3,$4,$5,500,500,0,0)", [f.nextId(), i.company, receipt, i.po, i.poLine]);
}

test("NOV-022: plan nets demand against free stock and confirmed open supply once, applying policy separately", async () => {
  await billetDemand();
  confirmed(await f.apply({ action: "supply.link", po_line_id: i.poLine, alloy: "6063", diameter_inch: 7, note }, i.inventory));
  confirmed(await f.apply({ action: "policy.set", alloy: "6063", diameter_inch: 7, lead_days: 5, min_order_kg: 1000, pack_kg: 250, safety_stock_kg: 100, note }, i.inventory));
  confirmed(await f.apply({ action: "plan.generate", note }, i.inventory));
  const rows = (await list("procurement", i.accounts)).rows;
  const main = rows.find(entry => entry.label.startsWith("6063")).details, other = rows.find(entry => entry.label.startsWith("6061")).details;
  assert.deepEqual([main.demand_kg, main.free_stock_kg, main.open_supply_kg, main.safety_stock_kg, main.net_shortage_kg, main.proposed_kg].map(n), [700, 150, 300, 100, 350, 1000]);
  assert.equal(main.demand.length, 2);
  assert.ok(main.warnings.some(text => /no dispatch date/.test(text))); assert.ok(main.warnings.some(text => /no recorded diameter/.test(text)));
  assert.equal(main.order_by, (await f.db.query("select (current_date+5)::text d")).rows[0].d);
  assert.deepEqual([n(other.proposed_kg), other.policy], [120, null]); assert.ok(other.warnings.some(text => /No approved purchasing policy/.test(text)));
});

test("NOV-022: units, duplicates, tentative supply, regeneration, review and stale plans are controlled", async () => {
  await billetDemand();
  await assert.rejects(() => f.prepare({ action: "supply.link", po_line_id: i.poLineMetres, alloy: "6063", diameter_inch: 7, note }, i.inventory), /measured in kg/);
  confirmed(await f.apply({ action: "supply.link", po_line_id: i.poLine, alloy: "6063", diameter_inch: 7, note }, i.inventory));
  await assert.rejects(() => f.prepare({ action: "supply.link", po_line_id: i.poLine, alloy: "6063", diameter_inch: 7, note }, i.inventory), /already linked/);
  const draft = f.nextId(), draftLine = f.nextId();
  await f.seed("insert into purchase_orders(id,company_id,vendor_id,vendor_name_snapshot,po_number,order_date,status,idempotency_key,request_hash,created_by,updated_by) values($1,$2,$3,'Billet supplier','PO-DRAFT',current_date,'draft',$4,'x',$5,$5)", [draft, i.company, i.vendor, f.nextId(), i.owner]);
  await f.seed("insert into purchase_order_lines(id,company_id,purchase_order_id,line_number,description,specification,unit,ordered_quantity,unit_rate,gst_percent) values($1,$2,$3,1,'6063 billet draft','6063','kg',400,200,18)", [draftLine, i.company, draft]);
  confirmed(await f.apply({ action: "supply.link", po_line_id: draftLine, alloy: "6063", diameter_inch: 7, note }, i.inventory));
  confirmed(await f.apply({ action: "plan.generate", note }, i.factory));
  let main = (await list("procurement")).rows.find(entry => entry.label.startsWith("6063"));
  assert.deepEqual([n(main.details.tentative_supply_kg), n(main.details.net_shortage_kg)], [400, 250]);
  confirmed(await f.apply({ action: "plan.review", id: main.id, decision: "accepted", note }, i.inventory));
  const other = (await list("procurement", i.owner, { status: "proposed" })).rows[0];
  const stale = await f.prepare({ action: "plan.generate", note }, i.inventory);
  await f.seed("update order_billet_requirements set billets_short=billets_short+1 where company_id=$1 and alloy='6061'", [i.company]);
  rejected(await f.commit(stale, i.inventory), /source changed/);
  confirmed(await f.apply({ action: "plan.generate", note }, i.inventory));
  assert.equal((await row("procurement", other.id)).status, "obsolete");
  assert.equal((await row("procurement", main.id)).status, "accepted");
  await assert.rejects(() => f.prepare({ action: "plan.review", id: other.id, decision: "accepted", note }, i.inventory), /current proposal/);
  await assert.rejects(() => f.prepare({ action: "plan.review", id: main.id, decision: "dismissed", note }, i.accounts), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "policy.set", alloy: "6063<", diameter_inch: 7, lead_days: 5, min_order_kg: 0, safety_stock_kg: 0, note }, i.inventory), /alloy/);
  await assert.rejects(() => f.prepare({ action: "policy.set", alloy: "6063", diameter_inch: 70, lead_days: 5, min_order_kg: 0, safety_stock_kg: 0, note }, i.inventory), /between/);
  await f.seed("update orders set current_stage='cancelled' where id in ($1,$2)", [i.order, i.order2]);
  confirmed(await f.apply({ action: "plan.generate", note }, i.inventory));
  assert.equal((await list("procurement", i.owner, { status: "proposed" })).total_count, 0);
});

test("NOV-028: WIP stage follows physical events, ages from stage entry and keeps location observation separate", async () => {
  let rows = (await list("wip")).rows;
  const byId = Object.fromEntries(rows.map(entry => [entry.id, entry]));
  assert.equal(byId[i.job1].status, "awaiting_qc"); assert.equal(byId[i.job3].status, "at_press");
  assert.ok(Math.abs(n(byId[i.job1].details.age_hours) - 30) < 0.2); assert.equal(byId[i.job1].details.location, null);
  assert.equal(rows.some(entry => entry.id === i.job2 || entry.id === i.foreignJob), false, "planned and foreign jobs are not WIP");
  await f.seed(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status) values($1,$2,$3,$4,now(),300,'approved')`, [i.inspection, i.company, i.job1, i.profile]);
  let job = await row("wip", i.job1); assert.equal(job.status, "awaiting_packing"); assert.equal(n(job.details.quantity_kg), 300);
  await f.seed(`insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,scheduled_date,pieces,profile_weight_kg,profile_length_m,status) values($1,$2,'PKG-1',$3,$4,current_date,50,300,300,'completed')`, [i.packaging, i.company, i.order, i.job1]);
  await assert.rejects(() => detail("wip", i.job1), /unavailable/);
  await finishing(i.finishing, "sent_to_vendor", 50, 0, 0, { job: i.jobUnlinked, sent: day(-2) });
  job = await row("wip", i.jobUnlinked); assert.deepEqual([job.status, job.details.vendor, n(job.details.quantity_kg)], ["at_vendor", "Shine Anodisers", 50]);
  await f.seed("update production_jobs set status='on_hold' where id=$1", [i.job3]);
  await f.seed(`insert into production_job_holds(id,company_id,production_job_id,reason,note,material_condition,resume_condition,responsible_user_id,responsible_name,previous_status,issued_billet_count,issued_billet_kg,status,held_by,held_by_name)
    values($1,$2,$3,'machine_breakdown','','Billets at press','Press repaired',$4,'Fixture productionManager','in_progress',2,90,'active',$4,'Fixture productionManager')`, [f.nextId(), i.company, i.job3, i.productionManager]);
  job = await row("wip", i.job3); assert.deepEqual([job.status, job.details.hold.reason, job.details.quantity_kg], ["on_hold", "machine_breakdown", null]);
  assert.match(job.summary, /quantity unknown/);
  confirmed(await f.apply({ action: "wip.observe", job_id: i.job3, location_id: i.location, quantity_kg: 85.5, note }, i.production));
  job = await row("wip", i.job3); assert.deepEqual([job.status, job.details.location, n(job.details.location_quantity_kg)], ["on_hold", "Bay 2 ageing rack", 85.5]);
  await assert.rejects(() => f.prepare({ action: "wip.observe", job_id: i.job3, location_id: i.foreignLocation, note }, i.production), /active factory location/);
  await assert.rejects(() => f.prepare({ action: "wip.observe", job_id: i.job2, location_id: i.location, note }, i.production), /Only started/);
  await assert.rejects(() => f.prepare({ action: "wip.observe", job_id: i.job3, location_id: i.location, quantity_kg: 0, note }, i.production), /between/);
  await assert.rejects(() => f.prepare({ action: "wip.observe", job_id: i.job3, location_id: i.location, note }, i.viewer), /Not permitted/);
  rows = (await list("wip", i.owner, { sort: "due" })).rows; assert.equal(rows[0].id, i.jobUnlinked, "oldest stage entry first");
});

test("NOV-031: vendor custody reconciles issue, receipts and explained differences without double counting", async () => {
  await f.seed("insert into factory_finishing_lead_times(id,company_id,finishing_type,lead_days,updated_by) values($1,$2,'anodizing',7,$3)", [f.nextId(), i.company, i.owner]);
  await finishing(i.finishing, "sent_to_vendor", 320, 0, 0, { sent: new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10) });
  await finishing(i.finishing2, "received", 320, 300, 10, { sent: day(-14), received: day(-6) });
  const over = f.nextId(); await finishing(over, "completed", 100, 98, 5, { sent: day(-14), received: day(-6) });
  const rows = (await list("custody", i.production, { state: "active" })).rows;
  assert.equal(rows[0].id, i.finishing, "overdue vendor custody comes first");
  assert.deepEqual(Object.fromEntries(rows.map(entry => [entry.id, entry.status])), { [i.finishing]: "at_vendor", [i.finishing2]: "unaccounted", [over]: "over_received" });
  assert.equal(n((await row("custody", i.finishing)).details.unaccounted_kg), 320);
  const explain = (patch, actor = i.inventory) => f.apply({ action: "custody.explain", job_id: i.finishing2, category: "process_loss", quantity_kg: 6, evidence: "Vendor weighment slip 4411", note, ...patch }, actor);
  confirmed(await explain());
  assert.equal(n((await row("custody", i.finishing2)).details.unaccounted_kg), 4);
  await assert.rejects(() => explain({ quantity_kg: 5 }), /Only 4 kg/);
  await assert.rejects(() => f.prepare({ action: "custody.explain", job_id: i.finishing, category: "process_loss", quantity_kg: 5, evidence: "Vendor phone call", note }, i.inventory), /after the vendor receipt/);
  confirmed(await f.apply({ action: "custody.explain", job_id: i.finishing, category: "returned_unprocessed", quantity_kg: 20, evidence: "Gate pass GP-77 returned", note }, i.inventory));
  assert.equal(n((await row("custody", i.finishing)).details.unaccounted_kg), 300);
  const entry = (await f.db.query("select id from finishing_custody_adjustments where finishing_job_id=$1", [i.finishing2])).rows[0].id;
  confirmed(await f.apply({ action: "custody.reverse", id: entry, note: "Slip belonged to another lot" }, i.factory));
  assert.equal(n((await row("custody", i.finishing2)).details.unaccounted_kg), 10);
  await assert.rejects(() => f.prepare({ action: "custody.reverse", id: entry, note }, i.factory), /already reversed/);
  await assert.rejects(() => f.prepare({ action: "custody.explain", job_id: i.finishing2, category: "process_loss", quantity_kg: 1, evidence: "Vendor slip", note }, i.production), /Not permitted/);
  await assert.rejects(() => list("custody", i.sales), /Not permitted/);
  const preview = await f.prepare({ action: "custody.explain", job_id: i.finishing2, category: "lost_claimed", quantity_kg: 2, evidence: "Claim raised CL-9", note }, i.inventory);
  confirmed(await f.commit(preview, i.inventory)); confirmed(await f.commit(preview, i.inventory));
  assert.equal((await f.db.query("select count(*)::int c from finishing_custody_adjustments where finishing_job_id=$1 and category='lost_claimed'", [i.finishing2])).rows[0].c, 1);
});

async function exceptionRequest(detail, type = "overdue_dispatch") {
  const id = f.nextId();
  await f.seed(`insert into exception_requests(id,company_id,exception_type,entity_type,entity_id,reference,fingerprint,detail,approved_weight_kg,reason,return_path,requested_by,requested_by_name,status)
    values($1,$2,$3,$4,$5,'SO-NOV4-01',$6,$7,$8,'Customer committed to clear dues this week',$9,$10,'Fixture dispatch','pending')`,
    [id, i.company, type, type === "overdue_dispatch" ? "order" : "quote", i.order, "a".repeat(32), detail, type === "overdue_dispatch" ? 500 : null, `/${type === "overdue_dispatch" ? "orders" : "quotes"}/${i.order}`, i.dispatch]);
  return id;
}
const approve = (id, actor) => f.asSystem("update exception_requests set status='approved',decided_by=$2,decided_by_name='Approver',decided_at=now(),expires_at=now()+interval '1 day' where id=$1", [id, actor]);

test("NOV-042: approval ceilings bind decisions to the revision in force on every write path", async () => {
  const id = await exceptionRequest({ overdue_amount: 150000 });
  // Each request is its own transaction in production; here now() is the test transaction's start.
  const now = new Date(Date.now() - 60000).toISOString();
  confirmed(await f.apply({ action: "authority.publish", decision_type: "overdue_dispatch", limits: { accounts: 100000, sales_manager: 200000 }, effective_from: now, note }, i.admin));
  await assert.rejects(() => approve(id, i.accounts), /above your approval limit \(150000 against your limit of 100000 under authority revision 1\)/);
  await approve(id, i.salesManager);
  const binding = (await f.db.query("select decided_role,exposure::float8 e,ceiling::float8 c,revision_id from decision_authority_bindings where request_id=$1", [id])).rows[0];
  assert.deepEqual([binding.decided_role, binding.e, binding.c], ["sales_manager", 150000, 200000]); assert.ok(binding.revision_id);
  const ownerDecided = await exceptionRequest({ overdue_amount: 900000 }); await approve(ownerDecided, i.owner);
  const missing = await exceptionRequest({}); await assert.rejects(() => approve(missing, i.accounts), /no recorded exposure/);
  const view = (await list("authority", i.accounts)).rows.find(entry => entry.details.decision_type === "overdue_dispatch");
  assert.deepEqual([view.status, view.details.your_ceiling, view.details.revision], ["limits_active", 100000, 1]);
});

test("NOV-042: owner limits, wrong roles, backdating, future revisions and unauthorised publishers are refused", async () => {
  const soon = new Date(Date.now() + 60000).toISOString();
  await assert.rejects(() => f.prepare({ action: "authority.publish", decision_type: "overdue_dispatch", limits: { owner: 1 }, effective_from: soon, note }, i.owner), /Owners are never limited/);
  await assert.rejects(() => f.prepare({ action: "authority.publish", decision_type: "low_margin_quote", limits: { accounts: 1 }, effective_from: soon, note }, i.owner), /cannot carry/);
  await assert.rejects(() => f.prepare({ action: "authority.publish", decision_type: "overdue_dispatch", limits: { accounts: 1.234 }, effective_from: soon, note }, i.owner), /two decimals/);
  await assert.rejects(() => f.prepare({ action: "authority.publish", decision_type: "overdue_dispatch", limits: {}, effective_from: "2026-01-01T00:00:00Z", note }, i.owner), /from now/);
  await assert.rejects(() => f.prepare({ action: "authority.publish", decision_type: "overdue_dispatch", limits: {}, effective_from: soon, note }, i.accounts), /Not permitted/);
  const future = new Date(Date.now() + 86400000).toISOString();
  const preview = confirmed(await f.apply({ action: "authority.publish", decision_type: "overdue_dispatch", limits: { accounts: 1 }, effective_from: future, note }, i.owner));
  assert.ok(preview);
  const id = await exceptionRequest({ overdue_amount: 5000 }); await approve(id, i.accounts);
  const view = (await list("authority")).rows.find(entry => entry.details.decision_type === "overdue_dispatch");
  assert.deepEqual([view.status, view.details.scheduled.revision], ["no_limits", 1]);
  assert.match((await f.prepare({ action: "authority.publish", decision_type: "low_margin_quote", limits: {}, effective_from: soon, note }, i.owner)).review.warnings[0], /not active/);
});

async function template(label = "Order is at extrusion planning", kind = "type:general") {
  await f.seed(`insert into completion_criteria_templates(id,company_id,task_kind,seq,kind,label,config,is_active,updated_by) values($1,$2,$3,1,'source_state',$4,'{"source_type":"order","states":["extrusion_planned","packing"]}',true,$5)`, [f.nextId(), i.company, kind, label, i.owner]);
}
const task = async (title, order = i.order) => (await f.asSystem(`insert into tasks(company_id,task_type,title,status,assigned_to,created_by,related_entity_type,related_entity_id) values($1,'general',$2,'open',$3,$4,'order',$5) returning id`, [i.company, title, i.production, i.owner, order]))[0].id;
const contractId = kind => f.db.query("select md5($1||':contract:'||$2)::uuid id", [i.company, kind]).then(result => result.rows[0].id);

test("NOV-051: published definitions of done bind new tasks and one source cannot complete two exclusive tasks", async () => {
  const before = await task("Before publication");
  await assert.rejects(() => f.prepare({ action: "contract.publish", task_kind: "type:general", exclusive_source: true, note }, i.factory), /at least one active completion criterion/);
  await template();
  assert.equal((await row("contracts", await contractId("type:general"))).status, "unpublished");
  confirmed(await f.apply({ action: "contract.publish", task_kind: "type:general", exclusive_source: true, note }, i.factory));
  const first = await task("Prepare die trial"), second = await task("Duplicate claim"), other = await task("Second order", i.order2);
  assert.equal((await f.db.query("select count(*)::int c from task_contract_bindings where task_id=any($1)", [[first, second, other]])).rows[0].c, 3);
  assert.equal((await f.db.query("select count(*)::int c from task_contract_bindings where task_id=$1", [before])).rows[0].c, 0);
  await f.asSystem("update tasks set status='completed',completed_at=now() where id=$1", [first]);
  await assert.rejects(() => f.asSystem("update tasks set status='completed',completed_at=now() where id=$1", [second]), /already completed another task of the same kind \("Prepare die trial"\)/);
  await f.asSystem("update tasks set status='completed',completed_at=now() where id=$1", [other]);
  await f.asSystem("update tasks set status='completed',completed_at=now() where id=$1", [before]);
  await assert.rejects(() => f.asSystem(`insert into tasks(company_id,task_type,title,status,assigned_to,created_by,related_entity_type,related_entity_id,completed_at) values($1,'general','Inserted complete','completed',$2,$3,'order',$4,now())`, [i.company, i.production, i.owner, i.order]), /already completed another task/);
});

test("NOV-051: changed criteria are visible until republished; older open tasks keep their revision and non-exclusive kinds allow reuse", async () => {
  await template();
  confirmed(await f.apply({ action: "contract.publish", task_kind: "type:general", exclusive_source: false, note }, i.owner));
  const old = await task("Open on revision 1");
  await f.seed("update completion_criteria_templates set label='Order at planning or packing' where company_id=$1", [i.company]);
  let view = await row("contracts", await contractId("type:general"));
  assert.equal(view.status, "templates_changed");
  confirmed(await f.apply({ action: "contract.publish", task_kind: "type:general", exclusive_source: false, note }, i.owner));
  view = await row("contracts", await contractId("type:general"));
  assert.deepEqual([view.status, view.details.revision, view.details.open_on_older], ["published", 2, 1]);
  const a = await task("Reuse A"), b = await task("Reuse B");
  await f.asSystem("update tasks set status='completed',completed_at=now() where id=any($1)", [[a, b, old]]);
  await assert.rejects(() => f.prepare({ action: "contract.publish", task_kind: "type:general", exclusive_source: true, note }, i.production), /Not permitted/);
  await assert.rejects(() => f.command("preview", { request_id: f.nextId(), mutation: { action: "contract.publish", task_kind: "general", exclusive_source: true, note } }), /kind of task/);
});

async function releasedVersions() {
  const steps = JSON.stringify([{ text: "Wrap each bundle in film" }]);
  for (const [id, no, status] of [[i.version1, 1, "released"], [i.version2, 2, "in_review"]]) {
    await f.seed(`insert into procedure_versions(id,company_id,procedure_id,version_no,status,steps,change_summary,content_hash,author_id,author_name,reviewer_id,reviewer_name,released_at,effective_from,in_flight_policy,submitted_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,'Fixture factory',$10,'Fixture owner',case when $5='released' then now() end,case when $5='released' then current_date end,case when $5='released' then 'keep_current' end,now())`,
      [id, i.company, i.procedure, no, status, steps, `Version ${no}: edge protection added`, String(no).repeat(32), i.factory, i.owner]);
  }
  await f.seed("insert into procedure_rollouts(version_id,company_id,procedure_id) values($1,$2,$3)", [i.version1, i.company, i.procedure]);
  await f.seed("update procedure_versions set status='released',released_at=now(),effective_from=current_date,in_flight_policy='keep_current' where id=$1", [i.version2]);
  await f.seed("insert into procedure_rollouts(version_id,company_id,procedure_id) values($1,$2,$3)", [i.version2, i.company, i.procedure]);
}
const bound = async (version, assignee = i.production) => {
  const id = (await f.asSystem("insert into tasks(company_id,task_type,title,status,assigned_to,created_by) values($1,'packing_check','Check wrapping','open',$2,$3) returning id", [i.company, assignee, i.owner]))[0].id;
  await f.seed("insert into task_procedure_bindings(task_id,company_id,procedure_id,version_id,bound_reason) values($1,$2,$3,$4,'task_created')", [id, i.company, i.procedure, version]);
  return id;
};

test("NOV-057: acknowledgement-required changes gate bound work for the assigned employee only", async () => {
  await releasedVersions();
  const current = await bound(i.version2), older = await bound(i.version1), unassigned = await bound(i.version2, null);
  await assert.rejects(() => f.prepare({ action: "rollout.classify", version_id: i.version1, change_class: "acknowledgement_required", note }, i.factory), /newer version/);
  confirmed(await f.apply({ action: "rollout.classify", version_id: i.version2, change_class: "acknowledgement_required", note }, i.factory));
  let view = await row("rollouts", i.version2);
  assert.deepEqual([view.status, view.details.affected_tasks, view.details.unassigned_tasks, view.details.older_version_work], ["awaiting_acknowledgement", 2, 1, 1]);
  await assert.rejects(() => f.asSystem("update tasks set status='in_progress' where id=$1", [current]), /must acknowledge the released version/);
  await f.asSystem("update tasks set status='in_progress' where id=$1", [older]);
  await assert.rejects(() => f.asSystem("update tasks set status='in_progress' where id=$1", [unassigned], i.production2), /must acknowledge/);
  confirmed(await f.apply({ action: "rollout.acknowledge", version_id: i.version2, note: "Read the edge protection change" }, i.production));
  await f.asSystem("update tasks set status='in_progress' where id=$1", [current]);
  view = await row("rollouts", i.version2);
  assert.deepEqual([view.status, view.details.employees.map(entry => entry.acknowledged)], ["acknowledged", [true]]);
  await assert.rejects(() => f.prepare({ action: "rollout.acknowledge", version_id: i.version2, note }, i.production), /already acknowledged/);
  await assert.rejects(() => f.prepare({ action: "rollout.acknowledge", version_id: i.version2, note }, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "rollout.classify", version_id: i.version2, change_class: "acknowledgement_required", note }, i.factory), /already uses/);
  await f.seed("update procedure_versions set status='withdrawn',withdrawn_at=now() where id=$1", [i.version2]);
  await assert.rejects(() => f.prepare({ action: "rollout.acknowledge", version_id: i.version2, note }, i.production2), /no longer released/);
});

test("NOV-057: releasing a version records an informational rollout through the existing procedure lifecycle", async () => {
  await releasedVersions();
  const draft = f.nextId();
  await f.seed(`insert into procedure_versions(id,company_id,procedure_id,version_no,status,steps,change_summary,content_hash,author_id,author_name,submitted_at)
    values($1,$2,$3,3,'in_review','[{"text":"Wrap and label"}]','Label added',$4,$5,'Fixture factory',now())`, [draft, i.company, i.procedure, "3".repeat(32), i.factory]);
  await f.asUser("select public.procedure_version_command('review.release',$1)", [{ version_id: draft, expected_hash: "3".repeat(32), effective_from: (await f.db.query("select current_date::text d")).rows[0].d, in_flight_policy: "keep_current", note: "" }], i.owner);
  assert.equal((await f.db.query("select change_class from procedure_rollouts where version_id=$1", [draft])).rows[0].change_class, "informational");
});

test("shared protocol: request identity, fingerprints, expiry, abandonment, outcomes and actor scope", async () => {
  const mutation = { action: "wip.observe", job_id: i.job3, location_id: i.location, note };
  const request_id = f.nextId(), preview = await f.prepare(mutation, i.production, request_id);
  assert.equal((await f.prepare(mutation, i.production, request_id)).fingerprint, preview.fingerprint);
  await assert.rejects(() => f.prepare({ ...mutation, note: "Different details here" }, i.production, request_id), /different details/);
  await assert.rejects(() => f.command("outcome", { request_id }, i.productionManager), /Not permitted/);
  await assert.rejects(() => f.command("commit", { request_id, fingerprint: "0".repeat(32) }, i.production), /does not match/);
  assert.equal((await f.command("outcome", { request_id: f.nextId() }, i.production)).state, "not_recorded");
  const abandoned = await f.prepare(mutation, i.production);
  assert.equal((await f.command("abandon", { request_id: abandoned.request_id }, i.production)).state, "abandoned");
  assert.equal((await f.commit(abandoned, i.production)).state, "abandoned");
  const expiring = await f.prepare(mutation, i.production);
  await f.db.query("update control_requests set expires_at=now()-interval '1 second' where request_id=$1", [expiring.request_id]);
  rejected(await f.commit(expiring, i.production), /expired/);
  confirmed(await f.commit(preview, i.production));
  assert.equal((await f.command("outcome", { request_id }, i.production)).state, "confirmed");
  await assert.rejects(() => f.command("preview", { request_id: f.nextId(), mutation: { ...mutation, company_id: i.foreignCompany } }, i.production), /required action details/);
  await assert.rejects(() => f.command("list", { view: "wip", company_id: i.foreignCompany }), /Invalid control request/);
  await assert.rejects(() => f.command("list", { view: "wip" }, i.dealer), /Not permitted/);
});

test("RLS: new tables are tenant- and role-scoped, history and direct writes are denied", async () => {
  confirmed(await f.apply({ action: "wip.observe", job_id: i.job3, location_id: i.location, note }, i.production));
  assert.equal((await f.asUser("select count(*)::int c from wip_location_observations", [], i.production))[0].c, 1);
  assert.equal((await f.asUser("select count(*)::int c from wip_location_observations", [], i.foreign))[0].c, 0);
  await assert.rejects(() => f.asUser("select count(*)::int c from control_events", [], i.owner), /permission denied/);
  assert.equal((await f.asUser("select count(*)::int c from control_requests", [], i.owner))[0].c, 0);
  assert.equal((await f.asUser("select count(*)::int c from control_requests", [], i.production))[0].c, 1);
  await assert.rejects(() => f.asUser("insert into wip_location_observations(company_id,production_job_id,location_id,note,observed_by) values($1,$2,$3,'direct write',$4)", [i.company, i.job3, i.location, i.production], i.production), /permission denied/);
  await assert.rejects(() => f.asUser("update finishing_custody_adjustments set quantity_kg=1", [], i.owner), /permission denied/);
  await assert.rejects(() => f.asUser("select private.control_order_ledger($1,$2)", [i.company, i.order], i.owner), /permission denied/);
  assert.equal((await f.asUser("select count(*)::int c from procurement_plan_lines", [], i.sales))[0].c, 0);
});
