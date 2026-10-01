import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildInvoicePdf } from "../lib/pdf/invoice-pdf.ts";

const input = {
  company: { name: "Test Manufacturer", gst_number: "08ABCDE1234F1Z5", billing_address: "Factory address" },
  customer: { company_name: "Test Customer", billing_address: "Customer address" },
  invoice: { invoice_number: "INV-2026-0001", invoice_date: "2026-09-29", status: "generated", supplier_state_code: "08", place_of_supply_state_code: "08", subtotal: 1000, tax_total: 180, grand_total: 1180, cgst_amount: 90, sgst_amount: 90 },
  items: [{ item_description: "Aluminium profile", hsn_code: "7604", quantity: 10, unit_rate: 100, line_total: 1000, gst_percent: 18 }],
};
test("invoice PDF generates a readable document and paginates long invoices", async () => {
  const one = await PDFDocument.load(await buildInvoicePdf(input));
  assert.equal(one.getPageCount(), 1);
  const many = await PDFDocument.load(await buildInvoicePdf({ ...input, items: Array.from({ length: 80 }, () => ({ ...input.items[0], item_description: "Long description ".repeat(15) })) }));
  assert.ok(many.getPageCount() > 1);
});
test("invoice PDF blocks missing supply-state or HSN data", async () => {
  await assert.rejects(buildInvoicePdf({ ...input, invoice: { ...input.invoice, place_of_supply_state_code: null } }), /Complete supply states/);
  await assert.rejects(buildInvoicePdf({ ...input, items: [{ ...input.items[0], hsn_code: null }] }), /HSN/);
});
