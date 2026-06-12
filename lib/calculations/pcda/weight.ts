/**
 * PCDA Weight Calculations
 *
 * Pure functions for theoretical weight, quantity-in-kg by method, and weight variance.
 * Returns NOT_CAPTURED sentinel for invalid/absent inputs.
 *
 * Sentinel discipline (Req 4.8, 4.12):
 * - If any numeric input used in the computation is negative → NOT_CAPTURED
 * - If QtyMethod is absent/null → NOT_CAPTURED
 *
 * Requirements: 4.1, 4.2, 4.3
 */

import { NOT_CAPTURED, type CalcResult, guardPositive, guardPositiveStrict } from "./sentinel.ts";
import { roundWeight } from "./rounding.ts";

export type QtyMethod = "length_weight_qty" | "theoretical" | "actual";

/**
 * Theoretical weight = length(m) × weight_per_m(kg/m) × quantity
 * Returns NOT_CAPTURED if any input is zero or negative. (Req 4.2)
 */
export function theoreticalWeight(lengthM: number, weightPerM: number, qty: number): CalcResult {
  if (guardPositiveStrict(lengthM, weightPerM, qty)) return NOT_CAPTURED;
  return roundWeight(lengthM * weightPerM * qty);
}

/**
 * Quantity in kg using the selected calculation method (Req 4.1):
 * - "length_weight_qty": length × weight_per_m × qty (rounded to 3dp)
 * - "theoretical": returns the recorded theoretical weight value (rounded to 3dp)
 * - "actual": returns the recorded actual weight value (rounded to 3dp)
 *
 * Returns NOT_CAPTURED if method is absent/null or required inputs are negative.
 */
export function quantityKg(input: {
  method: QtyMethod | null | undefined;
  lengthM: number;
  weightPerM: number;
  qty: number;
  theoretical?: number | null;
  actual?: number | null;
}): CalcResult {
  if (!input.method) return NOT_CAPTURED;

  switch (input.method) {
    case "length_weight_qty": {
      if (guardPositiveStrict(input.lengthM, input.weightPerM, input.qty)) return NOT_CAPTURED;
      return roundWeight(input.lengthM * input.weightPerM * input.qty);
    }
    case "theoretical": {
      if (input.theoretical === null || input.theoretical === undefined) return NOT_CAPTURED;
      if (guardPositive(input.theoretical)) return NOT_CAPTURED;
      return roundWeight(input.theoretical);
    }
    case "actual": {
      if (input.actual === null || input.actual === undefined) return NOT_CAPTURED;
      if (guardPositive(input.actual)) return NOT_CAPTURED;
      return roundWeight(input.actual);
    }
    default:
      return NOT_CAPTURED;
  }
}

/**
 * Weight variance = actual − theoretical (Req 4.3)
 * May be negative (actual lighter than theoretical).
 * Returns NOT_CAPTURED if actual or theoretical is negative.
 */
export function weightVariance(actual: number, theoretical: number): CalcResult {
  if (guardPositive(actual, theoretical)) return NOT_CAPTURED;
  return roundWeight(actual - theoretical);
}
