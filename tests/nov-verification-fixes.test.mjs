import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadMyWork } from "../lib/dashboard/my-work.ts";
import { nextRecordAction } from "../lib/workflow/record-next-action.ts";
import { checkPlanningQuantity, derivePlanningQuantity, planningLengthConflicts } from "../lib/calculations/planning-quantity.ts";
import { stageRequirementIssues } from "../lib/ui/form-workflow.ts";

// Version-4 identifiers: the next-action resolver only accepts real UUIDs, so earlier fixtures never exercised it.
const id = (n) => `5c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const companyId = id(1);
const context = (role) => ({ companyId, userId: id(2), role, dealerId: null, email: "fixture@example.invalid", fullName: "Fixture", companyName: "Fixture factory", department: null, salesRegion: null });
const order = (status) => ({ kind: "order", id: id(40), status });

test("NOV-004 fix: an order's next action follows its stage instead of always opening a dispatch", () => {
  for (const stage of ["order_confirmed", "die_ready", "billet_ready"]) {
    assert.equal(nextRecordAction("owner", order(stage)).href, `/production/new?order_id=${id(40)}`, stage);
    assert.equal(nextRecordAction("dispatch", order(stage)).href, `/orders/${id(40)}#order-progress`, stage);
  }
  for (const stage of ["billet_heating", "extrusion_planned", "extruded", "cutting", "finishing"]) {
    const action = nextRecordAction("owner", order(stage));
    assert.equal(action.href, `/orders/${id(40)}#order-progress`, stage);
    assert.equal(action.label, "Review production progress", stage);
  }
  for (const stage of ["packing", "dispatched"]) assert.equal(nextRecordAction("dispatch", order(stage)).href, `/dispatches/new?order_id=${id(40)}`, stage);
  assert.equal(nextRecordAction("production", order("packing")).href, `/orders/${id(40)}#order-progress`);
  assert.equal(nextRecordAction("accounts", order("payment_pending")).label, "Review billing and receipts");
  assert.equal(nextRecordAction("production", order("payment_pending")).href, `/orders/${id(40)}#order-progress`);
  for (const stage of ["delivered", "closed", "cancelled"]) assert.equal(nextRecordAction("owner", order(stage)).href, undefined, stage);
});

test("NOV-001 fix: a task linked to a record keeps its own purpose and opens that record", async () => {
  const supabase = createClient("http://127.0.0.1:59999", "fixture-only", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1);
      const params = url.searchParams;
      let body = [];
      if (table === "tasks" && params.get("assigned_to")?.startsWith("eq.")) body = [
        { id: id(10), title: "Chase advance payment", status: "open", priority: "normal", due_date: null, related_entity_type: "order", related_entity_id: id(40) },
        { id: id(11), title: "Confirm die trial", status: "open", priority: "normal", due_date: null, related_entity_type: "production_job", related_entity_id: id(41) }
      ];
      if (table === "orders" && params.has("id")) body = [{ id: id(40), current_stage: "order_confirmed" }];
      if (table === "production_jobs" && params.has("id")) body = [{ id: id(41), status: "planned" }];
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    } }
  });
  const work = await loadMyWork(supabase, context("owner"), {}, new Date("2026-11-03T06:00:00Z"));
  assert.deepEqual(work.assigned.items.map((item) => [item.href, item.actionLabel]), [[`/orders/${id(40)}`, "Open order"], [`/production/${id(41)}`, "Open job workflow"]]);
  assert.ok(work.assigned.items.every((item) => !item.href.startsWith("/dispatches/new")));
});

test("NOV-012 fix: the plan is derived from the cut length production jobs store (nearest mm)", () => {
  const feet = derivePlanningQuantity({ pieces: 7, length: "19.685", unit: "ft", sectionWeightKgPerM: 1.234 }).data;
  assert.equal(feet.lengthPerPieceM, 6);
  assert.equal(feet.totalMetres, 42);
  assert.equal(feet.theoreticalKg, 51.828);
  const inches = derivePlanningQuantity({ pieces: 10, length: "7", unit: "in", sectionWeightKgPerM: 2 }).data;
  assert.equal(inches.lengthPerPieceM, 0.178);
  assert.equal(inches.theoreticalKg, 3.56);
  assert.match(derivePlanningQuantity({ pieces: 1, length: "0.4", unit: "mm", sectionWeightKgPerM: 1 }).error, /at least 1 mm/);
  const basis = { pieces: 7, length: "19.685", unit: "ft", sectionWeightKgPerM: 1.234 };
  assert.equal(checkPlanningQuantity(basis, 1.234, { pieces: 7, length_per_piece_m: 6, planned_quantity_kg: 51.828 }, "5.999988"), null, "an order line held to 12 decimals is not a different cut length");
  assert.match(checkPlanningQuantity(basis, 1.234, { pieces: 7, length_per_piece_m: 6, planned_quantity_kg: 51.828 }, 6.001), /differs from the order line/);
  assert.equal(planningLengthConflicts(6, null), false);
  assert.equal(planningLengthConflicts(6, 6.0004), false);
  assert.equal(planningLengthConflicts(6, 6.0006), true);
});

test("NOV-006 fix: approving an inspection shows the database release rules before saving", () => {
  const fields = [{ name: "weight_per_meter_actual", label: "Actual kg/m" }, { name: "hardness_webster", label: "Hardness" }];
  const profile = { value: id(50), section_weight_kg_per_m: 1, weight_tolerance_percent: 2, hardness_requirement: "min 12 HW" };
  const paths = (values, p = profile) => stageRequirementIssues("quality", { status: "approved", ...values }, p, fields).map((issue) => issue.path);
  assert.deepEqual(paths({}), ["weight_per_meter_actual", "hardness_webster"]);
  assert.deepEqual(paths({ weight_per_meter_actual: "1.03", hardness_webster: "11.5" }), ["weight_per_meter_actual", "hardness_webster"]);
  assert.deepEqual(paths({ weight_per_meter_actual: "1.02", hardness_webster: "12" }), []);
  assert.deepEqual(paths({ weight_per_meter_actual: 0.98, hardness_webster: 14 }), []);
  assert.deepEqual(paths({}, { ...profile, weight_tolerance_percent: 0, hardness_requirement: "as per customer" }), [], "rules the database does not enforce are not invented");
  assert.deepEqual(stageRequirementIssues("quality", { status: "pending" }, profile, fields), [], "pending inspections stay optional");
  assert.deepEqual(stageRequirementIssues("quality", { status: "rejected" }, profile, fields), []);
  assert.deepEqual(stageRequirementIssues("quality", { status: "approved" }, null, fields), [], "an unavailable profile reference leaves the database authoritative");
  assert.deepEqual(stageRequirementIssues("production", { status: "approved" }, profile, fields), []);
});
