import { parseLengthInput, type LengthUnit } from "./length-units.ts";

export type PlanningQuantityBasis = { pieces: number; length: string; unit: LengthUnit; sectionWeightKgPerM: number };
export type PlanningQuantity = { pieces: number; lengthPerPieceM: number; totalMetres: number; theoreticalKg: number };

/** Production jobs store cut length as numeric(12,3), so the plan is derived from the length that will be saved. */
export const PLANNING_LENGTH_DECIMALS = 3;
const LENGTH_TOLERANCE_M = 0.0005;
const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function derivePlanningQuantity(input: unknown): { data: PlanningQuantity; error?: never } | { data?: never; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Enter pieces, cut length and section weight." };
  const basis = input as Record<string, unknown>;
  if (typeof basis.pieces !== "number" || !Number.isSafeInteger(basis.pieces) || basis.pieces <= 0) return { error: "Pieces must be a positive whole number." };
  if (typeof basis.sectionWeightKgPerM !== "number" || !Number.isFinite(basis.sectionWeightKgPerM) || basis.sectionWeightKgPerM <= 0) return { error: "A positive profile section weight is required. Missing weight cannot be treated as zero." };
  if (typeof basis.length !== "string" || typeof basis.unit !== "string") return { error: "Enter a cut length and its unit." };
  const length = parseLengthInput(basis.length, basis.unit as LengthUnit);
  if (length.error) return { error: length.error };
  const lengthPerPieceM = roundTo(length.metres!, PLANNING_LENGTH_DECIMALS);
  if (lengthPerPieceM <= 0) return { error: "Cut length must be at least 1 mm." };
  const totalMetres = roundTo(basis.pieces * lengthPerPieceM, PLANNING_LENGTH_DECIMALS);
  const rawKg = totalMetres * basis.sectionWeightKgPerM;
  const theoreticalKg = roundTo(rawKg, 3);
  if (!Number.isFinite(rawKg) || totalMetres > 1e12 || theoreticalKg > 1e12 || theoreticalKg <= 0) return { error: "The calculated quantity is outside the supported range or below 0.001 kg." };
  return { data: { pieces: basis.pieces, lengthPerPieceM, totalMetres, theoreticalKg } };
}

/** True when a reviewed cut length differs from the order line by more than half a millimetre. */
export function planningLengthConflicts(lengthPerPieceM: number, sourceLengthM: unknown) {
  if (sourceLengthM === null || sourceLengthM === undefined || sourceLengthM === "") return false;
  const source = Number(sourceLengthM);
  return Number.isFinite(source) && source > 0 && Math.abs(source - lengthPerPieceM) > LENGTH_TOLERANCE_M;
}

/** A server check of the reviewed basis; this is a planning estimate, never measured output. */
export function checkPlanningQuantity(input: unknown, sectionWeight: unknown, saved: { pieces: number; length_per_piece_m?: number | null; planned_quantity_kg: number }, sourceLengthM?: unknown): string | null {
  const calculation = derivePlanningQuantity(input);
  if (calculation.error) return calculation.error;
  const basis = input as PlanningQuantityBasis;
  if (sectionWeight === null || sectionWeight === undefined || sectionWeight === "" || !Number.isFinite(Number(sectionWeight)) || Number(sectionWeight) <= 0) return "Applicable section weight is unavailable. Reload the order or profile reference before using a theoretical plan.";
  if (Math.abs(Number(sectionWeight) - basis.sectionWeightKgPerM) > 1e-9) return "Section weight changed. Recalculate and review the theoretical plan.";
  const quantity = calculation.data!;
  if (planningLengthConflicts(quantity.lengthPerPieceM, sourceLengthM)) return "Cut length differs from the order line. Review the order specification before changing production requirements.";
  if (!Number.isFinite(saved.length_per_piece_m) || !Number.isFinite(saved.planned_quantity_kg)) return "The planned length and kg must be finite numbers matching the reviewed basis.";
  if (saved.pieces !== quantity.pieces || Math.abs(Number(saved.length_per_piece_m) - quantity.lengthPerPieceM) > 1e-9 || Math.abs(saved.planned_quantity_kg - quantity.theoreticalKg) > 0.000001) return "The planned quantity no longer matches the reviewed pieces and length. Recalculate or choose manual planned kg.";
  return null;
}
