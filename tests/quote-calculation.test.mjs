import test from "node:test";
import assert from "node:assert/strict";
import { calculateDieAmortization, calculateFinishingCost, calculateQuoteItem, calculateQuoteSummary } from "../lib/calculations/quote.ts";

const baseItem = {
  quantity_pieces: 100,
  length_per_piece_m: 5,
  section_weight_kg_per_m: 1,
  scrap_allowance_percent: 0,
  expected_recovery_percent: 100,
  minimum_billing_weight_kg: 0,
  billet_rate_per_kg: 250,
  conversion_charge_per_kg: 25,
  finishing_charge_type: "per_kg",
  finishing_charge: 0,
  die_charge: 0,
  die_amortization_type: "full_die_charge",
  die_amortization_quantity_kg: 0,
  packing_charge: 0,
  transport_charge: 0,
  other_charges: 0,
  margin_percent: 10,
  sales_price_override: null,
  minimum_margin_percent: 8
};

test("quote item uses physical weight, billing weight, GST-ready selling value", () => {
  const item = calculateQuoteItem(baseItem);

  assert.equal(item.total_meters, 500);
  assert.equal(item.total_weight_kg, 500);
  assert.equal(item.billing_weight_kg, 500);
  assert.equal(item.raw_material_cost, 125000);
  assert.equal(item.conversion_cost, 12500);
  assert.equal(item.line_subtotal, 137500);
  assert.equal(item.line_total_before_gst, 151250);
  assert.equal(item.estimated_profit_percent, 9.09);
});

test("scrap allowance and minimum billing weight increase billable kg", () => {
  const item = calculateQuoteItem({ ...baseItem, scrap_allowance_percent: 5, minimum_billing_weight_kg: 600 });

  assert.equal(item.effective_weight_kg, 525);
  assert.equal(item.billing_weight_kg, 600);
  assert.equal(item.raw_material_cost, 150000);
});

test("finishing modes are calculated centrally", () => {
  assert.equal(calculateFinishingCost("per_kg", 12, 100, 50), 1200);
  assert.equal(calculateFinishingCost("per_meter", 8, 100, 50), 400);
  assert.equal(calculateFinishingCost("fixed", 500, 100, 50), 500);
  assert.equal(calculateFinishingCost("per_sqft", 500, 100, 50), 80730);
});

test("die amortization supports full, per kg, waived, and customer paid modes", () => {
  assert.equal(calculateDieAmortization({ dieCharge: 10000, billingWeightKg: 500, type: "full_die_charge" }), 10000);
  assert.equal(calculateDieAmortization({ dieCharge: 10000, billingWeightKg: 500, type: "per_kg", quantityKg: 1000 }), 5000);
  assert.equal(calculateDieAmortization({ dieCharge: 10000, billingWeightKg: 500, type: "waived" }), 0);
  assert.equal(calculateDieAmortization({ dieCharge: 10000, billingWeightKg: 500, type: "customer_paid" }), 0);
});

test("manual selling override can trigger low margin approval", () => {
  const item = calculateQuoteItem({ ...baseItem, sales_price_override: 130000, minimum_margin_percent: 8 });

  assert.equal(item.line_total_before_gst, 130000);
  assert.equal(item.estimated_profit_amount, -7500);
  assert.equal(item.approval_required, true);
});

test("quote summary aggregates profit and GST", () => {
  const item = calculateQuoteItem(baseItem);
  const summary = calculateQuoteSummary([item], 18);

  assert.equal(summary.subtotal, 151250);
  assert.equal(summary.gst_amount, 27225);
  assert.equal(summary.grand_total, 178475);
  assert.equal(summary.estimated_profit_amount, 13750);
});
