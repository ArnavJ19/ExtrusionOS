/**
 * PCDA Calculation Sentinel
 * 
 * When a calculation cannot produce a valid result (zero divisor, absent input,
 * negative input where positive is required), functions return NOT_CAPTURED
 * instead of a fabricated number. UI layers map this to the appropriate
 * Not_Captured_Label for display.
 */

export const NOT_CAPTURED = Symbol("NOT_CAPTURED");

export type CalcResult = number | typeof NOT_CAPTURED;

export function isCaptured(result: CalcResult): result is number {
  return typeof result === "number";
}

/**
 * Guard: returns NOT_CAPTURED if any input is null, undefined, NaN, or negative
 * when positivity is required.
 */
export function guardPositive(...values: (number | null | undefined)[]): typeof NOT_CAPTURED | null {
  for (const v of values) {
    if (v === null || v === undefined || Number.isNaN(v) || v < 0) return NOT_CAPTURED;
  }
  return null;
}

export function guardPositiveStrict(...values: (number | null | undefined)[]): typeof NOT_CAPTURED | null {
  for (const v of values) {
    if (v === null || v === undefined || Number.isNaN(v) || v <= 0) return NOT_CAPTURED;
  }
  return null;
}
