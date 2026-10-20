import assert from "node:assert/strict";
import test from "node:test";
import { computeReportTotals, deriveReportRow, planColumnBands, reportFieldMap, reportImplicitFilters, reportSelectFields } from "../lib/reports/report-builder.ts";
import { reconcileInvoiceSettlement, signedCollectionAmount, signedSettlementAmount } from "../lib/financials/receivables.ts";

test("RPT-03: payment exports carry status/type and default to posted receipts with signed refunds", () => {
  for (const field of ["payment_status", "payment_type", "signed_amount", "collection_amount"]) assert.ok(reportFieldMap.payments.includes(field));
  assert.deepEqual(reportImplicitFilters("payments", []).map((filter) => [filter.field, filter.value]), [["payment_status", "PAID"]]);
  assert.deepEqual(reportImplicitFilters("payments", [{ field: "payment_status", operator: "equals", value: "CANCELLED" }]), [],
    "an explicit status filter (e.g. a reversal audit) is honoured");
  const select = reportSelectFields("payments", ["payment_date", "signed_amount"]);
  assert.ok(!select.includes("signed_amount"), "virtual fields never reach PostgREST");
  for (const field of ["payment_status", "payment_type", "payment_method", "amount"]) assert.ok(select.includes(field));
  const rows = [
    { amount: 400, payment_status: "PAID", payment_type: "PARTIAL_PAYMENT", payment_method: "cash" },
    { amount: 250, payment_status: "CANCELLED", payment_type: "PARTIAL_PAYMENT", payment_method: "cash" },
    { amount: 300, payment_status: "PAID", payment_type: "REFUND", payment_method: "bank_transfer" },
    { amount: 50, payment_status: "PAID", payment_type: "ADJUSTMENT", payment_method: "credit_note" }
  ].map((row) => deriveReportRow("payments", row));
  assert.deepEqual(rows.map((row) => row.signed_amount), [400, 0, -300, 50]);
  assert.deepEqual(rows.map((row) => row.collection_amount), [400, 0, -300, 0]);
  const totals = computeReportTotals("payments", rows, null);
  assert.equal(totals.grand.byCurrency.INR.collection_amount, 100, "matches collection analytics");
  assert.equal(totals.grand.byCurrency.INR.signed_amount, 150);
});

test("RPT-04: expense exports exclude deleted rows, expose currency, and total per currency", () => {
  assert.ok(reportFieldMap.expenses.includes("currency"));
  assert.deepEqual(reportImplicitFilters("expenses", []).map((filter) => [filter.field, filter.operator]), [["deleted_at", "is_null"]]);
  assert.ok(reportSelectFields("expenses", ["expense_number"]).includes("currency"));
  const totals = computeReportTotals("expenses", [
    { currency: "INR", total_amount: 1000, approval_status: "approved" },
    { currency: "INR", total_amount: 0.1 }, { currency: "INR", total_amount: 0.2 },
    { currency: "USD", total_amount: 300, approval_status: "approved" }
  ], "approval_status");
  assert.equal(totals.grand.byCurrency.INR.total_amount, 1000.3);
  assert.equal(totals.grand.byCurrency.USD.total_amount, 300, "USD is never added to INR");
  assert.deepEqual(totals.groups.map((group) => [group.label, group.count]), [["approved", 2], ["undefined", 2]].map(([label, count]) => [label === "undefined" ? "-" : label, count]));
});

test("PDF-04: credit notes are a source, reversed documents are excluded by default, and every column is printed", () => {
  assert.ok(reportFieldMap.credit_notes.includes("grand_total"));
  assert.deepEqual(reportImplicitFilters("credit_notes", []).map((filter) => filter.value), ["issued"]);
  assert.deepEqual(reportImplicitFilters("expense_payments", []).map((filter) => filter.value), ["posted"]);
  const fields = Array.from({ length: 14 }, (_, index) => `f${index}`);
  const bands = planColumnBands(fields, 6);
  assert.deepEqual(bands.map((band) => band.length), [6, 6, 2]);
  assert.deepEqual(bands.flat(), fields, "no selected field is dropped");
  assert.deepEqual(planColumnBands([], 6), [[]]);
});

test("receivable reconciliation explains the displayed balance from posted history", () => {
  const result = reconcileInvoiceSettlement({ grand_total: 1000, balance_due: 0 }, [
    { id: "1", payment_date: "2026-10-01", amount: 1000, payment_method: "cash", payment_type: "FINAL_PAYMENT", payment_status: "PAID" },
    { id: "2", payment_date: "2026-10-03", amount: 200, payment_method: "cash", payment_type: "PARTIAL_PAYMENT", payment_status: "CANCELLED" },
    { id: "3", payment_date: "2026-10-05", amount: 600, payment_method: "bank_transfer", payment_type: "REFUND", payment_status: "PAID" }
  ], [{ id: "c1", credit_note_number: "CN-1", credit_date: "2026-10-04", grand_total: 1000, status: "issued", dispatch_id: "d1" },
    { id: "c2", credit_note_number: "CN-0", credit_date: "2026-10-02", grand_total: 1000, status: "reversed", dispatch_id: "d1" }]);
  assert.deepEqual([result.cashReceipts, result.refunds, result.creditNotes, result.balance, result.customerCreditDue], [1000, 600, 1000, 0, 400]);
  assert.equal(result.matchesStoredBalance, true);
  assert.equal(result.entries[0].id, "3", "newest first");
  assert.equal(result.entries.find((entry) => entry.id === "2").effective, false);
  assert.equal(result.entries.find((entry) => entry.id === "c1").pdfHref, "/api/pdf/credit-note/c1");
  assert.equal(reconcileInvoiceSettlement({ grand_total: 100, balance_due: 40 }, [], []).matchesStoredBalance, false);
  assert.equal(signedSettlementAmount({ amount: "12.345", payment_status: "PAID", payment_type: "REFUND" }), -12.35);
  assert.equal(signedCollectionAmount({ amount: 10, payment_status: "PAID", payment_method: "credit_note", payment_type: "ADJUSTMENT" }), 0);
});
