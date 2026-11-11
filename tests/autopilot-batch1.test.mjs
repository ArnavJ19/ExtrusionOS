import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { crc32, deflateRawSync } from "node:zlib";

// Path aliases (@/...) inside lib modules resolve through tsx's CommonJS loader, as in the November batch tests.
const require = createRequire(import.meta.url);
require("tsx/cjs");
const { checkGstin, gstinCheckCharacter, resolveGstRegistration, GST_STATES } = require("../lib/validations/gstin.ts");
const { customerFormSchema, vendorFormSchema } = require("../lib/validations/schemas.ts");
const { inTaskCustomerSchema } = require("../lib/forms/in-task-customer.ts");
const { addLeadDays, addWorkingDays, isWorkingDay, workingDaysBetween, calendarExceptionInputSchema, calendarSettingsSchema } = require("../lib/calendar/working-time.ts");
const { buildFactoryDeliveryProposal } = require("../lib/workflow/factory-planning.ts");
const { financialYearLabel, checkSeriesTemplate, renderSeriesNumber } = require("../lib/numbering/financial-year.ts");
const { parseCsv, parseXlsx, parseSpreadsheet } = require("../lib/master-data/import/spreadsheet.ts");
const { MASTER_DEFINITIONS, CUTOVER_DEFINITIONS, parseSheetDate, parseSheetNumber } = require("../lib/master-data/import/definitions.ts");
const { autoMap, mappingProblems, validateSheet, rejectedRowsCsv, templateCsv } = require("../lib/master-data/import/engine.ts");
const { normalizeVisitRoute, navigationSaveSchema } = require("../lib/navigation/role-navigation.ts");
const { buildTaskNavigation } = require("../lib/navigation/task-navigation.ts");
const { homeForHubNew, parseWorkAction, HOME_STARTS, MODULE_STARTS, HUB_CONFIGURATION_ACTIONS } = require("../lib/navigation/home-work.ts");
const { canUseHubAction } = require("../lib/navigation/hub-permissions.ts");
const { isAuthorizedCronRequest } = require("../lib/jobs/cron-auth.ts");
const { decideBatchInputSchema, decideInputSchema, proposalWhy, proposalSummary } = require("../lib/proposals/proposals.ts");

test("AP-038 GSTIN check digit, state and PAN, and the registration choice", () => {
  assert.equal(gstinCheckCharacter("27AAPFU0939F1Z"), "V");
  assert.deepEqual(checkGstin(" 27aapfu0939f1zv "), { valid: true, gstin: "27AAPFU0939F1ZV", stateCode: "27", state: "Maharashtra", pan: "AAPFU0939F" });
  assert.equal(checkGstin("27AAPFU0939F1ZW").reason, "check_digit");
  assert.equal(checkGstin("40AAPFU0939F1ZV").reason, "state");
  assert.equal(checkGstin("27AAPFU0939F1Z").reason, "length");
  assert.equal(checkGstin("27AAPFU09391FZV").reason, "format");
  assert.equal(Object.keys(GST_STATES).length, 40);
  assert.deepEqual(resolveGstRegistration({ gst_number: "07ABCDE1234F1Z2" }), { ok: true, gst_number: "07ABCDE1234F1Z2", gst_registration: "registered", state: "Delhi" });
  assert.equal(resolveGstRegistration({ gst_number: "" }).ok, false, "blank needs the explicit unregistered choice");
  assert.equal(resolveGstRegistration({ gst_registration: "unregistered" }).ok, true);
  assert.equal(resolveGstRegistration({ gst_number: "07ABCDE1234F1Z2", gst_registration: "unregistered" }).ok, false);
  const base = { customer_name: "Patel Aluminium", customer_type: "dealer" };
  assert.equal(customerFormSchema.safeParse({ ...base, gst_number: "" }).success, false);
  assert.equal(customerFormSchema.safeParse({ ...base, gst_number: "", gst_registration: "unregistered" }).success, true);
  const invalid = customerFormSchema.safeParse({ ...base, gst_number: "27AAPFU0939F1ZW" });
  assert.match(invalid.error.issues.map(issue => issue.message).join(" "), /check digit/);
  assert.equal(vendorFormSchema.safeParse({ vendor_name: "VRL", vendor_type: "transporter", gst_number: "27aapfu0939f1zv" }).data.gst_number, "27AAPFU0939F1ZV");
  assert.equal(inTaskCustomerSchema.safeParse({ customer_name: "Quick party", customer_type: "fabricator" }).success, false);
  assert.equal(inTaskCustomerSchema.safeParse({ customer_name: "Quick party", customer_type: "fabricator", gst_registration: "unregistered" }).success, true);
});

test("AP-004 working days skip shutdowns and weekly offs; a delivery proposal moves by the shutdown", () => {
  const calendar = { weeklyOff: [0], promiseBasis: "calendar", exceptions: [{ date_from: "2026-11-10", date_to: "2026-11-14", kind: "shutdown" }, { date_from: "2026-11-15", date_to: "2026-11-15", kind: "working_day" }] };
  assert.equal(isWorkingDay(calendar, "2026-11-09"), true);
  assert.equal(isWorkingDay(calendar, "2026-11-12"), false);
  assert.equal(isWorkingDay(calendar, "2026-11-15"), true, "a working-day entry overrides the Sunday off");
  assert.equal(isWorkingDay(calendar, "2026-11-22"), false);
  assert.equal(addWorkingDays(calendar, "2026-11-09", 5), "2026-11-19");
  assert.equal(workingDaysBetween(calendar, "2026-11-08", "2026-11-21"), 8);
  assert.equal(addLeadDays(calendar, "2026-11-09", 5), "2026-11-14", "calendar basis is unchanged");
  assert.equal(addLeadDays({ ...calendar, promiseBasis: "working" }, "2026-11-09", 5), "2026-11-19");
  assert.throws(() => addWorkingDays(calendar, "2026-11-09", -1), RangeError);
  assert.equal(calendarExceptionInputSchema.safeParse({ date_from: "2026-11-10", date_to: "2026-11-09", kind: "holiday", label: "Back" }).success, false);
  assert.equal(calendarSettingsSchema.safeParse({ weekly_off: [0], shifts: [{ code: "A", start: "06:00", end: "14:00" }, { code: "A", start: "14:00", end: "22:00" }], promise_basis: "calendar" }).success, false);

  const id = n => `ad000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const data = {
    company_id: id(1), today: "2026-11-09",
    order: { id: id(2), order_number: "SO-1", current_stage: "order_confirmed", expected_dispatch_date: null, billets_short: 0, billet_allocation_status: "complete" },
    lines: [{ order_item_id: id(3), order_id: id(2), order_number: "SO-1", customer_name: "C", order_stage: "order_confirmed", line_label: "L", profile_code: "P", ordered_kg: 3000,
      from_stock_kg: 0, produced_kg: 0, planned_open_kg: 3000, packed_kg: 0, dispatched_kg: 0, line_required_date: null, effective_date: null, effective_priority: "normal", order_closed: false }],
    jobs: [{ id: id(4), job_number: "J-1", source_line_id: id(3), status: "planned", planned_quantity_kg: 3000, actual_quantity_kg: 0, machine_id: id(5), finishing_type: "mill_finish" }],
    slots: [], shift_capacities: [1, 2, 3, 4, 5, 6].map(weekday => ({ id: id(10 + weekday), machine_id: id(5), weekday, shift_name: "A", starts_local: "06:00", ends_local: "14:00", capacity_kg: 1000 })),
    maintenance_blocks: [], finishing_lead_times: [{ finishing_type: "mill_finish", lead_days: 1 }], eligible_stock_kg: 0, eligible_bundle_count: 0, unlinked_packed_kg: 0, active_load_dates: []
  };
  const without = buildFactoryDeliveryProposal(data);
  const withCalendar = buildFactoryDeliveryProposal(data, { weeklyOff: [0], promiseBasis: "calendar", exceptions: [{ date_from: "2026-11-10", date_to: "2026-11-14", kind: "shutdown" }] });
  assert.equal(without.proposalDate, "2026-11-12", "three Mon-Wed shifts plus one lead day");
  assert.equal(withCalendar.proposalDate, "2026-11-18", "the same work after the shutdown: Mon 9, Mon 16, Tue 17, plus one lead day");
  assert.ok(withCalendar.assumptions.some(line => /5 factory holiday, shutdown or maintenance day/.test(line)));
});

test("AP-005 financial year labels, GST length limit and number rendering", () => {
  assert.equal(financialYearLabel("2027-03-31"), "26-27");
  assert.equal(financialYearLabel("2027-04-01"), "27-28");
  assert.equal(financialYearLabel("2026-11-09", true), "2026-27");
  assert.equal(renderSeriesNumber("OMX/{FY}/", 4, "2027-04-01", 7), "OMX/27-28/0007");
  assert.deepEqual(checkSeriesTemplate("invoices", "OMX/{FY}/", 4, "2026-11-09"), { ok: true, example: "OMX/26-27/0001", longest: "OMX/26-27/9999" });
  // The catalogue's example OMX/INV/26-27/0001 is 18 characters, above the CGST Rule 46 limit.
  assert.match(checkSeriesTemplate("invoices", "OMX/INV/{FY}/", 4, "2026-11-09").message, /18 characters; GST allows at most 16/);
  assert.equal(checkSeriesTemplate("quotes", "OMX/QUOTE/{FY4}/", 5, "2026-11-09").ok, true, "the GST limit applies to tax documents only");
  assert.equal(checkSeriesTemplate("orders", "SO/2026/", 4, "2026-11-09").ok, false, "a series must reset by financial year");
});

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8"), packed = deflateRawSync(data), nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, packed); centrals.push(central, nameBuffer);
    offset += 30 + nameBuffer.length + packed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("AP-006 reads .xlsx (shared, inline, numeric and date cells) and .csv without a dependency", () => {
  const workbook = zip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Customers &amp; parties" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Party Name</t></si><si><t>GST No</t></si><si><r><t>Patel </t></r><r><t>Aluminium</t></r></si><si><t>Mobile</t></si><si><t>Since</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>27AAPFU0939F1ZV</t></is></c><c r="C2"><v>9876543210</v></c><c r="E2"><v>46335</v></c></row>
      <row r="4"><c r="A4" t="inlineStr"><is><t>Gap &lt;row&gt;</t></is></c></row></sheetData></worksheet>`
  });
  const sheet = parseXlsx(workbook);
  assert.equal(sheet.sheetName, "Customers & parties");
  assert.deepEqual(sheet.headers, ["Party Name", "GST No", "Mobile", "", "Since"]);
  assert.deepEqual(sheet.rows.map(row => [row.row, row.cells[0], row.cells[1], row.cells[2], row.cells[4]]), [[2, "Patel Aluminium", "27AAPFU0939F1ZV", "9876543210", "46335"], [4, "Gap <row>", "", "", ""]]);
  assert.equal(parseSheetDate("46335"), "2026-11-09", "Excel day serial");
  assert.equal(parseSheetDate("09/11/2026"), "2026-11-09", "DD/MM/YYYY");
  assert.equal(parseSheetDate("31/02/2026"), null);
  assert.equal(parseSheetNumber("₹1,20,000.50"), 120000.5);
  assert.equal(parseSheetNumber("12 kg"), null, "unreadable is not zero");
  const csv = parseCsv("﻿Code;Name;kg/m\r\nOM-4521;\"Casement; frame \"\"A\"\"\";1,12\r\n");
  assert.deepEqual(csv.headers, ["Code", "Name", "kg/m"]);
  assert.deepEqual(csv.rows[0].cells, ["OM-4521", "Casement; frame \"A\"", "1,12"]);
  assert.throws(() => parseSpreadsheet("old.xls", Buffer.from("x")), /Save As/);
  assert.throws(() => parseSpreadsheet("a.xlsx", Buffer.from("not a zip")), /not a readable Excel workbook/);
});

test("AP-006 maps columns (remembered first), keeps blanks blank and reports exact row problems", () => {
  const definition = MASTER_DEFINITIONS.customers;
  const sheet = { headers: ["Party Name", "GST No", "Mobile", "City", "Type", "Remarks"], sheetName: null, rows: [
    { row: 2, cells: ["Patel Aluminium", "27AAPFU0939F1ZV", "+91 98765 43210", "Surat", "Dealer", ""] },
    { row: 3, cells: ["Sharma", "", "12345", "Pune", "Wholesaler", "=HYPERLINK(\"x\")"] },
    { row: 4, cells: ["Mehta Windows", "", "", "Nashik", "", ""] },
    { row: 5, cells: ["", "", "", "", "", ""] }
  ] };
  const mapping = autoMap(sheet.headers, definition, null);
  assert.deepEqual(mapping, { "Party Name": "customer_name", "GST No": "gst_number", Mobile: "phone", City: "city", Type: "customer_type", Remarks: "notes" });
  assert.deepEqual(autoMap(sheet.headers, definition, { Remarks: null, City: "shipping_address" }).City, "shipping_address", "a remembered choice wins");
  assert.deepEqual(mappingProblems({ City: "city" }, definition).missing, ["Customer name"]);
  const { valid, rejected } = validateSheet(sheet, mapping, definition);
  assert.equal(valid.length, 1);
  assert.deepEqual(valid[0].values, { customer_name: "Patel Aluminium", gst_number: "27AAPFU0939F1ZV", company_name: null, customer_type: "dealer", gst_registration: "registered", contact_person: null,
    phone: "9876543210", email: null, city: "Surat", state: "Maharashtra", payment_terms: null, notes: null, whatsapp_number: null, billing_address: null, shipping_address: null, pincode: null, credit_terms: null });
  assert.deepEqual(rejected.map(row => row.row), [3, 4]);
  assert.match(rejected[0].errors.join("; "), /Customer type "Wholesaler" is not one of/);
  assert.match(rejected[0].errors.join("; "), /not an Indian mobile/);
  assert.match(rejected[1].errors.join("; "), /mark the party unregistered/);
  const csv = rejectedRowsCsv(sheet.headers, rejected);
  assert.match(csv, /'=HYPERLINK/, "formula cells are neutralised in the rejected-row file");
  assert.match(csv.split("\n")[0], /^Sheet row,Party Name,GST No,Mobile,City,Type,Remarks,Problems$/);
  const profiles = validateSheet({ headers: ["Section Code", "Name", "kg/m"], sheetName: null, rows: [{ row: 2, cells: ["om-1", "Frame", ""] }, { row: 3, cells: ["om-2", "Bead", "0"] }] },
    autoMap(["Section Code", "Name", "kg/m"], MASTER_DEFINITIONS.profiles, null), MASTER_DEFINITIONS.profiles);
  assert.deepEqual(profiles.rejected.map(row => row.errors[0]), ["Section weight kg/m is missing", "Section weight kg/m must be above zero"]);
  assert.equal(templateCsv(CUTOVER_DEFINITIONS.receivables), "Customer (name or GSTIN),Invoice number,Invoice date,Due date,Outstanding (₹)");
});

test("AP-042 visits count the destination only, and an approved navigation keeps permissions", () => {
  const destinations = [{ href: "/orders" }, { href: "/settings" }, { href: "/settings/data" }, { href: "/dispatches", aliases: ["/shipments"] }];
  assert.equal(normalizeVisitRoute("/orders/7c9e6679-7425-40de-944b-e07fc1f90ae7/edit?tab=lines", destinations), "/orders");
  assert.equal(normalizeVisitRoute("/settings/data/import", destinations), "/settings/data");
  assert.equal(normalizeVisitRoute("/shipments/abc", destinations), "/dispatches");
  assert.equal(normalizeVisitRoute("/unknown", destinations), null);
  assert.equal(navigationSaveSchema.safeParse({ role: "sales", items: Array.from({ length: 10 }, (_, k) => `/m${k}`) }).success, false);
  const items = ["/dashboard", "/orders", "/quotes", "/invoices", "/automation"].map(href => ({ href, label: href, icon: "x", roles: ["sales", "owner"] }));
  const model = buildTaskNavigation({ items, role: "sales", featureFlags: {}, isFeatureEnabled: () => true, hasRouteAccess: href => href !== "/invoices" && href !== "/automation",
    approvedItems: ["/quotes", "/invoices", "/orders"] });
  assert.deepEqual(model.primary.map(item => item.href), ["/quotes", "/orders"], "approved order, and a link the role cannot open is never shown");
  assert.deepEqual(model.more.flatMap(group => group.items.map(item => item.href)), ["/dashboard"]);
  assert.ok(buildTaskNavigation({ items, role: "owner", featureFlags: {}, isFeatureEnabled: () => true, hasRouteAccess: () => true, primaryLimit: 20 }).primary.length <= 9);
});

test("AP-041 hub entry points move to the record or module they belong to; configuration stays in its hub", () => {
  const order = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  assert.equal(homeForHubNew("coordination", "priority.set", { order_id: order }), `/orders/${order}/work?action=coordination%3Apriority.set`);
  assert.equal(homeForHubNew("coordination", "priority.set", {}), "/orders/database");
  assert.equal(homeForHubNew("coordination", "priority.set", { order_id: "../../etc" }), "/orders/database");
  assert.equal(homeForHubNew("specialist", "transfer.request", {}), "/inventory/work?action=specialist%3Atransfer.request");
  assert.equal(homeForHubNew("specialist", "automation.define", {}), null);
  assert.equal(homeForHubNew("control", "policy.set", {}), null);
  assert.deepEqual(parseWorkAction("lifecycle:promise.propose"), { hub: "lifecycle", action: "promise.propose" });
  assert.equal(parseWorkAction("nope:promise.propose"), null);
  assert.equal(parseWorkAction("lifecycle:<script>"), null);
  // Every listed start is a real hub action that at least one role may perform.
  const roles = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"];
  for (const start of [...Object.values(HOME_STARTS).flat(), ...Object.values(MODULE_STARTS).flat()]) {
    assert.ok(roles.some(role => canUseHubAction(start.hub, role, start.action)), `${start.hub}:${start.action}`);
    assert.equal(HUB_CONFIGURATION_ACTIONS[start.hub].includes(start.action), false);
  }
  assert.equal(canUseHubAction("specialist", "dealer_admin", "intake.submit"), false);
});

test("AP-001 cron requests need the exact secret; AP-002 inputs and descriptions", () => {
  const secret = "s".repeat(32);
  assert.equal(isAuthorizedCronRequest(`Bearer ${secret}`, secret), true);
  assert.equal(isAuthorizedCronRequest(`Bearer ${secret}x`, secret), false);
  assert.equal(isAuthorizedCronRequest(null, secret), false);
  assert.equal(isAuthorizedCronRequest("Bearer short", "short"), false, "a short secret is never accepted");
  assert.equal(isAuthorizedCronRequest(`Bearer ${secret}`, undefined), false);
  const uuid = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  assert.equal(decideInputSchema.safeParse({ id: uuid, decision: "reject" }).success, false, "a rejection needs a reason");
  assert.equal(decideBatchInputSchema.safeParse({ ids: [uuid], decision: "reject" }).success, false);
  assert.equal(decideBatchInputSchema.safeParse({ ids: Array(51).fill(uuid), decision: "accept" }).success, false);
  const row = { id: uuid, proposal_type: "series.adopt", target_key: "invoices", title: "Tax invoices", payload: { prefix_template: "OMX/{FY}/", pad_width: 4 }, evidence: { fy: "2026-27", example: "OMX/26-27/0001", gst_limit: 16 },
    versions: {}, rule_key: "series.fy_default", reason: "Reset each year", confidence: null, status: "open", created_at: "2026-11-09T00:00:00Z", expires_at: "2026-12-09T00:00:00Z", decided_at: null,
    decided_by: null, edited_fields: [], decision_note: null, outcome: null, editable: [], can_decide: true, stale_now: false, job_run_id: null };
  assert.match(proposalSummary(row), /Tax invoices: OMX\/\{FY\}\/ with 4-digit/);
  assert.ok(proposalWhy(row).some(line => /OMX\/26-27\/0001/.test(line)));
  assert.ok(proposalWhy({ ...row, proposal_type: "navigation.role_layout", target_key: "sales", payload: { items: ["/quotes"] }, evidence: { total_visits: 40, window_days: 28, days_observed: 15 }, confidence: 0.82 }).some(line => /82%/.test(line)));
});
