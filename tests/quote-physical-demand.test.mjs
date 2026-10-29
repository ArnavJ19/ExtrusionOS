import test from "node:test";
import assert from "node:assert/strict";
import { summarizeQuotePhysicalDemand } from "../lib/orders/quote-physical-demand.ts";

test("89: commercial minimum weight never increases the physical manufacturing requirement", () => {
  assert.deepEqual(summarizeQuotePhysicalDemand([{ total_weight_kg: 480, billing_weight_kg: 700 }]), { ok: true, physicalKg: 480, billingKg: 700, reason: null });
  assert.equal(summarizeQuotePhysicalDemand([{ total_weight_kg: 480, billing_weight_kg: 1200 }]).physicalKg, 480);
});
test("89: physical quantities add on their own basis across differently billed lines", () => {
  const result = summarizeQuotePhysicalDemand([{ total_weight_kg: "40.125", billing_weight_kg: 500 }, { total_weight_kg: 30.001, billing_weight_kg: 600 }]);
  assert.equal(result.physicalKg, 70.126); assert.equal(result.billingKg, 1100);
});
test("89: missing or invalid physical weight cannot fall back to a positive billing weight", () => {
  for (const total_weight_kg of [null, undefined, "", 0, -1, NaN, Infinity, "NaN"]) assert.equal(summarizeQuotePhysicalDemand([{ total_weight_kg, billing_weight_kg: 700 }]).ok, false);
  assert.equal(summarizeQuotePhysicalDemand([]).ok, false);
});
test("89: unavailable commercial weight stays unavailable while valid physical demand remains usable", () => {
  const result = summarizeQuotePhysicalDemand([{ total_weight_kg: 480, billing_weight_kg: null }]);
  assert.equal(result.ok, true); assert.equal(result.physicalKg, 480); assert.equal(result.billingKg, null);
});
test("89: finite but unsupported totals cannot overflow rounding or the order quantity column", () => {
  assert.equal(summarizeQuotePhysicalDemand([{ total_weight_kg: 1e308, billing_weight_kg: 1e308 }]).ok, false);
});
