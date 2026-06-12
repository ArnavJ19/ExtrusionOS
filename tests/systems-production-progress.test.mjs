import test from "node:test";
import assert from "node:assert/strict";
import { summarizeProductionProgress } from "../lib/systems-configurator/production-progress.ts";

test("production progress summarizes planned and actual output", () => {
  const summary = summarizeProductionProgress([
    { status: "completed", planned_quantity_kg: 10, actual_quantity_kg: 10, planned_meters: 20, actual_meters: 20 },
    { status: "in_progress", planned_quantity_kg: 30, actual_quantity_kg: 15, planned_meters: 60, actual_meters: 30 }
  ]);

  assert.equal(summary.jobCount, 2);
  assert.equal(summary.plannedKg, 40);
  assert.equal(summary.actualKg, 25);
  assert.equal(summary.progressPercent, 62.5);
  assert.equal(summary.status, "in_progress");
});

test("production progress handles empty and completed jobs", () => {
  assert.equal(summarizeProductionProgress([]).status, "not_started");
  assert.equal(summarizeProductionProgress([{ status: "completed", planned_quantity_kg: 5, actual_quantity_kg: 5 }]).status, "completed");
  assert.equal(summarizeProductionProgress([{ status: "on_hold", planned_quantity_kg: 5, actual_quantity_kg: 1 }]).status, "blocked");
});
