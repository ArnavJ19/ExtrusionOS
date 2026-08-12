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
  // per_sqft returns zero without a real surface area (no fabricated perimeter guess)...
  assert.equal(calculateFinishingCost("per_sqft", 500, 100, 50), 0);
  // ...and prices strictly from the supplied surface area (sq.ft) when present.
  assert.equal(calculateFinishingCost("per_sqft", 500, 100, 50, 20), 10000);
});

test("expected recovery grosses up billet input and raw material cost", () => {
  const item = calculateQuoteItem({ ...baseItem, expected_recovery_percent: 80 });
  // 500 kg billed / 0.80 recovery = 625 kg of billet actually melted
  assert.equal(item.billet_input_weight_kg, 625);
  assert.equal(item.raw_material_cost, 156250); // 625 * 250
  // conversion is charged on billed output weight and is unaffected by recovery
  assert.equal(item.conversion_cost, 12500);
});

test("full recovery (100%) leaves raw material unchanged", () => {
  const item = calculateQuoteItem({ ...baseItem, expected_recovery_percent: 100 });
  assert.equal(item.billet_input_weight_kg, 500);
  assert.equal(item.raw_material_cost, 125000);
});

test("per_sqft finishing uses profile surface area, zero when missing", () => {
  const withArea = calculateQuoteItem({ ...baseItem, finishing_charge_type: "per_sqft", finishing_charge: 10, surface_area_per_meter_sqm: 0.5 });
  // 500 m * 0.5 sq.m/m * 10.764 sq.ft/sq.m = 2691 sq.ft; * 10 = 26910
  assert.equal(withArea.finishing_surface_area_sqft, 2691);
  assert.equal(withArea.finishing_cost, 26910);
  const withoutArea = calculateQuoteItem({ ...baseItem, finishing_charge_type: "per_sqft", finishing_charge: 10 });
  assert.equal(withoutArea.finishing_cost, 0);
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

test("a line with metal but no billet rate requires approval before sending", () => {
  const item = calculateQuoteItem({ ...baseItem, billet_rate_per_kg: 0 });
  assert.equal(item.raw_material_cost, 0);
  assert.equal(item.approval_required, true);
  const summary = calculateQuoteSummary([item], 18);
  assert.equal(summary.low_margin_approval_required, true);
});

test("quote summary aggregates profit and GST", () => {
  const item = calculateQuoteItem(baseItem);
  const summary = calculateQuoteSummary([item], 18);

  assert.equal(summary.subtotal, 151250);
  assert.equal(summary.gst_amount, 27225);
  assert.equal(summary.grand_total, 178475);
  assert.equal(summary.estimated_profit_amount, 13750);
});
