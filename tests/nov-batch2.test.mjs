import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { applyFieldSuggestions, formFieldId, formIssues, formSection, formValidationValues, markFieldOverride } from "../lib/ui/form-workflow.ts";
import { checkPlanningQuantity, derivePlanningQuantity } from "../lib/calculations/planning-quantity.ts";
import { buildInspectionEntry, inspectionDraftKey, observationMatches, restoreInspectionDraft, restoreInspectionDraftState } from "../lib/ui/inspection-entry.ts";
import { mergeWorkRefresh } from "../lib/dashboard/work-refresh.ts";
import { moveWorkspaceLink, roleWorkspaceLinks } from "../lib/preferences/role-workspace.ts";
import { nextRecordAction } from "../lib/workflow/record-next-action.ts";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const basis = { pieces: 100, length: "6", unit: "m", sectionWeightKgPerM: .8 };
const saved = { pieces: 100, length_per_piece_m: 6, planned_quantity_kg: 480 };
const field = { name: "hardness_webster", label: "Hardness" };
const item = { item_id: id(20), seq: 1, characteristic: "Wall thickness", unit: "mm", method: "Micrometer", nominal: 1.6, lower_limit: 1.5, upper_limit: 1.7, critical: true, observed: null, visual_ok: null, outcome: "missing", recorded_by_name: null, recorded_at: null };
const evaluation = { plan_id: id(10), plan_version: 2, plan_scope: "profile", sampling_instruction: "3 pieces", state: "incomplete", total: 2, missing: 2, failed: 0, inspection_status: "pending", items: [item, { ...item, item_id: id(21), seq: 2, characteristic: "Surface", unit: "visual", nominal: null, lower_limit: null, upper_limit: null }] };

test("NOV-006: pending observations may collapse, final observations and every required field remain current", () => {
  assert.equal(formSection("quality", field, { status: "pending" }), "observations");
  for (const status of ["approved", "rework", "rejected"]) assert.equal(formSection("quality", field, { status }), "essential");
  assert.equal(formSection("quality", { ...field, required: true }, { status: "pending" }), "essential");
  assert.equal(formSection("production", { name: "remarks", label: "Remarks" }, {}), "optional");
  assert.equal(formSection("production", { name: "planned_quantity_kg", label: "Planned kg", required: true }, {}), "essential");
  assert.equal(formSection("customers", { name: "notes", label: "Notes" }, {}), "essential");
});

test("NOV-096: nested issues retain line identity, deduplicate paths and keep safe fallback labels", () => {
  const issues = formIssues([{ path: ["lines", 1, "weight"], message: "Enter kg" }, { path: ["lines", 1, "weight"], message: "Duplicate" }, { path: ["unknown"], message: "Check entry" }], [{ name: "lines", label: "Material" }]);
  assert.deepEqual(issues.map(issue => [issue.path, issue.label]), [["lines.1.weight", "Material, line 2"], ["unknown", "Record details"]]);
  assert.notEqual(formFieldId("first", "lines.1.weight"), formFieldId("second", "lines.1.weight"));
  assert.notEqual(formFieldId("first", "a b"), formFieldId("first", "a/b"));
});

test("NOV-006/096: blank optional planning inputs normalize to nullable values without relaxing required quantities", () => {
  const input = { machine_id: "", source_line_id: "", length_per_piece_m: "", planned_quantity_kg: "", pieces: 0, order_id: "" };
  assert.deepEqual(formValidationValues("production", input), { ...input, machine_id: null, source_line_id: null, length_per_piece_m: null });
  assert.equal(input.machine_id, ""); assert.equal(formValidationValues("quality", input), input);
});

test("NOV-094: source refresh preserves deliberate overrides, including zero, and exposes changed suggestions", () => {
  const first = applyFieldSuggestions({}, {}, { pieces: 100, notes: "Source note" }, { id: "order:line", label: "Order 1", revision: "v1" }, "2026-11-02T00:00:00Z");
  const overridden = markFieldOverride(first.provenance, "pieces", 0);
  const next = applyFieldSuggestions({ ...first.values, pieces: 0 }, overridden, { pieces: 200, notes: "New note" }, { id: "order:line", label: "Order 1", revision: "v2" }, "2026-11-02T01:00:00Z");
  assert.equal(next.values.pieces, 0); assert.equal(next.provenance.pieces.suggested, 200); assert.equal(next.provenance.pieces.overridden, true);
  assert.equal(next.values.notes, "New note"); assert.equal(next.provenance.notes.revision, "v2");
  assert.equal(first.values.pieces, 100, "source update must not mutate the prior draft");
  const restored = markFieldOverride(next.provenance, "pieces", 200); assert.equal(restored.pieces.overridden, false);
  const other = applyFieldSuggestions(next.values, next.provenance, { pieces: 50, notes: null }, { id: "different-order:line", label: "Order 2" }, "later");
  assert.equal(other.values.pieces, 50); assert.equal(other.values.notes, null); assert.equal(other.provenance.pieces.overridden, false);
});

test("NOV-012: known pieces derive metres and theoretical kg consistently across m/mm/ft/in", () => {
  assert.deepEqual(derivePlanningQuantity(basis).data, { pieces: 100, lengthPerPieceM: 6, totalMetres: 600, theoreticalKg: 480 });
  for (const [length, unit, expected] of [["6000", "mm", 480], ["20", "ft", 487.68], ["240", "in", 487.68]]) assert.equal(derivePlanningQuantity({ ...basis, length, unit }).data.theoreticalKg, expected);
  assert.equal(derivePlanningQuantity({ ...basis, pieces: 1, length: "1", sectionWeightKgPerM: .0005 }).data.theoreticalKg, .001);
});

test("NOV-012: missing/invalid quantities, unsafe counts and overflow never become a convenient zero", () => {
  for (const changes of [{ pieces: 0 }, { pieces: -1 }, { pieces: .5 }, { pieces: "100" }, { pieces: NaN }, { pieces: 1e20 }, { sectionWeightKgPerM: null }, { sectionWeightKgPerM: 0 }, { sectionWeightKgPerM: Infinity }, { length: "" }, { length: "0" }, { length: "NaN" }, { length: "1001" }, { unit: "cm" }, { pieces: 1e12 }, { pieces: 1, sectionWeightKgPerM: .000001 }]) assert.ok(derivePlanningQuantity({ ...basis, ...changes }).error, JSON.stringify(changes));
});

test("NOV-012: varied production plans reconcile at the supported kg precision", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 10000 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 1000 }), (pieces, metres, gramsPerM) => {
    const quantity = derivePlanningQuantity({ pieces, length: String(metres * 1000), unit: "mm", sectionWeightKgPerM: gramsPerM / 1000 });
    assert.equal(quantity.data.theoreticalKg, Math.round((pieces * metres * gramsPerM / 1000 + Number.EPSILON) * 1000) / 1000);
    assert.equal(checkPlanningQuantity({ pieces, length: String(metres), unit: "m", sectionWeightKgPerM: gramsPerM / 1000 }, gramsPerM / 1000, { pieces, length_per_piece_m: metres, planned_quantity_kg: quantity.data.theoreticalKg }), null);
  }), { numRuns: 200 });
});

test("NOV-012: reviewed plan rejects source-weight changes and altered or unavailable save values", () => {
  assert.equal(checkPlanningQuantity(basis, ".8", saved), null);
  for (const weight of [null, undefined, "", 0, "bad", 1]) assert.ok(checkPlanningQuantity(basis, weight, saved));
  for (const patch of [{ pieces: 99 }, { length_per_piece_m: 5 }, { length_per_piece_m: NaN }, { length_per_piece_m: null }, { planned_quantity_kg: 479 }, { planned_quantity_kg: Infinity }]) assert.ok(checkPlanningQuantity(basis, .8, { ...saved, ...patch }));
  assert.match(checkPlanningQuantity({ ...basis, length: "3" }, .8, { ...saved, length_per_piece_m: 3, planned_quantity_kg: 240 }, 6), /differs from the order line/);
});

test("NOV-018/095: observations are blank unless entered, accept actual zero, and omit other plan IDs", () => {
  assert.equal(buildInspectionEntry(evaluation, {}).results.length, 0);
  const draft = buildInspectionEntry(evaluation, { [id(20)]: "0", [id(21)]: "pass", [id(99)]: "12" });
  assert.deepEqual(draft.results, [{ item_id: id(20), observed: 0 }, { item_id: id(21), visual_ok: true }]);
  assert.equal(draft.issues.length, 0);
  assert.equal(buildInspectionEntry(evaluation, { [id(20)]: "   " }).results.length, 0);
  for (const value of ["NaN", "Infinity", "0x10", "1,6", "1 mm", "1e999"]) assert.equal(buildInspectionEntry(evaluation, { [id(20)]: value }).issues[0].path, id(20));
  assert.match(buildInspectionEntry(evaluation, { [id(21)]: "unknown" }).issues[0].message, /pass or fail/);
  assert.equal(observationMatches(draft.results[0], { ...evaluation, items: [{ ...item, observed: 0 }] }), true);
});

test("NOV-018: draft recovery is scoped, versioned, bounded, expiring and limited to applicable characteristics", () => {
  const now = Date.now();
  const draft = { scope: "company:user:quality", planId: evaluation.plan_id, version: 2, savedAt: now, values: { [id(20)]: "1.6", [id(99)]: "private" } };
  const restore = (patch = {}, scope = draft.scope, ev = evaluation) => restoreInspectionDraft(JSON.stringify({ ...draft, ...patch }), scope, ev, now);
  assert.deepEqual(restore(), { [id(20)]: "1.6" });
  for (const patch of [{ planId: id(11) }, { version: 3 }, { savedAt: now + 1 }, { savedAt: now - 9 * 3600000 }, { savedAt: null }, { values: [] }, { values: { [id(20)]: "x".repeat(121) } }]) assert.deepEqual(restore(patch), {});
  assert.deepEqual(restore({}, "other-company:user:quality"), {});
  assert.deepEqual(restore({}, draft.scope, { plan_id: null, state: "no_plan" }), {});
  assert.deepEqual(restoreInspectionDraft("{bad", draft.scope, evaluation), {});
  assert.notEqual(inspectionDraftKey("A:U", id(1), id(2), 1), inspectionDraftKey("B:U", id(1), id(2), 1));
});

test("NOV-001: failed refresh retains marked useful work while revoked or removed queues cannot be resurrected", () => {
  const queue = { key: "assigned", title: "Assigned", description: "", href: "/tasks", items: [{ id: id(1) }], hasMore: false, error: null };
  const previous = { today: "2026-11-02", assigned: queue, unassigned: { ...queue, key: "unassigned" }, departments: [{ ...queue, key: "production" }] };
  const failure = { ...previous, assigned: { ...queue, items: [], error: "Unknown workload", errorKind: "unavailable" }, departments: [] };
  const result = mergeWorkRefresh(previous, failure);
  assert.equal(result.assigned.items.length, 1); assert.match(result.assigned.error, /Previous entries/); assert.equal(result.departments.length, 0);
  const denied = mergeWorkRefresh(previous, { ...failure, assigned: { ...failure.assigned, errorKind: "denied" } });
  assert.equal(denied.assigned.items.length, 0);
});

test("NOV-018: interrupted-save state survives recovery only within the validated draft scope", () => {
  const draft = JSON.stringify({ scope: "company:user:quality", planId: evaluation.plan_id, version: 2, savedAt: Date.now(), values: { [id(20)]: "1.6" }, uncertain: true });
  assert.equal(restoreInspectionDraftState(draft, "company:user:quality", evaluation).uncertain, true);
  assert.equal(restoreInspectionDraftState(draft, "different:scope", evaluation).uncertain, false);
});

test("NOV-002: role workspaces respect permitted routes, resource authority and dealer boundaries", () => {
  const candidates = [{ href: "/production", label: "Production", moduleKey: "production", resource: "production" }, { href: "/invoices", label: "Invoices", moduleKey: "invoices", resource: "financials" }, { href: "/quality", label: "Quality", moduleKey: "quality", resource: "quality" }];
  assert.deepEqual(roleWorkspaceLinks("production", candidates, ["/production", "/quality"]).map(item => item.href), ["/production"]);
  assert.deepEqual(roleWorkspaceLinks("accounts", candidates, ["/production", "/invoices"]).map(item => item.href), ["/invoices"]);
  assert.deepEqual(roleWorkspaceLinks("owner", candidates, []).map(item => item.href), []);
  assert.deepEqual(roleWorkspaceLinks("dealer_admin", candidates, ["/production", "/invoices", "/quality"]), []);
});

test("NOV-002/100: explicit pin ordering is stable and safe at both ends", () => {
  const links = [{ href: "/orders" }, { href: "/production" }, { href: "/tasks" }];
  assert.equal(moveWorkspaceLink(links, "/orders", -1), links);
  assert.equal(moveWorkspaceLink(links, "/tasks", 1), links);
  assert.equal(moveWorkspaceLink(links, "/missing", -1), links);
  assert.deepEqual(moveWorkspaceLink(links, "/production", -1).map(item => item.href), ["/production", "/orders", "/tasks"]);
  assert.equal(links[0].href, "/orders");
  const withRevoked = [{ href: "/orders" }, { href: "/revoked-record" }, { href: "/production" }];
  const reordered = moveWorkspaceLink(withRevoked, "/production", -1, ["/orders", "/production"]);
  assert.deepEqual(reordered.map(item => item.href), ["/production", "/revoked-record", "/orders"], "hidden links cannot absorb a visible move or be revived");
});

test("NOV-004: quality and packaging next actions carry exact source context and remain review-only", () => {
  for (const [kind, status] of [["quality", "pending"], ["packaging", "scheduled"], ["production", "ready"]]) {
    const record = { kind, id: id(1), status, updatedAt: "2026-11-02T00:00:00Z" };
    const action = nextRecordAction("owner", record);
    assert.ok(action.href.includes(id(1))); assert.deepEqual(action.source, { kind, id: id(1), status, version: record.updatedAt }); assert.equal(action.readiness, "review_required");
    assert.equal(nextRecordAction("dealer_admin", record), null); assert.equal(nextRecordAction("owner", record, id(9)), null);
  }
  assert.equal(nextRecordAction("production", { kind: "invoice", id: id(1), status: "draft" }), null);
  assert.equal(nextRecordAction("owner", { kind: "quality", id: "../other", status: "pending" }), null);
  assert.doesNotMatch(nextRecordAction("viewer", { kind: "quality", id: id(1), status: "pending" }).label, /Record observations/);
  assert.doesNotMatch(nextRecordAction("owner", { kind: "quality", id: id(1), status: "approved" }).href, /edit|new/);
});
