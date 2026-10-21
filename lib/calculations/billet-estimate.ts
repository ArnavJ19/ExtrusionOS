import { calculateBilletWeightKg, calculateTotalBilletWeightKg } from "./foundry.ts";

export const billetDimensionUnits = ["mm", "cm", "m", "in"] as const;
export type BilletDimensionUnit = typeof billetDimensionUnits[number];
const millimetres: Record<BilletDimensionUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

export function convertBilletDimension(value: number, from: BilletDimensionUnit, to: BilletDimensionUnit) {
  if (!Object.hasOwn(millimetres, from) || !Object.hasOwn(millimetres, to) || !Number.isFinite(value) || value <= 0) return null;
  const result = value * millimetres[from] / millimetres[to];
  return Number.isFinite(result) && result > 0 ? result : null;
}

export type BilletEstimateInput = {
  length: number | null;
  lengthUnit: BilletDimensionUnit;
  diameter: number | null;
  diameterUnit: BilletDimensionUnit;
  densityKgPerM3: number | null;
  count: number | null;
};

export function estimateBilletGeometry(input: BilletEstimateInput) {
  if (input.length == null || input.diameter == null || input.densityKgPerM3 == null || input.count == null) {
    return { ok: false as const, reason: "Enter length, diameter, density, and a whole billet count to calculate an estimate." };
  }
  const lengthMm = convertBilletDimension(input.length, input.lengthUnit, "mm");
  const diameterMm = convertBilletDimension(input.diameter, input.diameterUnit, "mm");
  if (!lengthMm || !diameterMm || !Number.isFinite(input.densityKgPerM3) || input.densityKgPerM3 <= 0 || !Number.isSafeInteger(input.count) || input.count <= 0) {
    return { ok: false as const, reason: "Dimensions and density must be positive finite values; count must be a positive whole number." };
  }
  const eachKg = calculateBilletWeightKg(lengthMm, diameterMm, input.densityKgPerM3);
  const totalKg = calculateTotalBilletWeightKg(lengthMm, diameterMm, input.count, input.densityKgPerM3);
  if (![eachKg, totalKg].every((value) => Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER / 1000)) {
    return { ok: false as const, reason: "These dimensions do not produce a representable weight at 0.001 kg precision." };
  }
  return { ok: true as const, lengthM: lengthMm / 1000, diameterM: diameterMm / 1000, eachKg, totalKg };
}
