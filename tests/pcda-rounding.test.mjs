/**
 * Property Test: Rounding is half-up to the field's precision and idempotent
 *
 * Property 6: For any finite number, roundWeight/roundQuantity round half-up to three decimals,
 * roundPercent/roundMoney round half-up to two decimals, applying rounding only to the final
 * returned value; applying the rounding function to an already-rounded value returns it unchanged.
 *
 * **Validates: Requirements 4.11**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  roundWeight,
  roundQuantity,
  roundPercent,
  roundMoney,
} from "../lib/calculations/pcda/rounding.ts";

/**
 * Helper: count actual decimal places in a number.
 * Uses string representation to avoid floating-point artifacts.
 */
function decimalPlaces(n) {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const dotIndex = s.indexOf(".");
  if (dotIndex === -1) return 0;
  // Handle scientific notation (e.g., 1e-7)
  const eIndex = s.indexOf("e");
  if (eIndex !== -1) {
    // For scientific notation, parse the actual decimal places from the full representation
    const fixed = n.toFixed(20);
    const trimmed = fixed.replace(/0+$/, "");
    const fixedDot = trimmed.indexOf(".");
    if (fixedDot === -1) return 0;
    return trimmed.length - fixedDot - 1;
  }
  return s.length - dotIndex - 1;
}

/**
 * Arbitrary for finite doubles excluding extreme magnitudes that cause
 * floating-point representation issues. We use a reasonable range.
 */
const finiteDouble = fc.double({
  min: -1e12,
  max: 1e12,
  noNaN: true,
  noDefaultInfinity: true,
});



describe("Property 6: Rounding is half-up to the field's precision and idempotent", () => {
  /**
   * **Validates: Requirements 4.11**
   *
   * Idempotence: roundWeight(roundWeight(v)) === roundWeight(v) for all finite numbers.
   */
  it("roundWeight is idempotent: applying it twice yields the same result as once", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const once = roundWeight(v);
        const twice = roundWeight(once);
        return Object.is(once, twice);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Idempotence: roundQuantity(roundQuantity(v)) === roundQuantity(v) for all finite numbers.
   */
  it("roundQuantity is idempotent: applying it twice yields the same result as once", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const once = roundQuantity(v);
        const twice = roundQuantity(once);
        return Object.is(once, twice);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Idempotence: roundPercent(roundPercent(v)) === roundPercent(v) for all finite numbers.
   */
  it("roundPercent is idempotent: applying it twice yields the same result as once", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const once = roundPercent(v);
        const twice = roundPercent(once);
        return Object.is(once, twice);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Idempotence: roundMoney(roundMoney(v)) === roundMoney(v) for all finite numbers.
   */
  it("roundMoney is idempotent: applying it twice yields the same result as once", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const once = roundMoney(v);
        const twice = roundMoney(once);
        return Object.is(once, twice);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Precision: roundWeight result has at most 3 decimal places.
   */
  it("roundWeight produces at most 3 decimal places", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const result = roundWeight(v);
        return decimalPlaces(result) <= 3;
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Precision: roundQuantity result has at most 3 decimal places.
   */
  it("roundQuantity produces at most 3 decimal places", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const result = roundQuantity(v);
        return decimalPlaces(result) <= 3;
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Precision: roundPercent result has at most 2 decimal places.
   */
  it("roundPercent produces at most 2 decimal places", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const result = roundPercent(v);
        return decimalPlaces(result) <= 2;
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Precision: roundMoney result has at most 2 decimal places.
   */
  it("roundMoney produces at most 2 decimal places", () => {
    fc.assert(
      fc.property(finiteDouble, (v) => {
        const result = roundMoney(v);
        return decimalPlaces(result) <= 2;
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Half-up behavior for 3dp: values at the midpoint (X.YYY5) round up (toward +∞).
   * We construct exact midpoints by using integer-based values that are exactly
   * representable in floating-point: (2*base + 1) / 2e4 gives base/1e4 * 10 + 0.0005
   * which for small enough integers is exact.
   * E.g., 1.0005 → 1.001, 2.1235 → 2.124
   */
  it("roundWeight rounds half-up at the midpoint (3dp)", () => {
    // Use specific known-exact midpoints to verify half-up behavior.
    // The implementation uses exponential notation shift: Number(value + "e3") then Math.round.
    // We verify that the implementation correctly rounds 0.5 at the shifted level.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 9 }),
        (intPart, lastDigit) => {
          // Construct value as string to feed into the function: "intPart.lastDigit005"
          // e.g., intPart=1, lastDigit=2 → 1.2005 → should round to 1.201
          const valueStr = `${intPart}.${lastDigit}005`;
          const value = parseFloat(valueStr);
          const result = roundWeight(value);
          const expectedStr = `${intPart}.${lastDigit}01`;
          const expected = parseFloat(expectedStr);
          // The implementation rounds using exponential shift, so we verify against it
          return Math.abs(result - expected) < 1e-10;
        }
      ),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Half-up behavior for 2dp: values at the midpoint (X.YY5) round up (toward +∞).
   * E.g., 1.005 → 1.01, 2.125 → 2.13
   * We construct midpoints as "intPart.D1D25" where D1D2 are two decimal digits.
   */
  it("roundMoney rounds half-up at the midpoint (2dp)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 99 }),
        (intPart, decPart) => {
          // Construct value as string: "intPart.DD5" where DD is zero-padded decPart
          // e.g., intPart=1, decPart=0 → "1.005" → should round to 1.01
          // e.g., intPart=2, decPart=12 → "2.125" → should round to 2.13
          const dd = String(decPart).padStart(2, "0");
          const valueStr = `${intPart}.${dd}5`;
          const value = parseFloat(valueStr);
          const result = roundMoney(value);
          // Expected: increment the 2nd decimal place
          const expectedDecPart = decPart + 1;
          const expectedDd = String(expectedDecPart).padStart(2, "0");
          // Handle carry: if decPart=99, then 99+1=100, meaning intPart+1 and .00
          let expected;
          if (expectedDecPart <= 99) {
            expected = parseFloat(`${intPart}.${expectedDd}`);
          } else {
            expected = intPart + 1;
          }
          return Math.abs(result - expected) < 1e-10;
        }
      ),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Half-up behavior for roundPercent at the midpoint (2dp, toward +∞).
   */
  it("roundPercent rounds half-up at the midpoint (2dp)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 0, max: 99 }),
        (intPart, decPart) => {
          const dd = String(decPart).padStart(2, "0");
          const valueStr = `${intPart}.${dd}5`;
          const value = parseFloat(valueStr);
          const result = roundPercent(value);
          const expectedDecPart = decPart + 1;
          const expectedDd = String(expectedDecPart).padStart(2, "0");
          let expected;
          if (expectedDecPart <= 99) {
            expected = parseFloat(`${intPart}.${expectedDd}`);
          } else {
            expected = intPart + 1;
          }
          return Math.abs(result - expected) < 1e-10;
        }
      ),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 4.11**
   *
   * Non-finite values (NaN, Infinity, -Infinity) are handled gracefully:
   * the functions return the value as-is without throwing.
   */
  it("roundWeight handles NaN gracefully (returns NaN without throwing)", () => {
    const result = roundWeight(NaN);
    assert.ok(Number.isNaN(result), "roundWeight(NaN) should return NaN");
  });

  it("roundWeight handles Infinity gracefully (returns Infinity without throwing)", () => {
    assert.equal(roundWeight(Infinity), Infinity);
    assert.equal(roundWeight(-Infinity), -Infinity);
  });

  it("roundQuantity handles NaN gracefully (returns NaN without throwing)", () => {
    const result = roundQuantity(NaN);
    assert.ok(Number.isNaN(result), "roundQuantity(NaN) should return NaN");
  });

  it("roundQuantity handles Infinity gracefully (returns Infinity without throwing)", () => {
    assert.equal(roundQuantity(Infinity), Infinity);
    assert.equal(roundQuantity(-Infinity), -Infinity);
  });

  it("roundPercent handles NaN gracefully (returns NaN without throwing)", () => {
    const result = roundPercent(NaN);
    assert.ok(Number.isNaN(result), "roundPercent(NaN) should return NaN");
  });

  it("roundPercent handles Infinity gracefully (returns Infinity without throwing)", () => {
    assert.equal(roundPercent(Infinity), Infinity);
    assert.equal(roundPercent(-Infinity), -Infinity);
  });

  it("roundMoney handles NaN gracefully (returns NaN without throwing)", () => {
    const result = roundMoney(NaN);
    assert.ok(Number.isNaN(result), "roundMoney(NaN) should return NaN");
  });

  it("roundMoney handles Infinity gracefully (returns Infinity without throwing)", () => {
    assert.equal(roundMoney(Infinity), Infinity);
    assert.equal(roundMoney(-Infinity), -Infinity);
  });
});
