/**
 * Property Tests: Recovery & Scrap Calculations
 *
 * Property 3: Recovery and scrap percentages are uncapped quotients
 *
 * **Validates: Requirements 4.4**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  recoveryPercent,
  scrapPercent,
} from "../lib/calculations/pcda/recovery.ts";
import { isCaptured } from "../lib/calculations/pcda/sentinel.ts";
import { roundPercent } from "../lib/calculations/pcda/rounding.ts";

/**
 * Arbitrary for strictly positive numbers (inputBilletKg must be > 0).
 */
const positiveNum = fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for non-negative numbers (output/scrap weights can be zero).
 */
const nonNegativeNum = fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for negative numbers (used to test sentinel behavior).
 */
const negativeNum = fc.double({ min: -1e6, max: -0.001, noNaN: true, noDefaultInfinity: true });

describe("Property 3: Recovery and scrap percentages are uncapped quotients", () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * recoveryPercent equals output / input × 100 rounded to 2dp for valid inputs.
   */
  it("recoveryPercent equals output / input × 100 rounded to 2dp", () => {
    fc.assert(
      fc.property(nonNegativeNum, positiveNum, (outputGoodKg, inputBilletKg) => {
        const result = recoveryPercent(outputGoodKg, inputBilletKg);
        const expected = roundPercent((outputGoodKg / inputBilletKg) * 100);

        assert.ok(isCaptured(result), "recoveryPercent should return a number for valid inputs");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * scrapPercent equals scrap / input × 100 rounded to 2dp for valid inputs.
   */
  it("scrapPercent equals scrap / input × 100 rounded to 2dp", () => {
    fc.assert(
      fc.property(nonNegativeNum, positiveNum, (scrapKg, inputBilletKg) => {
        const result = scrapPercent(scrapKg, inputBilletKg);
        const expected = roundPercent((scrapKg / inputBilletKg) * 100);

        assert.ok(isCaptured(result), "scrapPercent should return a number for valid inputs");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.4**
   *
   * Neither recoveryPercent nor scrapPercent is capped at 100.
   * When output > input by a sufficient margin, recovery exceeds 100%.
   */
  it("neither value is capped at 100 (output > input yields recovery > 100)", () => {
    // Use a generator where output is at least 1.01× the input to ensure > 100% after rounding
    const inputArb = fc.double({ min: 1, max: 1e5, noNaN: true, noDefaultInfinity: true });
    const multiplierArb = fc.double({ min: 1.01, max: 10, noNaN: true, noDefaultInfinity: true });

    fc.assert(
      fc.property(inputArb, multiplierArb, (inputBilletKg, multiplier) => {
        const outputGoodKg = inputBilletKg * multiplier;

        const result = recoveryPercent(outputGoodKg, inputBilletKg);
        const expected = roundPercent((outputGoodKg / inputBilletKg) * 100);

        assert.ok(isCaptured(result), "recoveryPercent should return a number");
        // The result should exceed 100 since multiplier >= 1.01 → ratio >= 101%
        assert.ok(result > 100, `Expected recovery > 100%, got ${result}`);
        assert.strictEqual(result, expected);

        // Similarly for scrap: scrap > input yields scrap% > 100
        const scrapKg = inputBilletKg * multiplier;
        const scrapResult = scrapPercent(scrapKg, inputBilletKg);
        const scrapExpected = roundPercent((scrapKg / inputBilletKg) * 100);

        assert.ok(isCaptured(scrapResult), "scrapPercent should return a number");
        assert.ok(scrapResult > 100, `Expected scrap% > 100%, got ${scrapResult}`);
        assert.strictEqual(scrapResult, scrapExpected);
      }),
      { numRuns: 5000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * Zero divisor (inputBilletKg = 0) yields NOT_CAPTURED.
   */
  it("zero inputBilletKg yields NOT_CAPTURED", () => {
    fc.assert(
      fc.property(nonNegativeNum, (weight) => {
        const recoveryResult = recoveryPercent(weight, 0);
        assert.ok(!isCaptured(recoveryResult), "recoveryPercent with zero input should yield NOT_CAPTURED");

        const scrapResult = scrapPercent(weight, 0);
        assert.ok(!isCaptured(scrapResult), "scrapPercent with zero input should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * Negative inputs yield NOT_CAPTURED.
   */
  it("negative inputs yield NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, (negVal, posVal) => {
        // Negative outputGoodKg
        const r1 = recoveryPercent(negVal, posVal);
        assert.ok(!isCaptured(r1), "Negative outputGoodKg should yield NOT_CAPTURED");

        // Negative inputBilletKg
        const r2 = recoveryPercent(posVal, negVal);
        assert.ok(!isCaptured(r2), "Negative inputBilletKg should yield NOT_CAPTURED");

        // Negative scrapKg
        const r3 = scrapPercent(negVal, posVal);
        assert.ok(!isCaptured(r3), "Negative scrapKg should yield NOT_CAPTURED");

        // Negative inputBilletKg for scrap
        const r4 = scrapPercent(posVal, negVal);
        assert.ok(!isCaptured(r4), "Negative inputBilletKg for scrap should yield NOT_CAPTURED");
      }),
      { numRuns: 5000 }
    );
  });
});
