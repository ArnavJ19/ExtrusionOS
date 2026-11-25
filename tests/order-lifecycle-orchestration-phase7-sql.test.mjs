import test from "node:test";
import assert from "node:assert/strict";
import { createDispatchFixture, dIds as i, istDay } from "../scripts/lib/autopilot-batch4-fixture.mjs";

// Order lifecycle orchestration Phase 7 (migration 20261126100000): shipment tracking, delivery receipts and
// discrepancies, customer acceptance, the complaint workflow with replacement and credit note, payment follow-up with
// disputes and write-offs under authority, and the closure states with the closure guard. Dispatches go through the
// real loading session and dispatch writer; synthetic data only.
let f;
const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const dt = (command, payload = {}, actor = i.dispatchUser) => f.call("delivery_tracking_command", command, payload, actor);
const cc = (command, payload = {}, actor = i.quality) => f.call("customer_complaint_command", command, payload, actor);
const rf = (command, payload = {}, actor = i.accounts) => f.call("receivable_followup_command", command, payload, actor);
const oc = (command, payload = {}, actor = i.owner) => f.call("order_closure_command", command, payload, actor);
const ap = (command, payload = {}, actor = i.dispatchUser) => f.call("ap_dispatch", command, payload, actor);
const engine = async () => {
  for (const fn of ["olo_evaluate_delivery_p7($1)", "olo_evaluate_complaints($1)", "olo_evaluate_payments($1)", "olo_evaluate_closure($1,null)", "olo_verify_tasks($1)"]) {
    await q(`select private.${fn}`, [i.company]);
  }
};
const tasks = (kind, source) => q("select status, workflow_department dept, workflow_cycle cycle, system_resolution, title, description, priority, workflow_key from tasks where workflow_kind=$1 and workflow_source_id=$2 order by workflow_cycle", [kind, source]);
const denied = e => e.code === "42501";
const state = async order => (await one("select private.olo_closure_state($1,$2) v", [i.company, order])).v;
const core = async order => (await one("select private.olo_order_core($1,$2,false,false) v", [i.company, order])).v;

test.before(async () => { f = await createDispatchFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
// The engine logs its own failures instead of blocking the business change, so each scenario also proves it logged none.
test.afterEach(async () => {
  const errors = await q("select source, message from olo_engine_errors");
  await f.rollback();
  assert.deepEqual(errors, [], "the orchestration engine logged no errors");
});

/** An order of `kg` with one completed, QC-approved and packaged job, and bundles (114 kg net each) recorded for `tags`. */
async function packed({ tags = [], kg = 570 } = {}) {
  const o = await f.order({ kg });
  const job = await f.readyJob({ order: o.order, line: o.line, kg, approvedKg: kg, packagedKg: kg });
  const bundles = {};
  for (const tag of tags) bundles[tag] = await f.bundle({ order: o.order, job, tag });
  return { ...o, job, bundles };
}
/** Loads the tagged bundles and sends them through the real dispatch writer (the dispatch leaves the gate). */
async function ship(order, tags, vehicle = "MH12AB1234") {
  const s = await ap("start", { order_id: order, vehicle_number: vehicle, transporter_id: i.transporter });
  for (const tag of tags) await ap("scan", { session_id: s.id, tag });
  const d = await f.writeDispatch(s.id);
  await ap("complete", { id: s.id, dispatch_id: d });
  return d;
}
/** Marks a dispatch delivered with its proof of delivery on file (the existing delivery transition). */
async function deliver(d) {
  const pod = `${i.company}/dispatches/${d}/proof-of-delivery/pod.jpg`;
  await f.seed("insert into technical_documents(company_id,document_type,linked_entity_type,linked_entity_id,file_name,file_url,storage_bucket,storage_path,approval_status,uploaded_by) values($1,'proof_of_delivery','dispatch',$2,'pod.jpg',$3,'documents',$3,'approved',$4)", [i.company, d, pod, i.owner]);
  await f.db.query("update dispatches set delivery_status='delivered', delivered_at=now(), proof_of_delivery_url=$2 where id=$1", [d, pod]);
}
const receipt = (d, extra = {}, actor = i.sales) => dt("receipt.record", { id: f.next(), dispatch_id: d, delivered_at: new Date().toISOString(),
  receiving_company: "Sharma Fabricators", receiver_name: "Mr Sharma", received_bundles: 2, received_kg: 228, acknowledgement: "signed_challan", ...extra }, actor);
const lines = d => q("select id, bundle_number from packing_list_items where dispatch_id=$1 order by bundle_number", [d]);
const invoice = async ({ order, dispatch = null, total = 11800, paid = 0, due = istDay(-1), number }) => {
  const id = f.next();
  await f.seed(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,supplier_state_code,igst_amount)
    values($1,$2,$3,$4,$5,$6,current_date-20,$7,'generated',$8,0,$8,$9,'27','07',0)`, [id, i.company, i.customer2, order, dispatch, number ?? `OMX/26-27/7${id.slice(-3)}`, due, total, paid]);
  return id;
};

test("shipment tracking: updates move the shipment through its states; sales records customer reports, dispatch changes the status", async () => {
  const a = await packed({ tags: ["P7-T1", "P7-T2"] });
  const d = await ship(a.order, ["P7-T1", "P7-T2"]);
  let g = await dt("get", { dispatch_id: d });
  assert.deepEqual([g.shipment.state, g.shipment.acceptance.outcome, g.manifest.bundles, Number(g.manifest.kg)], ["dispatched", "not_delivered", 2, 228],
    "leaving the gate does not confirm delivery");
  await assert.rejects(() => dt("tracking.record", { id: f.next(), dispatch_id: d, kind: "in_transit", source: "customer", note: "Customer says truck passed Nashik" }, i.sales),
    /dispatch records in-transit and delay updates/);
  await f.seed("update dispatches set remarks='Unload at gate 3; call Mr Sharma first' where id=$1", [d]);
  const u1 = f.next();
  g = await dt("tracking.record", { id: u1, dispatch_id: d, kind: "in_transit", source: "driver", location: "Nashik toll", note: "Driver called: crossed Nashik at 14:10" });
  assert.deepEqual([g.replayed, g.dispatch.delivery_status, g.shipment.state, g.tracking[0].status_changed_to], [false, "in_transit", "in_transit", "in_transit"]);
  assert.equal((await dt("tracking.record", { id: u1, dispatch_id: d, kind: "in_transit", source: "driver", note: "Driver called: crossed Nashik at 14:10" })).replayed, true, "a retry is not recorded twice");
  assert.equal((await one("select remarks from dispatches where id=$1", [d])).remarks, "Unload at gate 3; call Mr Sharma first", "the dispatch's own remarks are kept");
  const eta = new Date(Date.now() + 2 * 86400000).toISOString();
  g = await dt("tracking.record", { id: f.next(), dispatch_id: d, kind: "eta_revised", source: "transporter", revised_eta: eta, note: "VRL revised ETA after checkpost queue" }, i.sales);
  assert.equal(new Date(g.shipment.expected_at).toISOString(), eta, "a revised ETA becomes the expected delivery");
  await assert.rejects(() => dt("tracking.record", { id: f.next(), dispatch_id: d, kind: "delivery_attempted", source: "driver", revised_eta: eta, note: "Gate closed at site" }, i.sales),
    /revised delivery time is recorded with a delay or an ETA revision/);
  g = await dt("tracking.record", { id: f.next(), dispatch_id: d, kind: "delivery_attempted", source: "driver", location: "Chakan MIDC gate 3", note: "Site gate closed, customer asked to come tomorrow" }, i.sales);
  assert.equal(g.shipment.state, "delivery_attempted");
  const roles = (await q("select recipient_role r from notifications where notification_type='olo_delivery_delivery_attempted' and related_entity_id=$1", [d])).map(x => x.r).sort();
  assert.deepEqual(roles, ["dispatch", "dispatch_manager", "sales", "sales_manager"], "dispatch and sales are told about the failed attempt");
  g = await dt("tracking.record", { id: f.next(), dispatch_id: d, kind: "delivered_reported", source: "transporter", note: "Transporter reports unloaded at site" }, i.sales);
  assert.equal(g.shipment.state, "delivered_confirmation_pending", "a transporter's report waits for confirmation");
  await assert.rejects(() => receipt(d), /Mark it delivered with its proof of delivery on the dispatch first/);
  const board = await dt("board", { view: "open", search: a.order.slice(-4) === "" ? "" : (await one("select order_number n from orders where id=$1", [a.order])).n.toLowerCase() });
  assert.deepEqual([board.total, board.rows[0].dispatch_id, board.rows[0].state, board.counts.delivered_confirmation_pending], [1, d, "delivered_confirmation_pending", 1]);
  assert.equal((await one("select count(*)::int n from dispatch_status_history where dispatch_id=$1 and to_status='in_transit'", [d])).n, 1, "the status change is in the dispatch history");
  assert.ok((await one("select 1 x from olo_events where order_id=$1 and event_type='delivery.tracking'", [a.order])).x, "updates are on the order timeline");
  await assert.rejects(() => f.raw("update dispatch_tracking_updates set note='changed later on' where id=$1", [u1]), /change only through the delivery, complaint and receivable screens/);
});

test("delivery receipt: a clean receipt accepts every bundle and closes the follow-up; a correction supersedes it with a reason", async () => {
  const a = await packed({ tags: ["P7-R1", "P7-R2"] });
  const d = await ship(a.order, ["P7-R1", "P7-R2"]);
  await deliver(d);
  let g = await dt("get", { dispatch_id: d });
  assert.deepEqual([g.shipment.state, g.shipment.acceptance.outcome], ["delivered_confirmation_pending", "acceptance_pending"]);
  const [follow] = await tasks("delivery_followup", d);
  assert.equal(follow.status, "open");
  await assert.rejects(() => receipt(d, {}, i.viewer), denied);
  await assert.rejects(() => receipt(d, { received_bundles: 3 }), /Bundles received must be between 0 and 2/);
  const id = f.next();
  g = await dt("receipt.record", { id, dispatch_id: d, delivered_at: new Date().toISOString(), receiving_company: "Sharma Fabricators",
    receiver_name: "Mr Sharma", receiver_phone: "9820000002", received_bundles: 2, received_kg: 227.4, acknowledgement: "signed_challan", accept_all: true }, i.sales);
  assert.deepEqual([g.accepted_bundles, g.shipment.state, g.shipment.acceptance.outcome], [2, "pod_received", "accepted_in_full"], "0.6 kg weighbridge variance is no shortage");
  assert.equal((await tasks("delivery_followup", d))[0].status, "completed", "acceptance of every bundle closes the follow-up");
  assert.equal((await dt("receipt.record", { id, dispatch_id: d, delivered_at: new Date().toISOString(), receiving_company: "x", receiver_name: "y", received_bundles: 2, received_kg: 1, acknowledgement: "email" }, i.sales)).replayed, true);
  await assert.rejects(() => receipt(d), /already recorded for .*write why it is corrected/);
  g = await receipt(d, { correction_reason: "Receiver name was misspelt on the first entry", receiver_name: "Mr R. Sharma" });
  assert.deepEqual(g.receipts.map(r => r.status), ["current", "superseded"]);
  assert.equal(g.receipts[0].receiver_name, "Mr R. Sharma");
  const disp = await q("select disposition, receiver_name, evidence from delivery_dispositions where dispatch_id=$1", [d]);
  assert.equal(disp.length, 2);
  assert.match(disp[0].evidence, /^Delivery receipt .*: accepted in full by Mr Sharma \(Sharma Fabricators\), acknowledged by signed challan$/);
});

test("delivery discrepancy: a partial POD opens a sales task that closes only when the short bundle has a resolved disposition", async () => {
  const a = await packed({ tags: ["P7-D1", "P7-D2"] });
  const d = await ship(a.order, ["P7-D1", "P7-D2"]);
  await deliver(d);
  await assert.rejects(() => receipt(d, { received_bundles: 1, received_kg: 114, shortage_kg: 114, accept_all: true }), /record each affected bundle instead of accepting all/);
  await receipt(d, { received_bundles: 1, received_kg: 114, shortage_kg: 114 });
  const [t] = await tasks("delivery_discrepancy", d);
  assert.deepEqual([t.status, t.dept, t.priority], ["open", "sales", "high"]);
  assert.match(t.description, /records 1 received of 2 bundle\(s\): 114 kg short, 0 kg damaged, 114 kg in total/);
  assert.ok((await q("select 1 from notifications where condition_key=$1 and recipient_role='dispatch_manager'", [t.workflow_key])).length, "dispatch is told too");
  let g = await dt("get", { dispatch_id: d });
  assert.deepEqual([g.shipment.state, g.shipment.discrepancy.open, g.shipment.discrepancy.resolved], ["delivery_disputed", true, false]);
  const [l1, l2] = await lines(d);
  await f.asOwnerFor("insert into delivery_dispositions(company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by) values($1,$2,$3,'accepted',114,'Mr Sharma','Signed challan, bundle 1 received',$4,$4)", [i.company, d, l1.id, i.sales], i.sales);
  const sid = (await f.asOwnerFor("insert into delivery_dispositions(company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by) values($1,$2,$3,'short_claimed',114,'Mr Sharma','Bundle P7-D2 not on the truck at unloading',$4,$4) returning id", [i.company, d, l2.id, i.sales], i.sales))[0].id;
  g = await dt("get", { dispatch_id: d });
  assert.deepEqual([g.shipment.acceptance.outcome, (await tasks("delivery_discrepancy", d))[0].status], ["quantity_shortage", "open"], "an unresolved short claim keeps it open");
  await f.asOwnerFor("update delivery_dispositions set resolution='redelivery', resolution_note='Bundle found at transporter hub, redelivered', resolved_by=$2, resolved_at=now() where id=$1", [sid, i.salesManager], i.salesManager);
  const [done] = await tasks("delivery_discrepancy", d);
  assert.deepEqual([done.status, done.system_resolution], ["completed", "Verified: 114 kg recorded on the affected bundles with a resolution"]);
  g = await dt("get", { dispatch_id: d });
  assert.deepEqual([g.shipment.state, g.shipment.acceptance.outcome], ["pod_received", "accepted_partially"]);
});

test("complaint: logged formally, everyone told at once, NCR drafted; investigation, cause, resolution and credit note in order; a second person closes", async () => {
  const a = await packed({ tags: ["P7-C1", "P7-C2"] });
  const d = await ship(a.order, ["P7-C1", "P7-C2"]);
  await deliver(d);
  const [l1] = await lines(d);
  const id = f.next();
  let c = await cc("log", { id, order_id: a.order, dispatch_id: d, category: "surface_finish", severity: "high", description: "Pitting marks on visible face of sash profiles",
    customer_reference: "SF/QC/118", suspected_kg: 114, evidence: "Six site photos on WhatsApp group", items: [{ packing_list_item_id: l1.id, affected_kg: 100 }] }, i.sales);
  assert.match(c.complaint.complaint_number, /^CC-\d{4}-0001$/);
  assert.deepEqual([c.complaint.status, c.items.length, Number(c.items[0].affected_kg), c.complaint.ncr_status], ["open", 1, 100, "draft"]);
  assert.equal((await cc("log", { id, order_id: a.order, dispatch_id: d, category: "surface_finish", severity: "high", description: "Pitting marks on visible face of sash profiles",
    customer_reference: "SF/QC/118", suspected_kg: 114, evidence: "Six site photos on WhatsApp group", items: [{ packing_list_item_id: l1.id, affected_kg: 100 }] }, i.sales)).replayed, true);
  const board = await cc("board", {}, i.sales);
  assert.deepEqual([board.counts.open, board.groups.open[0].id, board.groups.investigating.length], [1, id, 0]);
  const listed = await cc("list", { view: "open", category: "surface_finish", severity: "high", sort: "severity", direction: "desc", search: "pitting" }, i.viewer);
  assert.deepEqual([listed.total, listed.rows[0].complaint_number, listed.can_log], [1, c.complaint.complaint_number, false]);
  const picks = await cc("candidates", { search: "sharma" }, i.sales);
  assert.ok(picks.orders.some(o => o.id === a.order), "dispatched orders are offered");
  const lines2 = await cc("candidates", { order_id: a.order }, i.sales);
  assert.deepEqual([lines2.dispatches.length, lines2.dispatches[0].lines.length], [1, 2]);
  const [inv] = await tasks("complaint_investigation", id);
  assert.deepEqual([inv.status, inv.dept, inv.priority], ["open", "quality", "urgent"]);
  const told = (await q("select distinct recipient_role r from notifications where condition_key=$1", [inv.workflow_key])).map(x => x.r).sort();
  for (const role of ["sales", "sales_manager", "quality", "production_manager", "factory_manager", "owner"]) assert.ok(told.includes(role), `${role} is told`);
  assert.equal((await dt("get", { dispatch_id: d })).shipment.acceptance.outcome, "customer_quality_complaint");
  await assert.rejects(() => cc("root_cause", { complaint_id: id, root_cause: "Die bearing wear", corrective_action: "Polish die bearing", responsible_department: "tool_room" }),
    /Record the containment decision first/);
  await assert.rejects(() => cc("investigate", { complaint_id: id, containment_action: "qc_containment", containment_note: "Hold the rest of the lot" }), /Choose the QC containment/);
  c = await cc("investigate", { complaint_id: id, containment_action: "stock_held", containment_note: "Remaining 3 bundles of the lot held in FG bay" });
  c = await cc("root_cause", { complaint_id: id, root_cause: "Die bearing wear on die D-2045-A after 40 billets", corrective_action: "Die polished and nitrided; bearing check every 20 billets",
    preventive_action: "Add bearing check to the die preparation checklist", responsible_department: "tool_room" });
  assert.equal(c.complaint.status, "action");
  assert.deepEqual((await tasks("complaint_investigation", id)).map(x => x.status), ["completed"]);
  assert.deepEqual((await tasks("complaint_resolution", id)).map(x => [x.status, x.dept]), [["open", "sales"]]);
  await assert.rejects(() => cc("resolve", { complaint_id: id, resolution: "credit_note", resolution_note: "Agreed 100 kg credit", replacement_kg: 10 }, i.salesManager), /go with a replacement resolution/);
  c = await cc("resolve", { complaint_id: id, resolution: "credit_note", resolution_note: "Customer accepts a credit note for 100 kg; told on call 25 Nov" }, i.salesManager);
  assert.deepEqual([c.complaint.status, c.can.close], ["resolved", false]);
  assert.deepEqual((await tasks("complaint_credit_note", id)).map(x => [x.status, x.dept]), [["open", "finance"]]);
  assert.deepEqual(await tasks("complaint_closure", id), [], "nothing to close while the credit note is missing");
  await assert.rejects(() => cc("close", { complaint_id: id, note: "Verified the die fix on next run" }, i.salesManager), denied);
  await assert.rejects(() => cc("close", { complaint_id: id, note: "Verified the die fix on next run" }), /credit note for the complaint is not issued and linked/);
  const invId = await invoice({ order: a.order, dispatch: d });
  const cn = f.next();
  await f.seed("insert into credit_notes(id,company_id,invoice_id,dispatch_id,credit_note_number,reason,subtotal,tax_total,grand_total,status,item_snapshot,idempotency_key) values($1,$2,$3,$4,'CN/26-27/0007','Surface defect claim',2000,0,2000,'issued','[]',$1)", [cn, i.company, invId, d]);
  await assert.rejects(() => cc("link_credit_note", { complaint_id: id, credit_note_id: cn }, i.quality), denied);
  c = await cc("link_credit_note", { complaint_id: id, credit_note_id: cn }, i.accounts);
  assert.equal(c.complaint.credit_note_number, "CN/26-27/0007");
  assert.deepEqual((await tasks("complaint_credit_note", id)).map(x => x.status), ["completed"]);
  await assert.rejects(() => cc("close", { complaint_id: id, note: "Verified the die fix on next run" }), /NCR .* is still draft; close or dismiss it first/);
  await f.seed("update quality_ncrs set status='closed', cause='Die bearing wear', action='Die polished', closed_by=$2, closed_at=now() where complaint_id=$1", [id, i.quality]);
  await engine();
  assert.deepEqual((await tasks("complaint_closure", id)).map(x => [x.status, x.dept]), [["open", "factory_management"]]);
  await cc("communicate", { complaint_id: id, channel: "phone", summary: "Told Mr Sharma the die was corrected and the credit note sent" }, i.sales);
  c = await cc("close", { complaint_id: id, note: "Next two runs inspected: no pitting; customer confirmed the credit note" }, i.factory);
  assert.equal(c.complaint.status, "closed");
  assert.deepEqual((await tasks("complaint_closure", id)).map(x => x.status), ["completed"]);
  assert.deepEqual(c.events.map(e => e.action).reverse(), ["logged", "investigated", "cause_recorded", "resolved", "credit_note_linked", "communicated", "closed"]);
  await assert.rejects(() => f.raw("update customer_complaints set severity='low' where id=$1", [id]), /change only through the complaint screen/);
  // The AP-053 path keeps working and gets a number and due time.
  const ap6 = await f.call("ap_ncr", "log_complaint", { request_id: f.next(), customer_id: i.customer2, order_id: a.order, description: "Wrong length cut on two bundles" }, i.sales);
  const legacy = await one("select complaint_number, status, category, severity, due_at is not null due from customer_complaints where id=$1", [ap6.complaint_id]);
  assert.deepEqual([legacy.complaint_number.endsWith("0002"), legacy.status, legacy.category, legacy.severity, legacy.due], [true, "open", "quality", "medium", true]);
  assert.deepEqual((await cc("get", { complaint_id: ap6.complaint_id })).events.map(e => e.action), ["logged"], "its history starts with the logging");
});

test("complaint replacement: a free replacement travels on its own dispatch of the same order, is never invoiced and is not counted as fulfilment", async () => {
  await f.call("olo_command", "settings.save", { invoice_due_hours: 0 }, i.owner);
  const a = await packed({ tags: ["P7-X1", "P7-X2", "P7-X3"] });
  const d1 = await ship(a.order, ["P7-X1", "P7-X2"]);
  await deliver(d1);
  const id = f.next();
  await cc("log", { id, order_id: a.order, dispatch_id: d1, category: "dimensional", severity: "medium", description: "Two bundles cut 40 mm short of drawing length" }, i.sales);
  await cc("investigate", { complaint_id: id, containment_action: "not_required", containment_note: "Customer stock only; no other lot affected" });
  await cc("root_cause", { complaint_id: id, root_cause: "Saw stop set to the old drawing revision", corrective_action: "Saw stop reset and locked to revision C", responsible_department: "production" });
  await assert.rejects(() => cc("resolve", { complaint_id: id, resolution: "replacement", resolution_note: "Replace one bundle", replacement_kg: 114 }, i.salesManager), /free of charge or chargeable/);
  let c = await cc("resolve", { complaint_id: id, resolution: "replacement", resolution_note: "Replace one bundle free of charge; agreed with purchase head", replacement_kg: 114,
    replacement_billing: "free_of_charge" }, i.salesManager);
  assert.deepEqual((await tasks("complaint_replacement", id)).map(x => [x.status, x.dept]), [["open", "production_planning"]]);
  assert.match((await tasks("complaint_replacement", id))[0].description, /not new order quantity and is never invoiced/);
  const d2 = await ship(a.order, ["P7-X3"], "MH12AB5555");
  const pickers = await cc("get", { complaint_id: id }, i.dispatchUser);
  assert.deepEqual(pickers.replacement_candidates.map(x => [x.id, Number(x.kg), x.invoiced]), [[d2, 114, false]], "the complained dispatch is not offered as its own replacement");
  await assert.rejects(() => cc("link_replacement", { complaint_id: id, id: f.next(), dispatch_id: d1 }, i.dispatchUser), /cannot be its own replacement/);
  await assert.rejects(() => cc("link_replacement", { complaint_id: id, id: f.next(), dispatch_id: d2, kg: 50 }, i.dispatchUser), /goes on its own dispatch: link the whole dispatch/);
  c = await cc("link_replacement", { complaint_id: id, id: f.next(), dispatch_id: d2 }, i.dispatchUser);
  assert.deepEqual([c.replacements.length, Number(c.complaint.replaced_kg)], [1, 114]);
  assert.deepEqual((await tasks("complaint_replacement", id)).map(x => x.status), ["completed"], "the replacement left on a linked dispatch");
  await f.immediate();
  await q("select private.olo_evaluate_shipment($1)", [i.company]);
  await q("select private.olo_verify_tasks($1)", [i.company]);
  assert.equal((await tasks("dispatch_invoice", d1))[0]?.status, "open", "the original dispatch is invoiced as usual");
  const d2tasks = await tasks("dispatch_invoice", d2);
  assert.ok(d2tasks.every(x => x.status === "cancelled" && /Withdrawn: the dispatch is the free-of-charge replacement for complaint CC-/.test(x.system_resolution)),
    "the invoice task raised at gate-out is withdrawn once the dispatch is the free replacement, and none is raised again");
  const r = (await one("select private.closure_readiness($1,$2,'operational') v", [i.company, a.order])).v;
  assert.deepEqual([Number(r.dispatched_kg), Number(r.replacement_kg)], [228, 114], "replacement material is not order fulfilment");
  const qty = r.items.find(x => x.key === `quantity:${a.order}`);
  assert.match(qty.detail, /342 kg of 570 kg has not left the factory \(114 kg of replacement material for complaints is not counted\)/);
  assert.ok(!r.items.some(x => x.key === `unbilled:${d2}`), "no unbilled item for the free replacement");
  assert.equal(Number((await core(a.order)).quantities.replacement_dispatched_kg), 114);
  // Billing the free replacement anyway is caught.
  await invoice({ order: a.order, dispatch: d2 });
  const r2 = (await one("select private.closure_readiness($1,$2,'operational') v", [i.company, a.order])).v;
  assert.ok(r2.items.some(x => x.key === `double_bill:${d2}` && x.blocking));
});

test("payment follow-up: a due invoice gives finance a task without amounts; the finance alert carries the amount; settlement closes both", async () => {
  const a = await packed({ tags: ["P7-P1", "P7-P2"] });
  const d = await ship(a.order, ["P7-P1", "P7-P2"]);
  await deliver(d);
  const inv = await invoice({ order: a.order, dispatch: d, total: 120000, due: istDay(-3), number: "OMX/26-27/0145" });
  const later = await invoice({ order: a.order, total: 5000, due: istDay(10) });
  await engine();
  const [t] = await tasks("payment_followup", inv);
  assert.deepEqual([t.status, t.dept, t.priority], ["open", "finance", "high"]);
  assert.match(t.description, /was due on .* \(3 day\(s\) overdue\)\. The material was delivered on /);
  assert.doesNotMatch(t.title + t.description, /₹|INR|120000|1,20,000/, "the task carries no amounts");
  assert.deepEqual(await tasks("payment_followup", later), [], "an invoice not yet due waits");
  const alert = await q("select recipient_role r, body from notifications where condition_key=$1 order by 1", [`olo-pay-amount:${t.workflow_key}`]);
  assert.deepEqual(alert.map(x => x.r), ["accounts", "admin", "owner"], "only finance roles get the amount");
  assert.match(alert[0].body, /invoice OMX\/26-27\/0145 has an outstanding balance of ₹1,20,000\.00, 3 day\(s\) overdue under the agreed payment terms/);
  await assert.rejects(() => rf("list", {}, i.sales), denied, "receivables are finance only");
  await assert.rejects(() => rf("list", {}, i.dispatchManager), denied);
  const list = await rf("list", { view: "overdue", search: "omx/26-27/0145" });
  assert.deepEqual([list.total, list.rows[0].invoice_id, Number(list.rows[0].collectible), list.rows[0].days_overdue], [1, inv, 120000, 3]);
  await f.call("olo_command", "settings.save", { payment_followup_lead_days: 10 }, i.owner);
  await engine();
  assert.equal((await tasks("payment_followup", later))[0].status, "open", "the lead days bring a reminder before the due date");
  await f.seed("update invoices set amount_paid=120000 where id=$1", [inv]);
  await f.db.query("update invoices set status='paid' where id=$1", [inv]);
  const [done] = await tasks("payment_followup", inv);
  assert.deepEqual([done.status, done.system_resolution], ["completed", "Verified: the invoice is settled"]);
  assert.equal((await one("select count(*)::int n from notifications where condition_key=$1 and resolved_at is null", [`olo-pay-amount:${t.workflow_key}`])).n, 0, "the amount alert is resolved");
});

test("disputes and write-offs: amounts within the balance, never approved by the proposer, the authority matrix when configured", async () => {
  const a = await packed({ tags: ["P7-W1", "P7-W2"] });
  const inv = await invoice({ order: a.order, total: 1000, due: istDay(-40) });
  await engine();
  assert.equal((await tasks("payment_followup", inv))[0].priority, "urgent", "more than 30 days overdue is urgent");
  await assert.rejects(() => rf("dispute.open", { id: f.next(), invoice_id: inv, amount: 1200, reason_category: "rate_difference", reason: "Customer pays the old rate only" }),
    /cannot exceed the collectible balance not already disputed \(₹1,000\.00\)/);
  const dispute = f.next();
  let g = await rf("dispute.open", { id: dispute, invoice_id: inv, amount: 300, reason_category: "rate_difference", reason: "Customer pays the old rate only", customer_reference: "DN-44" });
  assert.deepEqual([Number(g.collectible.disputed), Number(g.collectible.collectible)], [300, 1000], "a dispute does not reduce what is collectible");
  assert.equal((await rf("list", { view: "disputed" })).total, 1);
  const wo = f.next();
  g = await rf("write_off.propose", { id: wo, invoice_id: inv, amount: 50, reason_category: "rounding", reason: "Customer short-paid bank charges" });
  assert.ok((await q("select 1 from notifications where condition_key=$1 and recipient_role='owner'", [`olo-writeoff:${wo}`])).length, "the owner and admin are asked to decide");
  await assert.rejects(() => rf("write_off.decide", { id: wo, decision: "approve", note: "Approving my own write-off" }), /You proposed this write-off/);
  await assert.rejects(() => rf("write_off.decide", { id: wo, decision: "approve", note: "Bank charges only, approve" }, i.accounts2), /approved by the owner or an admin/);
  g = await rf("write_off.decide", { id: wo, decision: "approve", note: "Bank charges only, approve" }, i.admin);
  assert.deepEqual([g.exceptions.find(x => x.id === wo).status, Number(g.collectible.written_off), Number(g.collectible.collectible)], ["approved", 50, 950]);
  await assert.rejects(() => rf("dispute.resolve", { id: dispute, outcome: "credit_note", note: "Rate difference conceded" }), /Issue the credit note for the conceded amount first/);
  g = await rf("dispute.resolve", { id: dispute, outcome: "customer_to_pay", note: "Customer agreed to pay the new rate in full" });
  assert.equal(g.exceptions.find(x => x.id === dispute).status, "resolved");
  await f.seed("update invoices set amount_paid=950 where id=$1", [inv]);
  await f.db.query("update invoices set status='partially_paid' where id=$1", [inv]);
  assert.deepEqual((await tasks("payment_followup", inv)).map(x => [x.status, x.system_resolution]), [["completed", "Verified: settled (part written off under authority)"]]);

  // With a write-off rule configured: accounts may approve small amounts, a second approver (owner) from ₹40.
  const inv2 = await invoice({ order: a.order, total: 500, due: istDay(-5) });
  await f.seed("insert into authority_rules(company_id,transaction_type,min_amount,approver_roles,second_approver_from,second_approver_roles,reason,created_by,created_by_name) values($1,'write_off',0,'{accounts,admin}',40,'{owner}','Write-off policy FY27',$2,'Fixture owner')", [i.company, i.owner]);
  const wo2 = f.next();
  await rf("write_off.propose", { id: wo2, invoice_id: inv2, amount: 60, reason_category: "settlement_discount", reason: "Early settlement discount agreed by sales" });
  g = await rf("write_off.decide", { id: wo2, decision: "approve", note: "First approval within accounts limit" }, i.accounts2);
  const step1 = g.exceptions.find(x => x.id === wo2);
  assert.deepEqual([step1.status, step1.first_approved_by_name], ["proposed", "Fixture accounts2"], "the first approval does not complete it");
  await assert.rejects(() => rf("write_off.decide", { id: wo2, decision: "approve", note: "Approving twice myself" }, i.accounts2), /second, different person/);
  g = await rf("write_off.decide", { id: wo2, decision: "approve", note: "Second approval by the owner" }, i.owner);
  assert.equal(g.exceptions.find(x => x.id === wo2).status, "approved");
  assert.equal((await one("select count(*)::int n from authority_approvals where source_type='receivable_exception' and source_id=$1", [wo2])).n, 2);
  // Amounts stay with finance.
  assert.equal((await f.asUser("select count(*)::int n from receivable_exceptions", [], i.sales))[0].n, 0);
  assert.equal((await f.asUser("select count(*)::int n from receivable_exceptions", [], i.accounts))[0].n, 3);
});

test("closure: acceptance pending, operationally fulfilled, closed with finance open, settled, finally closed; the guard refuses open obligations", async () => {
  const a = await packed({ tags: ["P7-F1", "P7-F2"], kg: 228 });
  const d = await ship(a.order, ["P7-F1", "P7-F2"]);
  await deliver(d);
  const inv = await invoice({ order: a.order, dispatch: d, total: 25000, due: istDay(15) });
  await engine();
  let st = await state(a.order);
  assert.deepEqual([st.operational, st.overall, st.financial], ["acceptance_pending", "delivered_acceptance_pending", "open"]);
  assert.equal((await core(a.order)).next_action.link, `/dispatches/deliveries/${d}`, "sales records the customer acceptance next");
  await assert.rejects(() => f.asOwnerFor("insert into order_closures(id,company_id,order_id,kind,previous_stage,readiness,carried,closed_by,close_note) values($1,$2,$3,'operational','delivered','[]','[]',$4,'Closing early')",
    [f.next(), i.company, a.order, i.salesManager], i.salesManager), /still has 1 open obligation\(s\) for operational closure, starting with: Customer acceptance not recorded/);
  await receipt(d, { accept_all: true });
  // An open complaint blocks operational closure and withdraws the review task.
  await engine();
  assert.deepEqual((await tasks("closure_review", a.order)).map(x => [x.status, x.dept]), [["open", "sales"]]);
  st = await state(a.order);
  assert.deepEqual([st.operational, st.overall], ["fulfilled", "operationally_fulfilled"]);
  const comp = f.next();
  await cc("log", { id: comp, order_id: a.order, category: "commercial", severity: "low", description: "Customer disputes the freight charged on the invoice" }, i.sales);
  assert.deepEqual((await tasks("closure_review", a.order)).map(x => x.status), ["cancelled"], "an open complaint withdraws the closure review");
  assert.equal((await dt("get", { dispatch_id: d })).shipment.acceptance.outcome, "commercial_dispute", "an order-level complaint counts for its dispatches");
  assert.equal((await core(a.order)).next_action.link, `/quality/complaints/${comp}`);
  await cc("withdraw", { complaint_id: comp, note: "Customer accepted the freight terms on the PO" }, i.salesManager);
  await engine();
  assert.deepEqual((await tasks("closure_review", a.order)).map(x => [x.cycle, x.status]), [[1, "cancelled"], [2, "open"]]);
  const op = f.next();
  await f.asOwnerFor("insert into order_closures(id,company_id,order_id,kind,previous_stage,readiness,carried,closed_by,close_note) values($1,$2,$3,'operational','delivered','[]','[]',$4,'Delivered and accepted in full')",
    [op, i.company, a.order, i.salesManager], i.salesManager);
  await f.db.query("update orders set current_stage='closed' where id=$1", [a.order]);
  assert.deepEqual((await tasks("closure_review", a.order)).map(x => x.status), ["cancelled", "completed"]);
  st = await state(a.order);
  assert.deepEqual([st.operational, st.overall, st.financial, st.readiness_kind], ["closed", "operationally_closed_financially_open", "open", "final"]);
  await assert.rejects(() => oc("finalize", { order_id: a.order, note: "Closing the order finally" }, i.salesManager), /recorded by accounts, an admin or the owner/);
  await assert.rejects(() => oc("finalize", { order_id: a.order, note: "Closing the order finally" }, i.accounts), /starting with: Invoice .* has an outstanding balance/);
  const view = await oc("get", { order_id: a.order }, i.salesManager);
  assert.ok(view.final.items.filter(x => x.domain === "billing").every(x => x.detail === "Details are visible to finance."), "receivable amounts are hidden from sales");
  await f.seed("update invoices set amount_paid=25000 where id=$1", [inv]);
  await f.db.query("update invoices set status='paid' where id=$1", [inv]);
  await engine();
  st = await state(a.order);
  assert.deepEqual([st.overall, st.blocking], ["operationally_closed_financially_settled", 0]);
  assert.deepEqual((await tasks("final_closure", a.order)).map(x => [x.status, x.dept]), [["open", "finance"]]);
  const v = await oc("finalize", { order_id: a.order, note: "Paid in full, records complete" }, i.accounts);
  assert.deepEqual([v.state.overall, v.closure.kind, v.history.map(h => h.status).sort().join(",")], ["fully_closed", "final", "closed,superseded"]);
  assert.deepEqual((await tasks("final_closure", a.order)).map(x => x.status), ["completed"]);
  const told = (await q("select recipient_role r from notifications where notification_type='olo_order_fully_closed' and related_entity_id=$1", [a.order])).map(x => x.r).sort();
  assert.deepEqual(told, ["factory_manager", "owner", "sales_manager"], "management reviews the completion");
  assert.equal((await core(a.order)).overall, "fully_closed");
  const sorted = await oc("board", { view: "all", sort: "order_number", direction: "asc" }, i.salesManager);
  assert.ok(sorted.rows.some(r => r.order_id === a.order && r.group === "fully_closed"));
  assert.deepEqual(sorted.rows.map(r => r.order_number), [...sorted.rows.map(r => r.order_number)].sort(), "sorted by order number");
  await assert.rejects(() => oc("finalize", { order_id: a.order, note: "Closing the order again" }, i.accounts), /already fully closed/);
});

test("closure: final closure refuses carried complaints, missing receipts, open NCRs and disputes; replacement keeps the order open", async () => {
  const a = await packed({ tags: ["P7-G1", "P7-G2"], kg: 228 });
  const d = await ship(a.order, ["P7-G1", "P7-G2"]);
  await deliver(d);
  await f.seed("insert into delivery_dispositions(company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by) select $1,$2,id,'accepted',114,'Mr Sharma','Signed challan copy',$3,$3 from packing_list_items where dispatch_id=$2", [i.company, d, i.sales]);
  const inv = await invoice({ order: a.order, dispatch: d, total: 25000, paid: 25000, due: istDay(15) });
  const comp = f.next();
  await cc("log", { id: comp, order_id: a.order, dispatch_id: d, category: "quality", severity: "low", description: "One section slightly bent at the end" }, i.sales);
  let r = (await one("select private.closure_readiness($1,$2,'final') v", [i.company, a.order])).v;
  const keys = r.items.filter(x => x.blocking).map(x => x.key.split(":")[0]).sort();
  assert.deepEqual(keys, ["complaint", "ncr", "receipt"], "complaint, its NCR and the missing delivery receipt block final closure");
  assert.ok(r.items.some(x => x.key.startsWith("trace:") && !x.blocking), "a billet traceability gap is shown, not blocking");
  // Carry the complaint past operational closure (NOV closure review carry), then close operationally.
  await f.asOwnerFor("insert into order_closure_carries(company_id,order_id,item_key,reason,carried_by) values($1,$2,$3,'Customer agreed to settle at the next visit',$4)", [i.company, a.order, `complaint:${comp}`, i.salesManager], i.salesManager);
  r = (await one("select private.closure_readiness($1,$2,'operational') v", [i.company, a.order])).v;
  assert.equal(r.blocking, 0, "a carried complaint does not block operational closure");
  await f.asOwnerFor("insert into order_closures(id,company_id,order_id,kind,previous_stage,readiness,carried,closed_by,close_note) values($1,$2,$3,'operational','delivered','[]','[]',$4,'Closed with the complaint carried')",
    [f.next(), i.company, a.order, i.salesManager], i.salesManager);
  assert.equal((await state(a.order)).overall, "partially_closed_by_authorization");
  r = (await one("select private.closure_readiness($1,$2,'final') v", [i.company, a.order])).v;
  const carried = r.items.find(x => x.key === `complaint:${comp}`);
  assert.deepEqual([carried.carried, carried.blocking], [true, true], "final closure does not accept a carried complaint");
  await assert.rejects(() => rf("dispute.open", { id: f.next(), invoice_id: inv, amount: 1, reason_category: "other", reason: "Customer disputes a settled invoice" }), /cannot exceed/,
    "nothing can be disputed on a settled invoice");
  await assert.rejects(() => f.asOwnerFor("insert into order_closures(id,company_id,order_id,kind,previous_stage,readiness,carried,closed_by,close_note) values($1,$2,$3,'final','delivered','[]','[]',$4,'Straight to final')",
    [f.next(), i.company, a.order, i.accounts], i.accounts), /open obligation/, "the guard refuses a final closure row while obligations are open");
});

test("closure: a corrected receipt reporting a shortage after every bundle was accepted blocks closure until the bundle is resolved", async () => {
  const a = await packed({ tags: ["P7-K1", "P7-K2"], kg: 228 });
  const d = await ship(a.order, ["P7-K1", "P7-K2"]);
  await deliver(d);
  const view = await oc("get", { order_id: a.order }, i.owner);
  assert.equal(view.can_finalize, false, "no closure yet: can_finalize is false, never null");
  assert.equal((await oc("get", { order_id: a.order }, i.accounts)).can_finalize, false);
  await receipt(d, { accept_all: true });
  await receipt(d, { correction_reason: "Customer reported bundle P7-K2 missing after unloading", received_bundles: 1, received_kg: 114, shortage_kg: 114 });
  const g = await dt("get", { dispatch_id: d });
  assert.deepEqual([g.shipment.discrepancy.open, g.shipment.discrepancy.resolved], [true, false]);
  for (const kind of ["operational", "final"]) {
    const r = (await one(`select private.closure_readiness($1,$2,'${kind}') v`, [i.company, a.order])).v;
    const item = r.items.find(x => x.key === `discrepancy:${d}`);
    assert.ok(item, `${kind} readiness lists the unresolved receipt discrepancy`);
    assert.deepEqual([item.blocking, item.carriable, item.domain], [true, false, "acceptance"]);
  }
  await assert.rejects(() => f.asOwnerFor("insert into order_closures(id,company_id,order_id,kind,previous_stage,readiness,carried,closed_by,close_note) values($1,$2,$3,'final','delivered','[]','[]',$4,'Straight to final')",
    [f.next(), i.company, a.order, i.accounts], i.accounts), /open obligation\(s\) for final closure, starting with: .*/, "the guard refuses a final closure with an open shortage");
  // Reverse the accepted disposition of the missing bundle and record the short claim with its resolution.
  const [, l2] = await lines(d);
  await f.asOwnerFor("update delivery_dispositions set reversed_at=now(), reversed_by=$2, reverse_note='Corrected receipt: bundle not received' where packing_list_item_id=$1 and reversed_at is null", [l2.id, i.salesManager], i.salesManager);
  const sid = (await f.asOwnerFor("insert into delivery_dispositions(company_id,dispatch_id,packing_list_item_id,disposition,quantity_kg,receiver_name,evidence,owner_id,recorded_by) values($1,$2,$3,'short_claimed',114,'Mr Sharma','Bundle P7-K2 not received',$4,$4) returning id", [i.company, d, l2.id, i.sales], i.sales))[0].id;
  await f.asOwnerFor("update delivery_dispositions set resolution='redelivery', resolution_note='Redelivered from the transporter hub', resolved_by=$2, resolved_at=now() where id=$1", [sid, i.salesManager], i.salesManager);
  const r = (await one("select private.closure_readiness($1,$2,'final') v", [i.company, a.order])).v;
  assert.equal(r.items.some(x => x.key === `discrepancy:${d}`), false, "a resolved disposition clears the discrepancy blocker");
});

test("security: Phase 7 records are read through the commands; tables refuse direct writes; dealers and other companies see nothing", async () => {
  const a = await packed({ tags: ["P7-S1"] });
  const d = await ship(a.order, ["P7-S1"]);
  await assert.rejects(() => f.asUser("insert into delivery_receipts(id,company_id,dispatch_id,order_id,delivered_at,receiving_company,receiver_name,dispatched_bundles,dispatched_kg,received_bundles,received_kg,acknowledgement,recorded_by) values($1,$2,$3,$4,now(),'X Co','Mr X',1,114,1,114,'email',$5)",
    [f.next(), i.company, d, a.order, i.owner], i.owner), /permission denied/);
  await assert.rejects(() => f.asUser("insert into customer_complaint_events(company_id,complaint_id,action) values($1,$2,'logged')", [i.company, f.next()], i.owner), /permission denied/);
  await assert.rejects(() => dt("get", { dispatch_id: d }, i.dealer), denied);
  const foreignList = await cc("list", {}, i.foreign).catch(() => null);
  assert.ok(!foreignList || foreignList.total === 0, "another company sees no complaints");
  await assert.rejects(() => oc("finalize", { order_id: a.order, note: "Not my company at all" }, i.foreign), e => e.code === "42501" || /not available/.test(e.message));
  await assert.rejects(() => dt("board", { view: "nope" }), /Invalid delivery view/);
  await assert.rejects(() => cc("log", { id: f.next(), order_id: a.order, category: "quality", severity: "low", description: "Bad\u0007defect text here" }, i.sales), /control characters/);
});
