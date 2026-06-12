import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { roundWeight, roundQuantity, roundPercent, roundMoney } from "../lib/calculations/pcda/rounding.ts";
import { isCaptured } from "../lib/calculations/pcda/sentinel.ts";
import { theoreticalWeight, quantityKg, weightVariance } from "../lib/calculations/pcda/weight.ts";
import { recoveryPercent, scrapPercent } from "../lib/calculations/pcda/recovery.ts";
import { costPerKg, costPerMeter, costPerPiece, contributionMargin, basicPrice, netRateAndLineValue } from "../lib/calculations/pcda/cost.ts";

// ============================================================
// Property 6: Rounding is half-up, idempotent, correct precision
// ============================================================
describe("Rounding functions", () => {
  it("roundWeight rounds to 3 decimal places", () => {
    assert.equal(roundWeight(1.23456), 1.235);
    assert.equal(roundWeight(1.2345), 1.235); // half-up
    assert.equal(roundWeight(1.2344), 1.234);
  });

  it("roundQuantity rounds to 3 decimal places", () => {
    assert.equal(roundQuantity(99.9995), 100);
    assert.equal(roundQuantity(0.001), 0.001);
  });

  it("roundPercent rounds to 2 decimal places", () => {
    assert.equal(roundPercent(85.555), 85.56); // half-up
    assert.equal(roundPercent(85.554), 85.55);
  });

  it("roundMoney rounds to 2 decimal places", () => {
    assert.equal(roundMoney(100.005), 100.01); // half-up
    assert.equal(roundMoney(100.004), 100);
  });

  it("rounding is idempotent", () => {
    assert.equal(roundWeight(roundWeight(1.23456)), roundWeight(1.23456));
    assert.equal(roundPercent(roundPercent(85.555)), roundPercent(85.555));
    assert.equal(roundMoney(roundMoney(100.005)), roundMoney(100.005));
  });
});

// ============================================================
// Property 1: Quantity-in-kg uses exactly the selected method
// Property 2: Weight variance is actual minus theoretical
// ============================================================
describe("Weight calculations", () => {
  it("theoreticalWeight = length × weight_per_m × qty", () => {
    const result = theoreticalWeight(5.8, 0.450, 100);
    assert.equal(isCaptured(result), true);
    assert.equal(result, roundWeight(5.8 * 0.450 * 100));
  });

  it("theoreticalWeight returns NOT_CAPTURED for zero inputs", () => {
    assert.ok(!isCaptured(theoreticalWeight(0, 0.450, 100)), "zero lengthM");
    assert.ok(!isCaptured(theoreticalWeight(5.8, 0, 100)), "zero weightPerM");
    assert.ok(!isCaptured(theoreticalWeight(5.8, 0.450, 0)), "zero qty");
  });

  it("theoreticalWeight returns NOT_CAPTURED for negative inputs", () => {
    assert.ok(!isCaptured(theoreticalWeight(-1, 0.450, 100)), "negative lengthM");
    assert.ok(!isCaptured(theoreticalWeight(5.8, -0.1, 100)), "negative weightPerM");
  });

  it("quantityKg method length_weight_qty matches theoreticalWeight", () => {
    const tw = theoreticalWeight(5.8, 0.450, 100);
    const qkg = quantityKg({ method: "length_weight_qty", lengthM: 5.8, weightPerM: 0.450, qty: 100 });
    assert.equal(tw, qkg);
  });

  it("quantityKg method theoretical uses recorded value", () => {
    const result = quantityKg({ method: "theoretical", lengthM: 5.8, weightPerM: 0.450, qty: 100, theoretical: 250.5 });
    assert.equal(result, roundWeight(250.5));
  });

  it("quantityKg method actual uses recorded value", () => {
    const result = quantityKg({ method: "actual", lengthM: 5.8, weightPerM: 0.450, qty: 100, actual: 248.3 });
    assert.equal(result, roundWeight(248.3));
  });

  it("quantityKg returns NOT_CAPTURED when method is null", () => {
    assert.ok(!isCaptured(quantityKg({ method: null, lengthM: 5.8, weightPerM: 0.450, qty: 100 })), "null method");
  });

  it("weightVariance = actual - theoretical (may be negative)", () => {
    assert.equal(weightVariance(248, 261), roundWeight(248 - 261));
    assert.equal(weightVariance(270, 261), roundWeight(270 - 261));
  });

  it("weightVariance returns NOT_CAPTURED for negative inputs", () => {
    assert.ok(!isCaptured(weightVariance(-1, 261)), "negative actual");
    assert.ok(!isCaptured(weightVariance(248, -1)), "negative theoretical");
  });
});

// ============================================================
// Property 3: Recovery and scrap percentages are uncapped
// ============================================================
describe("Recovery and scrap calculations", () => {
  it("recoveryPercent = output / input × 100", () => {
    const result = recoveryPercent(750, 1000);
    assert.equal(result, 75);
  });

  it("recoveryPercent is uncapped (can exceed 100)", () => {
    const result = recoveryPercent(1050, 1000);
    assert.equal(result, 105);
  });

  it("recoveryPercent returns NOT_CAPTURED for zero input", () => {
    assert.ok(!isCaptured(recoveryPercent(750, 0)), "zero input");
  });

  it("recoveryPercent returns NOT_CAPTURED for negative input", () => {
    assert.ok(!isCaptured(recoveryPercent(-1, 1000)), "negative output");
    assert.ok(!isCaptured(recoveryPercent(750, -1)), "negative input");
  });

  it("scrapPercent = scrap / input × 100", () => {
    const result = scrapPercent(250, 1000);
    assert.equal(result, 25);
  });

  it("scrapPercent is uncapped", () => {
    const result = scrapPercent(1100, 1000);
    assert.equal(result, 110);
  });
});

// ============================================================
// Property 4: Cost ratios and contribution margin
// ============================================================
describe("Cost calculations", () => {
  it("costPerKg = total / qty", () => {
    assert.equal(costPerKg(10000, 500), 20);
  });

  it("costPerKg returns NOT_CAPTURED for zero divisor", () => {
    assert.ok(!isCaptured(costPerKg(10000, 0)), "zero divisor");
  });

  it("costPerMeter = total / meters", () => {
    assert.equal(costPerMeter(5800, 100), 58);
  });

  it("costPerPiece = total / pieces", () => {
    assert.equal(costPerPiece(5000, 50), 100);
  });

  it("contributionMargin = revenue - variable cost", () => {
    assert.equal(contributionMargin(10000, 7500), 2500);
  });

  it("contributionMargin allows negative inputs (result can be negative)", () => {
    const result = contributionMargin(-100, 7500);
    assert.equal(result, roundMoney(-100 - 7500));
  });
});

// ============================================================
// Property 7: Packing charge included exactly once
// ============================================================
describe("Basic price and packing flag", () => {
  it("basicPrice without packing flag excludes packing", () => {
    const result = basicPrice({ materialPrice: 100, valueAddedServicePrice: 20, otherCharges: 5, packingCharge: 10, includePackingInBasic: false });
    assert.equal(result, 125);
  });

  it("basicPrice with packing flag includes packing exactly once", () => {
    const withPacking = basicPrice({ materialPrice: 100, valueAddedServicePrice: 20, otherCharges: 5, packingCharge: 10, includePackingInBasic: true });
    const withoutPacking = basicPrice({ materialPrice: 100, valueAddedServicePrice: 20, otherCharges: 5, packingCharge: 10, includePackingInBasic: false });
    assert.equal(withPacking - withoutPacking, 10); // exactly the packing charge
  });

  it("netRateAndLineValue returns NOT_CAPTURED for zero qty", () => {
    const result = netRateAndLineValue({
      basicPrice: 100, alloyChargePerKg: 5, reCuttingChargePerKg: 2, testingServiceChargePerKg: 1,
      dieServiceCharge: 50, freightCharge: 30, packingCharge: 20, packingInConversion: false,
      quantityKg: 0, discount: 0, margin: 0
    });
    assert.ok(!isCaptured(result.netRate), "netRate should be NOT_CAPTURED for zero qty");
    assert.ok(!isCaptured(result.lineValue), "lineValue should be NOT_CAPTURED for zero qty");
  });

  it("netRateAndLineValue with packingInConversion adds packing to fixed charges", () => {
    const withConv = netRateAndLineValue({
      basicPrice: 1000, alloyChargePerKg: 0, reCuttingChargePerKg: 0, testingServiceChargePerKg: 0,
      dieServiceCharge: 0, freightCharge: 0, packingCharge: 100, packingInConversion: true,
      quantityKg: 10, discount: 0, margin: 0
    });
    const withoutConv = netRateAndLineValue({
      basicPrice: 1000, alloyChargePerKg: 0, reCuttingChargePerKg: 0, testingServiceChargePerKg: 0,
      dieServiceCharge: 0, freightCharge: 0, packingCharge: 100, packingInConversion: false,
      quantityKg: 10, discount: 0, margin: 0
    });
    assert.equal(isCaptured(withConv.lineValue), true);
    assert.equal(isCaptured(withoutConv.lineValue), true);
    assert.equal(withConv.lineValue - withoutConv.lineValue, 100);
  });
});

// ============================================================
// Property 5: Sentinel for absent/zero/negative
// ============================================================
describe("Sentinel behavior", () => {
  it("all calc functions return NOT_CAPTURED for negative inputs", () => {
    assert.ok(!isCaptured(theoreticalWeight(-5, 0.5, 10)), "theoreticalWeight negative");
    assert.ok(!isCaptured(recoveryPercent(-10, 100)), "recoveryPercent negative output");
    assert.ok(!isCaptured(scrapPercent(-5, 100)), "scrapPercent negative");
    assert.ok(!isCaptured(costPerKg(-100, 50)), "costPerKg negative cost");
    // contributionMargin allows negative inputs (financial computation)
  });

  it("all calc functions return NOT_CAPTURED for zero divisors", () => {
    assert.ok(!isCaptured(recoveryPercent(100, 0)), "recoveryPercent zero input");
    assert.ok(!isCaptured(scrapPercent(50, 0)), "scrapPercent zero input");
    assert.ok(!isCaptured(costPerKg(100, 0)), "costPerKg zero divisor");
    assert.ok(!isCaptured(costPerMeter(100, 0)), "costPerMeter zero divisor");
    assert.ok(!isCaptured(costPerPiece(100, 0)), "costPerPiece zero divisor");
  });

  it("quantityKg returns NOT_CAPTURED for absent method", () => {
    assert.ok(!isCaptured(quantityKg({ method: null, lengthM: 5, weightPerM: 0.5, qty: 10 })), "null method");
    assert.ok(!isCaptured(quantityKg({ method: undefined, lengthM: 5, weightPerM: 0.5, qty: 10 })), "undefined method");
  });
});
