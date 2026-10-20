import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  availableExpenseActions, canDecideExpense, canEditManualExpense, canPayExpense, deriveExpenseTotals, expensePaymentInputSchema,
  expensePaymentRequestKey, expenseSettlement, liveExpensePaymentStatus, manualExpenseInputSchema, nextIdempotentAttempt,
  roundMoney, supplierCreditInputSchema, expenseTransitionInputSchema
} from "../lib/financials/expenses.ts";

const uuid = "00000000-0000-4000-8000-000000000001";

test("roundMoney rounds half away from zero at the paisa like PostgreSQL", () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(2.675), 2.68);
  assert.equal(roundMoney(-1.005), -1.01);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.ok(Number.isNaN(roundMoney("abc")));
});

test("deriveExpenseTotals mirrors the database derivation and its rejections", () => {
  assert.deepEqual(deriveExpenseTotals({ base_amount: 100, tax_amount: 18 }), { base: 100, total: 118, error: null });
  assert.deepEqual(deriveExpenseTotals({ quantity: 10, rate: 12.5, tax_amount: 22.5 }), { base: 125, total: 147.5, error: null });
  assert.equal(deriveExpenseTotals({ quantity: 0.333, rate: 3 }).base, 1, "0.333 x 3 = 0.999 rounds to 1.00");
  assert.match(deriveExpenseTotals({ quantity: 10, rate: 12.5, base_amount: 100 }).error, /quantity x rate/);
  assert.match(deriveExpenseTotals({ base_amount: 10, discount_amount: 11 }).error, /greater than zero/);
  assert.match(deriveExpenseTotals({ base_amount: -1 }).error, /negative/);
  assert.match(deriveExpenseTotals({ base_amount: Number.POSITIVE_INFINITY }).error, /valid numbers/);
  assert.match(deriveExpenseTotals({}).error, /greater than zero/);
});

test("deriveExpenseTotals is exact to the paisa for arbitrary components", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000 }),
    (basePaise, taxPaise, freightPaise, discountPaise) => {
      const result = deriveExpenseTotals({ base_amount: basePaise / 100, tax_amount: taxPaise / 100, freight_amount: freightPaise / 100, discount_amount: discountPaise / 100 });
      const expected = (basePaise + taxPaise + freightPaise - discountPaise) / 100;
      if (expected <= 0) return result.error !== null;
      return result.error === null && result.total === expected;
    }
  ));
});

test("expenseSettlement separates balance payable from supplier credit due", () => {
  assert.deepEqual(expenseSettlement({ total_amount: 1000, amount_paid: 1000, credited_amount: 200 }),
    { total: 1000, paid: 1000, refunded: 0, credited: 200, netPaid: 1000, balance: 0, supplierCreditDue: 200 });
  assert.equal(expenseSettlement({ total_amount: 1000, amount_paid: 1000, credited_amount: 200, refunded_amount: 200 }).supplierCreditDue, 0);
  assert.equal(expenseSettlement({ total_amount: 1000, amount_paid: 600, credited_amount: 100 }).balance, 300);
  assert.equal(expenseSettlement({ total_amount: 0.3, amount_paid: 0.1, credited_amount: 0.2 }).balance, 0, "no floating point residue");
});

test("liveExpensePaymentStatus advances overdue only after the due date", () => {
  assert.equal(liveExpensePaymentStatus("unpaid", 10, "2026-10-19", "2026-10-20"), "overdue");
  assert.equal(liveExpensePaymentStatus("partially_paid", 10, "2026-10-19", "2026-10-20"), "overdue");
  assert.equal(liveExpensePaymentStatus("unpaid", 10, "2026-10-20", "2026-10-20"), "unpaid");
  assert.equal(liveExpensePaymentStatus("unpaid", 0, "2026-01-01", "2026-10-20"), "unpaid");
  assert.equal(liveExpensePaymentStatus("overdue", 10, "2026-12-01", "2026-10-20"), "unpaid");
  assert.equal(liveExpensePaymentStatus("cancelled", 10, "2026-01-01", "2026-10-20"), "cancelled");
  assert.equal(liveExpensePaymentStatus("unpaid", 10, null, "2026-10-20"), "unpaid");
});

test("approval actions follow the Rs 25,000 authority rule and settlement locks", () => {
  assert.equal(canDecideExpense("accounts", 25000), true);
  assert.equal(canDecideExpense("accounts", 25000.01), false);
  assert.equal(canDecideExpense("admin", 900000), true);
  assert.equal(canDecideExpense("production", 10), false);
  const pendingLarge = { approval_status: "pending_approval", total_amount: 30000 };
  assert.deepEqual(availableExpenseActions({ ...pendingLarge, role: "accounts" }), []);
  assert.deepEqual(availableExpenseActions({ ...pendingLarge, role: "owner" }), ["approve", "reject", "cancel"]);
  assert.deepEqual(availableExpenseActions({ approval_status: "draft", total_amount: 100, role: "accounts" }), ["submit", "cancel"]);
  assert.deepEqual(availableExpenseActions({ approval_status: "approved", total_amount: 100, role: "accounts" }), ["cancel"]);
  assert.deepEqual(availableExpenseActions({ approval_status: "approved", total_amount: 100, role: "admin", amount_paid: 10 }), [],
    "a paid expense can neither be reopened nor cancelled until cash is reversed");
  assert.deepEqual(availableExpenseActions({ approval_status: "approved", total_amount: 100, role: "admin", source_table: "energy_readings" }), ["reopen"]);
  assert.deepEqual(availableExpenseActions({ approval_status: "approved", total_amount: 100, role: "production" }), []);
  assert.deepEqual(availableExpenseActions({ approval_status: "draft", total_amount: 100, role: "owner", deleted_at: "2026-01-01" }), []);
});

test("edit and payment eligibility match the database guards", () => {
  assert.equal(canEditManualExpense({ approval_status: "draft", source_table: null }), true);
  assert.equal(canEditManualExpense({ approval_status: "rejected", source_table: null }), true);
  assert.equal(canEditManualExpense({ approval_status: "approved", source_table: null }), false);
  assert.equal(canEditManualExpense({ approval_status: "draft", source_table: "breakdown_logs" }), false);
  assert.equal(canPayExpense({ approval_status: "approved", balance_amount: 0.01 }), true);
  assert.equal(canPayExpense({ approval_status: "approved", balance_amount: 0 }), false);
  assert.equal(canPayExpense({ approval_status: "pending_approval", balance_amount: 10 }), false);
  assert.equal(canPayExpense({ approval_status: "approved", balance_amount: 10, deleted_at: "x" }), false);
});

test("manual expense input rejects client-owned totals, foreign currency and backdated due dates", () => {
  const base = { expense_category: "utilities", description: "Power bill", base_amount: 100, tax_amount: 18 };
  assert.equal(manualExpenseInputSchema.safeParse(base).success, true);
  assert.equal(manualExpenseInputSchema.safeParse({ ...base, total_amount: 118 }).success, true);
  assert.match(manualExpenseInputSchema.safeParse({ ...base, total_amount: 100 }).error.issues[0].message, /Total must equal/);
  assert.match(manualExpenseInputSchema.safeParse({ ...base, currency: "USD" }).error.issues[0].message, /INR/);
  assert.match(manualExpenseInputSchema.safeParse({ ...base, invoice_date: "2026-05-10", due_date: "2026-05-01" }).error.issues[0].message, /Due date/);
  assert.equal(manualExpenseInputSchema.safeParse({ ...base, expense_category: "approval_bypass" }).success, false);
  const parsed = manualExpenseInputSchema.parse({ ...base, vendor_id: "", approval_status: "approved", amount_paid: 118 });
  assert.equal(parsed.vendor_id, null);
  assert.equal("approval_status" in parsed, false, "approval state is never part of the write contract");
  assert.equal("amount_paid" in parsed, false, "paid amount is never part of the write contract");
});

test("supplier payment and credit inputs require references for traceable methods", () => {
  const payment = { expense_id: uuid, amount_paid: 10, payment_date: "2026-10-20", payment_method: "bank_transfer", idempotency_key: uuid };
  assert.match(expensePaymentInputSchema.safeParse(payment).error.issues[0].message, /Reference number is required/);
  assert.equal(expensePaymentInputSchema.safeParse({ ...payment, reference_number: "UTR1" }).success, true);
  assert.equal(expensePaymentInputSchema.safeParse({ ...payment, payment_method: "cash" }).success, true);
  assert.equal(expensePaymentInputSchema.safeParse({ ...payment, payment_method: "credit_note", reference_number: "x" }).success, false);
  assert.equal(expensePaymentInputSchema.safeParse({ ...payment, amount_paid: 0, reference_number: "x" }).success, false);
  const credit = { expense_id: uuid, credit_type: "credit_note", amount: 5, credit_date: "2026-10-20", reason: "Short supply", idempotency_key: uuid };
  assert.match(supplierCreditInputSchema.safeParse(credit).error.issues[0].message, /credit note number/);
  assert.equal(supplierCreditInputSchema.safeParse({ ...credit, reference_number: "SCN-1" }).success, true);
  assert.match(supplierCreditInputSchema.safeParse({ ...credit, credit_type: "refund" }).error.issues[0].message, /how the refund/);
  assert.equal(supplierCreditInputSchema.safeParse({ ...credit, credit_type: "refund", payment_method: "cash" }).success, true);
  assert.equal(expenseTransitionInputSchema.safeParse({ expense_id: uuid, action: "reject", note: "no" }).success, false);
  assert.equal(expenseTransitionInputSchema.safeParse({ expense_id: uuid, action: "approve" }).success, true);
});

test("retry keys are reused only for an unchanged payment payload", () => {
  let n = 0;
  const create = () => `key-${++n}`;
  const payload = { expense_id: uuid, amount_paid: 100, payment_date: "2026-10-20", payment_method: "cash" };
  const first = nextIdempotentAttempt(null, expensePaymentRequestKey(payload), create);
  const retry = nextIdempotentAttempt(first, expensePaymentRequestKey({ ...payload, amount_paid: "100.00" }), create);
  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  const edited = nextIdempotentAttempt(retry, expensePaymentRequestKey({ ...payload, amount_paid: 150 }), create);
  assert.notEqual(edited.idempotencyKey, first.idempotencyKey);
  const reference = nextIdempotentAttempt(edited, expensePaymentRequestKey({ ...payload, amount_paid: 150, reference_number: "R2" }), create);
  assert.notEqual(reference.idempotencyKey, edited.idempotencyKey);
});
