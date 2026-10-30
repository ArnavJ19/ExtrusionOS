import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFinancialWorkflowFixture } from "../scripts/lib/financial-workflow-review-fixture.mjs";
import { createRetainedInvoiceFixture, installRetainedInvoiceSettlementObjects, invoiceFixtureIds } from "../scripts/lib/retained-invoice-fixture.mjs";
import { buildInvoiceItems } from "../lib/pcda/invoice.ts";
import { buildInvoiceFingerprintPayload, previewReceiptCsv } from "../lib/workflow/financial-workflow-review.ts";

let fixture;
let sourceFixture;
const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const migrationPath = "supabase/migrations/20261029130000_financial_workflow_review.sql";

test.before(async () => {
  fixture = await createFinancialWorkflowFixture();
  sourceFixture = await createRetainedInvoiceFixture();
  await installRetainedInvoiceSettlementObjects(sourceFixture);
  await sourceFixture.exec("create schema if not exists auth; create table if not exists auth.users(id uuid primary key,email text);");
  await sourceFixture.exec(read(migrationPath));
});
test.after(async () => { await fixture?.close(); await sourceFixture?.close(); });
test.beforeEach(async () => {
  await fixture.db.exec("reset role; begin; set role authenticated;");
  await fixture.actor();
  await sourceFixture.exec(`reset role; begin; set test.actor='${invoiceFixtureIds.actor}'; set role authenticated;`);
});
test.afterEach(async () => { await fixture.db.exec("rollback; reset role;"); await sourceFixture.exec("rollback; reset role;"); });

async function attempt(callback) {
  await fixture.db.exec("savepoint financial_attempt;");
  try {
    const result = await callback();
    await fixture.db.exec("release savepoint financial_attempt;");
    return result;
  } catch (error) {
    await fixture.db.exec("rollback to savepoint financial_attempt; release savepoint financial_attempt;");
    throw error;
  }
}

async function attemptSource(callback) {
  await sourceFixture.exec("savepoint reviewed_invoice_attempt;");
  try {
    const result = await callback();
    await sourceFixture.exec("release savepoint reviewed_invoice_attempt;");
    return result;
  } catch (error) {
    await sourceFixture.exec("rollback to savepoint reviewed_invoice_attempt; release savepoint reviewed_invoice_attempt;");
    throw error;
  }
}

const key = (number) => `d1000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const postReceipt = (amount, allocations, idempotencyKey, overrides = {}) => fixture.db.query(
  "select public.post_financial_receipt_atomic($1,$2,$3) data",
  [{ amount, payment_date: "2026-10-20", payment_method: "bank_transfer", reference_number: "UTR-GROUP-01", notes: "Customer receipt", source_type: "manual", ...overrides }, allocations, idempotencyKey]
);

test("CSV preview maps Indian date formats and grouped INR amounts without accepting ambiguous values", () => {
  const preview = previewReceiptCsv(
    'Invoice No,Receipt Date,Received,Mode,UTR,Remarks\nINV-1101,29/10/2026,"1,23,456.78",Bank Transfer,UTR-1,Advance',
    { invoice_number: "Invoice No", payment_date: "Receipt Date", amount: "Received", payment_method: "Mode", reference_number: "UTR", notes: "Remarks", date_format: "dmy" }
  );
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].payment_date, "2026-10-29");
  assert.equal(preview.rows[0].amount, 123456.78);
  assert.equal(preview.rows[0].payment_method, "bank_transfer");

  const ambiguous = previewReceiptCsv("Invoice,Date,Amount,Method\nINV-1101,29/10/2026,10,UPI", {
    invoice_number: "Invoice", payment_date: "Date", amount: "Amount", payment_method: "Method", date_format: "mdy"
  });
  assert.match(ambiguous.rows[0].error, /date is invalid/i);
});

test("invoice source fingerprints are stable across line order and change with source values", () => {
  const first = { source_line_id: "line-a", quantity: 10, unit_rate: 100, line_total: 1000, gst_percent: null, hsn_code: "760421" };
  const second = { source_line_id: "line-b", quantity: 5, unit_rate: 200, line_total: 1000, gst_percent: 18, hsn_code: "760421" };
  assert.equal(buildInvoiceFingerprintPayload([first, second], 18), buildInvoiceFingerprintPayload([second, first], 18));
  assert.notEqual(buildInvoiceFingerprintPayload([first, { ...second, quantity: 6 }], 18), buildInvoiceFingerprintPayload([first, second], 18));
});

test("reviewed invoice save locks the manifest, rejects stale tax/source review, and seals issued lines", async () => {
  const source = invoiceFixtureIds;
  await sourceFixture.exec("reset role;");
  await sourceFixture.query("update packing_list_items set gst_percent=null where id=$1 and company_id=$2", [source.packing, source.company]);
  await sourceFixture.query("update order_items set gst_percent=5 where id=$1 and company_id=$2", [source.orderLine, source.company]);
  await sourceFixture.exec("set role authenticated;");
  const loadReview = async () => {
    await sourceFixture.exec("reset role;");
    const lines = (await sourceFixture.query("select * from packing_list_items where company_id=$1 and dispatch_id=$2 order by id", [source.company, source.dispatch])).rows;
    await sourceFixture.exec("set role authenticated;");
    const sourceTax = (await sourceFixture.query("select hsn_code,gst_percent from invoice_dispatch_tax_basis_authorized where company_id=$1 and packing_line_id=$2", [source.company, source.packing])).rows[0];
    assert.deepEqual(sourceTax, { hsn_code: "760421", gst_percent: "5.00" });
    const items = buildInvoiceItems(lines.map(line => ({ ...line, gst_percent: 5, hsn_code: "760421" })), "00000000-0000-0000-0000-000000000000", source.company);
    const fingerprint = createHash("md5").update(buildInvoiceFingerprintPayload(items, 18)).digest("hex");
    return { lines, items, fingerprint };
  };
  const original = await loadReview();
  await sourceFixture.exec("reset role;");
  await sourceFixture.query("update packing_list_items set net_rate=101 where id=$1 and company_id=$2", [source.packing, source.company]);
  await sourceFixture.exec("set role authenticated;");
  const payload = {
    customer_id: source.customer,
    order_id: source.order,
    dispatch_id: source.dispatch,
    place_of_supply_state_code: "24",
    invoice_number: "",
    invoice_date: "2026-10-29",
    due_date: null,
    status: "generated",
    source_fingerprint: original.fingerprint,
    notes: null
  };
  await assert.rejects(attemptSource(() => sourceFixture.query("select public.save_reviewed_invoice_atomic(null,$1,$2,true)", [payload, original.items])), /changed after review/i);
  assert.equal((await sourceFixture.query("select count(*)::int n from invoices where dispatch_id=$1", [source.dispatch])).rows[0].n, 0);

  const current = await loadReview();
  payload.source_fingerprint = current.fingerprint;
  const saved = (await attemptSource(() => sourceFixture.query("select public.save_reviewed_invoice_atomic(null,$1,$2,true) id", [payload, current.items]))).rows[0].id;
  assert.deepEqual((await sourceFixture.query("select quantity,unit_rate,line_total,gst_percent from invoice_items where invoice_id=$1", [saved])).rows[0],
    { quantity: "10.000", unit_rate: "101.00", line_total: "1010.00", gst_percent: "5.00" });
  assert.equal((await sourceFixture.query("select tax_total from invoices where id=$1", [saved])).rows[0].tax_total, "50.50");

  payload.status = "sent";
  const issued = await loadReview();
  payload.source_fingerprint = issued.fingerprint;
  await attemptSource(() => sourceFixture.query("select public.save_reviewed_invoice_atomic($1,$2,$3,true)", [saved, payload, issued.items]));
  const snapshot = (await sourceFixture.query("select issued_snapshot,source_fingerprint from invoices where id=$1", [saved])).rows[0];
  assert.equal(snapshot.issued_snapshot.items.length, 1);
  assert.equal(snapshot.issued_snapshot.items[0].quantity, 10);
  assert.match(snapshot.source_fingerprint, /^[0-9a-f]{32}$/);
  await sourceFixture.exec("reset role;");
  await assert.rejects(attemptSource(() => sourceFixture.query("update invoices set grand_total=1 where id=$1", [saved])), /commercial fields are immutable/i);
  await assert.rejects(attemptSource(() => sourceFixture.query("update invoice_items set unit_rate=1 where invoice_id=$1", [saved])), /invoice lines are immutable/i);
  await sourceFixture.exec("set role authenticated;");
  await assert.rejects(attemptSource(() => sourceFixture.query("select public.save_reviewed_invoice_atomic(null,$1,$2,true)", [payload, issued.items])), /already has an active invoice/i);
});

test("one actual receipt posts through the canonical payment ledger and replays without duplicate rows", async () => {
  const allocations = [
    { invoice_id: fixture.ids.invoiceA, amount: 60 },
    { invoice_id: fixture.ids.invoiceB, amount: 40 }
  ];
  const created = (await attempt(() => postReceipt(100, allocations, key(1)))).rows[0].data;
  assert.equal(created.idempotent_replay, false);
  assert.equal(created.received_amount, 100);
  assert.equal(created.allocations.length, 2);
  assert.equal((await attempt(() => fixture.db.query("select count(*) n from payments where receipt_event_id=$1", [created.receipt_id]))).rows[0].n, 2);
  assert.equal((await attempt(() => fixture.db.query("select count(*) n from payments where receipt_event_id=$1 and payment_method='bank_transfer' and reference_number='UTR-GROUP-01' and payment_status='PAID'", [created.receipt_id]))).rows[0].n, 2);
  assert.deepEqual((await attempt(() => fixture.db.query("select invoice_number,amount_paid,balance_due from invoices where id in ($1,$2) order by invoice_number", [fixture.ids.invoiceA, fixture.ids.invoiceB]))).rows,
    [{ invoice_number: fixture.invoiceNumbers.a, amount_paid: "60.00", balance_due: "58.00" }, { invoice_number: fixture.invoiceNumbers.b, amount_paid: "40.00", balance_due: "196.00" }]);

  const replay = (await attempt(() => postReceipt(100, allocations, key(1)))).rows[0].data;
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.receipt_id, created.receipt_id);
  assert.equal((await attempt(() => fixture.db.query("select count(*) n from payments where receipt_event_id=$1", [created.receipt_id]))).rows[0].n, 2);
  await assert.rejects(attempt(() => postReceipt(99, [
    { invoice_id: fixture.ids.invoiceA, amount: 60 },
    { invoice_id: fixture.ids.invoiceB, amount: 39 }
  ], key(1))), /different receipt or allocations/i);
});

test("invoice locks prevent over-allocation and duplicate bank references across receipts", async () => {
  await assert.rejects(attempt(() => postReceipt(119, [{ invoice_id: fixture.ids.invoiceA, amount: 119 }], key(2), { reference_number: "UTR-OVER" })), /open balance changed/i);
  const accepted = (await attempt(() => postReceipt(118, [{ invoice_id: fixture.ids.invoiceA, amount: 118 }], key(3), { reference_number: "UTR-LOCK" }))).rows[0].data;
  assert.equal(accepted.allocations[0].invoice_status, "paid");
  await assert.rejects(attempt(() => postReceipt(10, [{ invoice_id: fixture.ids.invoiceB, amount: 10 }], key(4), { reference_number: "UTR-LOCK" })), /already recorded/i);
  await assert.rejects(attempt(() => fixture.db.query("select public.record_payment_atomic($1,$2)", [fixture.ids.invoiceB, {
    payment_date: "2026-10-20", amount: 10, payment_method: "bank_transfer", reference_number: "UTR-LOCK", notes: null, idempotency_key: key(11)
  }])), /payment reference is already recorded/i);
  assert.equal((await attempt(() => fixture.db.query("select count(*) n from financial_receipt_events where company_id=$1", [fixture.ids.company]))).rows[0].n, 1);
});

test("credit adjustments remain distinct from cash and reversals preserve grouped receipt history", async () => {
  const created = (await attempt(() => postReceipt(30, [
    { invoice_id: fixture.ids.invoiceA, amount: 10 },
    { invoice_id: fixture.ids.invoiceB, amount: 20 }
  ], key(5), { payment_method: "cash", reference_number: null }))).rows[0].data;
  assert.equal(created.allocations.length, 2);
  assert.equal((await attempt(() => fixture.db.query("select count(*) n from payments where receipt_event_id=$1 and payment_method='cash' and payment_status='PAID'", [created.receipt_id]))).rows[0].n, 2);
  await attempt(() => postReceipt(5, [{ invoice_id: fixture.ids.invoiceA, amount: 5 }], key(6), {
    payment_method: "credit_note", reference_number: null, notes: "Approved balance adjustment"
  }));
  assert.equal((await attempt(() => fixture.db.query("select sum(amount) amount from payments where company_id=$1 and payment_method<>'credit_note' and payment_status='PAID'", [fixture.ids.company]))).rows[0].amount, "30.00");
  assert.equal((await attempt(() => fixture.db.query("select sum(amount) amount from payments where company_id=$1 and payment_method='credit_note' and payment_status='PAID'", [fixture.ids.company]))).rows[0].amount, "5.00");

  const paymentId = created.allocations[0].payment_id;
  await attempt(() => fixture.db.query("select public.reverse_payment_atomic($1,$2,$3)", [paymentId, "Bank confirmed receipt reversal", key(7)]));
  assert.equal((await attempt(() => fixture.db.query("select status from financial_receipt_events where id=$1", [created.receipt_id]))).rows[0].status, "partially_reversed");
  const replay = (await attempt(() => postReceipt(30, [
    { invoice_id: fixture.ids.invoiceA, amount: 10 },
    { invoice_id: fixture.ids.invoiceB, amount: 20 }
  ], key(5), { payment_method: "cash", reference_number: null }))).rows[0].data;
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.status, "partially_reversed");
});

test("forged receipt context cannot extend a recorded receipt or create an unallocated sibling payment", async () => {
  const created = (await attempt(() => postReceipt(10, [{ invoice_id: fixture.ids.invoiceA, amount: 10 }], key(20)))).rows[0].data;
  await fixture.db.query("select set_config('app.financial_receipt_event_id',$1,true)", [created.receipt_id]);
  await assert.rejects(attempt(() => fixture.db.query("select public.record_payment_atomic($1,$2)", [fixture.ids.invoiceB, {
    payment_date: "2026-10-20", amount: 10, payment_method: "bank_transfer", reference_number: "UTR-GROUP-01", idempotency_key: key(21)
  }])), /payment reference is already recorded/i);
  assert.deepEqual((await fixture.db.query(`select e.received_amount,
    (select sum(p.amount) from payments p where p.receipt_event_id=e.id) payment_amount,
    (select sum(a.amount) from financial_receipt_allocations a where a.receipt_event_id=e.id) allocation_amount
    from financial_receipt_events e where e.id=$1`, [created.receipt_id])).rows[0],
  { received_amount: "10.00", payment_amount: "10.00", allocation_amount: "10.00" });
  await assert.rejects(attempt(() => fixture.db.query("insert into private.financial_receipt_authorizations values(txid_current(),$1,$2,$3,10,$4)",
    [created.receipt_id, fixture.ids.company, fixture.ids.invoiceB, key(22)])), /permission denied/i);
});

test('standalone canonical receipts cannot reuse an ungrouped bank reference with a different request identity',async()=>{
  const payment={payment_date:'2026-10-20',amount:10,payment_method:'bank_transfer',reference_number:'UTR-STANDALONE',idempotency_key:key(30)};
  const first=(await attempt(()=>fixture.db.query('select public.record_payment_atomic($1,$2) data',[fixture.ids.invoiceA,payment]))).rows[0].data;
  const replay=(await attempt(()=>fixture.db.query('select public.record_payment_atomic($1,$2) data',[fixture.ids.invoiceA,payment]))).rows[0].data;
  assert.equal(replay.payment_id,first.payment_id);
  await assert.rejects(attempt(()=>fixture.db.query('select public.record_payment_atomic($1,$2)',[fixture.ids.invoiceB,{...payment,idempotency_key:key(31)}])),/payment reference is already recorded/);
  assert.equal((await fixture.db.query("select count(*)::int n from payments where reference_number='UTR-STANDALONE'")).rows[0].n,1);
});

test("CSV import persists row-level reconciliation failures and same-file replay", async () => {
  const importCall = (fingerprint) => fixture.db.query("select public.import_financial_receipt_csv_atomic($1,$2,$3,$4) data", [
    fingerprint,
    "collections-october.csv",
    { invoice_number: "Invoice", payment_date: "Date", amount: "Amount", payment_method: "Method", reference_number: "UTR", date_format: "dmy" },
    [
      { row_number: 2, invoice_number: fixture.invoiceNumbers.a, payment_date: "2026-10-22", amount: 20, payment_method: "bank_transfer", reference_number: "UTR-CSV-01", notes: "Matched transfer" },
      { row_number: 3, invoice_number: fixture.invoiceNumbers.b, payment_date: "2026-10-22", amount: 10, payment_method: "bank_transfer", reference_number: "UTR-CSV-01", notes: "Duplicate UTR" },
      { row_number: 4, invoice_number: "NO-SUCH-INVOICE", payment_date: "2026-10-22", amount: 10, payment_method: "cash", reference_number: null, notes: "Unmatched line" }
    ]
  ]);
  const fingerprint = "ab".repeat(32);
  const imported = (await attempt(() => importCall(fingerprint))).rows[0].data;
  assert.equal(imported.row_count, 3);
  assert.equal(imported.posted_count, 1);
  assert.equal(imported.failed_count, 2);
  assert.deepEqual(imported.rows.filter((row) => row.status === "failed").map((row) => row.row_number), [3, 4]);
  assert.match(imported.rows.find((row) => row.row_number === 3).error, /duplicate receipt reference/i);
  assert.match(imported.rows.find((row) => row.row_number === 4).error, /not found/i);

  const replay = (await attempt(() => importCall(fingerprint))).rows[0].data;
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.posted_count, 1);
  assert.equal((await attempt(() => fixture.db.query("select count(*) n from financial_receipt_import_rows where batch_id=$1", [imported.batch_id]))).rows[0].n, 3);
});

test("finance roles, company scope, and protected receipt tables are enforced in SQL", async () => {
  await assert.rejects(attempt(() => fixture.db.query("insert into financial_receipt_events(company_id,idempotency_key,request_fingerprint,source_type,received_amount,payment_date,payment_method,created_by) values($1,$2,$3,'manual',1,current_date,'cash',$4)", [fixture.ids.company, key(8), "cd".repeat(16), fixture.ids.owner])), /permission denied|row-level security/i);
  await assert.rejects(attempt(() => fixture.db.query("select public.post_financial_receipt_atomic($1,$2,$3)", [
    { amount: 1, payment_date: "2026-10-20", payment_method: "cash", source_type: "manual" },
    [{ invoice_id: fixture.ids.foreignInvoice, amount: 1 }], key(9)
  ])), /open balance changed|unavailable|invoice not found for this company/i);

  await fixture.actor(fixture.ids.sales);
  await assert.rejects(attempt(() => fixture.db.query("select public.post_financial_receipt_atomic($1,$2,$3)", [
    { amount: 1, payment_date: "2026-10-20", payment_method: "cash", source_type: "manual" },
    [{ invoice_id: fixture.ids.invoiceA, amount: 1 }], key(10)
  ])), /permission denied/i);
  const access = (await attempt(() => fixture.db.query("select has_function_privilege('authenticated','private.post_financial_receipt_atomic(jsonb,jsonb,uuid)','EXECUTE') helper, has_function_privilege('authenticated','private.enforce_financial_payment_reference()','EXECUTE') reference_trigger, has_table_privilege('authenticated','financial_receipt_events','INSERT') direct_write"))).rows[0];
  assert.deepEqual(access, { helper: false, reference_trigger: false, direct_write: false });
});

test("migration seals issued totals and scopes workflow tables to finance readers", () => {
  const migration = read(migrationPath);
  assert.match(migration, /private\.seal_issued_invoice_snapshot/);
  assert.match(migration, /Issued invoice commercial fields are immutable/);
  assert.match(migration, /block_issued_invoice_item_mutation/);
  assert.match(migration, /public\.save_reviewed_invoice_atomic/);
  assert.match(migration, /private\.reviewed_invoice_source_fingerprint/);
  assert.match(migration, /private\.post_financial_receipt_atomic/);
  assert.match(migration, /private\.enforce_financial_payment_reference/);
  assert.match(migration, /private\.record_payment_atomic\(v_invoice_id, v_payment\)/);
  assert.match(migration, /private\.import_financial_receipt_csv_atomic/);
  assert.match(migration, /financial_receipt_import_batches_finance_read/);
  assert.match(migration, /revoke all on public\.financial_receipt_import_batches/);
});
