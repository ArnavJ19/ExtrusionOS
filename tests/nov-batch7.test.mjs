import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createNov7ActionsFixture, ids, n7 } from "../scripts/lib/nov-batch7-actions-fixture.mjs";

const require = createRequire(import.meta.url); require("tsx/cjs");
const search = require("../lib/workflow/instant-search.ts");
const preview = require("../lib/workflow/record-preview.ts");
const repeat = require("../lib/forms/repeat-previous.ts");
const paste = require("../lib/forms/line-paste.ts");
const qr = require("../lib/qr/payload.ts");
const scanTask = require("../lib/qr/scan-task.ts");
const improvement = require("../lib/workflow/improvement.ts");
const improvementForm = require("../lib/workflow/improvement-form.ts");
const vendorForm = require("../lib/forms/in-task-vendor.ts");
const migration = readFileSync("supabase/migrations/20261103500000_november_improvement.sql", "utf8");

// NOV-003 ---------------------------------------------------------------------------------------
test("NOV-003: search patterns tolerate separators and phone formats without widening the filter syntax", () => {
  assert.deepEqual(search.findPatterns("AL 6063"), ["AL 6063", "AL*6063"]);
  assert.deepEqual(search.findPatterns("ORD/26-100"), ["ORD/26-100", "ORD*26*100"]);
  assert.deepEqual(search.findPatterns("ORD100"), ["ORD100"]);
  assert.deepEqual(search.findPatterns("a"), []);
  assert.equal(search.findPhonePattern("+91 98765 43210"), "*9*8*7*6*5*4*3*2*1*0*");
  assert.equal(search.findPhonePattern("098765-43210"), "*9*8*7*6*5*4*3*2*1*0*");
  assert.equal(search.findPhonePattern("AL-6063"), null, "codes with letters are not phone numbers");
  assert.equal(search.findPhonePattern("12345"), null, "too short to identify a phone");
  // Commas, parentheses, quotes and percent signs never reach the or-filter.
  const filter = search.findFilter(search.findDefinitions.customers, "Kaveri), id.eq.x, (%'");
  assert.doesNotMatch(filter, /[()%'"]|id\.eq/);
  assert.ok(filter.split(",").every(clause => /^[a-z_]+\.ilike\.\*[^,]*\*$/.test(clause)));
  assert.match(search.findFilter(search.findDefinitions.customers, "98765 43210"), /phone\.ilike\.\*9\*8/);
  assert.doesNotMatch(search.findFilter(search.findDefinitions.orders, "98765 43210"), /phone/, "only resources with phone fields search phones");
  for (const definition of Object.values(search.findDefinitions)) assert.doesNotMatch(definition.columns, /\*|cost|margin|grand_total|order_value|notes|rate/);
});

test("NOV-003: exact identifiers rank first, and quick actions follow the role", () => {
  const items = [{ title: "SO-1001" }, { title: "SO-100" }, { title: "XSO-100" }, { title: "so 100" }].map((item, index) => ({ ...item, id: String(index), resource: "orders", detail: "", status: "", href: "" }));
  assert.deepEqual(search.rankFindResults(items, "SO-100").map(item => item.title), ["SO-100", "so 100", "SO-1001", "XSO-100"]);
  assert.equal(search.findResult("dies", { id: n7(5), die_number: "D-1", die_status: "active" }, "production").action.label, "View operating history");
  assert.equal(search.findResult("dies", { id: n7(5), die_number: "D-1", die_status: "active" }, "sales").action, undefined);
});

test("NOV-003: the find dialog does not open while typing in a field", async () => {
  const { isTypingTarget } = require("../components/search/global-find.tsx");
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
  assert.equal(isTypingTarget(null), false);
});

test("NOV-003: instant find searches phones and loose codes inside the session company only", async () => {
  const f = createNov7ActionsFixture("../../lib/actions/instant-search.ts");
  f.state.context.role = "sales_manager";
  f.state.tables.customers = [
    { id: n7(20), company_id: ids.company, customer_name: "Kaveri Windows", phone: "+91 98765 43210", deleted_at: null, customer_type: "fabricator" },
    { id: n7(21), company_id: ids.otherCompany, customer_name: "Other Kaveri", phone: "9876543210", deleted_at: null, customer_type: "fabricator" }
  ];
  f.state.tables.orders_authorized = [{ id: n7(22), company_id: ids.company, order_number: "SO-26-100", current_stage: "packing" }];
  const phone = await f.actions.instantFindAction("98765 43210");
  assert.deepEqual(phone.items.map(item => item.id), [n7(20)]);
  const loose = await f.actions.instantFindAction("SO 26 100");
  assert.deepEqual(loose.items.filter(item => item.resource === "orders").map(item => item.title), ["SO-26-100"]);
  f.state.failTables.add("customers");
  const partial = await f.actions.instantFindAction("Kaveri");
  assert.ok(partial.unavailable.includes("customers"), "a failed source is reported, not shown as empty");
});

// NOV-089 ---------------------------------------------------------------------------------------
test("NOV-089: previews surface blockers and only permitted next steps", () => {
  const order = { id: n7(30), order_number: "SO-1", current_stage: "extrusion_planned", billets_required: 10, billets_allocated: 4 };
  assert.deepEqual(preview.recordPreviewAlerts("orders", order), [{ tone: "warning", text: "Billets not fully allocated: 4 of 10." }]);
  assert.deepEqual(preview.recordPreviewAlerts("production", { status: "on_hold", die_id: null }).map(alert => alert.tone), ["critical", "warning"]);
  assert.deepEqual(preview.recordPreviewAlerts("dispatches", { delivery_status: "damaged" })[0].tone, "critical");
  assert.deepEqual(preview.recordPreviewAlerts("inventory", { current_stock: 5, reorder_level: 5 }).length, 1);
  assert.deepEqual(preview.recordPreviewAlerts("inventory", { current_stock: 5, reorder_level: 0 }), [], "no reorder level means no alert");
  assert.deepEqual(preview.recordPreviewAlerts("orders", null), []);
  const all = () => true, none = () => false;
  assert.deepEqual(preview.recordPreviewLinks("orders", order, all, false).map(link => link.label), ["Prepare a dispatch", "Plan production"]);
  assert.deepEqual(preview.recordPreviewLinks("orders", order, none, false), []);
  assert.deepEqual(preview.recordPreviewLinks("orders", { ...order, current_stage: "delivered" }, all, false), []);
  assert.deepEqual(preview.recordPreviewLinks("production", { id: n7(31), order_id: n7(30), die_id: n7(32) }, all, true).map(link => link.href), [`/orders/${n7(30)}`, `/tasks/improvement/dies/${n7(32)}`]);
  assert.deepEqual(preview.recordPreviewLinks("production", { id: n7(31), order_id: "../../admin", die_id: "x" }, all, true), [], "only exact record ids become links");
});

test("NOV-089: a fresh exact read decides whether the listed record is current, changed or gone", () => {
  assert.equal(preview.recordFreshness({ updated_at: "2026-11-05T10:00:00Z" }, { found: true, updatedAt: "2026-11-05T10:00:00Z" }), "current");
  assert.equal(preview.recordFreshness({ updated_at: "2026-11-05T10:00:00Z" }, { found: true, updatedAt: "2026-11-05T10:05:00Z" }), "changed");
  assert.equal(preview.recordFreshness({ updated_at: "2026-11-05T10:00:00Z" }, { found: false, updatedAt: null }), "missing");
  assert.equal(preview.recordFreshness({}, { found: true, updatedAt: "2026-11-05T10:05:00Z" }), "unknown");
  assert.equal(preview.recordFreshness({ updated_at: "x" }, null), "unknown");
  // The original allow-list stays unchanged.
  assert.deepEqual(preview.buildRecordPreviewModel("orders", { id: "o", order_number: "SO-1", order_value: 9, billets_required: 1 }).fields.map(field => field.label), ["Billets required"]);
});

// NOV-009 ---------------------------------------------------------------------------------------
test("NOV-009: repeat copies only setup fields, refreshes dates and never copies quantities, documents or approvals", () => {
  const source = { id: n7(40), job_number: "J-1", order_id: n7(41), die_id: n7(42), machine_id: n7(43), shift: "A", extrusion_efficiency_percent: 78, planned_quantity_kg: 900, pieces: 300, status: "completed", operator_name: "Ravi" };
  const draft = repeat.buildRepeatDraft("production_jobs", source, { today: "2026-11-05", machineUsable: true });
  assert.deepEqual(draft.values, { machine_id: n7(43), shift: "A", extrusion_efficiency_percent: "78" });
  assert.deepEqual(draft.refreshed, { planned_date: "2026-11-05" });
  for (const key of ["order_id", "die_id", "planned_quantity_kg", "pieces", "status", "operator_name", "job_number"]) assert.equal(key in draft.values, false, key);
  const inactive = repeat.buildRepeatDraft("production_jobs", source, { today: "2026-11-05", machineUsable: false });
  assert.equal(inactive.values.machine_id, undefined); assert.match(inactive.warnings[0], /not an active extrusion press/);
  const dispatch = { order_id: n7(44), transporter_name: "VRL", vehicle_number: "MH12AB1234", driver_name: "Sunil", driver_phone: "9000000000", lr_number: "LR-9", eway_bill_number: "EWB-1", total_weight_kg: 500 };
  const open = repeat.buildRepeatDraft("dispatches", dispatch, { today: "2026-11-05", orderStage: "packing" });
  assert.deepEqual(Object.keys(open.values).sort(), ["driver_name", "driver_phone", "order_id", "transporter_name", "vehicle_number"]);
  assert.ok(open.warnings.some(warning => /Confirm the vehicle and driver/.test(warning)));
  assert.equal(repeat.buildRepeatDraft("dispatches", dispatch, { today: "2026-11-05", orderStage: "delivered" }).values.order_id, undefined);
  assert.match(repeat.buildRepeatDraft("dispatches", dispatch, { today: "2026-11-05", orderStage: null }).warnings[0], /no longer available/);
  const purchase = { material_id: n7(45), vendor_id: n7(46), unit: "meter", rate: 12.5, payment_method: "upi", quantity: 400, total_amount: 5000, invoice_number: "INV-1", payment_status: "paid", received_date: "2026-09-01" };
  const receipt = repeat.buildRepeatDraft("packaging_material_purchases", purchase, { today: "2026-11-05", materialActive: true, vendorActive: false });
  assert.deepEqual(Object.keys(receipt.values).sort(), ["material_id", "payment_method", "rate", "unit"]);
  assert.ok(receipt.warnings.some(warning => /vendor is inactive/.test(warning)));
  assert.ok(receipt.warnings.some(warning => /rate 12.5 is from the previous receipt on 2026-09-01/.test(warning)));
  // Lineage records only values the employee kept.
  assert.deepEqual(repeat.repeatLineageFields("packaging_material_purchases", receipt.copied, { material_id: n7(45), rate: 13, unit: "meter", payment_method: "upi" }, receipt.values), ["material_id", "unit", "payment_method"]);
  assert.equal(repeat.repeatFamilyFor("quotes"), null);
});

test("NOV-009: the copy rules and the database lineage allow-list are identical", () => {
  for (const [family, rule] of Object.entries(repeat.REPEAT_RULES)) {
    const match = migration.match(new RegExp(`when '${family}' then array\\[([^\\]]+)\\]`));
    assert.ok(match, family);
    assert.deepEqual(match[1].split(",").map(value => value.trim().replace(/'/g, "")), [...rule.copy], family);
    assert.equal(rule.copy.some(key => rule.cleared.includes(key)), false, `${family} copies and clears the same field`);
  }
});

// NOV-011 ---------------------------------------------------------------------------------------
test("NOV-011: pasted bundle rows are reviewed as valid, ambiguous or invalid with reasons", () => {
  const sources = [{ id: n7(50), labels: ["JOB-1"] }, { id: n7(51), labels: ["STK-9", "Rack 4 bundle"] }, { id: n7(52), labels: ["STK-9"] }];
  const text = ["Bundle\tSource\tPieces\tMetres\tGross kg\tTare kg", "b-1\tJOB-1\t10\t60\t72.5\t1.25", "B-2\tSTK-9\t5\t30\t36\t1", "B-3\tunknown\t5\t30\t36\t1",
    "B-1\tJOB-1\t5\t30\t36\t1", "B-4\tJOB-1\t2.5\t30\t36\t1", "B-5\tJOB-1\t5\t30\t36\t40", "=HYPERLINK(\"x\")\tJOB-1\t5\t30\t36\t1", "B-6\tJOB-1\t5\t30\t36.1234\t1", "B-7\t\t5\t30\t36\t1",
    "EXISTING\tJOB-1\t5\t30\t36\t1", "B-8\tJOB-1\t5\t30\t36\t1\tsecret"].join("\n");
  const result = paste.parseBundlePaste(text, sources, ["existing"]);
  assert.equal(result.error, null);
  const by = row => result.rows.find(item => item.sourceRow === row);
  assert.equal(by(2).status, "valid"); assert.equal(by(2).values.bundle_number, "B-1"); assert.equal(by(2).values.source_line_id, n7(50));
  assert.equal(by(3).status, "ambiguous"); assert.deepEqual(by(3).candidates, [n7(51), n7(52)]);
  assert.match(by(4).errors.join(), /does not match a dispatch-ready source/);
  assert.match(by(5).errors.join(), /repeated in row 2/);
  assert.match(by(6).errors.join(), /whole number/);
  assert.match(by(7).errors.join(), /less than gross/);
  assert.match(by(8).errors.join(), /Formulas are not accepted/);
  assert.match(by(9).errors.join(), /at most 3 decimals/);
  assert.equal(by(10).status, "ambiguous", "a blank source with several sources needs an explicit choice");
  assert.match(by(11).errors.join(), /already on this load/);
  assert.match(by(12).errors.join(), /beyond the declared columns/);
});

test("NOV-011: headers, units and row limits are enforced before any row is read", () => {
  const sources = [{ id: n7(50), labels: ["JOB-1"] }];
  assert.match(paste.parseBundlePaste("Bundle\tPieces", sources, []).error, /header row and at least one/);
  assert.match(paste.parseBundlePaste("Bundle\tPieces\tLength mm\tGross kg\tTare kg\nB1\t1\t6000\t2\t1", sources, []).error, /unsupported unit/);
  assert.match(paste.parseBundlePaste("Bundle\tPieces\tMetres\tGross kg\tTare kg\tPrice\nB1\t1\t6\t2\t1\t9", sources, []).error, /Unsupported column "Price"/);
  assert.match(paste.parseBundlePaste("Bundle\tBundle\tPieces\tMetres\tGross kg\tTare kg\nB1\tB1\t1\t6\t2\t1", sources, []).error, /unique/);
  assert.match(paste.parseBundlePaste("Bundle\tPieces\tGross kg\nB1\t1\t2", sources, []).error, /Required columns/);
  const many = ["Bundle,Pieces,Metres,Gross kg,Tare kg", ...Array.from({ length: 61 }, (_, index) => `B${index},1,6,2,1`)].join("\n");
  assert.match(paste.parseBundlePaste(many, sources, []).error, /up to 60/);
  // Comma-separated with quoted cells and a single source needing no Source column.
  const quoted = paste.parseBundlePaste('Bundle,Pieces,Metres,Gross kg,Tare kg\n"B,9",1,6,2,1\nB10,1,6,2,1', sources, []);
  assert.match(quoted.rows[0].errors.join(), /bundle tag/); assert.equal(quoted.rows[1].status, "valid"); assert.equal(quoted.rows[1].values.source_line_id, n7(50));
  assert.deepEqual(paste.duplicateBundleLine({ bundle_number: "B1", source_line_id: n7(50), number_of_pieces: "10", net_length_m: "60", gross_weight_kg: "72", tare_weight_kg: "1" }),
    { bundle_number: "", source_line_id: n7(50), number_of_pieces: "10", net_length_m: "60", gross_weight_kg: "", tare_weight_kg: "1" });
  assert.equal(paste.isFormulaCell("+cmd"), true); assert.equal(paste.isFormulaCell("@SUM(A1)"), true); assert.equal(paste.isFormulaCell("B-1"), false);
});

// NOV-017 ---------------------------------------------------------------------------------------
test("NOV-017: scanned values are untrusted; versions, links and damaged labels are refused", () => {
  const id = n7(60);
  assert.equal(qr.parseScanInput(qr.buildQrPayloadV2("die", id, "nonce")).kind, "v2");
  assert.deepEqual(qr.parseScanInput(`EO2:die:${id.toUpperCase()}:n`), { kind: "v2", entityType: "die", entityId: id, raw: `EO2:die:${id.toUpperCase()}:n` });
  assert.equal(qr.parseScanInput(qr.buildQrPayload({ companyId: ids.company, entityType: "die", entityId: id, nonce: "n" })).kind, "v1");
  for (const [value, reason] of [["https://evil.example/x", /link/], ["javascript:alert(1)", /link/], ["EO3:die:x", /version 3/], ["EO2:die:not-a-uuid:n", /damaged/], ["EO2:alien:" + id + ":n", /damaged/],
    ["EO:company:die:" + id + ":n", /damaged/], ["A B", /spaces/], ["x".repeat(201), /too long/], ["\u0007bell", /control/], ["", /Scan or type/], ["<script>", /characters/]]) {
    const parsed = qr.parseScanInput(value);
    assert.equal(parsed.kind, "rejected", value); assert.match(parsed.reason, reason, value);
  }
  assert.equal(qr.parseScanInput(id).kind, "uuid");
  assert.equal(qr.parseScanInput("BNDL-0042").kind, "value");
});

test("NOV-017: warnings name held, reserved and consumed material, and actions follow permissions", () => {
  assert.deepEqual(scanTask.scanWarnings("inventory_batch", { status: "available", qc_status: "on_hold" }).map(w => w.tone), ["critical"]);
  assert.match(scanTask.scanWarnings("inventory_batch", { status: "transformed", qc_status: "released" })[0].text, /transformed and is no longer available/);
  assert.equal(scanTask.scanWarnings("inventory_batch", { status: "reserved", qc_status: "released" })[0].tone, "warning");
  assert.deepEqual(scanTask.scanWarnings("inventory_batch", { status: "available", qc_status: "released" }), []);
  assert.match(scanTask.scanWarnings("die", { die_status: "under_correction" })[0].text, /under correction/);
  const all = { read: () => true, create: () => true, readDieHistory: true, splitBundles: true };
  const none = { read: () => false, create: () => false, readDieHistory: false, splitBundles: false };
  assert.deepEqual(scanTask.scanActions("die", { id: n7(61) }, all).map(a => a.label), ["Die operating history", "Open die record"]);
  assert.deepEqual(scanTask.scanActions("die", { id: n7(61) }, none), []);
  assert.deepEqual(scanTask.scanActions("inventory_batch", { id: n7(62), status: "available", qc_status: "on_hold" }, all).map(a => a.label), ["Stock balances"], "held stock is not offered for splitting");
  assert.deepEqual(scanTask.scanActions("production_job", { id: n7(63), status: "in_progress" }, all).map(a => a.label), ["Open job", "Record output"]);
  assert.deepEqual(scanTask.scanActions("order", { id: n7(64), current_stage: "delivered" }, all).map(a => a.label), ["Open order"]);
});

test("NOV-017: scans resolve in the session company only and a session rechecks status when recorded", async () => {
  const f = createNov7ActionsFixture("../../lib/actions/scan.ts");
  const bundle = n7(70), held = n7(71), die = n7(72), foreign = n7(73);
  f.state.context.role = "dispatch";
  f.state.tables.qr_codes = [
    { id: n7(80), company_id: ids.company, qr_value: `EO2:inventory_batch:${bundle}:a`, entity_type: "inventory_batch", entity_id: bundle, status: "active", expires_at: null },
    { id: n7(81), company_id: ids.company, qr_value: `EO2:inventory_batch:${held}:b`, entity_type: "inventory_batch", entity_id: held, status: "active", expires_at: null },
    { id: n7(82), company_id: ids.company, qr_value: "OLD-LABEL", entity_type: "die", entity_id: die, status: "archived", expires_at: null },
    { id: n7(83), company_id: ids.otherCompany, qr_value: `EO2:inventory_batch:${foreign}:c`, entity_type: "inventory_batch", entity_id: foreign, status: "active", expires_at: null },
    { id: n7(84), company_id: ids.company, qr_value: "EXPIRED", entity_type: "die", entity_id: die, status: "active", expires_at: "2020-01-01T00:00:00Z" }
  ];
  f.state.tables.profile_stock_batches = [
    { id: bundle, company_id: ids.company, bundle_number: "SB-1", status: "available", qc_status: "released", quantity_pieces: 10, total_weight_kg: 72, location: "Rack 4" },
    { id: held, company_id: ids.company, bundle_number: "SB-2", status: "available", qc_status: "on_hold", quantity_pieces: 5, total_weight_kg: 36, location: "Rack 4" },
    { id: foreign, company_id: ids.otherCompany, bundle_number: "SB-F", status: "available", qc_status: "released" }
  ];
  const ok = await f.actions.resolveScanAction(`EO2:inventory_batch:${bundle}:a`);
  assert.equal(ok.ok, true); assert.equal(ok.label, "SB-1"); assert.deepEqual(ok.warnings, []);
  assert.equal(Object.keys(ok.details).includes("id"), false);
  assert.ok(f.state.tables.scan_events.some(event => event.action_type === "viewed" && event.company_id === ids.company && event.scanned_by === ids.owner));
  assert.match((await f.actions.resolveScanAction(`EO2:inventory_batch:${foreign}:c`)).error, /no longer available to you|No current record/);
  assert.match((await f.actions.resolveScanAction(qr.buildQrPayload({ companyId: ids.otherCompany, entityType: "die", entityId: die, nonce: "x" }))).error, /another company/);
  assert.match((await f.actions.resolveScanAction("OLD-LABEL")).error, /withdrawn or replaced/);
  assert.match((await f.actions.resolveScanAction("EXPIRED")).error, /expired/);
  assert.match((await f.actions.resolveScanAction("https://evil.example")).error, /link/);
  // Dispatch loading refuses held stock and duplicates; the held bundle is refused at recording time.
  const session = await f.actions.recordScanSessionAction({ task: "loaded_for_dispatch", codes: [`EO2:inventory_batch:${bundle}:a`, `EO2:inventory_batch:${held}:b`, `EO2:inventory_batch:${bundle}:a`] });
  assert.equal(session.ok, true); assert.deepEqual(session.recorded.map(item => item.label), ["SB-1"]);
  assert.match(session.refused[0].reason, /QC hold/); assert.match(session.refused[1].reason, /already scanned/);
  // Stock checks keep the warning with the scan instead of refusing it.
  const check = await f.actions.recordScanSessionAction({ task: "stock_checked", codes: [`EO2:inventory_batch:${held}:b`] });
  assert.deepEqual(check.recorded[0].warnings.length, 1);
  assert.equal(f.state.tables.scan_events.filter(event => event.action_type === "stock_checked")[0].metadata_json.warnings.length, 1);
  assert.match((await f.actions.recordScanSessionAction({ task: "die_checked", codes: [`EO2:inventory_batch:${bundle}:a`] })).refused[0].reason, /not part of a die check/);
  // Roles without scanner access and dealers are refused before any read.
  f.state.context.role = "sales"; assert.match((await f.actions.resolveScanAction(`EO2:inventory_batch:${bundle}:a`)).error, /not available for your role/);
  f.state.context.role = "owner"; f.state.context.dealerId = n7(99); assert.equal((await f.actions.resolveScanAction(`EO2:inventory_batch:${bundle}:a`)).ok, false);
  assert.equal((await f.actions.recordScanSessionAction({ task: "nonsense", codes: ["x"] })).ok, false);
});

// NOV-010 ---------------------------------------------------------------------------------------
test("NOV-010: an in-task vendor is checked for duplicates, created once per request and selected", async () => {
  const f = createNov7ActionsFixture("../../lib/actions/in-task-vendors.ts");
  f.state.tables.vendors = [{ id: n7(90), company_id: ids.company, vendor_name: "Shree Transport Co", vendor_type: "transporter", phone: "9876543210", gst_number: null, is_active: true },
    { id: n7(91), company_id: ids.otherCompany, vendor_name: "Shree Transport Co", vendor_type: "transporter", phone: "9876543210", is_active: true }];
  // AP-038: a vendor without a GSTIN is saved only with the explicit unregistered choice.
  const vendor = { vendor_name: "Shree  Transport", vendor_type: "transporter", contact_person: "", phone: "+91 98765 43210", gst_number: "", gst_registration: "unregistered", city: "Pune" };
  const checked = await f.actions.inTaskVendorAction({ intent: "check", vendor });
  assert.equal(checked.kind, "checked"); assert.deepEqual(checked.matches.map(match => match.id), [n7(90)], "only this company's vendors are matched");
  assert.deepEqual(checked.matches[0].matched_on.sort(), ["phone", "vendor name"]);
  const request = n7(92);
  assert.equal((await f.actions.inTaskVendorAction({ intent: "create", vendor, request_id: request })).kind, "similar", "a likely duplicate needs acknowledgement");
  const created = await f.actions.inTaskVendorAction({ intent: "create", vendor, request_id: request, acknowledge_similar: true });
  assert.equal(created.kind, "created"); assert.equal(created.vendor.id, request);
  const row = f.state.tables.vendors.find(item => item.id === request);
  assert.equal(row.company_id, ids.company); assert.equal(row.created_by, ids.owner); assert.equal(row.phone, "9876543210");
  assert.equal((await f.actions.inTaskVendorAction({ intent: "create", vendor, request_id: request, acknowledge_similar: true })).vendor.id, request, "a retry returns the same vendor");
  assert.equal(f.state.tables.vendors.filter(item => item.id === request).length, 1);
  assert.equal((await f.actions.inTaskVendorAction({ intent: "create", vendor: { ...vendor, city: "Nashik" }, request_id: request, acknowledge_similar: true })).kind, "error", "a reused request with other details is refused");
  assert.equal((await f.actions.inTaskVendorAction({ intent: "select", vendor_id: n7(90) })).vendor.vendor_name, "Shree Transport Co");
  assert.equal((await f.actions.inTaskVendorAction({ intent: "select", vendor_id: n7(91) })).kind, "error", "another company's vendor cannot be selected");
  assert.equal((await f.actions.inTaskVendorAction({ intent: "check", vendor: { ...vendor, company_id: ids.otherCompany } })).kind, "error", "injected tenant keys are refused");
  f.state.context.role = "production"; assert.match((await f.actions.inTaskVendorAction({ intent: "check", vendor })).error, /cannot create vendors/);
  f.state.context.role = "owner"; f.state.context.dealerId = n7(98); assert.match((await f.actions.inTaskVendorAction({ intent: "check", vendor })).error, /cannot create vendors/);
  f.state.context.dealerId = null; f.state.insertError = "23514";
  assert.match((await f.actions.inTaskVendorAction({ intent: "create", vendor: { ...vendor, vendor_name: "Brand new carrier", phone: "" }, request_id: n7(93) })).error, /was not saved/);
  assert.equal(vendorForm.sameVendorRequest({ created_by: ids.owner, vendor_name: "A" }, { vendor_name: "A" }, ids.production), false);
});

// Batch 7 hub contracts ---------------------------------------------------------------------------
test("hub forms join lines, omit blank optional fields and validate before review", () => {
  const fields = [{ key: "category", label: "Kind" }, { key: "description", label: "What", type: "note" }, { key: "evidence", label: "Ref", optional: true }];
  const built = improvementForm.buildImprovementMutation("suggestion.submit", fields, { category: "repeated_lookup", description: "Line one\nline two of the friction", evidence: "  " }, { source_path: "/dispatches/new" });
  assert.equal(built.success, true, JSON.stringify(built.error?.issues));
  assert.deepEqual(built.data, { action: "suggestion.submit", category: "repeated_lookup", description: "Line one line two of the friction", source_path: "/dispatches/new" });
  assert.equal(improvementForm.buildImprovementMutation("suggestion.submit", fields, { category: "repeated_lookup", description: "short" }, { source_path: "/x" }).success, false);
  assert.equal(improvement.suggestionSourcePath("/dispatches/new?draft=secret#x"), "/dispatches/new");
  assert.equal(improvement.suggestionSourcePath("/a/../admin"), "/");
  assert.equal(improvement.suggestionSourcePath("//evil.example/x"), "/evil.example/x");
  const decline = improvement.improvementMutationSchema.safeParse({ action: "suggestion.respond", id: n7(1), status: "declined", response: "Not this quarter" });
  assert.equal(decline.success, false);
  const threshold = improvement.improvementMutationSchema.safeParse({ action: "threshold.propose", basis: "runs_since_service", service_event: "nitriding", warn_at: 2.5, rationale: "Tooling", note: "Reviewed with tooling" });
  assert.equal(threshold.success, false);
});

test("hub server action keeps unsafe database text private and reports a missing upgrade as unavailable", async () => {
  const f = createNov7ActionsFixture("../../lib/actions/improvement.ts");
  const list = { rows: [], total_count: 0, as_of: new Date().toISOString() };
  f.state.rpcHandler = () => ({ data: list, error: null });
  assert.deepEqual((await f.actions.improvementAction({ command: "list", view: "suggestions" })).data, list);
  f.state.rpcHandler = () => ({ data: null, error: { code: "PGRST202", message: "function missing" } });
  const missing = await f.actions.improvementAction({ command: "list", view: "problems" });
  assert.equal(missing.unavailable, true); assert.match(missing.error, /batch 7 database upgrade/);
  f.state.rpcHandler = () => ({ data: null, error: { code: "P0001", message: "NOV: The problem is unavailable." } });
  assert.equal((await f.actions.improvementAction({ command: "detail", view: "problems", id: n7(1) })).error, "The problem is unavailable.");
  f.state.rpcHandler = () => ({ data: null, error: { code: "XX000", message: "internal relation private.secret" } });
  const hidden = await f.actions.improvementAction({ command: "list", view: "problems" });
  assert.doesNotMatch(hidden.error, /secret|relation/);
  f.state.context.role = "production";
  const calls = f.state.calls.length;
  assert.match((await f.actions.improvementAction({ command: "list", view: "problems" })).error, /not permitted/);
  assert.match((await f.actions.improvementAction({ command: "preview", request_id: n7(2), mutation: { action: "route.set", category: "other", owner_id: n7(3), note: "Reviewed routing" } })).error, /not permitted/);
  assert.equal(f.state.calls.length, calls, "refused requests never reach the database");
  f.state.context.role = "owner";
  f.state.rpcHandler = () => { throw Error("Transport lost"); };
  const lost = await f.actions.improvementAction({ command: "commit", request_id: n7(2), fingerprint: "a".repeat(32) });
  assert.equal(lost.uncertain, true);
});
