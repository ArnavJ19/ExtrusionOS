/**
 * PCDA Recovery & Scrap Calculations
 *
 * Pure functions for recovery percentage and scrap percentage.
 * Returns NOT_CAPTURED sentinel for invalid/absent inputs.
 *
 * Sentinel discipline (Req 4.8, 4.12):
 * - If inputBilletKg is zero or absent → NOT_CAPTURED (zero divisor)
 * - If outputGoodKg or scrapKg is negative → NOT_CAPTURED
 * - If inputBilletKg is negative → NOT_CAPTURED
 *
 * Neither value is capped at 100 (can exceed 100 in edge cases).
 *
 * Requirements: 4.4
 */

import { NOT_CAPTURED, type CalcResult, guardPositive, guardPositiveStrict } from "./sentinel.ts";
import { roundPercent } from "./rounding.ts";

/**
 * Recovery percent = outputGoodKg / inputBilletKg × 100 (Req 4.4)
 * Rounded half-up to 2 decimal places. Not capped at 100.
 *
 * Returns NOT_CAPTURED if:
 * - inputBilletKg is zero or negative (zero divisor / invalid)
 * - outputGoodKg is negative
 */
export function recoveryPercent(outputGoodKg: number, inputBilletKg: number): CalcResult {
  // outputGoodKg must be non-negative (≥ 0)
  if (guardPositive(outputGoodKg)) return NOT_CAPTURED;
  // inputBilletKg must be strictly positive (> 0) to avoid division by zero
  if (guardPositiveStrict(inputBilletKg)) return NOT_CAPTURED;
  return roundPercent((outputGoodKg / inputBilletKg) * 100);
}

/**
 * Scrap percent = scrapKg / inputBilletKg × 100 (Req 4.4)
 * Rounded half-up to 2 decimal places. Not capped at 100.
 *
 * Returns NOT_CAPTURED if:
 * - inputBilletKg is zero or negative (zero divisor / invalid)
 * - scrapKg is negative
 */
export function scrapPercent(scrapKg: number, inputBilletKg: number): CalcResult {
  // scrapKg must be non-negative (≥ 0)
  if (guardPositive(scrapKg)) return NOT_CAPTURED;
  // inputBilletKg must be strictly positive (> 0) to avoid division by zero
  if (guardPositiveStrict(inputBilletKg)) return NOT_CAPTURED;
  return roundPercent((scrapKg / inputBilletKg) * 100);
}
