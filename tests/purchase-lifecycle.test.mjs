import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSupplierInvoiceNumber,
  parseSupplierInvoiceText,
  purchaseLifecycleInputSchema,
  purchaseReceiptBalances,
  supplierBillReviewSchema
} from "../lib/workflow/purchase-lifecycle.ts";

test("receipt balances distinguish short delivery from held or rejected acceptance and derive PO base values", () => {
  assert.deepEqual(purchaseReceiptBalances({ ordered_quantity: 100, received_quantity: 40, accepted_quantity: 35, unit_rate: 10 }), {
    remaining_delivery: 60, remaining_acceptance: 65, received_base_value: 400, accepted_base_value: 350
  });
  assert.deepEqual(purchaseReceiptBalances({ ordered_quantity: 1.002, received_quantity: 0.502, accepted_quantity: 0.5, unit_rate: 10.01 }), {
    remaining_delivery: 0.5, remaining_acceptance: 0.502, received_base_value: 5.03, accepted_base_value: 5.01
  });
  assert.throws(() => purchaseReceiptBalances({ ordered_quantity: 10, received_quantity: 11, accepted_quantity: 10, unit_rate: 1 }), /consistent/);
  assert.throws(() => purchaseReceiptBalances({ ordered_quantity: 10, received_quantity: 9, accepted_quantity: 10, unit_rate: 1 }), /consistent/);
});

test("reviewable supplier text extraction parses supported invoice text and marks human matching fields", () => {
  const parsed = parseSupplierInvoiceText([
    "Vendor: Fixture Aluminium Supply",
    "Invoice Number: INV-001/26",
    "Invoice Date: 29/10/2026",
    "Line: 6063 billet | 20 | kg | 10 | 200 | 36",
    "Freight: INR 20.00",
    "Discount: 0",
    "Total: 256"
  ].join("\n"));
  assert.deepEqual(parsed.proposal, {
    vendor_name: "Fixture Aluminium Supply", invoice_number: "INV-001/26", invoice_date: "2026-10-29",
    quantity: null, unit: null, rate: null, description: null, base_amount: null,
    tax_amount: null, freight_amount: 20, discount_amount: 0, total_amount: 256,
    lines: [{ description: "6063 billet", quantity: 20, unit: "kg", rate: 10, base_amount: 200, tax_amount: 36 }]
  });
  assert.deepEqual(parsed.uncertainFields, ["purchase_order_id", "tax_amount", "vendor_id"]);
});

test("CSV extraction keeps conflicting invoice identifiers uncertain and does not invent a date", () => {
  const parsed = parseSupplierInvoiceText([
    "vendor,invoice_number,invoice_date,description,quantity,unit,rate,base_amount,tax_amount,total_amount",
    "Fixture Supply,INV-001,2026-10-29,6063 billet,10,kg,10,100,18,118",
    "Fixture Supply,INV-002,2026-10-29,6063 billet,5,kg,10,50,9,59"
  ].join("\n"));
  assert.equal(parsed.proposal.invoice_number, "INV-001");
  assert.equal(parsed.proposal.invoice_date, "2026-10-29");
  assert.ok(parsed.uncertainFields.includes("invoice_number"));
  assert.ok(parsed.uncertainFields.includes("tax_amount"));
  assert.equal(parsed.proposal.lines.length, 2);
  assert.equal(normalizeSupplierInvoiceNumber(" inv / 001-26 "), "INV00126");
});

test("purchasing input contracts reject cross-company fields, invalid receipt splits, and unbalanced bills", () => {
  const common = { idempotency_key: "bc000000-0000-4000-8000-000000000001", purchase_order_id: "bc000000-0000-4000-8000-000000000002", receipt_date: "2000-01-01" };
  const balancedLine = { purchase_order_line_id: "bc000000-0000-4000-8000-000000000003", received_quantity: 10, accepted_quantity: 8, rejected_quantity: 1, held_quantity: 1 };
  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "receipt.record", payload: { ...common, lines: [{
    purchase_order_line_id: "bc000000-0000-4000-8000-000000000003", received_quantity: 10, accepted_quantity: 8, rejected_quantity: 1, held_quantity: 0
  }] } }).success, false);
  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "receipt.record", payload: { ...common, lines: [balancedLine] } }).success, true);
  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "receipt.record", payload: { ...common, receipt_date: "2026-02-30", lines: [balancedLine] } }).success, false);
  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "receipt.record", payload: { ...common, lines: [{ ...balancedLine, received_quantity: 10.0004, accepted_quantity: 8.0004 }] } }).success, false);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}-${parts.find((part) => part.type === "day").value}`;
  const tomorrowDate = new Date(`${today}T00:00:00.000Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);
  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "receipt.record", payload: { ...common, receipt_date: tomorrow, lines: [balancedLine] } }).success, false);
  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "receipt.record", payload: { ...common, company_id: "bc000000-0000-4000-8000-000000000004", lines: [] } }).success, false);

  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "orders.list", payload: { page: 2, search: "PO-", status: "open", sort: "supplier", direction: "asc" } }).success, true);
  assert.equal(purchaseLifecycleInputSchema.safeParse({ command: "bills.list", payload: { page: 2, search: "INV-", status: "draft", sort: "invalid" } }).success, false);

  const bill = { vendor_id: "bc000000-0000-4000-8000-000000000005", purchase_order_id: common.purchase_order_id,
    invoice_number: "INV-001", invoice_date: "2026-10-29", due_date: null, tax_amount: 18, freight_amount: 5, discount_amount: 0, total_amount: 122,
    lines: [{ purchase_order_line_id: "bc000000-0000-4000-8000-000000000003", quantity: 10, unit: "kg", rate: 10, base_amount: 100, tax_amount: 18 }] };
  assert.equal(supplierBillReviewSchema.safeParse(bill).success, false);
  assert.equal(supplierBillReviewSchema.safeParse({ ...bill, total_amount: 123, tax_amount: 18, freight_amount: 5, discount_amount: 0, lines: [bill.lines[0], bill.lines[0]] }).success, false);
});
