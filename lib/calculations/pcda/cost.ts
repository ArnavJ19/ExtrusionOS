/**
 * PCDA Cost Calculations
 *
 * Pure functions for cost ratios, contribution margin, basic price, and net rate.
 * All monetary outputs rounded to 2 decimal places.
 *
 * DEPRECATED / NOT WIRED: the live quotation money engine is `lib/calculations/quote.ts`
 * (`calculateQuoteItem`), persisted by `save_quote_atomic`. These helpers are NOT used on
 * any live pricing path. Do NOT wire them into quote/order/report generation without first
 * reconciling their `basicPrice`/`netRateAndLineValue` semantics against `calculateQuoteItem`
 * (including recovery grossing and per_sqft surface-area finishing) — otherwise screen and
 * PDF/report numbers will diverge.
 */

import { NOT_CAPTURED, type CalcResult, guardPositive } from "./sentinel.ts";
import { roundMoney } from "./rounding.ts";

/**
 * Cost per kilogram = total cost / quantity in kg
 * Returns NOT_CAPTURED if divisor is zero/negative or cost is negative.
 */
export function costPerKg(totalCost: number, qtyKg: number): CalcResult {
  if (guardPositive(totalCost, qtyKg)) return NOT_CAPTURED;
  if (qtyKg <= 0) return NOT_CAPTURED;
  return roundMoney(totalCost / qtyKg);
}

/**
 * Cost per meter = total cost / total meters
 * Returns NOT_CAPTURED if divisor is zero/negative or cost is negative.
 */
export function costPerMeter(totalCost: number, totalMeters: number): CalcResult {
  if (guardPositive(totalCost, totalMeters)) return NOT_CAPTURED;
  if (totalMeters <= 0) return NOT_CAPTURED;
  return roundMoney(totalCost / totalMeters);
}

/**
 * Cost per piece = total cost / piece count
 * Returns NOT_CAPTURED if divisor is zero/negative or cost is negative.
 */
export function costPerPiece(totalCost: number, pieces: number): CalcResult {
  if (guardPositive(totalCost, pieces)) return NOT_CAPTURED;
  if (pieces <= 0) return NOT_CAPTURED;
  return roundMoney(totalCost / pieces);
}

/**
 * Contribution margin = net revenue - variable cost
 * Returns NOT_CAPTURED if either input is null/undefined/NaN.
 * Result can be negative (revenue < cost).
 */
export function contributionMargin(netRevenue: number | null | undefined, variableCost: number | null | undefined): CalcResult {
  if (netRevenue === null || netRevenue === undefined || Number.isNaN(netRevenue)) return NOT_CAPTURED;
  if (variableCost === null || variableCost === undefined || Number.isNaN(variableCost)) return NOT_CAPTURED;
  return roundMoney(netRevenue - variableCost);
}

/**
 * Basic price parts for computing the basic price of a line item.
 */
export type BasicPriceParts = {
  materialPrice: number;
  valueAddedServicePrice: number;
  otherCharges: number;
  packingCharge: number;
  includePackingInBasic: boolean;
};

/**
 * Basic price = material + value-added service + other charges
 * If includePackingInBasic is true, packing charge is added exactly once.
 */
export function basicPrice(parts: BasicPriceParts): number {
  let total = parts.materialPrice + parts.valueAddedServicePrice + parts.otherCharges;
  if (parts.includePackingInBasic) {
    total += parts.packingCharge;
  }
  return roundMoney(total);
}

/**
 * Pricing input for computing net rate and line value.
 */
export type PricingInput = {
  basicPrice: number;
  alloyChargePerKg: number;
  reCuttingChargePerKg: number;
  testingServiceChargePerKg: number;
  dieServiceCharge: number;
  freightCharge: number;
  packingCharge: number;
  packingInConversion: boolean;
  quantityKg: number;
  discount: number;
  margin: number; // can be negative
};

/**
 * Net rate and line value calculation.
 * Net rate = (basic + charges per kg × qty + fixed charges - discount + margin) / qty
 * Line value = net rate × qty
 * Returns NOT_CAPTURED if quantityKg is zero/negative.
 */
export function netRateAndLineValue(input: PricingInput): { netRate: CalcResult; lineValue: CalcResult } {
  if (input.quantityKg <= 0) {
    return { netRate: NOT_CAPTURED, lineValue: NOT_CAPTURED };
  }

  const perKgCharges = (input.alloyChargePerKg + input.reCuttingChargePerKg + input.testingServiceChargePerKg) * input.quantityKg;
  let fixedCharges = input.dieServiceCharge + input.freightCharge;
  if (input.packingInConversion) {
    fixedCharges += input.packingCharge;
  }

  const totalBeforeMargin = input.basicPrice + perKgCharges + fixedCharges - input.discount;
  const totalWithMargin = totalBeforeMargin + input.margin;
  const lineValue = roundMoney(totalWithMargin);
  const netRate = roundMoney(totalWithMargin / input.quantityKg);

  return { netRate, lineValue };
}
