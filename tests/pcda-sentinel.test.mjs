/**
 * Property Tests: Sentinel Behavior
 *
 * Property 5: Absent, zero-divisor, or negative inputs yield the NOT_CAPTURED sentinel
 *
 * For any calculation whose divisor is zero or absent, whose Quantity_Calculation_Method
 * is absent, or whose numeric input used in the computation is negative, the function
 * returns the NOT_CAPTURED sentinel and never a numeric value.
 *
 * **Validates: Requirements 4.8, 4.12**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { isCaptured } from "../lib/calculations/pcda/sentinel.ts";
import { theoreticalWeight, quantityKg, weightVariance } from "../lib/calculations/pcda/weight.ts";
import { recoveryPercent, scrapPercent } from "../lib/calculations/pcda/recovery.ts";
import {
  costPerKg,
  costPerMeter,
  costPerPiece,
  contributionMargin,
  netRateAndLineValue,
} from "../lib/calculations/pcda/cost.ts";

/**
 * Helper: asserts that a CalcResult is NOT_CAPTURED (not a number).
 * Uses !isCaptured to avoid Symbol identity issues across module boundaries.
 */
function assertNotCaptured(result, message) {
  assert.ok(!isCaptured(result), message);
}

/**
 * Arbitrary for strictly negative numbers.
 */
const negativeNum = fc.double({ min: -1e6, max: -0.001, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for non-negative numbers (valid positive inputs).
 */
const nonNegativeNum = fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for strictly positive numbers.
 */
const positiveNum = fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for zero or negative numbers (invalid divisors).
 */
const zeroOrNegativeNum = fc.double({ min: -1e6, max: 0, noNaN: true, noDefaultInfinity: true });

describe("Property 5: Absent, zero-divisor, or negative inputs yield the NOT_CAPTURED sentinel", () => {
  // --- theoreticalWeight with any negative input ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * theoreticalWeight with negative lengthM → NOT_CAPTURED
   */
  it("theoreticalWeight with negative lengthM returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, positiveNum, (lengthM, weightPerM, qty) => {
        const result = theoreticalWeight(lengthM, weightPerM, qty);
        assertNotCaptured(result, "negative lengthM should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * theoreticalWeight with negative weightPerM → NOT_CAPTURED
   */
  it("theoreticalWeight with negative weightPerM returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, negativeNum, positiveNum, (lengthM, weightPerM, qty) => {
        const result = theoreticalWeight(lengthM, weightPerM, qty);
        assertNotCaptured(result, "negative weightPerM should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * theoreticalWeight with negative qty → NOT_CAPTURED
   */
  it("theoreticalWeight with negative qty returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, positiveNum, negativeNum, (lengthM, weightPerM, qty) => {
        const result = theoreticalWeight(lengthM, weightPerM, qty);
        assertNotCaptured(result, "negative qty should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- quantityKg with null/undefined method ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * quantityKg with null method → NOT_CAPTURED
   */
  it("quantityKg with null method returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, positiveNum, positiveNum, (lengthM, weightPerM, qty) => {
        const result = quantityKg({
          method: null,
          lengthM,
          weightPerM,
          qty,
          theoretical: 10,
          actual: 10,
        });
        assertNotCaptured(result, "null method should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * quantityKg with undefined method → NOT_CAPTURED
   */
  it("quantityKg with undefined method returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, positiveNum, positiveNum, (lengthM, weightPerM, qty) => {
        const result = quantityKg({
          method: undefined,
          lengthM,
          weightPerM,
          qty,
          theoretical: 10,
          actual: 10,
        });
        assertNotCaptured(result, "undefined method should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- quantityKg with negative inputs for each method ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * quantityKg "length_weight_qty" with any negative input → NOT_CAPTURED
   */
  it("quantityKg length_weight_qty with negative lengthM returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, positiveNum, (lengthM, weightPerM, qty) => {
        const result = quantityKg({ method: "length_weight_qty", lengthM, weightPerM, qty });
        assertNotCaptured(result, "negative lengthM in length_weight_qty should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  it("quantityKg length_weight_qty with negative weightPerM returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, negativeNum, positiveNum, (lengthM, weightPerM, qty) => {
        const result = quantityKg({ method: "length_weight_qty", lengthM, weightPerM, qty });
        assertNotCaptured(result, "negative weightPerM in length_weight_qty should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  it("quantityKg length_weight_qty with negative qty returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, positiveNum, negativeNum, (lengthM, weightPerM, qty) => {
        const result = quantityKg({ method: "length_weight_qty", lengthM, weightPerM, qty });
        assertNotCaptured(result, "negative qty in length_weight_qty should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * quantityKg "theoretical" with negative theoretical → NOT_CAPTURED
   */
  it("quantityKg theoretical method with negative theoretical value returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, (theoretical) => {
        const result = quantityKg({
          method: "theoretical",
          lengthM: 1,
          weightPerM: 1,
          qty: 1,
          theoretical,
          actual: 10,
        });
        assertNotCaptured(result, "negative theoretical should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * quantityKg "actual" with negative actual → NOT_CAPTURED
   */
  it("quantityKg actual method with negative actual value returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, (actual) => {
        const result = quantityKg({
          method: "actual",
          lengthM: 1,
          weightPerM: 1,
          qty: 1,
          theoretical: 10,
          actual,
        });
        assertNotCaptured(result, "negative actual should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- weightVariance with negative actual or theoretical ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * weightVariance with negative actual → NOT_CAPTURED
   */
  it("weightVariance with negative actual returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, (actual, theoretical) => {
        const result = weightVariance(actual, theoretical);
        assertNotCaptured(result, "negative actual should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * weightVariance with negative theoretical → NOT_CAPTURED
   */
  it("weightVariance with negative theoretical returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, negativeNum, (actual, theoretical) => {
        const result = weightVariance(actual, theoretical);
        assertNotCaptured(result, "negative theoretical should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- recoveryPercent with zero or negative inputBilletKg ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * recoveryPercent with zero or negative inputBilletKg → NOT_CAPTURED
   */
  it("recoveryPercent with zero or negative inputBilletKg returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(nonNegativeNum, zeroOrNegativeNum, (outputGoodKg, inputBilletKg) => {
        const result = recoveryPercent(outputGoodKg, inputBilletKg);
        assertNotCaptured(result, "zero or negative inputBilletKg should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- recoveryPercent with negative outputGoodKg ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * recoveryPercent with negative outputGoodKg → NOT_CAPTURED
   */
  it("recoveryPercent with negative outputGoodKg returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, (outputGoodKg, inputBilletKg) => {
        const result = recoveryPercent(outputGoodKg, inputBilletKg);
        assertNotCaptured(result, "negative outputGoodKg should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- scrapPercent with zero or negative inputBilletKg ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * scrapPercent with zero or negative inputBilletKg → NOT_CAPTURED
   */
  it("scrapPercent with zero or negative inputBilletKg returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(nonNegativeNum, zeroOrNegativeNum, (scrapKg, inputBilletKg) => {
        const result = scrapPercent(scrapKg, inputBilletKg);
        assertNotCaptured(result, "zero or negative inputBilletKg should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- scrapPercent with negative scrapKg ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * scrapPercent with negative scrapKg → NOT_CAPTURED
   */
  it("scrapPercent with negative scrapKg returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, (scrapKg, inputBilletKg) => {
        const result = scrapPercent(scrapKg, inputBilletKg);
        assertNotCaptured(result, "negative scrapKg should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- costPerKg/costPerMeter/costPerPiece with zero divisor ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * costPerKg with zero or negative divisor → NOT_CAPTURED
   */
  it("costPerKg with zero or negative qtyKg returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(nonNegativeNum, zeroOrNegativeNum, (totalCost, qtyKg) => {
        const result = costPerKg(totalCost, qtyKg);
        assertNotCaptured(result, "zero or negative qtyKg should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * costPerMeter with zero or negative divisor → NOT_CAPTURED
   */
  it("costPerMeter with zero or negative totalMeters returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(nonNegativeNum, zeroOrNegativeNum, (totalCost, totalMeters) => {
        const result = costPerMeter(totalCost, totalMeters);
        assertNotCaptured(result, "zero or negative totalMeters should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * costPerPiece with zero or negative divisor → NOT_CAPTURED
   */
  it("costPerPiece with zero or negative pieces returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(nonNegativeNum, zeroOrNegativeNum, (totalCost, pieces) => {
        const result = costPerPiece(totalCost, pieces);
        assertNotCaptured(result, "zero or negative pieces should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- costPerKg/costPerMeter/costPerPiece with negative totalCost ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * costPerKg with negative totalCost → NOT_CAPTURED
   */
  it("costPerKg with negative totalCost returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, (totalCost, qtyKg) => {
        const result = costPerKg(totalCost, qtyKg);
        assertNotCaptured(result, "negative totalCost should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * costPerMeter with negative totalCost → NOT_CAPTURED
   */
  it("costPerMeter with negative totalCost returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, (totalCost, totalMeters) => {
        const result = costPerMeter(totalCost, totalMeters);
        assertNotCaptured(result, "negative totalCost should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * costPerPiece with negative totalCost → NOT_CAPTURED
   */
  it("costPerPiece with negative totalCost returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(negativeNum, positiveNum, (totalCost, pieces) => {
        const result = costPerPiece(totalCost, pieces);
        assertNotCaptured(result, "negative totalCost should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- contributionMargin with null/undefined inputs ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * contributionMargin with null netRevenue → NOT_CAPTURED
   */
  it("contributionMargin with null netRevenue returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, (variableCost) => {
        const result = contributionMargin(null, variableCost);
        assertNotCaptured(result, "null netRevenue should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * contributionMargin with undefined netRevenue → NOT_CAPTURED
   */
  it("contributionMargin with undefined netRevenue returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, (variableCost) => {
        const result = contributionMargin(undefined, variableCost);
        assertNotCaptured(result, "undefined netRevenue should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * contributionMargin with null variableCost → NOT_CAPTURED
   */
  it("contributionMargin with null variableCost returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, (netRevenue) => {
        const result = contributionMargin(netRevenue, null);
        assertNotCaptured(result, "null variableCost should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * contributionMargin with undefined variableCost → NOT_CAPTURED
   */
  it("contributionMargin with undefined variableCost returns NOT_CAPTURED", () => {
    fc.assert(
      fc.property(positiveNum, (netRevenue) => {
        const result = contributionMargin(netRevenue, undefined);
        assertNotCaptured(result, "undefined variableCost should yield NOT_CAPTURED");
      }),
      { numRuns: 1000 }
    );
  });

  // --- netRateAndLineValue with zero or negative quantityKg ---

  /**
   * **Validates: Requirements 4.8, 4.12**
   *
   * netRateAndLineValue with zero or negative quantityKg → NOT_CAPTURED for both outputs
   */
  it("netRateAndLineValue with zero or negative quantityKg returns NOT_CAPTURED", () => {
    const moneyNum = fc.double({ min: 0, max: 1e4, noNaN: true, noDefaultInfinity: true });
    const finiteNum = fc.double({ min: -1e4, max: 1e4, noNaN: true, noDefaultInfinity: true });

    fc.assert(
      fc.property(
        moneyNum,
        moneyNum,
        moneyNum,
        moneyNum,
        moneyNum,
        moneyNum,
        moneyNum,
        zeroOrNegativeNum,
        moneyNum,
        finiteNum,
        (basicPrice, alloyCharge, reCutting, testing, dieService, freight, packing, quantityKg, discount, margin) => {
          const result = netRateAndLineValue({
            basicPrice,
            alloyChargePerKg: alloyCharge,
            reCuttingChargePerKg: reCutting,
            testingServiceChargePerKg: testing,
            dieServiceCharge: dieService,
            freightCharge: freight,
            packingCharge: packing,
            packingInConversion: false,
            quantityKg,
            discount,
            margin,
          });
          assertNotCaptured(result.netRate, "zero/negative quantityKg should yield NOT_CAPTURED netRate");
          assertNotCaptured(result.lineValue, "zero/negative quantityKg should yield NOT_CAPTURED lineValue");
        }
      ),
      { numRuns: 1000 }
    );
  });
});
