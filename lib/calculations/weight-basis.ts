// FS-65: the one weight conversion, mirrored by private.weight_compare (tests/fs-batch4.test.mjs compares them).
// Stock is held in actual weighed kg; pieces and length are attributes. Theoretical kg = pieces x cut length (m) x
// section weight (kg/m). Rounding: kg to 3 decimals, percentages to 2, half away from zero (as PostgreSQL numeric).
// Whether invoices bill actual or theoretical kg is Omalco's decision, recorded by the owner (lib/fs-batch4/commands).

export type WeightState = "within" | "heavy" | "light" | "no_theoretical" | "not_weighed" | "no_tolerance";

/** Half away from zero at `places` decimals, without binary floating-point drift on ties (1.0005 -> 1.001). */
export function roundHalfAway(value: number, places: number) {
  if (!Number.isFinite(value)) return NaN;
  const sign = value < 0 ? -1 : 1;
  const [int, frac = ""] = Math.abs(value).toFixed(places + 6).split(".");
  const kept = `${int}${frac.slice(0, places)}`;
  const up = Number(frac.charAt(places) || "0") >= 5;
  const scaled = BigInt(kept) + (up ? BigInt(1) : BigInt(0));
  return sign * Number(scaled) / 10 ** places;
}

export const roundKg = (kg: number) => roundHalfAway(kg, 3);

export function theoreticalKg(pieces: number | null | undefined, lengthM: number | null | undefined, kgPerM: number | null | undefined): number | null {
  if (!(Number(pieces) > 0) || !(Number(lengthM) > 0) || !(Number(kgPerM) > 0)) return null;
  return roundKg(Number(pieces) * Number(lengthM) * Number(kgPerM));
}

export function compareWeights(input: { pieces: number | null; lengthM: number | null; kgPerM: number | null; actualKg: number | null; tolerancePercent: number | null }) {
  const theoretical = theoreticalKg(input.pieces, input.lengthM, input.kgPerM);
  const actual = Number(input.actualKg) > 0 ? roundKg(Number(input.actualKg)) : null;
  const differenceKg = theoretical !== null && actual !== null ? roundKg(actual - theoretical) : null;
  const differencePercent = theoretical !== null && actual !== null ? roundHalfAway((actual - theoretical) * 100 / theoretical, 2) : null;
  const tol = input.tolerancePercent;
  const state: WeightState = theoretical === null ? "no_theoretical" : actual === null ? "not_weighed" : tol === null || tol === undefined ? "no_tolerance"
    : Math.abs(differencePercent as number) <= tol ? "within" : (actual as number) > theoretical ? "heavy" : "light";
  return { theoreticalKg: theoretical, actualKg: actual, differenceKg, differencePercent, tolerancePercent: tol ?? null, state };
}

/** The kg an invoice line bills on a decided basis; null while Omalco has not decided (never a silent default). */
export function invoiceKg(basis: "actual_weighed" | "theoretical" | null, actualKg: number | null, theoretical: number | null) {
  if (basis === "actual_weighed") return actualKg === null ? null : roundKg(actualKg);
  if (basis === "theoretical") return theoretical === null ? null : roundKg(theoretical);
  return null;
}

export const WEIGHT_STATE_LABELS: Record<WeightState, string> = {
  within: "Within tolerance", heavy: "Heavier than tolerance", light: "Lighter than tolerance",
  no_theoretical: "No theoretical weight (profile kg/m or cut length missing)", not_weighed: "Not weighed", no_tolerance: "No tolerance set",
};
