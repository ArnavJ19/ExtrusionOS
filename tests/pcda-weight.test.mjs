/**
 * Property Tests: Weight Calculations
 *
 * Property 1: Quantity-in-kg uses exactly the selected method
 * Property 2: Weight variance is actual minus theoretical and may be negative
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  theoreticalWeight,
  quantityKg,
  weightVariance,
} from "../lib/calculations/pcda/weight.ts";
import { isCaptured } from "../lib/calculations/pcda/sentinel.ts";
import { roundWeight } from "../lib/calculations/pcda/rounding.ts";

/**
 * Arbitrary for positive numbers suitable for weight/length/quantity inputs.
 * Avoids zero (which is valid but edge-case) and extremely large values.
 */
const positiveNum = fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for non-negative numbers (including zero) for weight values.
 */
const nonNegativeNum = fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true });

describe("Property 1: Quantity-in-kg uses exactly the selected method", () => {
  /**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For method "length_weight_qty", quantityKg returns length × weightPerM × qty
   * rounded half-up to 3 decimals, and this equals theoreticalWeight(length, weightPerM, qty).
   */
  it("method 'length_weight_qty' gives same result as theoreticalWeight", () => {
    fc.assert(
      fc.property(positiveNum, positiveNum, positiveNum, (lengthM, weightPerM, qty) => {
        const result = quantityKg({
          method: "length_weight_qty",
          lengthM,
          weightPerM,
          qty,
          theoretical: undefined,
          actual: undefined,
        });

        const theoResult = theoreticalWeight(lengthM, weightPerM, qty);
        const expected = roundWeight(lengthM * weightPerM * qty);

        // Result must be a number (not sentinel)
        assert.ok(isCaptured(result), "quantityKg should return a number for valid inputs");
        assert.ok(isCaptured(theoResult), "theoreticalWeight should return a number for valid inputs");

        // quantityKg with method (a) must equal the expected formula
        assert.strictEqual(result, expected);

        // method (a) result must equal theoreticalWeight
        assert.strictEqual(result, theoResult);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.1**
   *
   * For method "theoretical", quantityKg returns the recorded theoretical weight (rounded to 3dp).
   */
  it("method 'theoretical' returns the recorded theoretical value (rounded)", () => {
    fc.assert(
      fc.property(positiveNum, (theoreticalVal) => {
        const result = quantityKg({
          method: "theoretical",
          lengthM: 1,
          weightPerM: 1,
          qty: 1,
          theoretical: theoreticalVal,
          actual: undefined,
        });

        const expected = roundWeight(theoreticalVal);

        assert.ok(isCaptured(result), "quantityKg should return a number for valid theoretical input");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.1**
   *
   * For method "actual", quantityKg returns the recorded actual weight (rounded to 3dp).
   */
  it("method 'actual' returns the recorded actual value (rounded)", () => {
    fc.assert(
      fc.property(positiveNum, (actualVal) => {
        const result = quantityKg({
          method: "actual",
          lengthM: 1,
          weightPerM: 1,
          qty: 1,
          theoretical: undefined,
          actual: actualVal,
        });

        const expected = roundWeight(actualVal);

        assert.ok(isCaptured(result), "quantityKg should return a number for valid actual input");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * Sentinel cases: negative inputs yield NOT_CAPTURED.
   */
  it("negative inputs yield NOT_CAPTURED sentinel", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: -0.001, noNaN: true, noDefaultInfinity: true }),
        positiveNum,
        positiveNum,
        (negVal, posA, posB) => {
          // Negative length
          const r1 = quantityKg({ method: "length_weight_qty", lengthM: negVal, weightPerM: posA, qty: posB });
          assert.ok(!isCaptured(r1), "Negative lengthM should yield NOT_CAPTURED");

          // Negative weightPerM
          const r2 = quantityKg({ method: "length_weight_qty", lengthM: posA, weightPerM: negVal, qty: posB });
          assert.ok(!isCaptured(r2), "Negative weightPerM should yield NOT_CAPTURED");

          // Negative qty
          const r3 = quantityKg({ method: "length_weight_qty", lengthM: posA, weightPerM: posB, qty: negVal });
          assert.ok(!isCaptured(r3), "Negative qty should yield NOT_CAPTURED");

          // Negative theoretical value
          const r4 = quantityKg({ method: "theoretical", lengthM: posA, weightPerM: posB, qty: posA, theoretical: negVal });
          assert.ok(!isCaptured(r4), "Negative theoretical should yield NOT_CAPTURED");

          // Negative actual value
          const r5 = quantityKg({ method: "actual", lengthM: posA, weightPerM: posB, qty: posA, actual: negVal });
          assert.ok(!isCaptured(r5), "Negative actual should yield NOT_CAPTURED");

          // theoreticalWeight with negative inputs
          const r6 = theoreticalWeight(negVal, posA, posB);
          assert.ok(!isCaptured(r6), "theoreticalWeight with negative length should yield NOT_CAPTURED");
        }
      ),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 4.8**
   *
   * Absent/null method yields NOT_CAPTURED.
   */
  it("null or undefined method yields NOT_CAPTURED", () => {
    const r1 = quantityKg({ method: null, lengthM: 1, weightPerM: 1, qty: 1 });
    assert.ok(!isCaptured(r1), "null method should yield NOT_CAPTURED");

    const r2 = quantityKg({ method: undefined, lengthM: 1, weightPerM: 1, qty: 1 });
    assert.ok(!isCaptured(r2), "undefined method should yield NOT_CAPTURED");
  });
});

describe("Property 2: Weight variance is actual minus theoretical and may be negative", () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any actual weight and theoretical weight, weightVariance equals
   * actual − theoretical rounded half-up to 3 decimals, preserving negative results.
   */
  it("weightVariance equals actual - theoretical (rounded to 3dp), allows negative", () => {
    fc.assert(
      fc.property(nonNegativeNum, nonNegativeNum, (actual, theoretical) => {
        const result = weightVariance(actual, theoretical);
        const expected = roundWeight(actual - theoretical);

        assert.ok(isCaptured(result), "weightVariance should return a number for valid inputs");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * Negative results are preserved: when actual < theoretical, variance is negative.
   */
  it("preserves negative results when actual < theoretical", () => {
    fc.assert(
      fc.property(
        positiveNum,
        fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (base, extra) => {
          // Ensure actual < theoretical by construction
          const actual = base;
          const theoretical = base + extra;
          const result = weightVariance(actual, theoretical);

          assert.ok(isCaptured(result), "weightVariance should return a number");
          assert.ok(result < 0, `Expected negative variance, got ${result}`);
          assert.strictEqual(result, roundWeight(actual - theoretical));
        }
      ),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * Negative inputs yield NOT_CAPTURED.
   */
  it("negative inputs yield NOT_CAPTURED sentinel", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: -0.001, noNaN: true, noDefaultInfinity: true }),
        positiveNum,
        (negVal, posVal) => {
          // Negative actual
          const r1 = weightVariance(negVal, posVal);
          assert.ok(!isCaptured(r1), "Negative actual should yield NOT_CAPTURED");

          // Negative theoretical
          const r2 = weightVariance(posVal, negVal);
          assert.ok(!isCaptured(r2), "Negative theoretical should yield NOT_CAPTURED");
        }
      ),
      { numRuns: 5000 }
    );
  });
});
