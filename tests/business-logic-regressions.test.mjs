import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuoteItem, calculateQuoteSummary, getQuoteItemWarnings } from "../lib/calculations/quote.ts";
import { calculateFoundryFurnaceMix } from "../lib/calculations/foundry.ts";
import { roundMoney, roundWeight } from "../lib/calculations/pcda/rounding.ts";
import { numberToWordsINR } from "../lib/utils/number-to-words.ts";
import { compositionsMatch } from "../lib/calculations/alloy-composition.ts";
import { planAttainmentPercent } from "../lib/calculations/operations.ts";
import { previewBusinessNumber } from "../lib/utils/numbering.ts";
import { buildQuoteItemPcdaFields } from "../lib/pcda/quote-order.ts";
import { netRateAndLineValue } from "../lib/calculations/pcda/cost.ts";
import { calculateSystemCosting } from "../lib/systems-configurator/costing-engine.ts";
import { glassDeductions } from "../lib/systems-configurator/glass-deductions.ts";

const base = { quantity_pieces: 10, length_per_piece_m: 5, section_weight_kg_per_m: 2, billet_rate_per_kg: 200,
  conversion_charge_per_kg: 10, finishing_charge_type: "per_kg", finishing_charge: 5, die_charge: 30,
  packing_charge: 40, transport_charge: 50, other_charges: 60, margin_percent: 20, minimum_margin_percent: 20 };

test("BL-01 real profile perimeter drives finishing; missing perimeter is explicitly uncosted", () => {
  const line = calculateQuoteItem({ ...base, finishing_charge_type: "per_sqft", perimeter_mm: 400 });
  assert.equal(line.finishing_cost, 1076.39);
  assert.equal(line.costing_complete, true);
  assert.equal(getQuoteItemWarnings(line).some((w) => w.code === "surface_area_missing"), false);
  const missing = calculateQuoteItem({ ...base, finishing_charge_type: "per_sqft" });
  assert.equal(missing.finishing_cost, 0);
  assert.equal(missing.costing_complete, false);
  assert.equal(getQuoteItemWarnings(missing).find((w) => w.code === "surface_area_missing").severity, "critical");
});
test("BL-02 recovery grosses up billet consumption independently of handling allowance", () => {
  const line = calculateQuoteItem({ ...base, expected_recovery_percent: 80, scrap_allowance_percent: 10 });
  assert.equal(line.billing_weight_kg, 110);
  assert.equal(line.billet_input_kg, 137.5);
  assert.equal(line.raw_material_cost, 27500);
  assert.equal(line.conversion_cost, 1100);
  assert.equal(calculateQuoteItem({ ...base, expected_recovery_percent: 0 }).costing_complete, false);
});
test("BL-04 selling margin and approval threshold use the same revenue base", () => {
  const line = calculateQuoteItem(base);
  assert.equal(line.line_total_before_gst, line.line_subtotal / 0.8);
  assert.equal(line.estimated_profit_percent, 20);
  assert.equal(line.approval_required, false);
});
test("BL-06 foundry mix conserves the rounded charge and rejects incompatible shares", () => {
  const mix = calculateFoundryFurnaceMix(800, 80, 30);
  assert.deepEqual(mix, { requiredFurnaceChargeKg: 1000, scrapAluminiumKg: 300, externalAluminiumKg: 700 });
  assert.throws(() => calculateFoundryFurnaceMix(800, 80, 30, 100), /total 100/);
  assert.throws(() => calculateFoundryFurnaceMix(800, 80, -1), /total 100/);
});
test("BL-07 cost components reconcile without double-counting glass wastage", () => {
  const result = calculateSystemCosting({ materialSummary: [{ materialType: "glass", amount: 1000 }], totalProfileWeightKg: 10,
    totalProfileLengthM: 10, totalGlassAreaSqft: 10, totalGlassAreaSqm: 1, quantity: 1, openingWidthMm: 1000,
    openingHeightMm: 1000, aluminiumRatePerKg: 100, fabrication: { rateType: "fixed", rate: 10 },
    installation: { enabled: false, rateType: "fixed", rate: 0 }, transport: { type: "fixed", amount: 20 },
    aluminiumWastagePercent: 5, glassWastagePercent: 10, marginPercent: 20, discountAmount: 0, gstPercent: 18 });
  assert.equal(result.glassCost, 1000);
  const sum = ["aluminiumCost", "glassCost", "finishCost", "hardwareCost", "gasketCost", "fabricationCost", "installationCost", "transportCost", "wastageAmount"].reduce((s, k) => s + result[k], 0);
  assert.equal(sum, result.internalCost);
});
test("BL-10 PCDA snapshots reconstruct the selling total including ancillary costs and override", () => {
  for (const finishing_charge_type of ["per_kg", "per_meter", "fixed", "per_sqft"]) {
    const item = calculateQuoteItem({ ...base, finishing_charge_type, perimeter_mm: 400, expected_recovery_percent: 85, sales_price_override: 30000 });
    const fields = buildQuoteItemPcdaFields({ companyId: "22222222-2222-4222-8222-222222222222", profile: { id: "11111111-1111-4111-8111-111111111111" }, item, gstPercent: 18 });
    assert.equal(fields.internal_cost, item.line_subtotal);
    assert.equal(fields.material_price, item.raw_material_cost);
    assert.equal(fields.value_added_service_price, roundMoney(item.conversion_cost + item.finishing_cost));
    const result = netRateAndLineValue({ basicPrice: fields.basic_price, alloyChargePerKg: 0, reCuttingChargePerKg: 0,
      testingServiceChargePerKg: 0, dieServiceCharge: fields.die_service_charge ?? 0, freightCharge: fields.freight_charge ?? 0,
      packingCharge: fields.packing_charge ?? 0, packingInConversion: fields.packing_in_conversion, quantityKg: fields.quantity_kg,
      discount: 0, margin: fields.margin });
    assert.equal(result.lineValue, item.line_total_before_gst);
    assert.equal(result.netRate, item.price_per_kg);
  }
});
test("BL-11 mixed-rate GST rounds each line before aggregation", () => {
  const a = calculateQuoteItem({ ...base, sales_price_override: 0.03, gst_percent: 18 });
  const b = calculateQuoteItem({ ...base, sales_price_override: 100, gst_percent: 5 });
  assert.equal(calculateQuoteSummary([a, a, b], 28).gst_amount, 5.02);
});
test("BL-12 signed ties round away from zero, including scientific notation", () => {
  assert.equal(roundMoney(-1.005), -1.01);
  assert.equal(roundWeight(-1.2345), -1.235);
  assert.equal(roundMoney(1e-7), 0);
  assert.equal(roundMoney(1e21), 1e21);
});
test("BL-13 large INR wording supports recursive crore groups", () => {
  assert.equal(numberToWordsINR(1_000_000_000), "Rupees One Hundred Crore Only");
  assert.equal(numberToWordsINR(1_000_000_000.25), "Rupees One Hundred Crore and Paise Twenty Five Only");
});
test("INR wording keeps rupees and paise unambiguous on printed documents", () => {
  // "One Hundred and Fifty Nine Paise" would read as 159 paise.
  assert.equal(numberToWordsINR(53100.59), "Rupees Fifty Three Thousand One Hundred and Paise Fifty Nine Only");
  assert.equal(numberToWordsINR(0.5), "Rupees Zero and Paise Fifty Only");
  assert.equal(numberToWordsINR(1656055.1), "Rupees Sixteen Lakh Fifty Six Thousand Fifty Five and Paise Ten Only");
});
test("BL-14 plan attainment remains distinct from material recovery", () => {
  assert.equal(planAttainmentPercent(100, 120), 120);
  assert.equal(planAttainmentPercent(0, 120), null);
});
test("BL-15 glass deductions support both spellings with mm taking precedence", () => {
  assert.deepEqual(glassDeductions({ options: { glass_deduction_width: 80, glass_deduction_width_mm: 120, glass_deduction_height_mm: 150 } }), { width: 120, height: 150 });
});
test("BL-18 composition equality ignores element and min/max property ordering", () => {
  assert.equal(compositionsMatch({ Mg: { min: 1, max: 2 }, Si: { max: 3 } }, { Si: { max: 3 }, Mg: { max: 2, min: 1 } }), true);
  assert.equal(compositionsMatch({ Mg: { min: 1 } }, { Mg: { min: 2 } }), false);
});
test("BL-03 preview uses Kolkata year and accepts sequences beyond 9999", () => {
  assert.equal(previewBusinessNumber("Q", ["Q-2027-10000"], new Date("2026-12-31T20:00:00Z")), "Q-2027-10001");
});
