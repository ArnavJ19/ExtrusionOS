import test from "node:test";
import assert from "node:assert/strict";
import { buildEwayExport, parseEwbPaste, validateEwaySource, EWAY_SCHEMA_VERSION } from "../lib/compliance/eway-bill.ts";
import { buildTallyExport, voucherEntries, LedgerBook, xmlEscape } from "../lib/integrations/tally-xml.ts";
import { formatRecordSummary } from "../lib/communications/record-summary.ts";
import { compareMaterials, packLine, packMaterials, packingInstruction } from "../lib/calculations/bundle-packing.ts";
import { dispatchCommands, freightCommands, shareCommands, tallyCommands } from "../lib/dispatch-autopilot/commands.ts";

const source = (overrides = {}) => ({
  dispatch_id: "11111111-1111-4111-8111-111111111111", dispatch_number: "DC-0042", dispatch_date: "2026-11-12", activated: true, vehicle_number: "MH12AB1234",
  transporter_name: "VRL Logistics", lr_number: "LR-889", eway_bill_number: null,
  supplier: { gstin: "07AAACX1234A1ZZ", name: "Omalco Extrusion Pvt Ltd", address: "Plot 7, Industrial Area", place: "Delhi", pincode: "110020", state_code: "07" },
  recipient: { gstin: "27ABCDE1234F1Z0", name: "Sharma Fabricators", address: "Gate 3, \"Chakan\" MIDC", place: "Pune", pincode: "411001", state_code: "27" },
  invoice: { id: "22222222-2222-4222-8222-222222222222", number: "OMX/26-27/0201", date: "2026-11-12", subtotal: 34200, cgst: 0, sgst: 0, igst: 6156, total: 40356, other_value: 0,
    items: [{ hsn: "7604", description: "OM-2045", quantity_kg: 114, taxable: 34200, gst_percent: 18 }] },
  inputs: { distance_km: 1420, distance_saved: true, transport_mode: "road", vehicle_type: "regular", transporter_gstin: null },
  ...overrides
});

test("AP-081 a valid dispatch becomes one portal bill with IGST for an interstate supply", () => {
  const built = buildEwayExport([source()]);
  assert.equal(built.skipped.length, 0);
  assert.equal(built.file.version, "1.0.0621");
  assert.ok(EWAY_SCHEMA_VERSION.includes("1.0.0621"), "the recorded schema version names the layout");
  const bill = built.file.billLists[0];
  assert.equal(bill.docType, "INV");
  assert.equal(bill.docNo, "OMX/26-27/0201");
  assert.equal(bill.docDate, "12/11/2026");
  assert.equal(bill.fromStateCode, 7);
  assert.equal(bill.toStateCode, 27);
  assert.equal(bill.itemList[0].igstRate, 18);
  assert.equal(bill.itemList[0].cgstRate, 0);
  assert.equal(bill.totInvValue, 40356);
  assert.equal(bill.transDistance, 1420);
  assert.equal(bill.vehicleNo, "MH12AB1234");
  assert.ok(!bill.toAddr1.includes('"'), "quotes are removed from addresses");
});

test("AP-081 missing facts keep a dispatch out of the file with what to fix; blank distance is not zero", () => {
  const issues = validateEwaySource(source({ invoice: null, inputs: { ...source().inputs, distance_km: null }, vehicle_number: "MH 12" }));
  const fields = issues.map(i => i.field);
  assert.ok(fields.includes("invoice"));
  assert.ok(fields.includes("distance"));
  assert.ok(fields.includes("vehicle"));
  const unregistered = buildEwayExport([source({ recipient: { ...source().recipient, gstin: null } })]);
  assert.equal(unregistered.file.billLists[0].toGstin, "URP", "an unregistered customer is URP");
  const badHsn = validateEwaySource(source({ invoice: { ...source().invoice, items: [{ hsn: null, description: "OM-2045", quantity_kg: 114, taxable: 34200, gst_percent: 18 }] } }));
  assert.match(badHsn.map(i => i.message).join(" "), /HSN/);
  const mixed = buildEwayExport([source(), source({ dispatch_number: "DC-0043", eway_bill_number: "341000001234" })]);
  assert.equal(mixed.file.billLists.length, 1);
  assert.equal(mixed.skipped[0].source.dispatch_number, "DC-0043", "a dispatch with an e-way bill is not exported again");
});

test("AP-081 pasted portal output gives document and EWB pairs", () => {
  const pairs = parseEwbPaste("Doc No\tEWB No\tDate\nOMX/26-27/0201\t3410 0000 1234\t12/11/2026\nomx/26-27/0202,341000001235\n\nOMX/26-27/0201 341000001234\nnoise line");
  assert.deepEqual(pairs, [{ doc: "OMX/26-27/0201", ewb: "341000001234" }, { doc: "OMX/26-27/0202", ewb: "341000001235" }]);
});

const mappings = [
  { kind: "sales", entity_id: null, gst_rate: 18, supply: "interstate", ledger_name: "Sales 18% Interstate" },
  { kind: "sales", entity_id: null, gst_rate: null, supply: null, ledger_name: "Sales" },
  { kind: "output_igst", entity_id: null, gst_rate: null, supply: null, ledger_name: "Output IGST" },
  { kind: "output_cgst", entity_id: null, gst_rate: null, supply: null, ledger_name: "Output CGST" },
  { kind: "output_sgst", entity_id: null, gst_rate: null, supply: null, ledger_name: "Output SGST" },
  { kind: "bank", entity_id: null, gst_rate: null, supply: null, ledger_name: "HDFC Bank" },
  { kind: "round_off", entity_id: null, gst_rate: null, supply: null, ledger_name: "Round Off" },
  { kind: "customer", entity_id: "c1", gst_rate: null, supply: null, ledger_name: "Sharma Fabricators (Pune)" }
];
const sale = { kind: "sales", id: "v1", number: "OMX/26-27/0201", date: "2026-11-12", amount: 40356.4, party_id: "c1", party: "Sharma Fabricators",
  data: { supply: "interstate", subtotal: 34200, cgst: 0, sgst: 0, igst: 6156, lines: [{ rate: 18, taxable: 34200 }] } };

test("AP-083 a sales voucher balances: party debit, sales and IGST credits, paise to round off", () => {
  const issues = [];
  const entries = voucherEntries(sale, new LedgerBook(mappings), issues);
  assert.deepEqual(issues, []);
  assert.deepEqual(entries.map(e => [e.ledger, e.amount]), [["Sharma Fabricators (Pune)", -40356.4], ["Sales 18% Interstate", 34200], ["Output IGST", 6156], ["Round Off", 0.4]]);
  assert.ok(Math.abs(entries.reduce((s, e) => s + e.amount, 0)) < 0.005, "balances to the paisa");
});

test("AP-083 vouchers with a missing ledger stay out of the file and stay pending; names are escaped", () => {
  const receipt = { kind: "receipt", id: "v2", number: "UTR123", date: "2026-11-12", amount: 5000, party_id: null, party: "A & B <Traders>", data: { method: "cash", allocations: [] } };
  const built = buildTallyExport("Omalco Extrusion", [sale, receipt], mappings);
  assert.equal(built.exported.length, 1, "the cash receipt has no cash ledger mapped");
  assert.match(built.issues[0].message, /cash/);
  assert.ok(built.xml.includes("<VOUCHERNUMBER>OMX/26-27/0201</VOUCHERNUMBER>"));
  assert.ok(built.xml.includes('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-40356.40</AMOUNT>'), "debit negative with ISDEEMEDPOSITIVE Yes");
  assert.equal(xmlEscape("A & B <Traders>"), "A &amp; B &lt;Traders&gt;");
  const unbalanced = buildTallyExport("Omalco", [{ ...sale, amount: 50000 }], mappings);
  assert.match(unbalanced.issues[0].message, /Does not balance/);
  assert.equal(unbalanced.exported.length, 0);
});

test("AP-089 the customer summary has no internal facts; the internal one is marked", () => {
  const facts = { order_number: "SO-101", company: "Omalco Extrusion", customer: "Sharma Fabricators", order_date: "2026-11-01", stage: "In production", expected_dispatch_date: "2026-11-20",
    lines: [{ profile: "OM-2045 - Sliding track", finish: "mill finish", ordered_pieces: 100, ordered_kg: 570, dispatched_kg: 228 }],
    dispatches: [{ vehicle: "MH12AB1234", lr_number: "LR-889", date: "2026-11-12", status: "In Transit" }], notes: "Push for advance", credit: "held" };
  const customer = formatRecordSummary({ kind: "order", audience: "customer", facts });
  assert.ok(customer.includes("*Order SO-101*"));
  assert.ok(customer.includes("Dispatched so far: 228 kg of 570 kg"));
  assert.ok(!customer.includes("Push for advance") && !customer.includes("Credit"), "customer text never shows notes or credit even if present");
  const internal = formatRecordSummary({ kind: "order", audience: "internal", facts });
  assert.ok(internal.includes("Note: Push for advance"));
  assert.ok(internal.endsWith("_Internal — do not forward to the customer._"));
  const invoice = formatRecordSummary({ kind: "invoice", audience: "customer", facts: { number: "OMX/1", total: 40356, paid: 0, balance: 40356, status: "Generated" } });
  assert.ok(invoice.includes("Amount: ₹40,356.00") && !invoice.includes("Received"), "a zero receipt line is left out");
});

test("AP-035 packing material, comparison and the packer's instruction", () => {
  const line = packLine({ pieces: 100, lengthM: 6, kgPerM: 0.95, maxBundleKg: 120, maxPieces: 25, profilePerBundle: null });
  assert.equal(line.perBundle, 21);
  const needs = packMaterials([{ id: "m1", code: "SF-23", name: "Stretch film", unit: "meter", method: "per_profile_meter", rate: 1.2 },
    { id: "m2", code: "IP-01", name: "Paper", unit: "sheet", method: "per_piece", rate: 1 }], { pieces: 100, metres: 600, kg: 570, bundles: 5 }, 2);
  assert.deepEqual(needs.map(m => [m.code, m.quantity]), [["IP-01", 100], ["SF-23", 720], ["BATTEN", 10]]);
  const cmp = compareMaterials([{ code: "SF-23", name: "Film", unit: "meter", quantity: 720 }], [{ code: "SF-23", name: "Film", unit: "meter", quantity: 756 }, { code: "TAPE", name: "Tape", unit: "roll", quantity: 2 }]);
  assert.deepEqual(cmp.map(c => [c.code, c.variance, c.variancePercent]), [["SF-23", 36, 5], ["TAPE", null, null]], "a material only on one side keeps the other blank");
  assert.match(packingInstruction(line, { wrapping: "stretch_film", interleavingPaper: true, battensPerBundle: 2, maxBundleKg: 120 }), /Pack 21 pieces per bundle \(about 119\.7 kg\); 5 bundles, last one 16 pcs; stretch film; interleaving paper/);
  assert.match(packingInstruction(packLine({ pieces: 10, lengthM: 6, kgPerM: 1, maxBundleKg: null, maxPieces: null, profilePerBundle: null }), null), /No bundle limit/);
});

test("Batch 4 command schemas refuse malformed input early", () => {
  assert.equal(dispatchCommands.scan.safeParse({ session_id: "11111111-1111-4111-8111-111111111111", tag: "" }).success, false);
  assert.equal(dispatchCommands.gate_out.safeParse({ dispatch_id: "11111111-1111-4111-8111-111111111111", vehicle_number: "MH12AB1234", override_reason: "short" }).success, false);
  assert.equal(freightCommands.save_card.safeParse({ transporter_id: "11111111-1111-4111-8111-111111111111", basis: "per_vehicle", destination_state: "27", rate: 9000, effective_from: "2026-11-01" }).success, false,
    "per-vehicle cards need a vehicle type and capacity");
  assert.equal(tallyCommands.save_mapping.safeParse({ kind: "bank", ledger_name: "HDFC <x>" }).success, false);
  assert.equal(shareCommands.summary.safeParse({ kind: "payment", id: "11111111-1111-4111-8111-111111111111", audience: "customer" }).success, false);
  assert.equal(dispatchCommands.save_pack_spec.safeParse({ wrapping: "stretch_film", interleaving_paper: false, battens_per_bundle: 0, material_ids: [], reason: "Per customer sheet", max_bundle_kg: 0 }).success, false,
    "a zero bundle limit is refused (blank means no limit)");
});
