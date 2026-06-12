/**
 * PCDA Rounding Functions
 *
 * Half-up rounding applied to the FINAL returned value only (Req 4.11).
 * - Weight and quantity: 3 decimal places
 * - Percentage and monetary: 2 decimal places
 *
 * Uses exponential notation shift to avoid floating-point multiplication errors
 * that plague naive `Math.round(x * factor) / factor` approaches.
 *
 * Rounding is idempotent: applying it to an already-rounded value returns unchanged.
 */

/**
 * True half-up rounding using exponential notation to avoid floating-point
 * representation errors. For example, 1.005 rounded to 2 dp correctly yields 1.01.
 */
function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  // Shift the decimal using exponential notation string conversion,
  // which avoids precision loss from multiplying by a power of 10.
  const shifted = Number(value + "e" + decimals);
  const rounded = Math.round(shifted);
  return Number(rounded + "e-" + decimals);
}

/** Round weight values to 3 decimal places (half-up) */
export function roundWeight(value: number): number {
  return roundHalfUp(value, 3);
}

/** Round quantity values to 3 decimal places (half-up) */
export function roundQuantity(value: number): number {
  return roundHalfUp(value, 3);
}

/** Round percentage values to 2 decimal places (half-up) */
export function roundPercent(value: number): number {
  return roundHalfUp(value, 2);
}

/** Round monetary values to 2 decimal places (half-up) */
export function roundMoney(value: number): number {
  return roundHalfUp(value, 2);
}
