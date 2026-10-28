import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductionJobEvidence,
  ceilQuantity,
  planBilletInput,
  productionMassBalanceToleranceKg,
  productionPerformance,
  reconcileProcessMass,
  summarizeLinkedBilletInput,
  uniformBilletWeightKg
} from "../lib/calculations/production-performance.ts";
import { calculateRequiredBilletCount } from "../lib/calculations/foundry.ts";
import { planAttainmentPercent } from "../lib/calculations/operations.ts";

test("feature 89 catalogue example: 900 kg at 75% with 30 kg billets needs 1,200 kg and 40 billets", () => {
  const plan = planBilletInput({ goodOutputKg: 900, recoveryPercent: 75, billetWeightKg: 30 });
  assert.deepEqual(plan, { ok: true, goodOutputKg: 900, recoveryPercent: 75, plannedInputKg: 1200, billetWeightKg: 30, billetCount: 40 });
});

test("billet counts round up real shortfalls but not binary floating-point noise", () => {
  // 700 / 0.7 is 1000.0000000000001 in IEEE-754; a naive ceil returned 41 billets.
  assert.equal(planBilletInput({ goodOutputKg: 700, recoveryPercent: 70, billetWeightKg: 25 }).billetCount, 40);
  assert.equal(calculateRequiredBilletCount(700, 25, 70), 40);
  assert.equal(calculateRequiredBilletCount(1000, 100, 80), 13);
  assert.equal(planBilletInput({ goodOutputKg: 901, recoveryPercent: 75, billetWeightKg: 30 }).billetCount, 41);
  assert.equal(ceilQuantity(40.0000004), 40);
  assert.equal(ceilQuantity(40.00001), 41);
});

test("recovery is applied once and invalid plan inputs are refused instead of becoming zero", () => {
  assert.equal(planBilletInput({ goodOutputKg: 900, recoveryPercent: 100, billetWeightKg: 30 }).plannedInputKg, 900);
  for (const recoveryPercent of [0, -5, 100.01, NaN, null, undefined, "", Infinity]) {
    assert.equal(planBilletInput({ goodOutputKg: 900, recoveryPercent, billetWeightKg: 30 }).ok, false, String(recoveryPercent));
  }
  for (const goodOutputKg of [0, -1, NaN, null, undefined, "abc"]) {
    assert.equal(planBilletInput({ goodOutputKg, recoveryPercent: 75 }).ok, false, String(goodOutputKg));
  }
  const withoutBillet = planBilletInput({ goodOutputKg: 900, recoveryPercent: 75, billetWeightKg: null });
  assert.equal(withoutBillet.plannedInputKg, 1200);
  assert.equal(withoutBillet.billetCount, null);
});

test("uniform billet weight is only a basis when every candidate shares it", () => {
  assert.equal(uniformBilletWeightKg([{ weight_kg: 30 }, { weight_kg: "30.000" }]), 30);
  assert.equal(uniformBilletWeightKg([{ weight_kg: 30 }, { weight_kg: 31 }]), null);
  assert.equal(uniformBilletWeightKg([{ weight_kg: 30 }, { weight_kg: null }]), null);
  assert.equal(uniformBilletWeightKg([]), null);
});

test("feature 92 catalogue example flags exactly 10 kg unaccounted and never books it as scrap", () => {
  const balance = reconcileProcessMass({ inputKg: 1000, goodOutputKg: 780, scrapKg: 180, otherClassified: [{ label: "Work in progress", kg: 30 }] });
  assert.equal(balance.status, "unaccounted");
  assert.equal(balance.differenceKg, 10);
  assert.equal(balance.accountedKg, 990);
  // 10 kg is within the 1% completion tolerance, but it must still be shown.
  assert.equal(balance.withinTolerance, true);
  assert.deepEqual(balance.lines.find((line) => line.label === "Measured scrap"), { label: "Measured scrap", kg: 180 });
});

test("mass balance uses the completion transaction tolerance and signs over-recording", () => {
  assert.equal(productionMassBalanceToleranceKg(10), 0.5);
  assert.equal(productionMassBalanceToleranceKg(1000), 10);
  assert.equal(reconcileProcessMass({ inputKg: 1000, goodOutputKg: 805, scrapKg: 195 }).status, "balanced");
  const edge = reconcileProcessMass({ inputKg: 1000, goodOutputKg: 790, scrapKg: 200 });
  assert.equal(edge.status, "unaccounted");
  assert.equal(edge.withinTolerance, true);
  const outside = reconcileProcessMass({ inputKg: 1000, goodOutputKg: 790, scrapKg: 199.999 });
  assert.equal(outside.differenceKg, 10.001);
  assert.equal(outside.withinTolerance, false);
  const over = reconcileProcessMass({ inputKg: 1000, goodOutputKg: 900, scrapKg: 150 });
  assert.equal(over.status, "over_accounted");
  assert.equal(over.differenceKg, -50);
  assert.equal(over.withinTolerance, false);
  assert.equal(reconcileProcessMass({ inputKg: 0.1 + 0.2, goodOutputKg: 0.3, scrapKg: 0 }).differenceKg, 0);
});

test("missing balance inputs stay not captured while a recorded zero output is a real result", () => {
  assert.equal(reconcileProcessMass({ inputKg: null, goodOutputKg: 780, scrapKg: 180 }).status, "not_captured");
  assert.equal(reconcileProcessMass({ inputKg: 0, goodOutputKg: 780, scrapKg: 180 }).status, "not_captured");
  assert.equal(reconcileProcessMass({ inputKg: 1000, goodOutputKg: undefined, scrapKg: 180 }).status, "not_captured");
  assert.equal(reconcileProcessMass({ inputKg: 1000, goodOutputKg: 780, scrapKg: -1 }).status, "not_captured");
  assert.equal(reconcileProcessMass({ inputKg: 1000, goodOutputKg: 780, scrapKg: 180, otherClassified: [{ label: "Returns", kg: null }] }).status, "not_captured");
  const zero = reconcileProcessMass({ inputKg: 100, goodOutputKg: 0, scrapKg: 100 });
  assert.equal(zero.status, "balanced");
  assert.equal(zero.lines[0].kg, 0);
});

test("feature 91: 800 kg good output from 1,000 kg input is 80% recovery; missing input is Not captured", () => {
  assert.deepEqual(productionPerformance({ inputKg: 1000, goodOutputKg: 800, scrapKg: 195, plannedOutputKg: 900 }), { recoveryPercent: 80, scrapPercent: 19.5, planAttainmentPercent: 88.89 });
  assert.deepEqual(productionPerformance({ inputKg: null, goodOutputKg: 800, scrapKg: 10, plannedOutputKg: 0 }), { recoveryPercent: null, scrapPercent: null, planAttainmentPercent: null });
  assert.equal(productionPerformance({ inputKg: 1000, goodOutputKg: 0 }).recoveryPercent, 0);
  assert.equal(productionPerformance({ inputKg: 1000, goodOutputKg: null }).recoveryPercent, null);
});

test("legacy plan attainment no longer turns a missing actual into 0%", () => {
  assert.equal(planAttainmentPercent(100, 120), 120);
  assert.equal(planAttainmentPercent(0, 120), null);
  assert.equal(planAttainmentPercent(100, null), null);
  assert.equal(planAttainmentPercent(100, undefined), null);
  assert.equal(planAttainmentPercent(100, 0), 0);
  assert.equal(planAttainmentPercent(100, -5), null);
});

test("linked billet input counts the completion statuses with measured-else-nominal weight", () => {
  const summary = summarizeLinkedBilletInput([
    { status: "issued", weight_kg: 30, measured_weight_kg: 29.5 },
    { status: "consumed", weight_kg: 30, measured_weight_kg: null },
    { status: "allocated", weight_kg: "30.000" },
    { status: "cancelled", weight_kg: 30, measured_weight_kg: 31 },
    { status: "scrap", weight_kg: 30 },
    { status: null, weight_kg: 30 }
  ]);
  assert.deepEqual(summary, { count: 3, inputKg: 89.5, measuredCount: 1, nominalOnlyCount: 2, missingWeightCount: 0, excludedCount: 3 });
});

const completedJob = {
  status: "completed",
  plannedOutputKg: 100,
  actualOutputKg: 80,
  billets: [{ status: "consumed", weight_kg: 50 }, { status: "consumed", weight_kg: 50 }],
  scrapRecords: [{ id: "s1", weight_kg: 15 }, { id: "s2", weight_kg: 5 }, { id: "s3", weight_kg: 12 }],
  reversals: [{ scrap_record_id: "s3", reversed_weight_kg: 12 }]
};

test("job evidence excludes reversed scrap postings and reports them separately", () => {
  const evidence = buildProductionJobEvidence(completedJob);
  assert.equal(evidence.scrapKg, 20);
  assert.equal(evidence.reversedScrapKg, 12);
  assert.equal(evidence.balance.status, "balanced");
  assert.equal(evidence.performance.recoveryPercent, 80);
  assert.equal(evidence.performance.planAttainmentPercent, 80);
});

test("job evidence never claims a balance for open jobs, unreadable scrap or jobs without billet input", () => {
  assert.equal(buildProductionJobEvidence({ ...completedJob, status: "in_progress" }).balance.status, "not_captured");
  assert.equal(buildProductionJobEvidence({ ...completedJob, status: "in_progress" }).goodOutputKg, null);
  const unreadable = buildProductionJobEvidence({ ...completedJob, scrapRecords: null });
  assert.equal(unreadable.scrapKg, null);
  assert.equal(unreadable.balance.status, "not_captured");
  assert.equal(unreadable.performance.scrapPercent, null);
  assert.equal(buildProductionJobEvidence({ ...completedJob, reversals: null }).balance.status, "not_captured");
  const exception = buildProductionJobEvidence({ ...completedJob, billets: [], inputExceptionRecorded: true });
  assert.equal(exception.inputExceptionRecorded, true);
  assert.equal(exception.performance.recoveryPercent, null);
  assert.equal(exception.balance.status, "not_captured");
  const corrupt = buildProductionJobEvidence({ ...completedJob, scrapRecords: [{ id: "x", weight_kg: -3 }] });
  assert.equal(corrupt.scrapKg, null);
});

test("an unexplained post-completion difference stays visible as unaccounted", () => {
  const evidence = buildProductionJobEvidence({ ...completedJob, actualOutputKg: 60 });
  assert.equal(evidence.balance.status, "unaccounted");
  assert.equal(evidence.balance.differenceKg, 20);
  assert.equal(evidence.scrapKg, 20);
});
