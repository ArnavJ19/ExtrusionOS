import test from "node:test";
import assert from "node:assert/strict";
import { buildDispatchProgress, buildOrderProgress } from "../lib/orders/order-progress.ts";
import { calculateQuoteItem, explainFinishingArea } from "../lib/calculations/quote.ts";

const lines = [
  { id: "L1", label: "EX-101", quantity_kg: 1000, quantity_pieces: 200, total_meters: 1200 },
  { id: "L2", label: "EX-205", quantity_kg: 400, quantity_pieces: 50, total_meters: 300.5 }
];

test("line progress matches the production guard basis: stock, open plans and completed output", () => {
  const { lines: rows, unlinkedJobs } = buildOrderProgress({
    lines,
    jobs: [
      { id: "J1", job_number: "PJ-1", status: "completed", source_line_id: "L1", planned_quantity_kg: 600, actual_quantity_kg: 590 },
      { id: "J2", job_number: "PJ-2", status: "in_progress", source_line_id: "L1", planned_quantity_kg: 300, actual_quantity_kg: null },
      { id: "J3", job_number: "PJ-3", status: "cancelled", source_line_id: "L1", planned_quantity_kg: 500 },
      { id: "J4", job_number: "PJ-4", status: "planned", source_line_id: null, planned_quantity_kg: 50 },
      { id: "J5", job_number: "PJ-5", status: "planned", source_line_id: "foreign-line", planned_quantity_kg: 50 }
    ],
    fulfillments: [
      { order_item_id: "L1", fulfilled_weight_kg: 60, credited_at: null },
      { order_item_id: "L1", fulfilled_weight_kg: 999, credited_at: "2026-10-01T00:00:00Z" },
      { order_item_id: "L2", fulfilled_weight_kg: "100.5" }
    ]
  });
  assert.deepEqual(rows[0], {
    id: "L1", label: "EX-101", orderedKg: 1000, fromStockKg: 60, openPlannedKg: 300, producedKg: 590, remainingToPlanKg: 50, overCommitted: false,
    jobs: [{ id: "J1", jobNumber: "PJ-1", status: "completed", kg: 590 }, { id: "J2", jobNumber: "PJ-2", status: "in_progress", kg: 300 }]
  });
  assert.equal(rows[1].remainingToPlanKg, 299.5);
  assert.deepEqual(unlinkedJobs.map((job) => job.id), ["J4", "J5"]);
});

test("a completed job without positive output counts as its plan, as in the database guard", () => {
  const { lines: rows } = buildOrderProgress({ lines, jobs: [{ id: "J", status: "completed", source_line_id: "L2", planned_quantity_kg: 100, actual_quantity_kg: 0 }], fulfillments: [] });
  assert.equal(rows[1].producedKg, 0);
  assert.equal(rows[1].openPlannedKg, 100);
});

test("missing ordered kg is Not captured; single-line orders fall back to the order-level quantity", () => {
  const missing = buildOrderProgress({ lines: [{ ...lines[0], quantity_kg: null }, lines[1]], jobs: [], fulfillments: [], orderLevelTargetKg: 900 });
  assert.equal(missing.lines[0].orderedKg, null);
  assert.equal(missing.lines[0].remainingToPlanKg, null);
  const single = buildOrderProgress({ lines: [{ ...lines[0], quantity_kg: "" }], jobs: [], fulfillments: [], orderLevelTargetKg: "900" });
  assert.equal(single.lines[0].orderedKg, 900);
  assert.equal(single.lines[0].remainingToPlanKg, 900);
});

test("over-commitment is flagged instead of showing a negative remaining balance", () => {
  const { lines: rows } = buildOrderProgress({ lines: [lines[1]], jobs: [{ id: "J", status: "planned", source_line_id: "L2", planned_quantity_kg: 450 }], fulfillments: [] });
  assert.equal(rows[0].remainingToPlanKg, 0);
  assert.equal(rows[0].overCommitted, true);
  const exact = buildOrderProgress({ lines: [lines[1]], jobs: [{ id: "J", status: "planned", source_line_id: "L2", planned_quantity_kg: 400.0005 }], fulfillments: [] });
  assert.equal(exact.lines[0].overCommitted, false);
});

test("dispatch progress subtracts packed quantities in exact millimetres", () => {
  const progress = buildDispatchProgress(lines, { pieces: 120, lengthM: 720.3, weightKg: 610.25 });
  assert.equal(progress.status, "ok");
  assert.deepEqual(progress.ordered, { pieces: 250, metres: 1500.5 });
  assert.deepEqual(progress.remaining, { pieces: 130, metres: 780.2 });
  const over = buildDispatchProgress(lines, { pieces: 260, lengthM: 1600, weightKg: 1 });
  assert.equal(over.remaining.pieces, -10);
});

test("unverified packing or missing ordered quantities never become a zero balance", () => {
  assert.deepEqual(buildDispatchProgress(lines, null), { status: "unavailable" });
  const incomplete = buildDispatchProgress([{ ...lines[0], quantity_pieces: null }, lines[1]], { pieces: 1, lengthM: 1, weightKg: 1 });
  assert.equal(incomplete.status, "ordered_incomplete");
  assert.equal("remaining" in incomplete, false);
  assert.equal(buildDispatchProgress([{ ...lines[0], quantity_pieces: 2.5 }], { pieces: 0, lengthM: 0, weightKg: 0 }).status, "ordered_incomplete");
  assert.deepEqual(buildDispatchProgress([], { pieces: 0, lengthM: 0, weightKg: 0 }).remaining, { pieces: 0, metres: 0 });
});

const quoteLine = { quantity_pieces: 100, length_per_piece_m: 6, section_weight_kg_per_m: 0.8, billet_rate_per_kg: 250, conversion_charge_per_kg: 20, finishing_type: "powder_coating", finishing_charge_type: "per_sqft", finishing_charge: 12, die_charge: 0, packing_charge: 0, transport_charge: 0, other_charges: 0, margin_percent: 20, expected_recovery_percent: 80 };

test("feature 84: finishing area explanation reproduces the costed quote line exactly", () => {
  const line = calculateQuoteItem({ ...quoteLine, perimeter_mm: 250 });
  const area = explainFinishingArea(line.total_meters, 250, 12);
  assert.equal(area.ok, true);
  assert.equal(area.areaM2, 150);
  assert.equal(area.areaSqft, 1614.587);
  assert.equal(area.charge, line.finishing_cost);
  assert.equal(area.charge, 19375.04);
});

test("feature 84: a missing coating perimeter is an incomplete cost, never a silent zero", () => {
  for (const perimeter of [null, undefined, 0, -10, NaN]) {
    const area = explainFinishingArea(600, perimeter, 12);
    assert.equal(area.ok, false, String(perimeter));
    assert.match(area.reason, /incomplete \(not zero\)/);
  }
  const line = calculateQuoteItem({ ...quoteLine, perimeter_mm: null });
  assert.equal(line.costing_complete, false);
  assert.equal(explainFinishingArea(0, 250, 12).ok, false);
});
