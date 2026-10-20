import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), otherCompany = id(2), accounts = id(3), salesManager = id(4), otherAccounts = id(5);
const customer = id(10), order = id(15);
const dispatchReturned = id(30), dispatchOpen = id(31), dispatchSpare = id(32), dispatchConflict = id(33);
const invoiceReturned = id(20), invoiceOverdue = id(21), invoiceConflict = id(22);
const migrationText = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
let db;
let keys = 500;
const key = () => id(++keys);

async function as(actor, text, params = []) {
  await db.exec(`set test.actor = '${actor}'; set role authenticated;`);
  try { return await db.query(text, params); }
  finally { await db.exec("reset role; reset test.actor;"); }
}
const rpc = async (actor, name, args) => (await as(actor, `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as data`, args)).rows[0].data;
const receipt = (invoiceId, payment) => rpc(accounts, "record_payment_atomic", [invoiceId, JSON.stringify(payment)]);
const invoice = async (invoiceId) => (await db.query("select * from public.invoices where id = $1", [invoiceId])).rows[0];
const today = async () => (await db.query("select private.business_today()::text as d")).rows[0].d;

test.before(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema private;
    grant usage on schema private to authenticated;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    create table public.app_users(id uuid primary key, company_id uuid, role text, is_active boolean);
    create function private.get_current_user_company_id() returns uuid language sql security definer set search_path = public as
      $$select company_id from public.app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql security definer set search_path = public as
      $$select role from public.app_users where id=auth.uid() and is_active$$;
    create function public.get_current_user_company_id() returns uuid language sql security definer set search_path = public as $$select private.get_current_user_company_id()$$;
    create function public.get_current_user_role() returns text language sql security definer set search_path = public as $$select private.get_current_user_role()$$;
    create sequence credit_number;
    create function private.next_business_number_locked(regclass,text,uuid,text,date) returns text
      language sql as $$select 'CN-'||nextval('credit_number')::text$$;
    create table public.customers(id uuid primary key, company_id uuid);
    create table public.orders(id uuid primary key, company_id uuid, customer_id uuid, dealer_id uuid);
    create table public.dispatches(id uuid primary key, company_id uuid, order_id uuid, delivery_status text);
    create table public.invoices(id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, order_id uuid,
      branch_id uuid, dispatch_id uuid, invoice_number text, invoice_date date default current_date,
      subtotal numeric(14,2), tax_total numeric(14,2), grand_total numeric(14,2),
      amount_paid numeric(14,2) default 0, credited_amount numeric(14,2) default 0,
      balance_due numeric(14,2) generated always as (greatest(grand_total-amount_paid-credited_amount,0)) stored,
      customer_credit_due numeric(14,2) generated always as (greatest(amount_paid+credited_amount-grand_total,0)) stored,
      status text, due_date date, paid_date date, notes text, created_at timestamptz default now(), updated_at timestamptz,
      deleted_at timestamptz);
    create table public.invoice_items(id uuid primary key, company_id uuid, invoice_id uuid, line_total numeric(14,2));
    create table public.payments(id uuid primary key default gen_random_uuid(), company_id uuid, invoice_id uuid,
      order_id uuid, branch_id uuid, dealership_id uuid, payment_date date, amount numeric(14,2),
      payment_method text, payment_type text, payment_status text, reference_number text, notes text,
      recorded_by_user_id uuid, idempotency_key uuid, created_at timestamptz, updated_at timestamptz,
      reversed_at timestamptz, reversed_by uuid, reversal_reason text, reversal_idempotency_key uuid,
      unique(company_id, idempotency_key));
    create table public.credit_notes(id uuid primary key default gen_random_uuid(), company_id uuid, invoice_id uuid,
      dispatch_id uuid, credit_note_number text, credit_date date, reason text, subtotal numeric(14,2), tax_total numeric(14,2),
      grand_total numeric(14,2), status text default 'issued', item_snapshot jsonb, idempotency_key uuid,
      reversed_at timestamptz, reversed_by uuid, reversal_reason text, created_by uuid,
      created_at timestamptz default now(), updated_at timestamptz default now(), unique(company_id, idempotency_key));
    create table public.audit_logs(company_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, metadata_json jsonb);
    alter table public.invoices enable row level security;
    alter table public.payments enable row level security;
    grant select on all tables in schema public to authenticated;
    insert into public.app_users values ('${accounts}','${company}','accounts',true), ('${salesManager}','${company}','sales_manager',true),
      ('${otherAccounts}','${otherCompany}','accounts',true);
    insert into public.customers values ('${customer}','${company}');
    insert into public.orders values ('${order}','${company}','${customer}',null);
    insert into public.dispatches values ('${dispatchReturned}','${company}','${order}','returned'), ('${dispatchOpen}','${company}','${order}','delivered'),
      ('${dispatchSpare}','${company}','${order}','delivered'), ('${dispatchConflict}','${company}','${order}','returned');
    insert into public.invoices(id, company_id, customer_id, order_id, dispatch_id, invoice_number, subtotal, tax_total, grand_total, status, due_date) values
      ('${invoiceReturned}','${company}','${customer}','${order}','${dispatchReturned}','INV-RET',80,20,100,'sent', current_date + 30),
      ('${invoiceOverdue}','${company}','${customer}','${order}','${dispatchOpen}','INV-OVD',800,200,1000,'sent','2026-01-15');
    -- A historical overlap that predates the exclusivity guard.
    insert into public.invoices(id, company_id, customer_id, order_id, dispatch_id, invoice_number, subtotal, tax_total, grand_total, amount_paid, credited_amount, status)
      values ('${invoiceConflict}','${company}','${customer}','${order}','${dispatchConflict}','INV-HIST',80,20,100,50,100,'credited');
    insert into public.payments(company_id, invoice_id, payment_date, amount, payment_method, payment_type, payment_status, idempotency_key)
      values ('${company}','${invoiceConflict}','2026-01-01',50,'credit_note','ADJUSTMENT','PAID','${id(99)}');
    insert into public.credit_notes(company_id, invoice_id, dispatch_id, credit_note_number, reason, grand_total, status, idempotency_key)
      values ('${company}','${invoiceConflict}','${dispatchConflict}','CN-HIST','Verified historical return',100,'issued','${id(98)}');`);
  await db.exec(migrationText("20261015020000_credit_settlement_exclusivity.sql"));
  await db.exec(migrationText("20261020020000_receivables_integrity.sql"));
  for (const name of ["public.record_payment_atomic", "private.reverse_payment_atomic", "public.reverse_payment_atomic"]) {
    await db.exec(sqlDefinition("20260718010000_financial_closure.sql", name));
  }
  await db.exec(sqlDefinition("20260723070000_dispatch_return_credit_notes.sql", "private.reverse_credit_note_atomic"));
  await db.exec(sqlDefinition("20261015030000_credit_note_retry_binding.sql", "private.issue_dispatch_return_credit_note_atomic"));
  for (const name of ["public.issue_dispatch_return_credit_note_atomic", "public.reverse_credit_note_atomic"]) {
    await db.exec(sqlDefinition("20261008020000_factory_workflow_integrity.sql", name));
  }
  await db.exec(`revoke all on function private.reverse_payment_atomic(uuid,text,uuid) from public, anon, authenticated;
    grant execute on function public.record_payment_atomic(uuid,jsonb), public.reverse_payment_atomic(uuid,text,uuid),
      public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid), public.reverse_credit_note_atomic(uuid,text) to authenticated;`);
});
test.after(async () => { await db?.close(); });

test("AR-03: a receipt retry key is bound to its amount, date, method, reference and notes", async () => {
  const retryKey = key();
  const date = await today();
  const base = { amount: 100, payment_date: date, payment_method: "bank_transfer", reference_number: "UTR-1", notes: "Part receipt", idempotency_key: retryKey };
  const first = await receipt(invoiceOverdue, base);
  const replay = await receipt(invoiceOverdue, base);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.payment_id, first.payment_id);
  for (const change of [{ amount: 150 }, { payment_date: "2026-02-01" }, { payment_method: "cash" }, { reference_number: "UTR-2" }, { notes: "Changed" }]) {
    await assert.rejects(receipt(invoiceOverdue, { ...base, ...change }), /different details/, JSON.stringify(change));
  }
  assert.equal(Number((await invoice(invoiceOverdue)).amount_paid), 100, "a changed retry never reports success over the old receipt");
});

test("AR-04: a partial receipt on a past-due invoice keeps it overdue", async () => {
  const row = await invoice(invoiceOverdue);
  assert.equal(row.status, "overdue");
  assert.equal(Number(row.balance_due), 900);
  await receipt(invoiceOverdue, { amount: 900, payment_date: await today(), payment_method: "cash", idempotency_key: key() });
  assert.equal((await invoice(invoiceOverdue)).status, "paid");
  assert.equal((await db.query("select private.invoice_live_status('sent', 10, '2026-01-01') as s")).rows[0].s, "overdue");
  assert.equal((await db.query("select private.invoice_live_status('partially_paid', 10, '2999-01-01') as s")).rows[0].s, "partially_paid");
  assert.equal((await db.query("select private.invoice_live_status('generated', 10, '2026-01-01') as s")).rows[0].s, "generated");
  assert.equal((await db.query("select private.invoice_live_status('sent', 10, current_date, current_date) as s")).rows[0].s, "sent");
});

test("AR-10: receipt dates are validated against the Asia/Kolkata business date in any session timezone", async () => {
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
    await db.exec(`set timezone = '${zone}'`);
    const ist = await today();
    const tomorrow = (await db.query("select (private.business_today() + 1)::text as d")).rows[0].d;
    await assert.rejects(receipt(invoiceReturned, { amount: 1, payment_date: tomorrow, payment_method: "cash", idempotency_key: key() }), /future/);
    assert.equal(ist, (await db.query("select (now() at time zone 'Asia/Kolkata')::date::text as d")).rows[0].d);
  }
  await db.exec("reset timezone");
  const source = migrationText("20261020020000_receivables_integrity.sql");
  const writer = source.slice(source.indexOf("create or replace function private.record_payment_atomic"), source.indexOf("-- Customer refunds"));
  assert.doesNotMatch(writer, /current_date/);
});

test("AR-02: customer refunds clear credit due and cannot exceed it or orphan a receipt reversal", async () => {
  const cash = await receipt(invoiceReturned, { amount: 100, payment_date: await today(), payment_method: "cash", idempotency_key: key() });
  const creditNote = await rpc(accounts, "issue_dispatch_return_credit_note_atomic", [dispatchReturned, "Complete dispatch returned damaged", key()]);
  let row = await invoice(invoiceReturned);
  assert.equal(Number(row.customer_credit_due), 100);
  assert.equal(row.status, "credited");
  const refundKey = key();
  const refundPayload = { amount: 60, refund_date: await today(), payment_method: "bank_transfer", reference_number: "NEFT-REF-1",
    notes: "Refund for returned dispatch", credit_note_id: creditNote };
  await assert.rejects(rpc(accounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify({ ...refundPayload, amount: 150 }), key()]), /exceeds the customer credit due/);
  await assert.rejects(rpc(accounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify({ ...refundPayload, reference_number: "" }), key()]), /Reference number is required/);
  await assert.rejects(rpc(accounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify({ ...refundPayload, payment_method: "credit_note" }), key()]), /how the refund was paid/);
  await assert.rejects(rpc(accounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify({ ...refundPayload, notes: "x" }), key()]), /refund reason/);
  await assert.rejects(rpc(salesManager, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify(refundPayload), key()]), /Permission denied/);
  await assert.rejects(rpc(otherAccounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify(refundPayload), key()]), /not found/);
  const refund = await rpc(accounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify(refundPayload), refundKey]);
  assert.equal(Number(refund.customer_credit_due), 40);
  assert.equal((await rpc(accounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify(refundPayload), refundKey])).idempotent_replay, true);
  await assert.rejects(rpc(accounts, "record_customer_refund_atomic", [invoiceReturned, JSON.stringify({ ...refundPayload, amount: 61 }), refundKey]), /different refund details/);
  row = await invoice(invoiceReturned);
  assert.deepEqual([Number(row.amount_paid), Number(row.credited_amount), Number(row.balance_due)], [40, 100, 0]);
  await assert.rejects(rpc(accounts, "reverse_payment_atomic", [cash.payment_id, "Cheque bounced at bank", key()]), /refunds would exceed posted receipts/);
  await rpc(accounts, "reverse_payment_atomic", [refund.payment_id, "Refund transfer failed", key()]);
  assert.equal(Number((await invoice(invoiceReturned)).customer_credit_due), 100);
  const events = (await db.query("select payment_type, payment_status, related_credit_note_id from public.payments where id = $1", [refund.payment_id])).rows[0];
  assert.deepEqual(events, { payment_type: "REFUND", payment_status: "CANCELLED", related_credit_note_id: creditNote });
});

test("AR-01: a credit note and a standalone adjustment still cannot settle the same invoice", async () => {
  const adjustment = await rpc(accounts, "record_payment_atomic", [invoiceOverdue, JSON.stringify({ amount: 1, payment_method: "credit_note", payment_date: await today(), idempotency_key: key() })]).catch((error) => error);
  assert.ok(adjustment instanceof Error, "a paid invoice accepts no further adjustment");
  const review = (await as(accounts, "select invoice_id, issue from public.invoice_settlement_review")).rows;
  assert.ok(review.some((row) => row.invoice_id === invoiceConflict && row.issue === "credit_note_and_adjustment"));
  assert.ok(review.some((row) => row.invoice_id === invoiceReturned && row.issue === "customer_credit_due"));
  assert.equal((await as(salesManager, "select count(*)::int as n from public.invoice_settlement_review")).rows[0].n, 0);
});

test("AR-09: one active invoice per dispatch is enforced on create, edit and reactivation", async () => {
  await assert.rejects(db.query(`insert into public.invoices(company_id, customer_id, order_id, dispatch_id, invoice_number, grand_total, status)
    values ($1,$2,$3,$4,'INV-DUP',10,'generated')`, [company, customer, order, dispatchOpen]), /already has an active invoice/);
  const spare = (await db.query(`insert into public.invoices(company_id, customer_id, order_id, dispatch_id, invoice_number, grand_total, status)
    values ($1,$2,$3,$4,'INV-SPARE',10,'generated') returning id`, [company, customer, order, dispatchSpare])).rows[0].id;
  await assert.rejects(db.query("update public.invoices set dispatch_id = $1 where id = $2", [dispatchOpen, spare]), /already has an active invoice/);
  await db.query("update public.invoices set status = 'cancelled' where id = $1", [spare]);
  const replacement = (await db.query(`insert into public.invoices(company_id, customer_id, order_id, dispatch_id, invoice_number, grand_total, status)
    values ($1,$2,$3,$4,'INV-SPARE-2',10,'generated') returning id`, [company, customer, order, dispatchSpare])).rows[0].id;
  assert.ok(replacement);
  await assert.rejects(db.query("update public.invoices set status = 'generated' where id = $1", [spare]), /already has an active invoice/);
  const index = (await db.query("select indexname from pg_indexes where indexname = 'invoices_company_dispatch_active_unique'")).rows;
  assert.equal(index.length, 1, "the unique index is installed when no legacy duplicates exist");
});

test("SEC-01: sales managers cannot read invoice headers directly; finance users read a live-status projection", async () => {
  assert.equal((await as(salesManager, "select count(*)::int as n from public.invoices")).rows[0].n, 0);
  assert.equal((await as(salesManager, "select count(*)::int as n from public.invoices_authorized")).rows[0].n, 0);
  assert.ok((await as(accounts, "select count(*)::int as n from public.invoices")).rows[0].n >= 3);
  assert.equal((await as(otherAccounts, "select count(*)::int as n from public.invoices_authorized")).rows[0].n, 0);
  const projected = (await as(accounts, "select status, stored_status from public.invoices_authorized where id = $1", [invoiceOverdue])).rows[0];
  assert.equal(projected.status, "paid");
});
