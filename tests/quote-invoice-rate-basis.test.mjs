// EXOS-AUD-026: invoices bill actual net kg, so the invoice rate must be the quoted
// amount per physical kg for the quoted quantity to invoice the quoted amount.
import test from "node:test";
import assert from "node:assert/strict";
import { calculateQuoteItem } from "../lib/calculations/quote.ts";
import { buildQuoteItemPcdaFields } from "../lib/pcda/quote-order.ts";
import { parseOrderBillingLines } from "../lib/orders/billing-reconciliation.ts";

const base = { quantity_pieces: 10, length_per_piece_m: 5, section_weight_kg_per_m: 2, billet_rate_per_kg: 200,
  conversion_charge_per_kg: 10, finishing_charge_type: "per_kg", finishing_charge: 5, die_charge: 30,
  packing_charge: 40, transport_charge: 50, other_charges: 60, margin_percent: 20, minimum_margin_percent: 20 };
const physicalKg = base.quantity_pieces * base.length_per_piece_m * base.section_weight_kg_per_m;
// The rate is rounded to the paisa, so rate x kg may differ from the amount by 0.005 per kg.
// Die and freight are billed once as separate invoice lines when the line has them.
const reproduces = (line) => Math.abs(line.invoice_rate_per_kg * line.total_weight_kg + line.separately_billed_charges - line.line_total_before_gst) <= 0.005 * line.total_weight_kg;

test("scrap allowance: shipping the quoted kg invoices the quoted amount", () => {
  const line = calculateQuoteItem({ ...base, scrap_allowance_percent: 5 });
  assert.ok(line.billing_weight_kg > line.total_weight_kg);
  assert.ok(reproduces(line));
  // The old rate (amount / billing kg) under-invoiced by the allowance.
  assert.ok(line.price_per_kg * line.total_weight_kg < line.line_total_before_gst * 0.96);
});

test("minimum billing weight is invoiced when the quoted quantity ships", () => {
  const line = calculateQuoteItem({ ...base, minimum_billing_weight_kg: physicalKg * 5 });
  assert.equal(line.billing_weight_kg, physicalKg * 5);
  assert.ok(reproduces(line));
});

test("die and freight are excluded from the per-kg rate and billed once", () => {
  const line = calculateQuoteItem(base);
  assert.equal(line.charges_billed_separately, true);
  assert.equal(line.separately_billed_charges, base.die_charge + base.transport_charge);
  assert.ok(reproduces(line));
  const waived = calculateQuoteItem({ ...base, die_amortization_type: "waived", transport_charge: 0 });
  assert.equal(waived.charges_billed_separately, false);
  assert.equal(waived.separately_billed_charges, 0);
});

test("without allowance, minimum or one-off charges the invoice rate equals the per-kg price", () => {
  const line = calculateQuoteItem({ ...base, die_amortization_type: "waived", transport_charge: 0 });
  assert.equal(line.invoice_rate_per_kg, line.price_per_kg);
});

test("the PCDA line carries the invoice rate and invoices per kg", () => {
  const item = calculateQuoteItem({ ...base, scrap_allowance_percent: 5 });
  const fields = buildQuoteItemPcdaFields({ companyId: "22222222-2222-4222-8222-222222222222", profile: { id: "11111111-1111-4111-8111-111111111111" }, item, gstPercent: 18 });
  assert.equal(fields.net_rate, item.invoice_rate_per_kg);
  assert.equal(fields.invoice_calc_uom, "kg");
});

test("billing reconciliation rows are parsed defensively", () => {
  assert.deepEqual(parseOrderBillingLines(null), []);
  const [row] = parseOrderBillingLines([{ orderItemId: "a", quotedKg: "1000.000", quotedValue: "340000", invoicedKg: 600, invoicedValue: 204000, uninvoicedValue: 136000, invoiceRatePerKg: 340 }]);
  assert.equal(row.quotedKg, 1000);
  assert.equal(row.profileId, null);
  assert.equal(row.uninvoicedValue, 136000);
});

test("printed invoice basis separates die and freight only when the stored rate excludes them", async () => {
  const { savedLineInvoiceBasis } = await import("../lib/calculations/quote.ts");
  const line = calculateQuoteItem(base);
  const stored = { net_rate: line.invoice_rate_per_kg, total_weight_kg: line.total_weight_kg, line_total_before_gst: line.line_total_before_gst, die_service_charge: line.die_amortization_amount, freight_charge: base.transport_charge };
  const split = savedLineInvoiceBasis(stored);
  assert.equal(split.dieCharge, base.die_charge);
  assert.equal(split.freightCharge, base.transport_charge);
  // A sales viewer does not see the die and freight amounts; the one-off total is still printed.
  const masked = savedLineInvoiceBasis({ ...stored, die_service_charge: null, freight_charge: null });
  assert.equal(masked.dieCharge, null);
  assert.ok(Math.abs(masked.oneOffCharges - (base.die_charge + base.transport_charge)) <= 0.005 * line.total_weight_kg + 0.01);
  // A line saved before the split carries the charges inside the rate: nothing is billed once.
  const legacy = savedLineInvoiceBasis({ ...stored, net_rate: Math.round(line.line_total_before_gst / line.total_weight_kg * 100) / 100 });
  assert.equal(legacy.oneOffCharges, 0);
});
