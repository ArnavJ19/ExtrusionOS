import test from "node:test";
import assert from "node:assert/strict";
import { getStatusPresentation } from "../lib/ui/status-presentation.ts";
import { formatNumeric, formatRate, numericKindForField, readDisplayNumber } from "../lib/utils/numeric-display.ts";
import { classifyReadFailure, readStateMessage } from "../lib/ui/read-state.ts";
import { databaseFilterChips, parseDatabaseView } from "../lib/ui/database-view.ts";
import { readinessBlockers } from "../lib/ui/readiness-blockers.ts";
import { lookupOptionContext } from "../lib/ui/lookup-option.ts";
import { viewStateParams } from "../lib/preferences/workspace-preferences.ts";

test("NOV-086: production, dispatch, quality and accounts share presentation while retaining their domain codes", () => {
  for (const code of ["on_hold", "delayed", "rejected", "overdue"]) {
    const presentation = getStatusPresentation(code);
    assert.equal(presentation.family, "blocked");
    assert.equal(presentation.code, code);
    assert.ok(presentation.labelText.length);
  }
  for (const code of ["completed", "delivered", "approved", "paid"]) assert.equal(getStatusPresentation(code).family, "completed");
  assert.equal(getStatusPresentation("in_transit").family, "active");
  assert.equal(getStatusPresentation("in_progress").family, "active");
  assert.equal(getStatusPresentation("payment_pending").family, "waiting");
  assert.equal(getStatusPresentation("available").family, "active");
  assert.equal(getStatusPresentation("critical").family, "blocked");
  assert.equal(getStatusPresentation("warning").family, "waiting");
});

test("NOV-086: unknown and blank statuses remain neutral and visible", () => {
  assert.equal(getStatusPresentation("future_status").family, "neutral");
  assert.equal(getStatusPresentation("future_status").labelText, "Future Status");
  assert.match(getStatusPresentation("").labelText, /unknown/i);
  assert.equal(getStatusPresentation(" PAID ").family, "completed");
});

test("NOV-093: absent, invalid and genuine zero quantities cannot collapse into the same display", () => {
  for (const value of [null, undefined, "", "   "]) assert.equal(formatNumeric(value, "weight"), "Not captured");
  for (const value of [NaN, Infinity, -Infinity, "broken", "0x10", "12 kg", "1,000"]) assert.equal(formatNumeric(value, "weight"), "Unavailable");
  assert.equal(formatNumeric(0, "weight"), "0.000 kg");
  assert.equal(formatNumeric("0", "currency"), "\u20b90.00");
  assert.equal(readDisplayNumber("-2.5e2"), -250);
});

test("NOV-093: correction signs, Indian scale, dimensions and non-INR currency remain explicit", () => {
  assert.equal(formatNumeric(-1250.126, "weight"), "-1,250.126 kg");
  assert.equal(formatNumeric(12345678.5, "currency"), "\u20b91,23,45,678.50");
  assert.equal(formatNumeric(6, "metres"), "6.00 m");
  assert.equal(formatNumeric(0.42751, "sectionWeight"), "0.428 kg/m");
  assert.equal(formatNumeric(17, "pieces"), "17 pcs");
  assert.equal(formatNumeric(1.2, "pieces"), "Unavailable");
  assert.equal(formatNumeric(12.5, "percent"), "12.5%");
  assert.doesNotMatch(formatNumeric(100, "currency", "USD"), /\u20b9/);
  assert.equal(formatRate(null, "kg"), "Not captured");
  assert.equal(formatRate(250, "kg"), "\u20b9250.00/kg");
});

test("NOV-093: configured record fields retain their piece, length, percentage and section-weight dimensions", () => {
  assert.equal(numericKindForField("production.pieces", "number"), "pieces");
  assert.equal(numericKindForField("quantity_pieces", "number"), "pieces");
  assert.equal(formatNumeric(1.25, numericKindForField("quantity_pieces", "number")), "Unavailable");
  assert.equal(formatNumeric(0, numericKindForField("production_pieces", "number")), "0 pcs");
  assert.equal(formatNumeric(6, numericKindForField("length_per_piece_m", "number")), "6.00 m");
  assert.equal(formatNumeric(80, numericKindForField("furnace_efficiency_percent", "number")), "80%");
  assert.equal(formatNumeric(0.8, numericKindForField("section_weight_kg_per_m", "weight")), "0.800 kg/m");
  assert.equal(numericKindForField("current_stock", "number"), "number");
});

test("NOV-099: denied access, source failure and filtered emptiness have distinct recovery guidance", () => {
  assert.equal(classifyReadFailure({ code: "42501", message: "secret database detail" }), "denied");
  assert.equal(classifyReadFailure(new Error("network")), "failed");
  assert.notEqual(readStateMessage("empty").title, readStateMessage("filtered").title);
  assert.match(readStateMessage("filtered").description, /filter/i);
  assert.match(readStateMessage("failed").description, /does not mean.*no stock/i);
  assert.doesNotMatch(JSON.stringify(readStateMessage("denied")), /secret/);
  assert.match(readStateMessage("partial").description, /last successful/i);
});

const rules = { statuses: ["ready", "on_hold"], secondary: [{ value: "urgent", label: "Urgent" }], sortable: ["job_number", "planned_date"], defaultSort: { column: "planned_date", direction: "desc" }, dates: true };
const uuid = "10000000-0000-4000-8000-000000000001";

test("NOV-091: shared URLs preserve combined supported filters, ordering and page", () => {
  const state = parseDatabaseView(new URLSearchParams(`status=ready&secondary=urgent&search=Press+7&page=3&sort=job_number&direction=asc&dateFrom=2026-11-01&dateTo=2026-11-02&order_id=${uuid}`), rules);
  assert.equal(state.page, 3);
  assert.equal(state.search, "Press 7");
  assert.equal(state.status, "ready");
  assert.deepEqual(parseDatabaseView(viewStateParams(state), rules), state);
  const chips = databaseFilterChips(state, { status: "Job state", secondary: "Priority", secondaryOptions: rules.secondary, date: "Planned" });
  assert.equal(chips.length, 6);
  assert.ok(chips.some((chip) => chip.label === "Priority: Urgent"));
  assert.ok(chips.some((chip) => chip.key === "order_id" && chip.label === "Connected order"));
  assert.equal(JSON.stringify(chips).includes(uuid), false);
});

test("NOV-091: malformed or unsupported URL values cannot become query fields", () => {
  const state = parseDatabaseView(new URLSearchParams("status=secret&secondary=no&page=-5&sort=internal_cost&direction=injected&dateFrom=2026-02-31&dateTo=wrong&order_id=not-a-uuid&company_id=other"), rules);
  assert.equal(state.status, "");
  assert.equal(state.secondary, "");
  assert.equal(state.page, 1);
  assert.equal(state.sort, "planned_date");
  assert.equal(state.direction, "desc");
  assert.equal(state.dateFrom, "");
  assert.equal(state.dateTo, "");
  assert.deepEqual(state.relationFilters, {});
  assert.equal("company_id" in state, false);
});

test("NOV-091: reversed dates, disabled date filtering and long input are bounded", () => {
  const reversed = parseDatabaseView(new URLSearchParams("dateFrom=2026-12-01&dateTo=2026-11-01&page=999999999&search=" + "x".repeat(1000)), rules);
  assert.equal(reversed.dateFrom, "");
  assert.equal(reversed.dateTo, "");
  assert.equal(reversed.page, 100000);
  assert.equal(reversed.search.length, 100);
  assert.equal(parseDatabaseView(new URLSearchParams("dateFrom=2026-11-01"), { ...rules, dates: false }).dateFrom, "");
  assert.equal(parseDatabaseView(new URLSearchParams(), rules, "ready").status, "ready");
  assert.equal(parseDatabaseView(new URLSearchParams("status="), rules, "ready").status, "");
});

test("NOV-016: enforced blockers lead advisories, describe their source and leave ownership honest", () => {
  const issues = [{ code: "slot_missing", message: "No slot has been recorded", enforced: false }, { code: "drawing_not_approved", message: "Drawing not approved", enforced: true }];
  const instructions = readinessBlockers(issues, { jobId: uuid, profileId: uuid }, "owner");
  assert.equal(instructions[0].code, "drawing_not_approved");
  assert.equal(instructions[0].source, "Profile drawing approval");
  assert.equal(instructions[0].team, "Technical and quality");
  assert.equal(instructions[0].evidence, "Missing evidence or setup");
  assert.equal(instructions[0].resolution.href, `/profiles/${uuid}`);
  assert.equal(issues[0].code, "slot_missing");
  assert.equal("assignee" in instructions[0], false);
});

test("NOV-016: unauthorized edit/issue links are withheld and unknown rules do not invent a resolution", () => {
  const issues = ["die_missing", "billets_not_issued", "new_domain_rule"].map((code) => ({ code, message: "Review the source", enforced: true }));
  for (const instruction of readinessBlockers(issues, { jobId: uuid }, "viewer")) assert.equal(instruction.resolution, null);
  for (const instruction of readinessBlockers(issues, { jobId: uuid }, "dealer_staff")) assert.equal(instruction.resolution, null);
  const unknown = readinessBlockers([issues[2]], { jobId: uuid }, "owner")[0];
  assert.equal(unknown.team, "Responsible team not recorded");
  assert.equal(unknown.resolution, null);
});

test("NOV-092: lookup context uses identifiers and units without financial or internal payloads", () => {
  const context = lookupOptionContext({ city: "Delhi", phone: "9876543210", section_weight_kg_per_m: 0.425, alloy: "6063", temper: "T6", rack_location: "Rack 3", die_status: "approved", internal_cost: 999999, notes: "restricted" });
  assert.match(context, /Delhi/);
  assert.match(context, /0.425 kg\/m/);
  assert.match(context, /Rack 3/);
  assert.doesNotMatch(context, /999999|restricted/);
  assert.equal(lookupOptionContext({}), "");
});
