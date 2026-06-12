/**
 * Property Tests: Cost Calculations and Packing Flag
 *
 * Property 4: Cost ratios and contribution margin follow their formulas
 * Property 7: Packing charge is included exactly once when its flag is set
 *
 * **Validates: Requirements 3.6, 3.7, 4.6, 4.7**
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  costPerKg,
  costPerMeter,
  costPerPiece,
  contributionMargin,
  basicPrice,
  netRateAndLineValue,
} from "../lib/calculations/pcda/cost.ts";
import { isCaptured } from "../lib/calculations/pcda/sentinel.ts";
import { roundMoney } from "../lib/calculations/pcda/rounding.ts";

/**
 * Arbitrary for strictly positive numbers (divisors must be > 0).
 */
const positiveNum = fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for non-negative numbers (totalCost can be zero).
 */
const nonNegativeNum = fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for any finite number (contribution margin allows negatives).
 */
const finiteNum = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });

/**
 * Arbitrary for monetary amounts (non-negative, realistic range for charges/prices).
 * Using min: 0 with integer-based generation to avoid subnormal floating-point values
 * that would not represent real monetary amounts.
 */
const moneyNum = fc.integer({ min: 0, max: 100000000 }).map((n) => n / 100);

describe("Property 4: Cost ratios and contribution margin follow their formulas", () => {
  /**
   * **Validates: Requirements 4.6**
   *
   * costPerKg = totalCost / qtyKg rounded to 2dp for valid inputs.
   */
  it("costPerKg = totalCost / qtyKg rounded to 2dp for valid inputs", () => {
    fc.assert(
      fc.property(nonNegativeNum, positiveNum, (totalCost, qtyKg) => {
        const result = costPerKg(totalCost, qtyKg);
        const expected = roundMoney(totalCost / qtyKg);

        assert.ok(isCaptured(result), "costPerKg should return a number for valid inputs");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * costPerMeter = totalCost / totalMeters rounded to 2dp for valid inputs.
   */
  it("costPerMeter = totalCost / totalMeters rounded to 2dp for valid inputs", () => {
    fc.assert(
      fc.property(nonNegativeNum, positiveNum, (totalCost, totalMeters) => {
        const result = costPerMeter(totalCost, totalMeters);
        const expected = roundMoney(totalCost / totalMeters);

        assert.ok(isCaptured(result), "costPerMeter should return a number for valid inputs");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * costPerPiece = totalCost / pieces rounded to 2dp for valid inputs.
   */
  it("costPerPiece = totalCost / pieces rounded to 2dp for valid inputs", () => {
    fc.assert(
      fc.property(nonNegativeNum, positiveNum, (totalCost, pieces) => {
        const result = costPerPiece(totalCost, pieces);
        const expected = roundMoney(totalCost / pieces);

        assert.ok(isCaptured(result), "costPerPiece should return a number for valid inputs");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * **Validates: Requirements 4.7**
   *
   * contributionMargin = netRevenue - variableCost rounded to 2dp (allows negative result).
   */
  it("contributionMargin = netRevenue - variableCost rounded to 2dp (allows negative result)", () => {
    fc.assert(
      fc.property(finiteNum, finiteNum, (netRevenue, variableCost) => {
        const result = contributionMargin(netRevenue, variableCost);
        const expected = roundMoney(netRevenue - variableCost);

        assert.ok(isCaptured(result), "contributionMargin should return a number for valid inputs");
        assert.strictEqual(result, expected);
      }),
      { numRuns: 10000 }
    );
  });
});

describe("Property 7: Packing charge is included exactly once when its flag is set", () => {
  /**
   * Arbitrary for BasicPriceParts.
   */
  const basicPricePartsArb = fc.record({
    materialPrice: moneyNum,
    valueAddedServicePrice: moneyNum,
    otherCharges: moneyNum,
    packingCharge: moneyNum,
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * basicPrice with includePackingInBasic=true minus basicPrice with
   * includePackingInBasic=false equals packing charge (rounded).
   */
  it("basicPrice with includePackingInBasic=true exceeds disabled result by exactly packing charge", () => {
    fc.assert(
      fc.property(basicPricePartsArb, (parts) => {
        const withPacking = basicPrice({
          ...parts,
          includePackingInBasic: true,
        });
        const withoutPacking = basicPrice({
          ...parts,
          includePackingInBasic: false,
        });

        // The difference should be exactly the packing charge after rounding
        const difference = roundMoney(withPacking - withoutPacking);
        const expectedDifference = roundMoney(parts.packingCharge);

        assert.strictEqual(
          difference,
          expectedDifference,
          `basicPrice difference should equal packing charge: got ${difference}, expected ${expectedDifference}`
        );
      }),
      { numRuns: 10000 }
    );
  });

  /**
   * Arbitrary for PricingInput (without packing flags, those are controlled in the test).
   */
  const pricingInputBaseArb = fc.record({
    basicPrice: moneyNum,
    alloyChargePerKg: moneyNum,
    reCuttingChargePerKg: moneyNum,
    testingServiceChargePerKg: moneyNum,
    dieServiceCharge: moneyNum,
    freightCharge: moneyNum,
    packingCharge: moneyNum,
    quantityKg: positiveNum,
    discount: moneyNum,
    margin: finiteNum,
  });

  /**
   * **Validates: Requirements 3.7**
   *
   * netRateAndLineValue with packingInConversion=true vs false:
   * the difference in lineValue equals packing charge.
   *
   * Since lineValue = roundMoney(total), the observable difference
   * roundMoney(total + packing) - roundMoney(total) may differ from
   * roundMoney(packing) by at most 0.01 due to intermediate rounding.
   * We also round the difference itself since IEEE754 subtraction of
   * two rounded numbers may carry representation noise beyond 2dp.
   */
  it("netRateAndLineValue with packingInConversion=true exceeds disabled result by exactly packing charge", () => {
    fc.assert(
      fc.property(pricingInputBaseArb, (base) => {
        const withPacking = netRateAndLineValue({
          ...base,
          packingInConversion: true,
        });
        const withoutPacking = netRateAndLineValue({
          ...base,
          packingInConversion: false,
        });

        // Both should produce valid results since quantityKg > 0
        assert.ok(isCaptured(withPacking.lineValue), "lineValue with packing should be captured");
        assert.ok(isCaptured(withoutPacking.lineValue), "lineValue without packing should be captured");

        // The difference in lineValue should equal the packing charge.
        // roundMoney the difference to remove IEEE754 subtraction noise,
        // then allow ±0.01 for the boundary rounding case.
        const difference = roundMoney(withPacking.lineValue - withoutPacking.lineValue);
        const expectedDifference = roundMoney(base.packingCharge);

        assert.ok(
          Math.abs(difference - expectedDifference) < 0.015,
          `lineValue difference should equal packing charge (±0.01 rounding): got ${difference}, expected ${expectedDifference}`
        );
      }),
      { numRuns: 10000 }
    );
  });
});
