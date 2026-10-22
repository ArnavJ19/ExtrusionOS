// UPGRADE_EOS features 89, 91 and 92: planned billet input, production performance from
// recorded transactions, and process mass balance. Missing inputs return null ("Not captured");
// a recorded zero is a real observation and is never confused with a missing one.
import { roundPercent, roundWeight } from "./pcda/rounding.ts";

// Billet statuses counted as job input. Must match complete_production_job_with_scrap_atomic.
export const PRODUCTION_INPUT_BILLET_STATUSES = ["allocated", "issued", "consumed"] as const;

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function finitePositive(value: unknown): number | null {
  const number = finiteNonNegative(value);
  return number !== null && number > 0 ? number : null;
}

// Removes binary floating-point noise before rounding up, so 1000.0000000000001 kg / 25 kg is 40 billets.
export function ceilQuantity(value: number) {
  return Math.ceil(Number(value.toFixed(6)));
}

export type BilletInputPlan =
  | { ok: true; goodOutputKg: number; recoveryPercent: number; plannedInputKg: number; billetWeightKg: number | null; billetCount: number | null }
  | { ok: false; reason: string };

/** Feature 89: planned input kg = good output kg / recovery fraction; billets = ceil(input / billet kg). */
export function planBilletInput(input: { goodOutputKg: unknown; recoveryPercent: unknown; billetWeightKg?: unknown }): BilletInputPlan {
  const goodOutputKg = finitePositive(input.goodOutputKg);
  const recoveryPercent = finitePositive(input.recoveryPercent);
  if (goodOutputKg === null) return { ok: false, reason: "Enter the planned good output kg to calculate billet input." };
  if (recoveryPercent === null || recoveryPercent > 100) return { ok: false, reason: "Expected recovery must be greater than 0% and at most 100%." };
  const exactInputKg = goodOutputKg / (recoveryPercent / 100);
  const billetWeightKg = finitePositive(input.billetWeightKg);
  return {
    ok: true,
    goodOutputKg,
    recoveryPercent,
    plannedInputKg: roundWeight(exactInputKg),
    billetWeightKg,
    billetCount: billetWeightKg === null ? null : ceilQuantity(exactInputKg / billetWeightKg)
  };
}

/** A billet weight basis exists only when every candidate billet has the same positive weight. */
export function uniformBilletWeightKg(billets: { weight_kg?: unknown }[]) {
  const weights = billets.map((billet) => finitePositive(billet.weight_kg));
  if (!weights.length || weights.some((weight) => weight === null)) return null;
  const first = roundWeight(weights[0] as number);
  return weights.every((weight) => roundWeight(weight as number) === first) ? first : null;
}

export type LinkedBillet ={ status?: string | null; weight_kg?: unknown; measured_weight_kg?: unknown };

export function summarizeLinkedBilletInput(billets: LinkedBillet[]) {
  const counted = billets.filter((billet) => (PRODUCTION_INPUT_BILLET_STATUSES as readonly string[]).includes(String(billet.status ?? "")));
  let inputKg = 0;
  let measuredCount = 0;
  let missingWeightCount = 0;
  for (const billet of counted) {
    const measured = finitePositive(billet.measured_weight_kg);
    const nominal = finitePositive(billet.weight_kg);
    if (measured !== null) measuredCount += 1;
    if (measured === null && nominal === null) missingWeightCount += 1;
    inputKg += measured ?? nominal ?? 0;
  }
  return {
    count: counted.length,
    inputKg: roundWeight(inputKg),
    measuredCount,
    nominalOnlyCount: counted.length - measuredCount - missingWeightCount,
    missingWeightCount,
    excludedCount: billets.length - counted.length
  };
}

/** Same tolerance as the completion transaction: the larger of 0.5 kg and 1% of input. */
export function productionMassBalanceToleranceKg(inputKg: number) {
  return Math.max(0.5, roundWeight(inputKg * 0.01));
}

export type ClassifiedQuantity = { label: string; kg: unknown };

export type MassBalance =
  | { status: "not_captured"; reason: string }
  | {
      status: "balanced" | "unaccounted" | "over_accounted";
      inputKg: number;
      accountedKg: number;
      differenceKg: number;
      toleranceKg: number;
      withinTolerance: boolean;
      lines: { label: string; kg: number }[];
    };

/**
 * Feature 92: difference = input - (good output + measured scrap + other classified movements).
 * A positive difference is unaccounted material. It is reported only; it is never booked as scrap.
 */
export function reconcileProcessMass(input: { inputKg: unknown; goodOutputKg: unknown; scrapKg: unknown; otherClassified?: ClassifiedQuantity[] }): MassBalance {
  const inputKg = finitePositive(input.inputKg);
  if (inputKg === null) return { status: "not_captured", reason: "Issued input is not captured, so the material balance cannot be calculated." };
  const goodOutputKg = finiteNonNegative(input.goodOutputKg);
  if (goodOutputKg === null) return { status: "not_captured", reason: "Good output is not recorded yet." };
  const scrapKg = finiteNonNegative(input.scrapKg);
  if (scrapKg === null) return { status: "not_captured", reason: "Measured scrap is not recorded." };
  const lines = [{ label: "Good output", kg: goodOutputKg }, { label: "Measured scrap", kg: scrapKg }];
  for (const entry of input.otherClassified ?? []) {
    const kg = finiteNonNegative(entry.kg);
    if (kg === null) return { status: "not_captured", reason: `${entry.label} is not captured.` };
    lines.push({ label: entry.label, kg });
  }
  const accountedKg = roundWeight(lines.reduce((sum, line) => sum + line.kg, 0));
  const differenceKg = roundWeight(inputKg - accountedKg);
  const toleranceKg = productionMassBalanceToleranceKg(inputKg);
  // Any non-zero difference stays visible; tolerance only says whether completion would accept it.
  const status = differenceKg === 0 ? "balanced" : differenceKg > 0 ? "unaccounted" : "over_accounted";
  const withinTolerance = Math.abs(differenceKg) <= toleranceKg;
  return { status, inputKg: roundWeight(inputKg), accountedKg, differenceKg, toleranceKg, withinTolerance, lines: lines.map((line) => ({ ...line, kg: roundWeight(line.kg) })) };
}

export type ScrapRecordRow = { id: string; weight_kg?: unknown };
export type ScrapReversalRow = { scrap_record_id: string; reversed_weight_kg?: unknown };

/** Assembles completed-job evidence from recorded rows. Reversed scrap postings are excluded and reported. */
export function buildProductionJobEvidence(input: {
  status: string;
  plannedOutputKg: unknown;
  actualOutputKg: unknown;
  billets: LinkedBillet[];
  scrapRecords: ScrapRecordRow[] | null;
  reversals: ScrapReversalRow[] | null;
  inputExceptionRecorded?: boolean;
}) {
  const billetInput = summarizeLinkedBilletInput(input.billets);
  const completed = input.status === "completed";
  const goodOutputKg = completed ? finiteNonNegative(input.actualOutputKg) : null;
  let scrapKg: number | null = null;
  let reversedKg = 0;
  if (input.scrapRecords && input.reversals) {
    const reversedIds = new Set(input.reversals.map((row) => row.scrap_record_id));
    let total = 0;
    let invalid = false;
    for (const record of input.scrapRecords) {
      const kg = finiteNonNegative(record.weight_kg);
      if (kg === null) { invalid = true; break; }
      if (reversedIds.has(record.id)) reversedKg += kg;
      else total += kg;
    }
    scrapKg = invalid ? null : roundWeight(total);
  }
  const inputKg = billetInput.count > 0 && billetInput.missingWeightCount === 0 ? billetInput.inputKg : null;
  return {
    billetInput,
    goodOutputKg,
    scrapKg,
    reversedScrapKg: roundWeight(reversedKg),
    inputExceptionRecorded: Boolean(input.inputExceptionRecorded),
    performance: productionPerformance({ inputKg, goodOutputKg, scrapKg, plannedOutputKg: input.plannedOutputKg }),
    balance: completed
      ? reconcileProcessMass({ inputKg, goodOutputKg, scrapKg })
      : { status: "not_captured" as const, reason: "The material balance is calculated from final output after the job is completed." }
  };
}

/** Feature 91: performance from recorded issued input, good output and scrap. */
export function productionPerformance(input: { inputKg: unknown; goodOutputKg: unknown; scrapKg?: unknown; plannedOutputKg?: unknown }) {
  const inputKg = finitePositive(input.inputKg);
  const goodOutputKg = finiteNonNegative(input.goodOutputKg);
  const scrapKg = finiteNonNegative(input.scrapKg);
  const plannedOutputKg = finitePositive(input.plannedOutputKg);
  return {
    recoveryPercent: inputKg !== null && goodOutputKg !== null ? roundPercent(goodOutputKg / inputKg * 100) : null,
    scrapPercent: inputKg !== null && scrapKg !== null ? roundPercent(scrapKg / inputKg * 100) : null,
    planAttainmentPercent: plannedOutputKg !== null && goodOutputKg !== null ? roundPercent(goodOutputKg / plannedOutputKg * 100) : null
  };
}
