import test from "node:test";
import assert from "node:assert/strict";
import { createDispatchFixture, dIds as i, nid, istDay, GSTIN } from "../scripts/lib/autopilot-batch4-fixture.mjs";

let f;
test.before(async () => { f = await createDispatchFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const n = value => (value === null || value === undefined ? value : Number(value));
const count = async (sql, params = []) => Number((await f.one(sql, params)).c);
const dispatch = (command, payload = {}, actor = i.dispatchUser) => f.call("ap_dispatch", command, payload, actor);
const freight = (command, payload = {}, actor = i.dispatchManager) => f.call("ap_freight", command, payload, actor);
const eway = (command, payload = {}, actor = i.accounts) => f.call("ap_eway", command, payload, actor);
const tally = (command, payload = {}, actor = i.accounts) => f.call("ap_tally", command, payload, actor);
const share = (command, payload = {}, actor = i.sales) => f.call("ap_share", command, payload, actor);
const decide = (id, decision, extra = {}, actor = i.dispatchManager) => f.call("ap_proposals", "decide", { id, decision, ...extra }, actor);

/** Order with one line (100 pcs of 6 m at 0.95 kg/m), a ready job of 570 kg and bundles recorded against it. */
async function readyOrder({ tags = ["B4-A1", "B4-A2"], pieces = 20, customer = i.customer2, approvedKg = 570, packagedKg = 570, gross = 120, tare = 6 } = {}) {
  const o = await f.order({ customer });
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570, approvedKg, packagedKg });
  const bundles = [];
  for (const tag of tags) bundles.push(await f.bundle({ order: o.order, job, tag, pieces, gross, tare }));
  return { ...o, job, bundles };
}

test("AP-018 a scanned bundle loads once, refusals are recorded, and the session shows planned vs loaded per line", async () => {
  const o = await readyOrder();
  const s = await dispatch("start", { order_id: o.order, vehicle_number: "mh 12 ab 1234", transporter_id: i.transporter, driver_phone: "+91 98200 12345" });
  assert.equal(s.vehicle_number, "MH12AB1234");
  assert.equal(s.transporter_name, "VRL Logistics");
  assert.equal(s.driver_phone, "9820012345");
  const again = await dispatch("start", { order_id: o.order });
  assert.equal(again.id, s.id, "one open session per order");
  const first = await dispatch("scan", { session_id: s.id, tag: "b4-a1" });
  assert.equal(first.state, "loaded", "tags match case-insensitively");
  const line = first.session.plan.lines[0];
  assert.equal(line.ordered_pieces, 100);
  assert.equal(line.loaded_pieces, 20);
  assert.equal(n(line.loaded_kg), 114);
  assert.equal(line.open_pieces, 80);
  const dup = await dispatch("scan", { session_id: s.id, tag: "B4-A1" });
  assert.equal(dup.state, "already_loaded", "scanning the same bundle twice does not load it twice");
  const unknown = await dispatch("scan", { session_id: s.id, tag: "NO-SUCH-TAG" });
  assert.equal(unknown.state, "refused");
  assert.deepEqual(unknown.warnings, ["unknown"]);
  assert.equal(await count("select count(*) c from loading_scans where session_id=$1 and outcome='loaded' and removed_at is null", [s.id]), 1);
  assert.equal(await count("select count(*) c from loading_scans where session_id=$1 and outcome='refused'", [s.id]), 1, "refusals are kept for the warning audit");
  await assert.rejects(() => dispatch("scan", { session_id: s.id, tag: "B4-A2" }, i.sales), err => err.code === "42501", "sales cannot load a vehicle");
});

test("AP-018 another customer's bundle, another order's bundle and a QC-held bundle are refused", async () => {
  const mine = await readyOrder({ tags: ["B4-M1"] });
  const theirs = await readyOrder({ tags: ["B4-T1"], customer: i.customer });
  const sameCustomer = await readyOrder({ tags: ["B4-S1"] });
  const held = await readyOrder({ tags: ["B4-H1"], approvedKg: 0 });
  const s = await dispatch("start", { order_id: mine.order });
  const other = await dispatch("scan", { session_id: s.id, tag: "B4-T1" });
  assert.deepEqual(other.warnings, ["other_customer"]);
  assert.match(other.message, /Do not load/);
  const otherOrder = await dispatch("scan", { session_id: s.id, tag: "B4-S1" });
  assert.deepEqual(otherOrder.warnings, ["other_order"]);
  const s2 = await dispatch("start", { order_id: held.order });
  const h = await dispatch("scan", { session_id: s2.id, tag: "B4-H1" });
  assert.equal(h.state, "refused");
  assert.deepEqual(h.warnings, ["held"]);
  assert.match(h.message, /QC has not released/);
  assert.equal(await count("select count(*) c from loading_scans where bundle_id=$1 and outcome='loaded'", [held.bundles[0]]), 0, "a held bundle is never loaded");
  void theirs; void sameCustomer;
});

test("AP-018 a bundle loaded on one vehicle cannot be loaded on another, and released quantity limits a source", async () => {
  // 570 kg released; three bundles of 228 kg net: the third exceeds what QC released and packaging packed.
  const o = await readyOrder({ tags: ["B4-L1", "B4-L2", "B4-L3"], pieces: 40, gross: 234, tare: 6 });
  const s = await dispatch("start", { order_id: o.order, vehicle_number: "DL01AB1111" });
  assert.equal((await dispatch("scan", { session_id: s.id, tag: "B4-L1" })).state, "loaded");
  assert.equal((await dispatch("scan", { session_id: s.id, tag: "B4-L2" })).state, "loaded");
  const third = await dispatch("scan", { session_id: s.id, tag: "B4-L3" });
  assert.deepEqual(third.warnings, ["held"], "the third bundle would exceed the released 570 kg");
  // A second session for the same order cannot exist; cancel and start again frees the bundles.
  await assert.rejects(() => dispatch("cancel", { id: s.id, reason: "no" }), /5 to 300/);
  await dispatch("cancel", { id: s.id, reason: "Truck broke down at the gate" });
  const s2 = await dispatch("start", { order_id: o.order, vehicle_number: "DL01AB2222" });
  assert.notEqual(s2.id, s.id);
  assert.equal((await dispatch("scan", { session_id: s2.id, tag: "B4-L1" })).state, "loaded", "a cancelled session releases its bundles");
  // Simulate a parallel loader: the same bundle loaded in another (fresh) session is refused by the active-bundle index.
  await assert.rejects(() => f.raw("insert into loading_scans(company_id,session_id,bundle_id,raw_tag,outcome,message,scanned_by) values($1,$2,$3,'B4-L1','loaded','x',$4)",
    [i.company, s2.id, o.bundles[0], i.dispatchUser]), /duplicate key/);
});

test("AP-018 more than ordered needs a confirmed note; removing a bundle needs a reason", async () => {
  const o = await f.order({ pieces: 30 });
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570 });
  await f.bundle({ order: o.order, job, tag: "B4-O1", pieces: 20 });
  await f.bundle({ order: o.order, job, tag: "B4-O2", pieces: 20 });
  const s = await dispatch("start", { order_id: o.order });
  await dispatch("scan", { session_id: s.id, tag: "B4-O1" });
  const over = await dispatch("scan", { session_id: s.id, tag: "B4-O2" });
  assert.equal(over.state, "confirm");
  assert.deepEqual(over.warnings, ["over_plan"]);
  await assert.rejects(() => dispatch("scan", { session_id: s.id, tag: "B4-O2", confirm: true }), /Write why/);
  const ok = await dispatch("scan", { session_id: s.id, tag: "B4-O2", confirm: true, note: "Customer asked for the extra bundle by phone" });
  assert.equal(ok.state, "loaded");
  const scan = await f.one("select confirm_note, warnings from loading_scans where id=$1", [ok.scan_id]);
  assert.deepEqual(scan.warnings, ["over_plan"]);
  await assert.rejects(() => dispatch("remove", { scan_id: ok.scan_id, reason: "x" }), /5 to 300/);
  const after = await dispatch("remove", { scan_id: ok.scan_id, reason: "Taken off: over the order" });
  assert.equal(after.plan.totals.bundles, 1);
});

test("AP-018 completing a load sends the scanned bundles through the dispatch writer with no typed lines", async () => {
  const o = await readyOrder();
  const s = await dispatch("start", { order_id: o.order, vehicle_number: "MH12AB1234", transporter_name: "VRL Logistics", lr_number: "LR-889" });
  await dispatch("scan", { session_id: s.id, tag: "B4-A1" });
  await dispatch("scan", { session_id: s.id, tag: "B4-A2" });
  const dispatchId = await f.writeDispatch(s.id);
  const d = await f.one("select delivery_status, number_of_bundles, total_weight_kg, vehicle_number, actual_dispatched_at from dispatches where id=$1", [dispatchId]);
  assert.equal(d.delivery_status, "dispatched");
  assert.equal(d.number_of_bundles, 2);
  assert.equal(n(d.total_weight_kg), 228);
  assert.ok(d.actual_dispatched_at, "activated: stock posted by the existing writer, not by the session");
  const recovery = await dispatch("bundles_for_dispatch", { id: s.id });
  assert.equal(recovery.already_dispatched, dispatchId, "a retried completion finds the dispatch already written");
  const done = await dispatch("complete", { id: s.id, dispatch_id: dispatchId });
  assert.equal(done.status, "completed");
  const repeat = await dispatch("complete", { id: s.id, dispatch_id: dispatchId });
  assert.equal(repeat.repeated, true);
  // A second order's dispatch cannot complete this session.
  const o2 = await readyOrder({ tags: ["B4-Z1"] });
  const s2 = await dispatch("start", { order_id: o2.order });
  await dispatch("scan", { session_id: s2.id, tag: "B4-Z1" });
  await assert.rejects(() => dispatch("complete", { id: s2.id, dispatch_id: dispatchId }), /does not belong/);
});

test("AP-019 vehicle out checks the number plate, warns on a missing e-way bill and moves the dispatch to in transit", async () => {
  const o = await readyOrder();
  const s = await dispatch("start", { order_id: o.order, vehicle_number: "MH12AB1234" });
  await dispatch("scan", { session_id: s.id, tag: "B4-A1" });
  await dispatch("scan", { session_id: s.id, tag: "B4-A2" });
  const dispatchId = await f.writeDispatch(s.id);
  await dispatch("complete", { id: s.id, dispatch_id: dispatchId });
  const queue = await dispatch("gate_queue", {});
  assert.equal(queue.rows.length, 1);
  assert.equal(queue.rows[0].eway_required, true, "an unpriced or valuable consignment needs an e-way bill");
  await assert.rejects(() => dispatch("gate_out", { dispatch_id: dispatchId, vehicle_number: "MH12AB9999" }), /does not match/);
  await assert.rejects(() => dispatch("gate_out", { dispatch_id: dispatchId, vehicle_number: "MH12AB9999", override_reason: "Transporter swapped the truck" }), /Only a dispatch supervisor/);
  await assert.rejects(() => dispatch("gate_out", { dispatch_id: dispatchId, vehicle_number: "mh-12-ab-1234" }), /Give a reason/);
  const out = await dispatch("gate_out", { dispatch_id: dispatchId, vehicle_number: "mh-12-ab-1234", eway_reason: "Portal down; EWB generated from the phone app" });
  assert.equal(out.state, "out");
  assert.equal(out.vehicle_check, "matched");
  assert.equal(out.eway_state, "missing_acknowledged");
  assert.equal((await f.one("select delivery_status from dispatches where id=$1", [dispatchId])).delivery_status, "in_transit");
  assert.equal((await dispatch("gate_out", { dispatch_id: dispatchId, vehicle_number: "MH12AB1234" })).state, "already_out", "one exit per dispatch");
  const register = await dispatch("gate_register", {});
  assert.equal(register.rows[0].vehicle_number, "MH12AB1234");
  assert.equal(register.rows[0].eway_state, "missing_acknowledged");
  assert.equal((await dispatch("gate_queue", {})).rows.length, 0);
  // Block policy refuses instead of warning.
  const o2 = await readyOrder({ tags: ["B4-K1"] });
  const s2 = await dispatch("start", { order_id: o2.order, vehicle_number: "MH12AB5555" });
  await dispatch("scan", { session_id: s2.id, tag: "B4-K1" });
  const d2 = await f.writeDispatch(s2.id);
  await dispatch("save_settings", { eway_gate_policy: "block" }, i.dispatchManager);
  await assert.rejects(() => dispatch("gate_out", { dispatch_id: d2, vehicle_number: "MH12AB5555", eway_reason: "Trying to leave anyway" }), /needs an e-way bill/);
  await assert.rejects(() => dispatch("save_settings", { eway_gate_policy: "warn" }, i.dispatchUser), err => err.code === "42501");
});

test("AP-051 the ready list splits released and held kilograms by customer and destination and marks credit holds", async () => {
  const a = await readyOrder({ tags: ["B4-R1", "B4-R2"] });
  const held = await readyOrder({ tags: ["B4-R3"], approvedKg: 0 });
  const list = await dispatch("ready", {}, i.sales);
  const group = list.rows.find(r => r.customer_id === i.customer2);
  assert.ok(group, "grouped by customer");
  assert.equal(group.destination, "Pune");
  const lineA = group.lines.find(l => l.order_id === a.order);
  assert.equal(n(lineA.released_kg), 228);
  assert.equal(n(lineA.held_kg), 0);
  const lineH = group.lines.find(l => l.order_id === held.order);
  assert.equal(n(lineH.held_kg), 114);
  assert.match(lineH.held_reason, /QC/);
  const released = await dispatch("ready", { released_only: true }, i.sales);
  assert.ok(!released.rows.flatMap(r => r.lines).some(l => l.order_id === held.order), "released-only hides lines with nothing released");
  await f.seed("insert into order_credit_holds(company_id,order_id,customer_id,status,reasons,exposure,credit_limit,overdue_beyond_grace,requested_by) values($1,$2,$3,'held',array['over_limit'],100000,50000,0,$4)",
    [i.company, a.order, i.customer2, i.sales]);
  const marked = (await dispatch("ready", {}, i.sales)).rows.flatMap(r => r.lines).find(l => l.order_id === a.order);
  assert.equal(marked.credit, "held", "credit-held orders are shown and marked");
  await assert.rejects(() => dispatch("ready", {}, i.quality), err => err.code === "42501");
});

/** An approved company label template (NOV-079 needs a second person to approve). */
async function approvedTemplate(fields = ["bundle_number", "order_number", "customer", "profile_code", "pieces", "net_kg"]) {
  const id = nid(7000);
  await f.seed(`insert into packing_label_templates(id,company_id,scope,revision,status,instructions,label_fields,spacer_required,created_by,approved_by,approved_at)
    values($1,$2,'company',1,'approved','Wrap in stretch film; label on both ends',$3,false,$4,$5,now())`, [id, i.company, fields, i.dispatchManager, i.owner]);
  return id;
}

test("AP-017 recording a bundle queues its label; printing writes the label print once; reprints need a reason", async () => {
  const o = await readyOrder({ tags: ["B4-LB1"] });
  const blocked = await f.one("select status, blocked_reason from label_print_jobs where bundle_id=$1", [o.bundles[0]]);
  assert.equal(blocked.status, "blocked", "without an approved template the label is blocked with the reason, never printed with guessed fields");
  assert.match(blocked.blocked_reason, /No approved label template/);
  await approvedTemplate();
  const station = await dispatch("save_station", { name: "Packing table 1", auto_print: true, is_default: true }, i.dispatchManager);
  const job = (await dispatch("label_queue", { status: "blocked", station_id: station.id })).rows[0];
  const retried = await dispatch("label_retry", { job_id: job.id });
  assert.equal(retried.status, "queued");
  assert.equal(retried.fields.bundle_number, "B4-LB1");
  assert.equal(retried.fields.customer, "Sharma Fabricators");
  assert.equal(retried.fields.net_kg, "114");
  for (const forbidden of ["rate", "price", "cost", "margin", "net_rate"]) assert.ok(!(forbidden in retried.fields), "only the template's permitted fields");
  const b2 = await f.bundle({ order: o.order, job: o.job, tag: "B4-LB2" });
  const queued = await f.one("select status, station_id from label_print_jobs where bundle_id=$1", [b2]);
  assert.equal(queued.status, "queued");
  assert.equal(queued.station_id, station.id, "a new bundle queues straight to the default station");
  const printed = await dispatch("label_printed", { job_id: retried.id });
  assert.equal(printed.state, "printed");
  assert.equal((await dispatch("label_printed", { job_id: retried.id })).repeated, true, "confirming twice does not print twice");
  assert.equal(await count("select count(*) c from packing_label_prints where bundle_id=$1", [o.bundles[0]]), 1);
  await assert.rejects(() => dispatch("label_reprint", { bundle_id: o.bundles[0], reason: "damaged", note: "x" }), /5 to 300/);
  const re = await dispatch("label_reprint", { bundle_id: o.bundles[0], reason: "damaged", note: "Tag torn while strapping" });
  await dispatch("label_printed", { job_id: re.id });
  const prints = (await f.db.query("select print_number, reason, status from packing_label_prints where bundle_id=$1 order by print_number", [o.bundles[0]])).rows;
  assert.deepEqual(prints.map(p => [p.print_number, p.reason, p.status]), [[1, "initial", "superseded"], [2, "damaged", "active"]], "reprints are logged and supersede");
  const audit = await dispatch("label_audit", { days: 7 });
  assert.equal(audit.stats.bundles, 2);
  assert.equal(audit.stats.labelled, 1);
  assert.equal(audit.rows[0].bundle_number, "B4-LB2", "the unlabelled bundle is listed");
  await assert.rejects(() => dispatch("save_station", { name: "Rogue" }), err => err.code === "42501", "only supervisors configure stations");
});

test("AP-035 the packing standard proposes bundles and material, versions the customer spec and records deviations", async () => {
  await assert.rejects(() => dispatch("save_pack_spec", { customer_id: i.customer2, wrapping: "stretch_film", interleaving_paper: true, battens_per_bundle: 2, material_ids: [], reason: "Customer requirement" }),
    err => err.code === "42501", "dispatch staff cannot set a customer's packing spec");
  const v1 = await dispatch("save_pack_spec", { customer_id: i.customer2, max_bundle_kg: 120, max_pieces: 25, wrapping: "stretch_film", interleaving_paper: true, battens_per_bundle: 2,
    material_ids: [i.film, i.paper], reason: "Customer packing sheet dated 1 Nov" }, i.dispatchManager);
  assert.equal(v1.revision, 1);
  const o = await f.order({ pieces: 100, length: 6, kgm: 0.95 });
  const plan = await dispatch("pack_plan", { order_id: o.order });
  const line = plan.lines[0];
  assert.equal(n(line.piece_kg), 5.7);
  assert.equal(line.per_bundle, 21, "5.7 kg per piece: 120 kg allows 21, below the 25-piece limit");
  assert.equal(line.basis, "max_kg");
  assert.equal(line.bundles, 5);
  assert.equal(line.last_bundle_pieces, 16);
  const film = plan.materials.find(m => m.code === "SF-23"), paper = plan.materials.find(m => m.code === "IP-01"), battens = plan.materials.find(m => m.code === "BATTEN");
  assert.equal(n(film.quantity), 720, "1.2 m film per profile metre x 600 m");
  assert.equal(n(paper.quantity), 100, "one sheet per piece");
  assert.equal(n(battens.quantity), 10, "2 battens x 5 bundles");
  const v2 = await dispatch("save_pack_spec", { customer_id: i.customer2, max_bundle_kg: 200, wrapping: "bubble_wrap", interleaving_paper: false, battens_per_bundle: 0, material_ids: [i.film],
    reason: "Customer relaxed the bundle weight" }, i.dispatchManager);
  assert.equal(v2.revision, 2);
  assert.equal(await count("select count(*) c from customer_packing_specs where customer_id=$1 and status='active'", [i.customer2]), 1, "one active revision");
  assert.equal(await count("select count(*) c from customer_packing_specs where customer_id=$1", [i.customer2]), 2, "history kept");
  const job = await f.readyJob({ order: o.order, line: o.line, kg: 570 });
  const big = await f.bundle({ order: o.order, job, tag: "B4-P1", pieces: 40, gross: 234, tare: 6 });
  await f.bundle({ order: o.order, job, tag: "B4-P2", pieces: 10, gross: 63, tare: 6 });
  const kinds = (await f.db.query("select bundle_id, kind, expected_pieces from packing_deviations where order_id=$1 order by bundle_id = $2 desc, kind", [o.order, big])).rows;
  assert.deepEqual(kinds.map(k => [k.bundle_id === big ? "big" : "small", k.kind, k.expected_pieces]), [["big", "over_kg", 35], ["big", "over_pieces", 35], ["small", "under_pieces", 35]],
    "under revision 2 (35 per bundle), a 40-piece 228 kg bundle and a 10-piece bundle mid-run are deviations");
  const dev = (await dispatch("deviations", { order_id: o.order, open_only: true })).rows[0];
  await dispatch("deviation_note", { id: dev.id, note: "Customer asked for smaller bundles on this lot" });
  assert.equal((await dispatch("deviations", { order_id: o.order, open_only: true })).total_count, 2);
  const report = await dispatch("pack_report", { days: 7 });
  const row = report.rows.find(r => r.order_id === o.order);
  assert.equal(row.bundles, 2);
  assert.equal(n(row.standard.find(m => m.code === "SF-23").quantity), 288, "1.2 x 240 m packed");
  assert.equal(n(row.issued.find(m => m.code === "SF-23")?.quantity ?? 0), 0, "nothing issued yet through packaging movements");
  const blank = await f.one("select private.ap4_pack_line(100, 6, 0.95, null, null, null) v");
  assert.equal(blank.v.per_bundle, null, "no limit: blank, never zero");
  assert.equal(blank.v.bundles, null);
});

test("AP-036 the cheapest card is proposed, an override needs a reason, and billed freight is compared per transporter", async () => {
  await assert.rejects(() => freight("save_card", { transporter_id: i.transporter, basis: "per_kg", destination_state: "27", rate: 4, effective_from: istDay(-1) }, i.dispatchUser), err => err.code === "42501");
  await freight("save_card", { transporter_id: i.transporter, basis: "per_kg", destination_state: "27", rate: 4.5, min_charge: 2000, effective_from: istDay(-10) });
  await freight("save_card", { transporter_id: i.transporter, basis: "per_kg", destination_state: "27", destination_city: "Pune", rate: 3.8, min_charge: 1500, effective_from: istDay(-10) });
  await freight("save_card", { transporter_id: i.transporter, basis: "per_vehicle", vehicle_type: "14 ft truck", vehicle_capacity_kg: 4000, destination_state: "27", rate: 9000, effective_from: istDay(-10) });
  await assert.rejects(() => freight("save_card", { transporter_id: i.vendor, basis: "per_kg", destination_state: "27", rate: 4, effective_from: istDay(-1) }), /active transporter/);
  const est = await freight("estimate", { weight_kg: 1000, state: "27", city: "Pune" });
  assert.equal(n(est.options[0].amount), 3800, "city card beats the state card: 3.8 x 1000");
  assert.equal(est.options.length, 2, "the state per-kg card is replaced by the city card for the same transporter");
  const o = await readyOrder();
  const s = await dispatch("start", { order_id: o.order, vehicle_number: "MH12AB1234" });
  await dispatch("scan", { session_id: s.id, tag: "B4-A1" });
  await dispatch("scan", { session_id: s.id, tag: "B4-A2" });
  const proposed = await freight("propose", { target_kind: "loading", target_id: s.id });
  assert.equal(proposed.state, "proposed");
  const p = await f.one("select payload from proposals where id=$1", [proposed.proposal_id]);
  assert.equal(n(p.payload.amount), 1500, "240 kg gross: the 1,500 minimum on the Pune card");
  await assert.rejects(() => decide(proposed.proposal_id, "edit", { payload: { option_index: 1, amount: 9000 } }), /Override reason is required/);
  const decided = await decide(proposed.proposal_id, "edit", { payload: { option_index: 1, amount: 9000, reason: "Customer wants a dedicated truck" } });
  assert.equal(decided.state, "edited");
  assert.equal((await f.one("select transporter_name from loading_sessions where id=$1", [s.id])).transporter_name, "VRL Logistics", "the chosen transporter fills the blank transporter");
  const dispatchId = await f.writeDispatch(s.id);
  await dispatch("complete", { id: s.id, dispatch_id: dispatchId });
  const dec = await freight("decision", { target_kind: "dispatch", target_id: dispatchId });
  assert.equal(dec.decision.decision, "overridden", "the loading decision follows the dispatch");
  await assert.rejects(() => freight("record_billed", { decision_id: dec.decision.id, amount: 9500, reference: "VRL/123" }), err => err.code === "42501", "only accounts records billed freight");
  assert.equal((await freight("refresh_billed", { decision_id: dec.decision.id }, i.accounts)).state, "none");
  await freight("record_billed", { decision_id: dec.decision.id, amount: 9450, reference: "VRL/2026/881" }, i.accounts);
  const variance = await freight("variance", {});
  assert.equal(n(variance.rows[0].variance), 450);
  assert.equal(n(variance.rows[0].variance_percent), 5);
  const o2 = await readyOrder({ tags: ["B4-F1", "B4-F2"] });
  const s2 = await dispatch("start", { order_id: o2.order });
  await dispatch("scan", { session_id: s2.id, tag: "B4-F1" });
  const p2 = await freight("propose", { target_kind: "loading", target_id: s2.id });
  await dispatch("scan", { session_id: s2.id, tag: "B4-F2" });
  assert.equal((await decide(p2.proposal_id, "accept")).state, "stale", "once more weight is loaded the old estimate cannot be accepted");
});

test("AP-081 the e-way bill source carries the posted invoice; numbers pasted back fill blank dispatches only", async () => {
  const o = await readyOrder();
  const s = await dispatch("start", { order_id: o.order, vehicle_number: "MH12AB1234" });
  await dispatch("scan", { session_id: s.id, tag: "B4-A1" });
  const dispatchId = await f.writeDispatch(s.id);
  const before = (await eway("sources", { dispatch_ids: [dispatchId] }))[0];
  assert.equal(before.invoice, null, "no posted invoice yet");
  assert.equal(before.recipient.gstin, GSTIN.maharashtra);
  assert.equal(before.recipient.state_code, "27");
  assert.equal(before.supplier.state_code, "07");
  const invoice = nid(7100);
  await f.seed(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,status,subtotal,tax_total,grand_total,amount_paid,igst_amount,place_of_supply_state_code,supplier_state_code)
    values($1,$2,$3,$4,$5,'OMX/26-27/0201',current_date,'generated',34200,6156,40356,0,6156,'27','07')`, [invoice, i.company, i.customer2, o.order, dispatchId]);
  await f.seed(`insert into invoice_items(company_id,invoice_id,profile_id,item_description,quantity,quantity_kg,unit_rate,line_total,gst_percent,hsn_code,line_kind)
    values($1,$2,$3,'Sliding track',114,114,300,34200,18,'7604','goods')`, [i.company, invoice, i.profile2]);
  await eway("save_inputs", { dispatch_id: dispatchId, distance_km: 1420 });
  const src = (await eway("sources", { dispatch_ids: [dispatchId] }))[0];
  assert.equal(src.invoice.number, "OMX/26-27/0201");
  assert.equal(src.invoice.items[0].hsn, "7604");
  assert.equal(src.inputs.distance_km, 1420);
  assert.equal((await f.one("select distance_km from eway_distance_memory where to_pincode='411001'")).distance_km, 1420, "the distance to the PIN is remembered");
  await assert.rejects(() => eway("record_export", { schema_version: "NIC-EWB-BULK-1.0.0621", file_sha256: "a".repeat(64), docs: [{ dispatch_id: dispatchId, doc_no: "WRONG", doc_date: istDay(0), total_value: 1 }] }),
    /not the posted invoice/);
  await eway("record_export", { schema_version: "NIC-EWB-BULK-1.0.0621", file_sha256: "a".repeat(64), docs: [{ dispatch_id: dispatchId, doc_no: "OMX/26-27/0201", doc_date: istDay(0), total_value: 40356 }] });
  const back = await eway("record_ewb", { entries: [{ doc: "omx/26-27/0201", ewb: "3410 0000 1234" }, { doc: "NOPE", ewb: "341000001235" }, { doc: "OMX/26-27/0201", ewb: "12" }] });
  assert.equal(back.recorded, 1);
  assert.deepEqual(back.results.map(r => r.state), ["recorded", "unknown", "invalid"]);
  assert.equal((await f.one("select eway_bill_number from dispatches where id=$1", [dispatchId])).eway_bill_number, "341000001234");
  const conflict = await eway("record_ewb", { entries: [{ doc: "OMX/26-27/0201", ewb: "341000009999" }] });
  assert.equal(conflict.results[0].state, "conflict", "a recorded e-way bill is never overwritten");
  await assert.rejects(() => eway("queue", {}, i.sales), err => err.code === "42501");
});

test("AP-083 each posted voucher is exported once; re-export needs a reason; opening invoices are never exported", async () => {
  const from = istDay(-30), to = istDay(0);
  const pending = await tally("pending", { from: istDay(-28), to });
  assert.ok(pending.pending_by_kind.sales >= 2, "posted invoices dated in the period are pending");
  const data = await tally("vouchers_data", { from: istDay(-28), to, kinds: ["sales"] });
  const v = data.vouchers[0];
  await tally("record_export", { from: istDay(-28), to, kinds: ["sales"], file_sha256: "b".repeat(64), vouchers: [{ kind: "sales", id: v.id }] });
  await assert.rejects(() => tally("record_export", { from: istDay(-28), to, kinds: ["sales"], file_sha256: "c".repeat(64), vouchers: [{ kind: "sales", id: v.id }] }), /already exported/);
  assert.ok(!(await tally("vouchers_data", { from: istDay(-28), to, kinds: ["sales"] })).vouchers.some(x => x.id === v.id), "an exported voucher is no longer pending");
  await assert.rejects(() => tally("re_export", { kind: "sales", voucher_id: v.id, reason: "short" }), /10 to 300/);
  await tally("re_export", { kind: "sales", voucher_id: v.id, reason: "Tally company was restored from backup" });
  await tally("record_export", { from: istDay(-28), to, kinds: ["sales"], file_sha256: "d".repeat(64), vouchers: [{ kind: "sales", id: v.id }] });
  assert.equal((await f.one("select re_export from tally_export_vouchers where voucher_id=$1 and status='exported'", [v.id])).re_export, true);
  await f.seed("update invoices set opening_cutover_id=$2 where id=$1", [i.inv3, nid(7200)]);
  assert.ok(!(await tally("vouchers_data", { from, to })).vouchers.some(x => x.id === i.inv3), "opening (cut-over) invoices are never exported");
  await tally("save_mapping", { kind: "output_igst", ledger_name: "Output IGST 18%" });
  await assert.rejects(() => tally("save_mapping", { kind: "bank", ledger_name: "HDFC <script>" }), /cannot contain/);
  assert.ok((await tally("mappings")).rows.some(m => m.kind === "output_igst"));
  await assert.rejects(() => tally("pending", { from, to }, i.sales), err => err.code === "42501");
});

test("AP-060 a status link shows a safe projection once its token is known, and stops when revoked or expired", async () => {
  const o = await readyOrder();
  const link = await share("create_link", { order_id: o.order, days: 7 });
  assert.match(link.token, /^[0-9a-f]{64}$/);
  const stored = await f.one("select token_hash from order_status_links where id=$1", [link.id]);
  assert.notEqual(stored.token_hash, link.token, "only the hash is stored");
  const view = await f.asAnon("select public.ap_order_status($1) v", [link.token]);
  assert.equal(view.state, "ok");
  const text = JSON.stringify(view.order);
  for (const forbidden of ["rate", "price", "cost", "margin", "notes", "internal", "50000"]) assert.ok(!text.includes(forbidden), `no ${forbidden} in the public projection`);
  assert.equal(view.order.lines[0].ordered_pieces, 100);
  assert.equal(n(view.order.lines[0].packed_kg), 228);
  assert.equal((await f.asAnon("select public.ap_order_status($1) v", ["f".repeat(64)])).state, "invalid");
  assert.equal((await f.asAnon("select public.ap_order_status($1) v", ["not-a-token"])).state, "invalid");
  assert.equal((await f.one("select view_count from order_status_links where id=$1", [link.id])).view_count, 1);
  await share("revoke_link", { id: link.id, reason: "Sent to the wrong contact" });
  assert.equal((await f.asAnon("select public.ap_order_status($1) v", [link.token])).state, "revoked");
  const l2 = await share("create_link", { order_id: o.order, days: 1 });
  await f.seed("update order_status_links set expires_at=now()-interval '1 minute' where id=$1", [l2.id]);
  assert.equal((await f.asAnon("select public.ap_order_status($1) v", [l2.token])).state, "expired");
  await assert.rejects(() => share("create_link", { order_id: o.order }, i.production), err => err.code === "42501");
  await assert.rejects(() => f.asAnon("select public.ap_share('links',$1)", [{ order_id: o.order }]), /permission denied/);
});

test("AP-089 the customer summary leaves out internal facts; the internal one is refused to roles without it", async () => {
  const o = await readyOrder();
  await f.seed("update orders set notes='Margin is thin; push for advance' where id=$1", [o.order]);
  const customer = await share("summary", { kind: "order", id: o.order, audience: "customer" });
  assert.ok(!JSON.stringify(customer.facts).includes("Margin"), "internal notes stay out of the customer version");
  const internal = await share("summary", { kind: "order", id: o.order, audience: "internal" });
  assert.equal(internal.facts.notes, "Margin is thin; push for advance");
  assert.equal(internal.facts.bundles_waiting, 2);
  await assert.rejects(() => share("summary", { kind: "order", id: o.order, audience: "internal" }, i.viewer), err => err.code === "42501", "viewers get the customer version only");
  assert.ok(await share("summary", { kind: "order", id: o.order, audience: "customer" }, i.viewer));
  await assert.rejects(() => share("summary", { kind: "invoice", id: i.inv1, audience: "customer" }, i.sales), err => err.code === "42501", "sales cannot summarise invoices");
  const inv = await share("summary", { kind: "invoice", id: i.inv1, audience: "customer" }, i.accounts);
  assert.equal(inv.facts.number, "OMX/26-27/0101");
  await assert.rejects(() => share("summary", { kind: "order", id: i.foreignOrder, audience: "customer" }), /not found/, "another company's order");
});

test("Batch 4 tables have RLS, a company read policy and no client grants; only the five entry points and the public status read are callable", async () => {
  const tables = ["dispatch_autopilot_settings", "loading_sessions", "loading_scans", "dispatch_gate_exits", "label_stations", "label_print_jobs", "customer_packing_specs", "packing_deviations",
    "transporter_rate_cards", "freight_decisions", "dispatch_eway_inputs", "eway_distance_memory", "eway_exports", "eway_export_items", "tally_ledger_map", "tally_export_batches",
    "tally_export_vouchers", "order_status_links"];
  for (const t of tables) {
    const r = await f.one(`select c.relrowsecurity rls, (select count(*) from pg_policies p where p.tablename=c.relname) policies, has_table_privilege('authenticated', c.oid, 'select') sel,
      has_table_privilege('anon', c.oid, 'select') anon_sel from pg_class c where c.relname=$1 and c.relnamespace='public'::regnamespace`, [t]);
    assert.equal(r.rls, true, `${t} has RLS`);
    assert.ok(Number(r.policies) >= 1, `${t} has a policy`);
    assert.equal(r.sel, false, `${t}: no client select grant`);
    assert.equal(r.anon_sel, false);
  }
  for (const fn of ["ap_dispatch", "ap_freight", "ap_eway", "ap_tally", "ap_share"]) {
    const r = await f.one("select has_function_privilege('authenticated', $1::regprocedure, 'execute') a, has_function_privilege('anon', $1::regprocedure, 'execute') b", [`public.${fn}(text,jsonb)`]);
    assert.equal(r.a, true);
    assert.equal(r.b, false, `${fn} is not callable without a session`);
  }
  assert.equal((await f.one("select has_function_privilege('anon','public.ap_order_status(text)','execute') a")).a, true, "the status read is the one anonymous entry point");
  const definers = await f.db.query(`select p.proname from pg_proc p where (p.proname like 'ap4%' or p.proname in ('ap_dispatch','ap_freight','ap_eway','ap_tally','ap_share','ap_order_status'))
    and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')`);
  assert.deepEqual(definers.rows, [], "every security-definer function pins search_path");
  const privateCallable = await f.db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'ap4%'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
  assert.deepEqual(privateCallable.rows, [], "no private batch 4 function is callable by clients");
  await readyOrder({ tags: ["B4-X1"] });
  const s = await dispatch("start", { order_id: (await f.one("select order_id from prepared_physical_bundles where bundle_number='B4-X1'")).order_id });
  assert.ok(s.id);
  await assert.rejects(() => dispatch("session", { id: s.id }, i.foreign), err => err.code === "42501" || /not found/.test(err.message), "another company's user cannot open the session");
  await assert.rejects(() => dispatch("sessions", {}, i.dealer), err => err.code === "42501", "dealers are refused");
});

test("AP-035 the packing calculation in lib/calculations matches private.ap4_pack_line", async () => {
  const { packLine } = await import("../lib/calculations/bundle-packing.ts");
  const cases = [];
  for (const pieces of [null, 0, 1, 37, 100, 1000]) for (const length of [null, 0, 2.5, 6, 6.4]) for (const kgm of [null, 0.35, 0.95, 2.4])
    for (const maxKg of [null, 5, 120, 450]) for (const maxPieces of [null, 1, 25]) for (const profile of [null, 0, 18]) cases.push([pieces, length, kgm, maxKg, maxPieces, profile]);
  const rows = (await f.db.query(`select x.i, private.ap4_pack_line(x.p, x.l, x.k, x.mk, x.mp, x.pp) v from jsonb_to_recordset($1::jsonb) as x(i integer, p integer, l numeric, k numeric, mk numeric, mp integer, pp integer)`,
    [JSON.stringify(cases.map((c, i) => ({ i, p: c[0], l: c[1], k: c[2], mk: c[3], mp: c[4], pp: c[5] })))])).rows;
  for (const row of rows) {
    const [pieces, lengthM, kgPerM, maxBundleKg, maxPieces, profilePerBundle] = cases[row.i];
    const ts = packLine({ pieces, lengthM, kgPerM, maxBundleKg, maxPieces, profilePerBundle });
    const sql = row.v;
    assert.deepEqual([ts.perBundle, ts.basis, ts.bundles, ts.lastBundlePieces, ts.heavyPiece, ts.pieceKg, ts.bundleKg],
      [sql.per_bundle, sql.basis, sql.bundles, sql.last_bundle_pieces, sql.heavy_piece, n(sql.piece_kg), n(sql.bundle_kg)], `case ${JSON.stringify(cases[row.i])}`);
  }
  assert.ok(rows.length > 2000);
});
