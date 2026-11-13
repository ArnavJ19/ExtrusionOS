import test from "node:test";
import assert from "node:assert/strict";
import { planBilletLength, evaluateBilletLength } from "../lib/calculations/billet-length.ts";
import { sectionWeightDrift, bundleKgPerM } from "../lib/calculations/section-weight.ts";
import { suggestReorder } from "../lib/calculations/reorder-point.ts";
import { buildEinvoiceExport, decodeSignedQr, parseIrnResponse, validateEinvoiceSource } from "../lib/compliance/e-invoice.ts";
import { parseTdsStatement, readStatementDate } from "../lib/financials/tds-statement.ts";
import { flushEntries, legacyTapEntries, listEntries, newEntry, putEntry } from "../lib/offline/queue.ts";
import { offlineCommands, pressPlanCommands, reorderCommands, tdsCommands, weightCommands } from "../lib/autopilot-batch6/commands.ts";
import { qrModules, qrRuns } from "../lib/pdf/qr-modules.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";

const press = { machine_id: "p", min_billet_mm: 400, max_billet_mm: 1100, standard_billet_mm: 900, container_diameter_mm: 185, butt_mm: 25, runout_m: 70, front_crop_m: 0.5, back_crop_m: 0.5, step_mm: 10 };
const job = { kg_per_m: 0.95, cut_length_m: 6, billet_diameter_mm: 178, extrusion_ratio: null };

test("AP-029 recommendation is the best recovery within the limits and never below the standard length", () => {
  const plan = planBilletLength(job, press);
  assert.equal(plan.ok, true);
  for (let mm = 400; mm <= 1100; mm += 10) {
    const o = evaluateBilletLength({ ...job, extrusion_ratio: 0 }, press, mm);
    if (o.fits_runout && o.pieces > 0) assert.ok(o.recovery_percent <= plan.recommended.recovery_percent + 1e-9, `${mm} mm beats the recommendation`);
  }
  assert.ok(plan.recommended.recovery_percent >= plan.standard.recovery_percent);
  assert.ok(plan.options.some(o => o.label.startsWith("Recommended")));
  assert.ok(plan.options.every(o => o.billet_mm >= 400 && o.billet_mm <= 1100));
  // Mass balance: good output never exceeds the billet.
  assert.ok(plan.options.every(o => o.good_kg <= o.billet_kg));
});

test("AP-029 missing inputs stay missing; the run-out and the container are respected; extrusion ratio fills kg/m", () => {
  assert.deepEqual(planBilletLength({ ...job, cut_length_m: null }, press).missing, ["cut length"]);
  assert.equal(planBilletLength({ ...job, billet_diameter_mm: 200 }, press).ok, false);
  const short = planBilletLength(job, { ...press, runout_m: 30 });
  assert.equal(short.ok, true);
  assert.ok(short.options.every(o => o.extruded_m <= 30));
  assert.ok(short.recommended.billet_mm < 500, "longer billets would overrun the 30 m table");
  assert.equal(planBilletLength(job, { ...press, runout_m: 10 }).ok, false, "no push fits a 10 m table");
  const ratio = planBilletLength({ ...job, kg_per_m: null, extrusion_ratio: 30 }, press);
  assert.equal(ratio.ok, true); assert.match(ratio.kg_per_m_source, /extrusion ratio/);
  assert.equal(planBilletLength({ ...job, kg_per_m: null }, press).ok, false);
});

test("AP-027 bundle kg/m and drift states; invalid bundles are ignored", () => {
  assert.equal(bundleKgPerM({ gross_weight_kg: 66, tare_weight_kg: 6, net_length_m: 60 }), 1);
  assert.equal(bundleKgPerM({ gross_weight_kg: 6, tare_weight_kg: 6, net_length_m: 60 }), null);
  const b = kg => ({ gross_weight_kg: kg * 60 + 6, tare_weight_kg: 6, net_length_m: 60 });
  assert.equal(sectionWeightDrift({ newestFirst: [b(1), b(1)], theoreticalKgPerM: 0.95, tolerancePercent: 2 }).state, "insufficient");
  assert.equal(sectionWeightDrift({ newestFirst: [b(1), b(1), b(1)], theoreticalKgPerM: null, tolerancePercent: 2 }).state, "no_theoretical");
  assert.equal(sectionWeightDrift({ newestFirst: [b(1), b(1), b(1)], theoreticalKgPerM: 0.95, tolerancePercent: null }).state, "no_tolerance");
  assert.equal(sectionWeightDrift({ newestFirst: [b(0.9), b(0.9), b(0.9)], theoreticalKgPerM: 0.95, tolerancePercent: 2 }).state, "light");
  assert.equal(sectionWeightDrift({ newestFirst: [b(0.95), b(0.96), b(0.94)], theoreticalKgPerM: 0.95, tolerancePercent: 2 }).state, "within");
  assert.equal(sectionWeightDrift({ newestFirst: [b(1), b(1), b(1), b(0.5)], theoreticalKgPerM: 0.95, tolerancePercent: 2, windowBundles: 3 }).state, "heavy", "only the newest window counts");
});

test("AP-033 reorder suggestion stays blank without history, consumption or lead time", () => {
  assert.equal(suggestReorder({ consumed: 90, windowDays: 10, leadDays: 10 }).state, "insufficient_history");
  assert.equal(suggestReorder({ consumed: 0, windowDays: 90, leadDays: 10 }).state, "not_consumed");
  assert.equal(suggestReorder({ consumed: 90, windowDays: 90, leadDays: null }).min, null);
  assert.deepEqual(suggestReorder({ consumed: 90, windowDays: 90, leadDays: 10, safetyDays: 0, reviewDays: 15 }), { state: "suggested", min: 10, qty: 15, avgDaily: 1 });
});

const source = (over = {}) => ({
  invoice_id: "i1", invoice_number: "OMX/26-27/0101", invoice_date: "2026-11-10", status: "generated", supplier_state_code: "07", place_of_supply_state_code: "27",
  subtotal: 10000, tax_total: 1800, grand_total: 11800, cgst_amount: 0, sgst_amount: 0, utgst_amount: 0, igst_amount: 1800, has_irn: false,
  supplier: { legal_name: "Omalco Extrusion Pvt Ltd", gst_number: "07AAACX1234A1ZZ", billing_address: "Plot 7, Industrial Area", city: "Delhi", pincode: "110020" },
  customer: { company_name: "Sharma Fabricators", gst_number: "27ABCDE1234F1Z0", billing_address: "Gate 3, Chakan MIDC", city: "Pune", pincode: "411001" },
  items: [{ description: "Sliding track 6 m", hsn_code: "7604", quantity: 40, unit_rate: 250, line_total: 10000, gst_percent: 18, line_kind: "goods" }], ...over
});

test("AP-082 e-invoice JSON maps an inter-state B2B invoice exactly; unmappable invoices are skipped with reasons", () => {
  const out = buildEinvoiceExport([source(), source({ invoice_id: "i2", invoice_number: "OMX/26-27/0102", customer: { ...source().customer, gst_number: null } })]);
  assert.equal(out.included.length, 1); assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].issues[0].message, /unregistered/);
  const doc = out.file[0];
  assert.equal(doc.Version, "1.1"); assert.equal(doc.DocDtls.Dt, "10/11/2026"); assert.equal(doc.BuyerDtls.Pos, "27"); assert.equal(doc.BuyerDtls.Stcd, "27");
  assert.equal(doc.ItemList[0].IgstAmt, 1800); assert.equal(doc.ItemList[0].CgstAmt, 0); assert.equal(doc.ItemList[0].Unit, "KGS");
  assert.equal(doc.ValDtls.TotInvVal, 11800); assert.equal(doc.ValDtls.RndOffAmt, 0);
  const intra = buildEinvoiceExport([source({ place_of_supply_state_code: "07", customer: { ...source().customer, gst_number: "07ABCDE1234F1Z0" }, igst_amount: 0, cgst_amount: 900, sgst_amount: 900 })]);
  assert.equal(intra.file[0].ItemList[0].CgstAmt, 900); assert.equal(intra.file[0].ValDtls.SgstVal, 900);
  assert.ok(validateEinvoiceSource(source({ items: [{ ...source().items[0], hsn_code: null }] })).some(x => /HSN/.test(x.message)));
  assert.ok(validateEinvoiceSource(source({ igst_amount: 1500 })).some(x => /reconcile/.test(x.message)));
  assert.ok(validateEinvoiceSource(source({ has_irn: true })).some(x => /already recorded/.test(x.message)));
});

const b64 = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
test("AP-082 IRN responses are cross-checked against the signed QR before import", () => {
  const irn = "a".repeat(64);
  const qr = `${b64({ alg: "RS256" })}.${b64({ data: JSON.stringify({ DocNo: "OMX/26-27/0101", Irn: irn, DocDt: "10/11/2026" }), iss: "NIC" })}.signature`;
  assert.equal(decodeSignedQr(qr).DocNo, "OMX/26-27/0101");
  const ok = parseIrnResponse(JSON.stringify([{ Irn: irn, AckNo: 112010012345678, AckDt: "2026-11-14 10:30:00", SignedQRCode: qr }]));
  assert.equal(ok.rows.length, 1); assert.equal(ok.rows[0].doc_no, "OMX/26-27/0101"); assert.equal(ok.rows[0].ack_date, "2026-11-14T10:30:00+05:30");
  const wrong = parseIrnResponse(JSON.stringify({ data: [{ Irn: "b".repeat(64), AckNo: "1", AckDt: "2026-11-14 10:30:00", SignedQRCode: qr }] }));
  assert.equal(wrong.rows.length, 0); assert.match(wrong.problems[0].message, /different IRN/);
  assert.match(parseIrnResponse("not json").problems[0].message, /not valid JSON/);
  assert.match(parseIrnResponse(JSON.stringify({ Irn: irn })).problems[0].message, /required/);
});

test("AP-082 the signed QR becomes drawable modules", () => {
  const runs = qrRuns("eyJhbGciOiJSUzI1NiJ9.eyJkYXRhIjoiIn0.c2lnbmF0dXJl".repeat(8), "L");
  assert.ok(runs && runs.size >= 21 && runs.runs.length > 50);
  assert.ok(runs.runs.every(r => r.x >= 0 && r.x + r.w <= runs.size && r.y >= 0 && r.y < runs.size));
  assert.equal(qrRuns(""), null);
  // Same modules as qrcode.react draws (dark-cell runs read back from its SVG path), for byte, alphanumeric and numeric text.
  for (const [text, level] of [["eyJhbGciOiJSUzI1NiJ9.e30.sig".repeat(12), "L"], ["OMX/26-27/0101 IRN", "M"], ["1234567890123", "Q"]]) {
    const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value: text, level, marginSize: 0 }));
    const d = [...svg.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).pop();
    const fromSvg = [...d.matchAll(/M(\d+)[ ,](\d+) ?h(\d+)v1H\d+z/g)].map(m => `${m[1]},${m[2]},${m[3]}`).sort();
    const ours = qrRuns(text, level).runs.map(r => `${r.x},${r.y},${r.w}`).sort();
    assert.deepEqual(ours, fromSvg, text.slice(0, 20));
    assert.equal(qrModules(text, level).length, Number(/viewBox="0 0 (\d+)/.exec(svg)[1]));
  }
});

test("AP-077 tax-credit statement CSV is read by its headings; unreadable rows are reported, not guessed", () => {
  const csv = `Form 26AS export\nSr. No.,Name of Deductor,TAN of Deductor,Section,Transaction Date,Status of Booking,Amount Paid / Credited,Tax Deducted,TDS Deposited\n1,"Sharma Fabricators, Pune",PNEA12345B,194Q,15-Oct-2026,F,"10,000.00",10.00,10.00\n2,Bad Row,XX,194Q,15-Oct-2026,F,100,1,1\n3,No Date,PNEA12345B,194Q,someday,F,100,1,1\n`;
  const r = parseTdsStatement(csv);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0], { row_number: 3, tan: "PNEA12345B", deductor_name: "Sharma Fabricators, Pune", section: "194Q", transaction_date: "2026-10-15", amount_credited: 10000, tds_amount: 10, booking_status: "F" });
  assert.equal(r.problems.length, 2);
  assert.equal(readStatementDate("31/02/2026"), null);
  assert.equal(readStatementDate("2026-11-01"), "2026-11-01");
  assert.match(parseTdsStatement("a,b\n1,2").problems[0].message, /heading row/);
});

test("AP-094 the queue keeps order, stops at a connection failure, keeps conflicts and adopts old station taps", async () => {
  const owner = "c:u";
  const e1 = newEntry({ owner, kind: "ap", rpc: "ap_press", command: "push", payload: { n: 1 }, label: "one", now: new Date("2026-11-14T08:00:00Z") });
  const e2 = newEntry({ owner, kind: "ap", rpc: "ap_press", command: "push", payload: { n: 2 }, label: "two", now: new Date("2026-11-14T08:01:00Z") });
  const e3 = newEntry({ owner, kind: "ap", rpc: "ap_press", command: "push", payload: { n: 3 }, label: "three", now: new Date("2026-11-14T08:02:00Z") });
  for (const e of [e3, e1, e2]) await putEntry(e);
  const seen = [];
  let r = await flushEntries(owner, async e => { seen.push(e.payload.n); return e.payload.n === 1 ? { kind: "applied" } : e.payload.n === 2 ? { kind: "conflict", message: "Job closed" } : { kind: "retry" }; });
  assert.deepEqual(seen, [1, 2, 3]); assert.deepEqual(r, { applied: 1, conflicts: 1, waiting: 1 });
  const left = await listEntries(owner);
  assert.deepEqual(left.map(e => [e.payload.n, e.state]), [[2, "conflict"], [3, "pending"]]);
  r = await flushEntries(owner, async () => { throw new Error("offline"); });
  assert.equal(r.waiting, 1);
  r = await flushEntries(owner, async () => ({ kind: "applied" }));
  assert.equal(r.applied, 1, "only pending entries are re-sent; conflicts wait for the employee");
  const legacy = legacyTapEntries(owner, JSON.stringify([{ id: "t1", session_id: "s", job_id: "j", client_at: "2026-11-14T07:00:00Z" }, { bad: true }]));
  assert.equal(legacy.length, 1); assert.equal(legacy[0].request_id, "t1"); assert.equal(legacy[0].payload.id, "t1");
  assert.deepEqual(legacyTapEntries(owner, "not json"), []);
});

test("batch 6 command schemas refuse malformed input early", () => {
  assert.equal(offlineCommands.submit.safeParse({ request_id: "bd000000-0000-4000-8000-000000000001", rpc: "ap_press", command: "scan", payload: {} }).success, false);
  assert.equal(offlineCommands.submit.safeParse({ request_id: "bd000000-0000-4000-8000-000000000001", rpc: "ap_dispatch", command: "scan", payload: {} }).success, true);
  assert.equal(weightCommands.save_settings.safeParse({ window_bundles: 3, min_bundles: 5 }).success, false);
  assert.equal(reorderCommands.update_requisition.safeParse({ id: "bd000000-0000-4000-8000-000000000001", status: "cancelled" }).success, false);
  assert.equal(tdsCommands.record.safeParse({ request_id: "bd000000-0000-4000-8000-000000000001", customer_id: "bd000000-0000-4000-8000-000000000002", deducted_on: "2026-11-14",
    lines: [{ invoice_id: "bd000000-0000-4000-8000-000000000003", amount: 10.005 }] }).success, false);
  assert.equal(pressPlanCommands.edit_line.safeParse({ line_id: "bd000000-0000-4000-8000-000000000001", remove: true }).success, true);
  assert.equal(pressPlanCommands.add_line.safeParse({ draft_id: "bd000000-0000-4000-8000-000000000001", job_id: "bd000000-0000-4000-8000-000000000002", machine_id: "bd000000-0000-4000-8000-000000000003",
    shift: "A", planned_start_at: "2026-11-15T10:00:00+05:30", planned_end_at: "2026-11-15T09:00:00+05:30", capacity_kg: 100 }).success, false);
});
