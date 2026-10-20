import assert from "node:assert/strict";
import test from "node:test";
import {
  accountsA, accountsB, actor, adminA, asOwner, companyA, createExpenseFixture, id, legacyForgedPaid, legacyOverpaid,
  legacyPaidLabel, legacyTotalMismatch, legacyUsd, materialA, ownerA, productionA, vendorA, vendorA2, vendorB
} from "../scripts/lib/expense-ledger-fixture.mjs";

let db;
let keySeq = 1000;
const key = () => id(++keySeq);
const today = async () => (await db.query("select private.business_today()::text as d")).rows[0].d;
const expense = async (expenseId) => (await db.query("select * from public.expense_ledger where id = $1", [expenseId])).rows[0];
const num = (value) => Number(value);
const accounts = () => actor(db, accountsA);
const owner = () => actor(db, ownerA);

async function manual(payload, who = accounts(), idempotencyKey = key(), expenseId = null) {
  return who.rpc("save_manual_expense_atomic", [expenseId, JSON.stringify({
    expense_category: "utilities", description: "Compressor service", quantity: 1, unit: "job", rate: 0,
    base_amount: 0, tax_amount: 0, freight_amount: 0, discount_amount: 0, currency: "INR", ...payload
  }), idempotencyKey]);
}
async function pay(expenseId, payload, who = accounts(), idempotencyKey = key()) {
  return who.rpc("record_expense_payment_atomic", [expenseId, JSON.stringify({
    payment_method: "bank_transfer", reference_number: `UTR-${keySeq}`, payment_date: await today(), ...payload
  }), idempotencyKey]);
}
async function approvedExpense(base, extra = {}) {
  const saved = await manual({ base_amount: base, submit: true, ...extra });
  if (saved.approval_status !== "approved") await owner().rpc("transition_expense_approval", [saved.expense_id, "approve", null]);
  return saved.expense_id;
}

test.before(async () => { db = await createExpenseFixture(); });
test.after(async () => { await db?.close(); });

test("EXP-01: totals are derived from components and a mismatched total is rejected", async () => {
  await assert.rejects(manual({ base_amount: 100, tax_amount: 18, total_amount: 100 }), /does not match/);
  const saved = await manual({ base_amount: 100, tax_amount: 18 });
  assert.equal(num(saved.total_amount), 118);
  await assert.rejects(manual({ quantity: 10, rate: 12.5, base_amount: 100 }), /Base amount must equal quantity x rate/);
  const derived = await manual({ quantity: 10, rate: 12.5, tax_amount: 22.5 });
  assert.equal(num(derived.total_amount), 147.5);
  await assert.rejects(manual({ base_amount: 10, discount_amount: 11 }), /greater than zero/);
  await assert.rejects(manual({ base_amount: -5 }), /cannot be negative/);
  await assert.rejects(manual({ base_amount: "abc" }), /valid numbers/);
  // Paise-level rounding is exact and a total within half a paisa is accepted.
  const paise = await manual({ base_amount: 0.1, tax_amount: 0.2, total_amount: 0.3 });
  assert.equal(num(paise.total_amount), 0.3);
  // Even the database owner cannot persist a total that ignores its components.
  await asOwner(db, accountsA, "update public.expense_ledger set total_amount = 1 where id = $1", [saved.expense_id]);
  assert.equal(num((await expense(saved.expense_id)).total_amount), 118);
});

test("EXP-02: a client-supplied approved state never bypasses the Rs 25,000 threshold", async () => {
  const large = await manual({ base_amount: 30000, submit: true });
  assert.equal(large.approval_status, "pending_approval");
  const inserted = await asOwner(db, accountsA, `insert into public.expense_ledger(company_id, expense_category, description,
    base_amount, approval_status) values ($1, 'utilities', 'Forged approval', 40000, 'approved') returning approval_status`, [companyA]);
  assert.equal(inserted.rows[0].approval_status, "pending_approval");
  await assert.rejects(asOwner(db, accountsA, "update public.expense_ledger set approval_status = 'approved' where id = $1", [large.expense_id]),
    /approval workflow/);
  await assert.rejects(accounts().rpc("transition_expense_approval", [large.expense_id, "approve", null]), /owner or admin approval/);
  const approved = await owner().rpc("transition_expense_approval", [large.expense_id, "approve", null]);
  assert.equal(approved.approval_status, "approved");
  assert.equal((await expense(large.expense_id)).approved_by, ownerA);
  const small = await manual({ base_amount: 25000, submit: true });
  assert.equal(small.approval_status, "approved", "accounts may approve at the threshold");
  const draft = await manual({ base_amount: 999 });
  assert.equal(draft.approval_status, "draft");
});

test("EXP-03: supplier payments require an approved, active parent", async () => {
  const draft = await manual({ base_amount: 1000 });
  await assert.rejects(pay(draft.expense_id, { amount_paid: 100 }), /Only approved expenses can be paid/);
  const pending = await manual({ base_amount: 30000, submit: true });
  await assert.rejects(pay(pending.expense_id, { amount_paid: 100 }), /Only approved expenses can be paid/);
  const rejected = await manual({ base_amount: 30000, submit: true });
  await owner().rpc("transition_expense_approval", [rejected.expense_id, "reject", "Duplicate of an earlier bill"]);
  await assert.rejects(pay(rejected.expense_id, { amount_paid: 100 }), /rejected/);
  const cancelled = await approvedExpense(500);
  await accounts().rpc("transition_expense_approval", [cancelled, "cancel", "Raised in error"]);
  await assert.rejects(pay(cancelled, { amount_paid: 100 }), /Cancelled or deleted/);
});

test("EXP-04: payments are capped by the locked balance", async () => {
  const expenseId = await approvedExpense(100);
  await pay(expenseId, { amount_paid: 60 });
  await assert.rejects(pay(expenseId, { amount_paid: 60 }), /exceeds the outstanding expense balance/);
  const row = await expense(expenseId);
  assert.equal(num(row.amount_paid), 60);
  assert.equal(num(row.balance_amount), 40);
  assert.equal(row.payment_status, "partially_paid");
  await pay(expenseId, { amount_paid: 40 });
  assert.equal((await expense(expenseId)).payment_status, "paid");
  await assert.rejects(pay(expenseId, { amount_paid: 0.01 }), /exceeds/);
  await assert.rejects(pay(expenseId, { amount_paid: 0 }), /greater than zero/);
});

test("EXP-05: reassigning a payment recomputes both the old and the new expense", async () => {
  const first = await approvedExpense(300);
  const second = await approvedExpense(300);
  const posted = await pay(first, { amount_paid: 120 });
  await assert.rejects(asOwner(db, ownerA, "update public.expense_payments set expense_ledger_id = $1 where id = $2", [second, posted.payment_id]),
    /immutable/);
  // Even if a privileged path bypasses immutability, the projection follows both parents.
  await db.exec("alter table public.expense_payments disable trigger expense_payments_immutable_guard");
  await asOwner(db, ownerA, "update public.expense_payments set expense_ledger_id = $1 where id = $2", [second, posted.payment_id]);
  await db.exec("alter table public.expense_payments enable trigger expense_payments_immutable_guard");
  assert.equal(num((await expense(first)).amount_paid), 0);
  assert.equal(num((await expense(second)).amount_paid), 120);
});

test("EXP-06: payment links are tenant-composite", async () => {
  const otherTenant = await actor(db, accountsB).rpc("save_manual_expense_atomic", [null, JSON.stringify({
    expense_category: "utilities", description: "Tenant B bill", base_amount: 500, submit: true }), key()]);
  await assert.rejects(pay(otherTenant.expense_id, { amount_paid: 10 }), /Expense not found for this company/);
  await assert.rejects(asOwner(db, accountsA, `insert into public.expense_payments(company_id, expense_ledger_id, amount_paid, payment_method)
    values ($1, $2, 10, 'cash')`, [companyA, otherTenant.expense_id]), /foreign key|violates/);
  await assert.rejects(accounts().rpc("transition_expense_approval", [otherTenant.expense_id, "cancel", "Not ours at all"]),
    /not found/);
  await assert.rejects(manual({ base_amount: 10, vendor_id: vendorB }), /Vendor not found for this company/);
});

test("EXP-07 / EXP-13 / SEC-02: direct table access is finance-read-only and paid is ledger-owned", async () => {
  const expenseId = await approvedExpense(700);
  const production = actor(db, productionA);
  assert.equal((await production.query("select count(*)::int as n from public.expense_ledger")).rows[0].n, 0);
  assert.equal((await production.query("select count(*)::int as n from public.expense_payments")).rows[0].n, 0);
  assert.ok((await accounts().query("select count(*)::int as n from public.expense_ledger")).rows[0].n > 0);
  await assert.rejects(production.query(`insert into public.expense_ledger(company_id, expense_category, description, base_amount)
    values ($1, 'utilities', 'x', 1)`, [companyA]), /permission denied/);
  await assert.rejects(accounts().query("update public.expense_ledger set amount_paid = 700 where id = $1", [expenseId]), /permission denied/);
  await assert.rejects(accounts().query(`insert into public.expense_payments(company_id, expense_ledger_id, amount_paid)
    values ($1, $2, 5)`, [companyA, expenseId]), /permission denied/);
  await asOwner(db, ownerA, "update public.expense_ledger set amount_paid = 700, balance_amount = 0, payment_status = 'paid' where id = $1", [expenseId]);
  const row = await expense(expenseId);
  assert.equal(num(row.amount_paid), 0);
  assert.equal(row.payment_status, "unpaid");
  await assert.rejects(production.rpc("record_expense_payment_atomic", [expenseId, JSON.stringify({ amount_paid: 1, payment_method: "cash" }), key()]),
    /Permission denied/);
});

test("EXP-08: payment retries are bound to their payload and duplicate references are rejected", async () => {
  const expenseId = await approvedExpense(1000);
  const retryKey = key();
  const first = await pay(expenseId, { amount_paid: 100, reference_number: "UTR-RETRY" }, accounts(), retryKey);
  const replay = await pay(expenseId, { amount_paid: 100, reference_number: "UTR-RETRY" }, accounts(), retryKey);
  assert.equal(replay.payment_id, first.payment_id);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(num((await expense(expenseId)).amount_paid), 100);
  await assert.rejects(pay(expenseId, { amount_paid: 150, reference_number: "UTR-RETRY" }, accounts(), retryKey), /different supplier payment/);
  await assert.rejects(pay(expenseId, { amount_paid: 50, reference_number: " utr-retry " }), /already posted/);
  await assert.rejects(pay(expenseId, { amount_paid: 50, reference_number: "" }), /Reference number is required/);
  const cash = await pay(expenseId, { amount_paid: 50, payment_method: "cash", reference_number: "" });
  assert.ok(cash.payment_id);
  // Duplicate vendor bill: same vendor, bill number, financial year and total.
  const bill = { vendor_id: vendorA, invoice_number: "SM/101", invoice_date: "2026-05-10", base_amount: 2000 };
  await manual(bill);
  await assert.rejects(manual({ ...bill, invoice_number: " sm/101 " }), /already recorded/);
  assert.ok((await manual({ ...bill, base_amount: 1500 })).expense_id, "a split bill with a different total remains valid");
  assert.ok((await manual({ ...bill, invoice_date: "2027-05-10" })).expense_id, "vendor numbering may restart next financial year");
  assert.ok((await manual({ ...bill, vendor_id: vendorA2 })).expense_id, "another vendor may reuse the number");
  // Manual expense creation is idempotent too.
  const createKey = key();
  const created = await manual({ base_amount: 321, description: "Retry safe" }, accounts(), createKey);
  const createdAgain = await manual({ base_amount: 321, description: "Retry safe" }, accounts(), createKey);
  assert.equal(createdAgain.expense_id, created.expense_id);
  await assert.rejects(manual({ base_amount: 322, description: "Retry safe" }, accounts(), createKey), /different expense details/);
});

test("EXP-09: posted payments are immutable, reversible, and audited with before/after values", async () => {
  const expenseId = await approvedExpense(500);
  const posted = await pay(expenseId, { amount_paid: 200, reference_number: "CHQ-77", payment_method: "cheque" });
  await assert.rejects(asOwner(db, ownerA, "update public.expense_payments set amount_paid = 150 where id = $1", [posted.payment_id]), /immutable/);
  await assert.rejects(asOwner(db, ownerA, "update public.expense_payments set reference_number = 'X' where id = $1", [posted.payment_id]), /immutable/);
  await assert.rejects(asOwner(db, ownerA, "delete from public.expense_payments where id = $1", [posted.payment_id]), /cannot be deleted/);
  await assert.rejects(accounts().rpc("reverse_expense_payment_atomic", [posted.payment_id, "no", key()]), /clear reversal reason/);
  const reversalKey = key();
  const reversed = await accounts().rpc("reverse_expense_payment_atomic", [posted.payment_id, "Cheque bounced", reversalKey]);
  assert.equal(num(reversed.amount_paid), 0);
  const replay = await accounts().rpc("reverse_expense_payment_atomic", [posted.payment_id, "Cheque bounced", reversalKey]);
  assert.equal(replay.idempotent_replay, true);
  await assert.rejects(accounts().rpc("reverse_expense_payment_atomic", [posted.payment_id, "Cheque bounced", key()]), /already reversed/);
  const audit = (await db.query("select metadata_json from public.audit_logs where entity_id = $1 and action = 'expense_payment_reversed'", [posted.payment_id])).rows[0];
  assert.equal(audit.metadata_json.before.status, "posted");
  assert.equal(audit.metadata_json.after.status, "reversed");
  assert.equal(audit.metadata_json.before.reference_number, "CHQ-77");
  // A reference from a reversed payment can be reused by its correction.
  assert.ok((await pay(expenseId, { amount_paid: 200, reference_number: "CHQ-77", payment_method: "cheque" })).payment_id);
});

test("EXP-10 / EXP-11 / EXP-22: packaging purchases keep the central ledger authoritative", async () => {
  const purchase = (await asOwner(db, productionA, `insert into public.packaging_material_purchases(company_id, purchase_number, material_id,
    vendor_id, quantity, unit, rate, tax_amount, payment_status, total_amount) values ($1, 'PMP-1', $2, $3, 100, 'meter', 10, 180, 'paid', 5)
    returning id, expense_ledger_id`, [companyA, materialA, vendorA2])).rows[0];
  const source = async () => (await db.query("select * from public.packaging_material_purchases where id = $1", [purchase.id])).rows[0];
  let row = await source();
  assert.equal(num(row.total_amount), 1180, "source total is derived from quantity x rate + tax");
  assert.equal(row.payment_status, "unpaid", "a source cannot mark its payable paid");
  const central = await expense(row.expense_ledger_id);
  assert.equal(central.approval_status, "pending_approval", "a production user cannot self-approve");
  assert.equal(num(central.total_amount), 1180);
  await accounts().rpc("transition_expense_approval", [central.id, "approve", null]);
  await pay(central.id, { amount_paid: 1180 });
  row = await source();
  assert.equal(row.payment_status, "paid", "central settlement is projected back to the source");
  // A paid source cannot vanish from spend: deletion is blocked until cash is reversed.
  await assert.rejects(asOwner(db, productionA, "delete from public.packaging_material_purchases where id = $1", [purchase.id]),
    /posted supplier payments/);
  // An approved source cost is locked until reopened.
  await assert.rejects(asOwner(db, productionA, "update public.packaging_material_purchases set rate = 12 where id = $1", [purchase.id]),
    /approved and locked/);
  const payment = (await db.query("select id from public.expense_payments where expense_ledger_id = $1", [central.id])).rows[0];
  await accounts().rpc("reverse_expense_payment_atomic", [payment.id, "Wrong bank account", key()]);
  await owner().rpc("transition_expense_approval", [central.id, "reopen", "Vendor revised the rate"]);
  const item = async () => (await db.query("select current_stock, average_rate from public.inventory_items where company_id = $1 and item_code = 'PKG-STRETCH'", [companyA])).rows[0];
  assert.equal(num((await item()).average_rate), 10);
  await asOwner(db, productionA, "update public.packaging_material_purchases set rate = 12 where id = $1", [purchase.id]);
  assert.equal(num((await item()).current_stock), 100, "quantity is unchanged");
  assert.equal(num((await item()).average_rate), 12, "stock is revalued when only the cost changes");
  const revaluation = (await db.query(`select movement_type, quantity, amount from public.inventory_movements
    where reference_id = $1 and notes like '%revalued%'`, [purchase.id])).rows[0];
  assert.deepEqual([revaluation.movement_type, num(revaluation.quantity), num(revaluation.amount)], ["adjustment_in", 0, 200]);
  assert.equal(num((await expense(central.id)).total_amount), 1380);
  await asOwner(db, productionA, "delete from public.packaging_material_purchases where id = $1", [purchase.id]);
  const retired = await expense(central.id);
  assert.equal(retired.approval_status, "cancelled");
  assert.equal(retired.payment_status, "cancelled");
  assert.ok(retired.deleted_at);
  assert.equal(num((await item()).current_stock), 0);
});

test("EXP-12: supplier credit notes and refunds reconcile the payable", async () => {
  const expenseId = await approvedExpense(1000);
  await pay(expenseId, { amount_paid: 1000 });
  await assert.rejects(accounts().rpc("record_expense_supplier_credit_atomic", [expenseId, JSON.stringify({
    credit_type: "refund", amount: 10, payment_method: "cash", reason: "Nothing owed yet" }), key()]), /exceeds the supplier credit due/);
  const credit = await accounts().rpc("record_expense_supplier_credit_atomic", [expenseId, JSON.stringify({
    credit_type: "credit_note", amount: 200, reference_number: "SCN-9", reason: "Short supply credit" }), key()]);
  assert.equal(num(credit.supplier_credit_due), 200);
  await assert.rejects(accounts().rpc("record_expense_supplier_credit_atomic", [expenseId, JSON.stringify({
    credit_type: "credit_note", amount: 900, reference_number: "SCN-10", reason: "Too much credit" }), key()]), /exceeds the uncredited/);
  await assert.rejects(accounts().rpc("record_expense_supplier_credit_atomic", [expenseId, JSON.stringify({
    credit_type: "credit_note", amount: 10, reference_number: "scn-9", reason: "Duplicate credit" }), key()]), /already posted/);
  const refund = await accounts().rpc("record_expense_supplier_credit_atomic", [expenseId, JSON.stringify({
    credit_type: "refund", amount: 200, payment_method: "bank_transfer", reference_number: "NEFT-R1", reason: "Vendor refunded credit" }), key()]);
  assert.equal(num(refund.supplier_credit_due), 0);
  let row = await expense(expenseId);
  assert.deepEqual([num(row.amount_paid), num(row.refunded_amount), num(row.credited_amount), num(row.balance_amount)], [1000, 200, 200, 0]);
  assert.equal(row.payment_status, "paid");
  const payment = (await db.query("select id from public.expense_payments where expense_ledger_id = $1", [expenseId])).rows[0];
  await assert.rejects(accounts().rpc("reverse_expense_payment_atomic", [payment.id, "Bank reversed the transfer", key()]),
    /refunds cannot exceed posted supplier payments/);
  const refundRow = (await db.query("select id from public.expense_supplier_credits where expense_ledger_id = $1 and credit_type = 'refund'", [expenseId])).rows[0];
  await accounts().rpc("reverse_expense_supplier_credit_atomic", [refundRow.id, "Refund cheque bounced", key()]);
  row = await expense(expenseId);
  assert.equal(num(row.supplier_credit_due), 200);
  await assert.rejects(asOwner(db, ownerA, "update public.expense_supplier_credits set amount = 1 where id = $1", [refundRow.id]), /immutable/);
});

test("EXP-14 / EXP-18: approved expenses stay locked; reopening is an audited owner/admin action", async () => {
  const expenseId = await approvedExpense(5000);
  await assert.rejects(manual({ base_amount: 6000 }, accounts(), key(), expenseId), /locked/);
  await assert.rejects(asOwner(db, ownerA, "update public.expense_ledger set approval_status = 'draft' where id = $1", [expenseId]), /approval workflow/);
  await assert.rejects(asOwner(db, ownerA, "update public.expense_ledger set approval_status = 'paid' where id = $1", [expenseId]), /approval workflow/);
  await assert.rejects(accounts().rpc("transition_expense_approval", [expenseId, "reopen", "Correct the amount"]), /owner or admin/);
  await pay(expenseId, { amount_paid: 10, payment_method: "cash" });
  await assert.rejects(owner().rpc("transition_expense_approval", [expenseId, "reopen", "Correct the amount"]), /Reverse posted supplier payments/);
  const payment = (await db.query("select id from public.expense_payments where expense_ledger_id = $1", [expenseId])).rows[0];
  await accounts().rpc("reverse_expense_payment_atomic", [payment.id, "Posted to wrong bill", key()]);
  await assert.rejects(actor(db, adminA).rpc("transition_expense_approval", [expenseId, "reopen", "no"]), /clear reason/);
  const reopened = await actor(db, adminA).rpc("transition_expense_approval", [expenseId, "reopen", "Correct the amount"]);
  assert.equal(reopened.approval_status, "draft");
  const edited = await manual({ base_amount: 6000, submit: true }, accounts(), key(), expenseId);
  assert.equal(num(edited.total_amount), 6000);
  assert.equal(edited.approval_status, "approved");
  const audit = (await db.query("select metadata_json from public.audit_logs where entity_id = $1 and action = 'expense_approval_reopen'", [expenseId])).rows[0];
  assert.equal(audit.metadata_json.note, "Correct the amount");
  assert.equal(audit.metadata_json.from, "approved");
});

test("EXP-15 / EXP-25: zero-cost energy and maintenance edits retire the posted payable", async () => {
  const reading = (await asOwner(db, productionA, `insert into public.energy_readings(company_id, energy_type, consumption, rate_per_unit, total_cost)
    values ($1, 'electricity', 100, 8, 800) returning id, expense_ledger_id`, [companyA])).rows[0];
  assert.ok(reading.expense_ledger_id === null || reading.expense_ledger_id);
  const linked = (await db.query("select expense_ledger_id from public.energy_readings where id = $1", [reading.id])).rows[0].expense_ledger_id;
  assert.equal(num((await expense(linked)).total_amount), 800);
  await asOwner(db, productionA, "update public.energy_readings set rate_per_unit = 0, total_cost = 0 where id = $1", [reading.id]);
  assert.equal((await expense(linked)).approval_status, "cancelled");
  await asOwner(db, productionA, "update public.energy_readings set rate_per_unit = 9, total_cost = 900 where id = $1", [reading.id]);
  const revived = await expense(linked);
  assert.equal(revived.approval_status, "pending_approval");
  assert.equal(num(revived.total_amount), 900);
  assert.equal(revived.deleted_at, null);

  const breakdown = (await asOwner(db, productionA, `insert into public.breakdown_logs(company_id, machine_id, issue_description, cost, vendor_name,
    bill_number, bill_date) values ($1, 'P1', 'Hydraulic seal', 4500, 'Ganesh Hydraulics', 'GH/22', '2026-06-01') returning id`, [companyA])).rows[0];
  const breakdownExpense = (await db.query("select expense_ledger_id from public.breakdown_logs where id = $1", [breakdown.id])).rows[0].expense_ledger_id;
  const mapped = await expense(breakdownExpense);
  assert.equal(mapped.vendor_name_snapshot, "Ganesh Hydraulics", "EXP-21 free-text supplier reaches the central payable");
  assert.equal(mapped.invoice_number, "GH/22");
  assert.equal(mapped.invoice_date.toISOString().slice(0, 10), "2026-06-01");
  await asOwner(db, ownerA, "update public.breakdown_logs set cost = 0 where id = $1", [breakdown.id]);
  assert.equal((await expense(breakdownExpense)).approval_status, "cancelled");
});

test("EXP-16 / EXP-17: overdue is computed at read time and paid date follows the ledger", async () => {
  assert.equal((await db.query("select private.expense_live_payment_status('unpaid', 10, '2000-01-01') as s")).rows[0].s, "overdue");
  assert.equal((await db.query("select private.expense_live_payment_status('partially_paid', 10, '2000-01-01') as s")).rows[0].s, "overdue");
  assert.equal((await db.query("select private.expense_live_payment_status('paid', 0, '2000-01-01') as s")).rows[0].s, "paid");
  assert.equal((await db.query("select private.expense_live_payment_status('unpaid', 10, '2999-01-01') as s")).rows[0].s, "unpaid");
  assert.equal((await db.query("select private.expense_live_payment_status('overdue', 0, '2000-01-01') as s")).rows[0].s, "unpaid");
  assert.equal((await db.query("select private.expense_live_payment_status('unpaid', 10, '2026-10-10', '2026-10-10') as s")).rows[0].s, "unpaid",
    "an invoice is not overdue on its due date");
  const dueSoon = await approvedExpense(400, { invoice_date: "2026-01-01", due_date: "2026-01-15" });
  const live = (await accounts().query("select payment_status from public.expense_ledger_authorized where id = $1", [dueSoon])).rows[0];
  assert.equal(live.payment_status, "overdue");
  assert.equal((await actor(db, productionA).query("select count(*)::int as n from public.expense_ledger_authorized")).rows[0].n, 0);
  await pay(dueSoon, { amount_paid: 150, payment_date: "2026-02-01" });
  await pay(dueSoon, { amount_paid: 250, payment_date: "2026-01-20" });
  let row = await expense(dueSoon);
  assert.equal(row.payment_status, "paid");
  assert.equal(row.paid_date.toISOString().slice(0, 10), "2026-02-01", "paid date is the latest settlement date, not today");
  const late = (await db.query("select id from public.expense_payments where expense_ledger_id = $1 and amount_paid = 250", [dueSoon])).rows[0];
  await accounts().rpc("reverse_expense_payment_atomic", [late.id, "Duplicate transfer", key()]);
  row = await expense(dueSoon);
  assert.equal(row.paid_date, null, "a reopened balance clears the paid date");
  assert.equal(row.payment_status, "overdue");
  await assert.rejects(pay(dueSoon, { amount_paid: 1, payment_method: "cash", payment_date: "2999-01-01" }), /future/);
});

test("EXP-19 / EXP-20 / EXP-24: foundry and outsourced sources sync once without recursion", async () => {
  const external = (await asOwner(db, productionA, `insert into public.foundry_external_aluminium_sources(company_id, source_number, weight_kg,
    available_weight_kg, rate, tax_amount, vendor_id) values ($1, 'EXT-1', 1000, 1000, 200, 36000, $2) returning id`, [companyA, vendorA])).rows[0];
  let ext = (await db.query("select * from public.foundry_external_aluminium_sources where id = $1", [external.id])).rows[0];
  assert.equal(num(ext.total_amount), 236000);
  assert.ok(ext.expense_ledger_id);
  await asOwner(db, productionA, "update public.foundry_external_aluminium_sources set available_weight_kg = 600 where id = $1", [external.id]);
  const scrap = (await asOwner(db, productionA, `insert into public.foundry_aluminium_scrap(company_id, scrap_number, weight_kg, rate)
    values ($1, 'SCR-1', 500, 150) returning id`, [companyA])).rows[0];
  assert.ok((await db.query("select expense_ledger_id from public.foundry_aluminium_scrap where id = $1", [scrap.id])).rows[0].expense_ledger_id);

  const batch = (await asOwner(db, productionA, `insert into public.outsourced_billet_batches(company_id, batch_number, alloy, weight_kg, price_per_kg)
    values ($1, 'OBB-1', '6063', 2000, 250) returning id`, [companyA])).rows[0];
  const stock = async (code) => num((await db.query("select current_stock from public.inventory_items where company_id = $1 and item_code = $2", [companyA, code])).rows[0]?.current_stock ?? 0);
  assert.equal(await stock("OBB-6063-7"), 2000);
  await asOwner(db, productionA, "update public.outsourced_billet_batches set alloy = '6061' where id = $1", [batch.id]);
  assert.equal(await stock("OBB-6063-7"), 0, "stock leaves the former SKU");
  assert.equal(await stock("OBB-6061-7"), 2000, "stock arrives on the corrected SKU");
  const batchExpense = (await db.query("select expense_ledger_id from public.outsourced_billet_batches where id = $1", [batch.id])).rows[0].expense_ledger_id;
  await asOwner(db, productionA, "update public.outsourced_billet_batches set status = 'cancelled' where id = $1", [batch.id]);
  assert.equal(await stock("OBB-6061-7"), 0);
  const voided = await expense(batchExpense);
  assert.equal(voided.approval_status, "cancelled");
  assert.equal(voided.payment_status, "cancelled");
});

test("EXP-23: new expenses are INR only; legacy foreign-currency rows are reported, not restated", async () => {
  await assert.rejects(manual({ base_amount: 10, currency: "USD" }), /recorded in INR/);
  const issues = (await accounts().query("select issue from public.expense_ledger_reconciliation_issues where expense_id = $1", [legacyUsd])).rows;
  assert.deepEqual(issues.map((row) => row.issue), ["non_inr_currency"]);
});

test("historical repair: valid projections are recomputed, irreconcilable rows are listed", async () => {
  const relabelled = await expense(legacyPaidLabel);
  assert.equal(relabelled.approval_status, "approved");
  assert.equal(relabelled.payment_status, "unpaid", "a legacy paid label without payments reads unpaid");
  const forged = await expense(legacyForgedPaid);
  assert.equal(num(forged.amount_paid), 0, "a forged paid projection is recomputed from the ledger");
  assert.equal(num((await expense(legacyTotalMismatch)).total_amount), 100, "untouched legacy totals are not silently restated");
  const issues = (await accounts().query("select expense_id, issue from public.expense_ledger_reconciliation_issues")).rows;
  const has = (expenseId, issue) => issues.some((row) => row.expense_id === expenseId && row.issue === issue);
  assert.ok(has(legacyTotalMismatch, "total_component_mismatch"));
  assert.ok(has(legacyOverpaid, "settlement_exceeds_total"));
  assert.ok(has(legacyOverpaid, "paid_projection_mismatch"));
  assert.ok(!issues.some((row) => row.expense_id === legacyForgedPaid));
  assert.equal((await actor(db, productionA).query("select count(*)::int as n from public.expense_ledger_reconciliation_issues")).rows[0].n, 0);
  assert.ok((await db.query("select count(*)::int as n from public.audit_logs where action = 'expense_legacy_paid_approval_relabelled'")).rows[0].n >= 1);
});

test("tenant isolation: another company cannot read or act on company A expenses", async () => {
  const expenseId = await approvedExpense(900);
  const other = actor(db, accountsB);
  assert.equal((await other.query("select count(*)::int as n from public.expense_ledger where id = $1", [expenseId])).rows[0].n, 0);
  await assert.rejects(other.rpc("record_expense_payment_atomic", [expenseId, JSON.stringify({ amount_paid: 1, payment_method: "cash" }), key()]),
    /not found/);
  await assert.rejects(other.rpc("save_manual_expense_atomic", [expenseId, JSON.stringify({ expense_category: "utilities", description: "Hijack", base_amount: 1 }), null]),
    /not found/);
});
