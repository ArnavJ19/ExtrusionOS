import test from "node:test";
import assert from "node:assert/strict";
import { createDispatchFixture, dIds as i } from "../scripts/lib/autopilot-batch4-fixture.mjs";

// Order lifecycle orchestration Phase 6 (migration 20261125100000): packaging release by route, the bundle register and
// trace, finished-goods transfers with second-person receipt, the loading guards and the invoice of a dispatch that
// left. Bundles, loading and dispatches go through the real commands and writer. Synthetic data only.
let f;
const LOC = "0e600000-0000-4000-8000-000000000001";
const LOC2 = "0e600000-0000-4000-8000-000000000002";
const T4 = "0e600000-0000-4000-8000-000000000003";   // naturally aged profile: first-stage QC releases it to packaging
const SPEC = "0e600000-0000-4000-8000-000000000004";

const q = async (sql, p = []) => (await f.db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const pf = (command, payload = {}, actor = i.dispatchUser) => f.call("packaging_flow_command", command, payload, actor);
const olo = (command, payload = {}, actor = i.owner) => f.call("olo_command", command, payload, actor);
const dispatch = (command, payload = {}, actor = i.dispatchUser) => f.call("ap_dispatch", command, payload, actor);
const engine = async () => { await q("select private.olo_evaluate_shipment($1)", [i.company]); await q("select private.olo_verify_tasks($1)", [i.company]); };
const tasks = (kind, source) => q("select status, workflow_department dept, workflow_cycle cycle, system_resolution, title, description from tasks where workflow_kind=$1 and workflow_source_id=$2 order by workflow_cycle", [kind, source]);
const reg = id => one("select state, location_name, transfer_number, dispatch_number, invoice_number from private.olo_bundle_register where id=$1", [id]);
const denied = e => e.code === "42501";

test.before(async () => {
  f = await createDispatchFixture();
  await f.db.exec("begin");
  await f.seed("insert into inventory_locations(id,company_id,location_code,location_name,location_type) values($1,$3,'FG-1','Dispatch bay 1','factory'),($2,$3,'FG-2','Dispatch bay 2','warehouse')", [LOC, LOC2, i.company]);
  await f.seed("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper,hsn_code) values($1,$2,'OM-6010','Mullion T4',0.95,'6063','T4','7604')", [T4, i.company]);
  await f.seed(`insert into customer_packing_specs(id,company_id,customer_id,revision,status,max_bundle_kg,max_pieces,wrapping,interleaving_paper,battens_per_bundle,material_ids,notes,reason,set_by)
    values($1,$2,$3,2,'active',800,120,'stretch_film',true,4,'{}','Label on both ends','Customer drawing note 14',$4)`, [SPEC, i.company, i.customer2, i.owner]);
  await f.db.exec("commit");
});
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
// The engine logs its own failures instead of blocking the business change, so each scenario also proves it logged none.
test.afterEach(async () => {
  const errors = await q("select source, message from olo_engine_errors");
  await f.rollback();
  assert.deepEqual(errors, [], "the orchestration engine logged no errors");
});

/** An order with a completed job, optionally QC-approved and packaged (seeded), and `tags` bundles recorded through the bundle command. */
async function packed({ tags = [], profile = i.profile2, approvedKg, packagedKg = 0, kg = 570 } = {}) {
  const o = await f.order({});
  const job = await f.readyJob({ order: o.order, line: o.line, kg, profile, approvedKg: approvedKg ?? kg, packagedKg });
  const bundles = {};
  for (const tag of tags) bundles[tag] = await f.bundle({ order: o.order, job, tag });
  return { ...o, job, bundles };
}
/** A first-stage QC decision written by QA (production triggers on). */
async function inspect(job, profile, kg) {
  const id = f.next();
  await f.asUser(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,batch_number,inspector_name,surface_finish_ok,weight_per_meter_actual)
    values($1,$2,$3,$4,now(),$5,'approved','LOT-P6','QA day shift',true,0.95)`, [id, i.company, job, profile, kg], i.quality);
  return id;
}
const send = (bundleIds, actor = i.production, location = LOC, id = f.next()) => pf("fg.send", { id, location_id: location, bundle_ids: bundleIds }, actor);

test("packaging release: an ageing route is released to packaging by the final QC, with the packing specification; other routes by their QC", async () => {
  const aged = await packed({ approvedKg: 0 });
  const ins = await inspect(aged.job, i.profile2, 500);
  assert.equal((await one("select count(*)::int n from tasks where handoff_key=$1", [`inspection_release:${ins}`])).n, 0,
    "first-stage QC of a T5 job does not tell packaging to pack");
  let rel = await pf("release.get", { job_id: aged.job });
  assert.deepEqual([rel.release.basis, Number(rel.release.release_kg), Number(rel.release.to_pack_kg)], ["final_qc", 0, 0], "nothing is released before final QC");
  const rec = f.next();
  await q(`insert into final_qc_records(id,company_id,record_number,production_job_id,order_id,profile_id,accepted_kg,rejected_kg,results,method,sampling_reference,awaiting_before_kg,recorded_by,recorded_by_role)
    values($1,$2,'FQC-P6-1',$3,$4,$5,400,0,'{"hardness_webster":12,"samples_tested":3}','Webster hardness','QP-07 rev 2',500,$6,'quality')`, [rec, i.company, aged.job, aged.order, i.profile2, i.quality]);
  assert.equal((await one("select count(*)::int n from tasks where handoff_key=$1", [`final_qc_release:${rec}`])).n, 0, "raised at commit, after any reversal in the same transaction");
  await f.immediate();
  const h = await one("select handoff_team, handoff_quantity_kg kg, handoff_source_type src, handoff_source_id sid, title, description from tasks where handoff_key=$1", [`final_qc_release:${rec}`]);
  assert.deepEqual([h.handoff_team, Number(h.kg), h.src, h.sid], ["packaging", 400, "quality_inspection", ins], "sourced from the approval it releases, so the acceptance checks apply");
  assert.match(h.title, /^Pack 400\.000 kg released by final QC/);
  assert.match(h.description, /customer specification rev 2\): stretch film; max 800 kg per bundle; max 120 pieces per bundle; interleaving paper; 4 battens per bundle\. Label on both ends/);
  await f.bundle({ order: aged.order, job: aged.job, tag: "P6-AG1" });
  rel = await pf("release.get", { job_id: aged.job });
  assert.deepEqual([Number(rel.release.release_kg), Number(rel.release.packed_kg), Number(rel.release.to_pack_kg)], [400, 114, 286]);
  assert.match(rel.spec_text, /stretch film/);
  assert.equal(rel.bundles[0].bundle_number, "P6-AG1");
  assert.equal(rel.handoffs.length, 1, "the job shows its packaging handoff");
  const queue = await pf("release.queue", { view: "to_pack", search: rel.job.job_number.toLowerCase() });
  assert.deepEqual([queue.total, queue.rows[0].job_id, Number(queue.rows[0].to_pack_kg), queue.rows[0].basis], [1, aged.job, 286, "final_qc"]);

  const plain = await packed({ approvedKg: 0, profile: T4 });
  const ins2 = await inspect(plain.job, T4, 300);
  assert.equal((await one("select handoff_team from tasks where handoff_key=$1", [`inspection_release:${ins2}`])).handoff_team, "packaging", "a T4 job keeps its QC handoff");
  rel = await pf("release.get", { job_id: plain.job });
  assert.deepEqual([rel.release.basis, Number(rel.release.to_pack_kg)], ["first_qc", 300]);
  const lc = (await one("select private.olo_order_core($1,$2,false,false) v", [i.company, plain.order])).v;
  assert.equal(lc.next_action.link, `/packaging/release/${plain.job}`);
  assert.equal(Number(lc.quantities.to_pack_kg), 300);
  assert.equal(lc.domains.find(d => d.key === "shipment").status, "to_pack");
});

test("finished-goods transfer: packaging sends, another person scans each tag in, the receipt task closes itself", async () => {
  const a = await packed({ tags: ["P6-T1", "P6-T2"] });
  const id = f.next();
  const t = await send([a.bundles["P6-T1"], a.bundles["P6-T2"]], i.production, LOC, id);
  assert.deepEqual([t.status, t.bundle_count, Number(t.net_kg), t.remaining, t.replayed], ["in_transit", 2, 228, 2, false]);
  assert.match(t.transfer_number, /^FGT-\d{4}-0001$/);
  assert.equal((await send([a.bundles["P6-T1"], a.bundles["P6-T2"]], i.production, LOC, id)).replayed, true, "the same request is not recorded twice");
  await assert.rejects(() => send([a.bundles["P6-T2"], a.bundles["P6-T1"], a.bundles["P6-T1"]]), /appears twice/);
  await assert.rejects(() => send([a.bundles["P6-T1"]]), /P6-T1: already on transfer FGT-/);
  assert.equal((await reg(a.bundles["P6-T1"])).state, "in_transfer");
  assert.deepEqual((await tasks("fg_receipt", id)).map(x => [x.status, x.dept]), [["open", "dispatch"]]);
  await assert.rejects(() => f.raw("update tasks set status='completed' where workflow_kind='fg_receipt' and workflow_source_id=$1", [id]), /closes when every bundle of the transfer is scanned in/);
  await assert.rejects(() => pf("fg.receive", { transfer_id: id, tag: "P6-T1" }, i.production), denied, "the production sender is not a receiver");

  await assert.rejects(() => pf("fg.receive", { transfer_id: id, tag: "NO-SUCH-TAG" }), /Unknown bundle tag NO-SUCH-TAG/);
  const r1 = await pf("fg.receive", { transfer_id: id, tag: "p6-t1" });
  assert.deepEqual([r1.state, r1.remaining], ["received", 1]);
  assert.equal((await pf("fg.receive", { transfer_id: id, tag: "P6-T1" })).state, "already_received");
  const r2 = await pf("fg.receive", { transfer_id: id, tag: `EO2:dispatch_package:${a.bundles["P6-T2"]}:n1` });
  assert.deepEqual([r2.remaining, r2.transfer.status], [0, "received"], "an EO2 label resolves to the bundle");
  assert.deepEqual([(await tasks("fg_receipt", id))[0].status, (await tasks("fg_receipt", id))[0].system_resolution], ["completed", "Verified: every bundle of the transfer was scanned in"]);
  assert.deepEqual(await reg(a.bundles["P6-T1"]), { state: "in_fg", location_name: "Dispatch bay 1", transfer_number: t.transfer_number, dispatch_number: null, invoice_number: null });
  assert.equal((await one("select count(*)::int n from olo_events where order_id=$1 and event_type in ('packaging.fg_transfer_sent','packaging.fg_received')", [a.order])).n, 2);
  await assert.rejects(() => send([a.bundles["P6-T1"]], i.production, LOC2), /already in Dispatch bay 1/, "a bundle already in finished goods is not sent again");
  await assert.rejects(() => f.raw("update fg_transfers set status='in_transit', closed_at=null where id=$1", [id]), /change only through the transfer screen/);
});

test("finished-goods transfer: the sender cannot receive; closing short records the missing bundles and alerts factory management", async () => {
  const a = await packed({ tags: ["P6-S1", "P6-S2", "P6-S3"] });
  const t = await send(Object.values(a.bundles), i.dispatchManager);
  await assert.rejects(() => pf("fg.receive", { transfer_id: t.id, tag: "P6-S1" }, i.dispatchManager), /another person must receive/);
  await assert.rejects(() => pf("fg.close", { transfer_id: t.id, note: "Two bundles not found at the bay" }), /No bundle of this transfer was received/);
  await pf("fg.receive", { transfer_id: t.id, tag: "P6-S1" });
  await assert.rejects(() => pf("fg.cancel", { transfer_id: t.id, note: "Sent to the wrong bay by mistake" }, i.dispatchManager), /already received; close it/);
  await assert.rejects(() => pf("fg.close", { transfer_id: t.id, note: "short" }), /at least 10 characters/);
  const closed = await pf("fg.close", { transfer_id: t.id, note: "Two bundles not found at the bay after the shift" });
  assert.deepEqual([closed.status, closed.received, closed.missing], ["closed_short", 1, 2]);
  const n = await one("select severity, body from notifications where condition_key=$1 limit 1", [`olo-fg-missing:${t.id}`]);
  assert.equal(n.severity, "critical");
  assert.match(n.body, /2 bundle\(s\) sent to Dispatch bay 1 .* P6-S2, P6-S3/);
  assert.match((await tasks("fg_receipt", t.id))[0].system_resolution, /closed with 2 bundle\(s\) missing/);
  assert.equal((await reg(a.bundles["P6-S2"])).state, "packed", "a missing bundle can be found and sent again");
  const again = await send([a.bundles["P6-S2"]]);
  assert.equal(again.status, "in_transit");
});

test("finished-goods transfer: cancel before any receipt withdraws the receipt task; refused bundles are named", async () => {
  const a = await packed({ tags: ["P6-C1"] });
  const t = await send([a.bundles["P6-C1"]]);
  await assert.rejects(() => pf("fg.cancel", { transfer_id: t.id, note: "Sent to the wrong bay by mistake" }, i.quality), denied, "QA cannot cancel a packaging transfer");
  const c = await pf("fg.cancel", { transfer_id: t.id, note: "Sent to the wrong bay by mistake" }, i.production);
  assert.equal(c.status, "cancelled");
  assert.deepEqual((await tasks("fg_receipt", t.id)).map(x => x.status), ["cancelled"]);
  assert.equal((await reg(a.bundles["P6-C1"])).state, "packed");
  await assert.rejects(() => pf("fg.receive", { transfer_id: t.id, tag: "P6-C1" }), /already cancelled/);
  await assert.rejects(() => send([a.bundles["P6-C1"]], i.viewer), denied, "a viewer cannot send");
  await assert.rejects(() => send([a.bundles["P6-C1"]], i.production, f.next()), /Choose an active factory or warehouse location/);
  await assert.rejects(() => send([f.next()]), /not a packed bundle of this company/);
  await f.seed(`insert into quality_containments(id,company_id,containment_number,production_job_id,order_id,stage,defect,defect_kind,inspection_mode,scope_kg,status,opened_by)
    values($1,$2,'QCH/P6/0001',$3,$4,'final','Hardness below specification on sample 2','non_destructive','full_inspection',100,'open',$5)`, [f.next(), i.company, a.job, a.order, i.quality]);
  await assert.rejects(() => send([a.bundles["P6-C1"]]), /P6-C1: held in QC containment QCH\/P6\/0001/);
});

test("loading: a bundle on an open transfer is refused; with the receipt control on only received bundles load", async () => {
  const a = await packed({ tags: ["P6-L1", "P6-L2"], packagedKg: 570 });
  const t = await send([a.bundles["P6-L1"]]);
  const s = await dispatch("start", { order_id: a.order, vehicle_number: "MH12AB1234", transporter_id: i.transporter });
  await assert.rejects(() => dispatch("scan", { session_id: s.id, tag: "P6-L1" }), /Bundle P6-L1 is on finished-goods transfer FGT-.* to Dispatch bay 1/);
  assert.equal((await dispatch("scan", { session_id: s.id, tag: "P6-L2" })).state, "loaded", "with the control off a packed bundle still loads");
  await olo("settings.save", { enforce_fg_receipt: true });
  const other = await packed({ tags: ["P6-L3"], packagedKg: 570 });
  const s2 = await dispatch("start", { order_id: other.order, vehicle_number: "MH12AB9999", transporter_id: i.transporter });
  await assert.rejects(() => dispatch("scan", { session_id: s2.id, tag: "P6-L3" }), /P6-L3 has not been received in the finished-goods area/);
  await pf("fg.receive", { transfer_id: t.id, tag: "P6-L1" });
  assert.equal((await dispatch("scan", { session_id: s.id, tag: "P6-L1" })).state, "loaded", "received in finished goods, it loads");
  assert.equal((await reg(a.bundles["P6-L1"])).state, "loaded");
});

test("transfer reminder: packed bundles left outside finished goods give packaging a task once the factory uses transfers", async () => {
  await olo("settings.save", { fg_transfer_hours: 1 });
  const a = await packed({ tags: ["P6-R1", "P6-R2"] });
  await f.seed("update prepared_physical_bundles set recorded_at=now()-interval '3 hours' where id = any($1)", [Object.values(a.bundles)]);
  await engine();
  assert.equal((await tasks("fg_transfer", a.order)).length, 0, "no reminders before the factory has used a transfer");
  const b = await packed({ tags: ["P6-R3"] });
  await send([b.bundles["P6-R3"]]);
  await engine();
  const [task] = await tasks("fg_transfer", a.order);
  assert.deepEqual([task.status, task.dept], ["open", "packaging"]);
  assert.match(task.description, /2 packed bundle\(s\), 228 kg net, .* P6-R1, P6-R2/);
  await send(Object.values(a.bundles));
  assert.deepEqual((await tasks("fg_transfer", a.order)).map(x => x.status), ["completed"], "sending them closes the reminder");
});

test("invoicing link: a dispatch that left without an issued invoice gives finance one task; the issued invoice closes it", async () => {
  await olo("settings.save", { invoice_due_hours: 0 });
  const a = await packed({ tags: ["P6-I1", "P6-I2"], packagedKg: 570 });
  const s = await dispatch("start", { order_id: a.order, vehicle_number: "MH12AB1234", transporter_id: i.transporter });
  for (const tag of ["P6-I1", "P6-I2"]) await dispatch("scan", { session_id: s.id, tag });
  const d = await f.writeDispatch(s.id);
  await engine();
  const [task] = await tasks("dispatch_invoice", d);
  assert.deepEqual([task.status, task.dept, task.cycle], ["open", "finance", 1]);
  assert.match(task.description, /left the gate at .* on vehicle MH12AB1234 with 2 bundle\(s\), 228 kg net, and no tax invoice is issued/);
  assert.doesNotMatch(task.description, /₹|INR/, "the task carries no amounts");
  assert.equal((await reg(a.bundles["P6-I1"])).state, "dispatched");
  let lc = (await one("select private.olo_order_core($1,$2,false,false) v", [i.company, a.order])).v;
  assert.equal(lc.domains.find(x => x.key === "shipment").status, "awaiting_invoice");
  assert.equal(Number(lc.quantities.dispatches_not_invoiced), 1);
  let tr = await pf("bundle.trace", { tag: "P6-I1" }, i.quality);
  assert.deepEqual([tr.found, tr.bundle.state, tr.dispatch.vehicle_number, tr.invoice], [true, "dispatched", "MH12AB1234", null]);
  assert.ok(tr.gaps.includes("No tax invoice is issued yet for the dispatch of this bundle."));
  assert.ok(tr.gaps.some(g => /No billet issue is recorded for job/.test(g)), "an unlinked metal source is listed, not guessed");
  assert.equal(tr.loading[0].vehicle_number, "MH12AB1234");

  const inv = f.next();
  await f.seed(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,supplier_state_code,igst_amount)
    values($1,$2,$3,$4,$5,'OMX/26-27/0601',current_date,'generated',1000,180,1180,0,'27','07',180)`, [inv, i.company, i.customer2, a.order, d]);
  await engine();
  const [done] = await tasks("dispatch_invoice", d);
  assert.deepEqual([done.status, done.system_resolution], ["completed", "Verified: invoice OMX/26-27/0601 issued for the dispatch"]);
  tr = await pf("bundle.trace", { bundle_id: a.bundles["P6-I2"] });
  assert.equal(tr.invoice.invoice_number, "OMX/26-27/0601");
  assert.equal((await reg(a.bundles["P6-I2"])).invoice_number, "OMX/26-27/0601");
  lc = (await one("select private.olo_order_core($1,$2,false,false) v", [i.company, a.order])).v;
  assert.deepEqual([lc.domains.find(x => x.key === "shipment").status, Number(lc.quantities.invoiced_kg)], ["invoiced", 228]);

  await f.seed("update invoices set status='cancelled' where id=$1", [inv]);
  await engine();
  const cycles = await tasks("dispatch_invoice", d);
  assert.deepEqual(cycles.map(x => [x.cycle, x.status]), [[1, "completed"], [2, "open"]], "a cancelled invoice opens a new cycle");
  assert.match(cycles[1].description, /earlier invoice of this dispatch was cancelled|draft/);
});

test("bundle trace and register: lookups by tag or label, search and filters, and who may read them", async () => {
  const a = await packed({ tags: ["P6-X1", "P6-X2"] });
  const t = await send([a.bundles["P6-X1"]]);
  const tr = await pf("bundle.trace", { tag: "p6-x1" }, i.viewer);
  assert.deepEqual([tr.bundle.bundle_number, tr.bundle.state, tr.order.order_number, tr.job.job_number, tr.custody[0].transfer_number], ["P6-X1", "in_transfer", tr.order.order_number, tr.job.job_number, t.transfer_number]);
  assert.equal(tr.qc[0].status, "approved");
  assert.equal(tr.route.state, "required", "OM-2045 is T5");
  assert.ok(tr.gaps.some(g => /no final QC after ageing is recorded/.test(g)));
  const res = await pf("bundle.resolve", { tag: `EO2:bundle:${a.bundles["P6-X2"]}:n` });
  assert.deepEqual([res.found, res.bundle_number, res.state, Number(res.net_kg)], [true, "P6-X2", "packed", 114]);
  assert.equal((await pf("bundle.resolve", { tag: "P6-NONE" })).found, false);
  assert.equal((await pf("bundle.trace", { bundle_id: a.bundles["P6-X1"] }, i.foreign)).found, false, "another company never sees the bundle");
  await assert.rejects(() => pf("bundle.trace", { tag: "P6-X1" }, i.dealer), denied);

  const list = await pf("bundles.list", { state: "in_transfer", search: "p6-x" });
  assert.deepEqual([list.total, list.rows[0].bundle_number, list.rows[0].transfer_number], [1, "P6-X1", t.transfer_number]);
  const all = await pf("bundles.list", { search: "p6-x", sort: "bundle_number", direction: "desc" });
  assert.deepEqual(all.rows.map(r => r.bundle_number), ["P6-X2", "P6-X1"]);
  await assert.rejects(() => pf("bundles.list", { state: "lost" }), /Invalid bundle view/);
  const open = await pf("fg.list", { view: "open", search: "p6-x1" });
  assert.deepEqual([open.total, open.rows[0].transfer_number], [1, t.transfer_number]);
  assert.equal((await pf("fg.list", { view: "done" })).total, 0);
  const cands = await pf("fg.candidates", { order_id: a.order });
  assert.deepEqual(cands.rows.map(r => r.bundle_number), ["P6-X2"], "only packed bundles not yet sent are offered");
  const detail = await pf("fg.get", { transfer_id: t.id }, i.production);
  assert.deepEqual([detail.can_receive, detail.can_cancel, detail.lines.length], [false, true, 1]);
  assert.equal((await pf("fg.get", { transfer_id: t.id })).can_receive, true);
  assert.equal((await pf("fg.locations", {}, i.production)).rows.length, 2);
});

test("settings: the Phase 6 settings save with their limits and leave earlier settings to their own saves", async () => {
  await assert.rejects(() => olo("settings.save", { fg_transfer_hours: 0 }), /1 to 168 hours/);
  await assert.rejects(() => olo("settings.save", { invoice_due_hours: 200 }), /0 to 168 hours/);
  await assert.rejects(() => olo("settings.save", { enforce_fg_receipt: "yes" }), /on or off/);
  await assert.rejects(() => olo("settings.save", { fg_transfer_hours: 4 }, i.dispatchUser), denied);
  const s = await olo("settings.save", { fg_transfer_hours: 12, invoice_due_hours: 2, enforce_fg_receipt: true, ageing_overdue_grace_minutes: 90, ack_sla_hours: 6 });
  assert.deepEqual([s.fg_transfer_hours, s.invoice_due_hours, s.enforce_fg_receipt, s.ageing_overdue_grace_minutes, s.ack_sla_hours], [12, 2, true, 90, 6]);
  const got = await olo("settings.get");
  assert.equal(got.settings.fg_transfer_hours, 12);
});

test("packaging release: the final-QC handoff names the approval that still stands after a reversal in the same transaction", async () => {
  const aged = await packed({ approvedKg: 0 });
  const first = await inspect(aged.job, i.profile2, 500);
  const rec = f.next(), kept = f.next();
  await q(`insert into final_qc_records(id,company_id,record_number,production_job_id,order_id,profile_id,accepted_kg,rejected_kg,results,method,sampling_reference,awaiting_before_kg,recorded_by,recorded_by_role,rejection_reason)
    values($1,$2,'FQC-P6-2',$3,$4,$5,300,200,'{"hardness_webster":7,"samples_tested":3}','Webster hardness','QP-07 rev 2',500,$6,'quality','Hardness 7 HW on bundles 9 and 10')`, [rec, i.company, aged.job, aged.order, i.profile2, i.quality]);
  // What the Phase 4 reversal leaves for a partial rejection: the original reversed and an approved child for the part kept.
  await f.seed("update quality_inspections set status='reversed' where id=$1", [first]);
  await f.seed(`insert into quality_inspections(id,company_id,production_job_id,profile_id,inspection_date,quantity_checked_kg,status,batch_number)
    values($1,$2,$3,$4,now(),300,'approved','LOT-P6-KEPT')`, [kept, i.company, aged.job, i.profile2]);
  await f.immediate();
  const h = await one("select handoff_source_id sid, handoff_quantity_kg kg from tasks where handoff_key=$1", [`final_qc_release:${rec}`]);
  assert.deepEqual([h.sid, Number(h.kg)], [kept, 300]);
});

test("packaging release: a QC reversal still withdraws the packing handoff of a route without ageing", async () => {
  const plain = await packed({ approvedKg: 0, profile: T4 });
  const ins = await inspect(plain.job, T4, 300);
  assert.equal((await one("select status from tasks where handoff_key=$1", [`inspection_release:${ins}`])).status, "open", "the T4 approval releases to packaging");
  const r = await f.call("quality_reversal_command", "reverse", { inspection_id: ins, reversed_kg: 300, reversed_as: "rejected", method: "Webster hardness re-test",
    reason: "Customer complaint: hardness below 12 HW on site" }, i.quality);
  assert.ok(r.id);
  assert.equal((await one("select status from tasks where handoff_key=$1", [`inspection_release:${ins}`])).status, "cancelled", "the packing handoff is withdrawn");
  const rel = await pf("release.get", { job_id: plain.job });
  assert.deepEqual([rel.release.basis, Number(rel.release.release_kg), Number(rel.release.to_pack_kg)], ["first_qc", 0, 0], "nothing stays released for packing");
});
