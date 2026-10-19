import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), otherCompany = id(2), actor = id(3), otherActor = id(4);
const invoice = id(20), dispatch = id(30), customer = id(10), order = id(15);
const candidateFile = "20261015020000_credit_settlement_exclusivity.sql";
const candidateUrl = new URL(`../supabase/migrations/${candidateFile}`, import.meta.url);
let db;

async function attempt(callback) {
  await db.exec("savepoint settlement_attempt;");
  try {
    const result = await callback();
    await db.exec("release savepoint settlement_attempt;");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint settlement_attempt;release savepoint settlement_attempt;");
    throw error;
  }
}
async function payment(amount, method = "cash", key = id(100), invoiceId = invoice) {
  return attempt(async () => (await db.query("select public.record_payment_atomic($1,$2::jsonb) data", [invoiceId,
    JSON.stringify({ amount, payment_method: method, payment_date: "2026-01-01", idempotency_key: key })])).rows[0].data);
}
async function issue(key = id(200), dispatchId = dispatch) {
  return attempt(async () => (await db.query("select public.issue_dispatch_return_credit_note_atomic($1,$2,$3) id",
    [dispatchId, "Verified customer return", key])).rows[0].id);
}
async function reversePayment(paymentId, key = id(300)) {
  return attempt(async () => (await db.query("select public.reverse_payment_atomic($1,$2,$3) data",
    [paymentId, "Replace the standalone adjustment with its return document", key])).rows[0].data);
}
async function balances(invoiceId = invoice) {
  const row = (await privileged(() => db.query("select amount_paid,credited_amount,balance_due,customer_credit_due,status from invoices where id=$1", [invoiceId]))).rows[0];
  return { ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== "status").map(([key, value]) => [key, Number(value)])), status: row.status };
}
async function privileged(callback) {
  await db.exec("reset role;");
  try { return await attempt(callback); }
  finally { await db.exec("set role authenticated;"); }
}

test.before(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean);
    create function private.get_current_user_company_id() returns uuid language sql security definer as
      $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql security definer as
      $$select role from app_users where id=auth.uid() and is_active$$;
    create sequence credit_number;
    create function private.next_business_number_locked(regclass,text,uuid,text,date) returns text
      language sql as $$select 'FIXTURE-CN-'||nextval('credit_number')::text$$;
    create table customers(id uuid primary key,company_id uuid);
    create table orders(id uuid primary key,company_id uuid,customer_id uuid,dealer_id uuid);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid,delivery_status text);
    create table invoices(id uuid primary key,company_id uuid,customer_id uuid,order_id uuid,branch_id uuid,
      dispatch_id uuid,invoice_number text,subtotal numeric(14,2),tax_total numeric(14,2),grand_total numeric(14,2),
      amount_paid numeric(14,2) default 0,credited_amount numeric(14,2) default 0,
      balance_due numeric(14,2) generated always as (greatest(grand_total-amount_paid-credited_amount,0)) stored,
      customer_credit_due numeric(14,2) generated always as (greatest(amount_paid+credited_amount-grand_total,0)) stored,
      status text,due_date date,paid_date date,updated_at timestamptz);
    create table invoice_items(id uuid primary key,company_id uuid,invoice_id uuid,line_total numeric(14,2));
    create table payments(id uuid primary key default gen_random_uuid(),company_id uuid,invoice_id uuid,
      order_id uuid,branch_id uuid,dealership_id uuid,payment_date date,amount numeric(14,2),
      payment_method text,payment_type text,payment_status text,reference_number text,notes text,
      recorded_by_user_id uuid,idempotency_key uuid,created_at timestamptz,updated_at timestamptz,
      reversed_at timestamptz,reversed_by uuid,reversal_reason text,reversal_idempotency_key uuid,
      unique(company_id,idempotency_key));
    create table credit_notes(id uuid primary key default gen_random_uuid(),company_id uuid,invoice_id uuid,
      dispatch_id uuid,credit_note_number text,credit_date date,reason text,subtotal numeric(14,2),tax_total numeric(14,2),
      grand_total numeric(14,2),status text default 'issued',item_snapshot jsonb,idempotency_key uuid,
      reversed_at timestamptz,reversed_by uuid,reversal_reason text,created_by uuid,
      created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,idempotency_key));
    create unique index one_active_credit on credit_notes(company_id,dispatch_id) where status='issued';
    create table audit_logs(company_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata_json jsonb);
    insert into app_users values('${actor}','${company}','accounts',true),('${otherActor}','${otherCompany}','accounts',true);
    insert into customers values('${customer}','${company}'),('${id(11)}','${otherCompany}');
    insert into orders values('${order}','${company}','${customer}',null),('${id(16)}','${otherCompany}','${id(11)}',null);
    insert into dispatches values('${dispatch}','${company}','${order}','returned'),
      ('${id(31)}','${company}','${order}','returned'),('${id(32)}','${otherCompany}','${id(16)}','returned'),
      ('${id(96)}','${company}','${order}','returned');
    insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,subtotal,tax_total,grand_total,status) values
      ('${invoice}','${company}','${customer}','${order}','${dispatch}','INV-001',80,20,100,'sent'),
      ('${id(21)}','${company}','${customer}','${order}','${id(31)}','INV-002',80,20,100,'sent'),
      ('${id(22)}','${otherCompany}','${id(11)}','${id(16)}','${id(32)}','OTHER-001',80,20,100,'sent');
    insert into invoice_items values('${id(40)}','${company}','${invoice}',80);
    -- An intentionally inconsistent historical record predates the proposed guard.
    insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,subtotal,tax_total,grand_total,amount_paid,credited_amount,status)
      values('${id(90)}','${company}','${customer}','${order}','${id(96)}','HISTORICAL-CONFLICT',80,20,100,50,100,'credited');
    insert into payments(id,company_id,invoice_id,payment_date,amount,payment_method,payment_type,payment_status,idempotency_key) values
      ('${id(91)}','${company}','${id(90)}','2026-01-01',30,'credit_note','ADJUSTMENT','PAID','${id(92)}'),
      ('${id(93)}','${company}','${id(90)}','2025-01-01',20,'cash','PARTIAL_PAYMENT','PAID','${id(94)}');
    insert into credit_notes(id,company_id,invoice_id,dispatch_id,credit_note_number,reason,grand_total,status,idempotency_key)
      values('${id(95)}','${company}','${id(90)}','${id(96)}','HISTORICAL-CN','Verified customer return',100,'issued','${id(97)}');`);
  await db.exec(sqlDefinition("20260929000000_business_logic_fixes.sql", "private.recalculate_invoice_collection_state"));
  for (const name of ["private.record_payment_atomic", "public.record_payment_atomic", "private.reverse_payment_atomic", "public.reverse_payment_atomic"]) {
    await db.exec(sqlDefinition("20260718010000_financial_closure.sql", name));
  }
  for (const name of ["private.issue_dispatch_return_credit_note_atomic", "private.reverse_credit_note_atomic"]) {
    await db.exec(sqlDefinition("20260723070000_dispatch_return_credit_notes.sql", name));
  }
  await db.exec(sqlDefinition("20261015030000_credit_note_retry_binding.sql", "private.issue_dispatch_return_credit_note_atomic"));
  for (const name of ["public.issue_dispatch_return_credit_note_atomic", "public.reverse_credit_note_atomic"]) {
    await db.exec(sqlDefinition("20261008020000_factory_workflow_integrity.sql", name));
  }
  for (const name of ["private.get_financial_collection_events", "public.get_financial_collection_events"]) {
    await db.exec(sqlDefinition("20260718010100_financial_collection_analytics.sql", name));
  }
  // Install extracted candidate objects only, without replaying its migration or connecting to Supabase.
  const candidate = readFileSync(candidateUrl, "utf8");
  await db.exec(sqlDefinition(candidateFile, "private.enforce_invoice_credit_settlement_exclusivity"));
  for (const statement of candidate.match(/(?:create trigger|revoke)[^;]+;/gi) ?? []) await db.exec(statement);
  await db.exec(`revoke all on function private.record_payment_atomic(uuid,jsonb) from public,anon,authenticated;
    revoke all on function private.reverse_payment_atomic(uuid,text,uuid) from public,anon,authenticated;
    revoke all on function private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public,anon,authenticated;
    revoke all on function private.reverse_credit_note_atomic(uuid,text) from public,anon,authenticated;
    revoke all on function private.recalculate_invoice_collection_state(uuid,uuid) from public,anon,authenticated;
    revoke all on function public.record_payment_atomic(uuid,jsonb) from public,anon;
    revoke all on function public.reverse_payment_atomic(uuid,text,uuid) from public,anon;
    revoke all on function public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public,anon;
    revoke all on function public.reverse_credit_note_atomic(uuid,text) from public,anon;
    grant execute on function public.record_payment_atomic(uuid,jsonb),public.reverse_payment_atomic(uuid,text,uuid),
      public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid),public.reverse_credit_note_atomic(uuid,text),
      public.get_financial_collection_events(date) to authenticated;`);
});
test.after(async () => { if (db) await db.close(); });
test.beforeEach(async () => {
  await db.exec("reset role;begin;");
  await db.query("select set_config('test.actor',$1,true)", [actor]);
  await db.exec("set role authenticated;");
});
test.afterEach(async () => { await db.exec("rollback;reset role;"); });

test("a posted standalone credit adjustment cannot be credited again by a full return document", async t => {
  await payment(100, "credit_note");
  assert.equal((await balances()).customer_credit_due, 0);
  await assert.rejects(async () => {
    await issue();
    t.diagnostic(`Unexpected duplicate settlement: ${JSON.stringify(await balances())}`);
  }, /Reverse the standalone credit adjustment/);
  assert.deepEqual(await balances(), { amount_paid: 100, credited_amount: 0, balance_due: 0, customer_credit_due: 0, status: "paid" });
  assert.equal((await privileged(() => db.query("select count(*)::int n from credit_notes where invoice_id=$1", [invoice]))).rows[0].n, 0);
});

test("reversing the standalone adjustment permits one return credit and only actual cash becomes refundable", async t => {
  const receipt = await payment(20);
  const adjustment = await payment(30, "credit_note", id(101));
  await assert.rejects(async () => {
    await issue();
    t.diagnostic(`Unexpected mixed settlement: ${JSON.stringify(await balances())}`);
  }, /Reverse the standalone credit adjustment/);
  const reversal = await reversePayment(adjustment.payment_id);
  assert.equal(reversal.idempotent_replay, false);
  assert.equal((await reversePayment(adjustment.payment_id)).idempotent_replay, true);
  const note = await issue();
  assert.equal(await issue(), note);
  assert.deepEqual(await balances(), { amount_paid: 20, credited_amount: 100, balance_due: 0, customer_credit_due: 20, status: "credited" });
  const collections = (await db.query("select * from public.get_financial_collection_events('2026-01-01')")).rows;
  assert.deepEqual(collections.map(row => [row.event_id, Number(row.amount)]), [[receipt.payment_id, 20]]);
  assert.equal((await privileged(() => db.query("select count(*)::int n from audit_logs where entity_id=$1", [note]))).rows[0].n, 1);
});

test("both database ledgers reject conflicting inserts even outside the public receipt and return wrappers", async () => {
  await payment(25, "credit_note");
  await assert.rejects(privileged(() => db.query(`insert into credit_notes(company_id,invoice_id,dispatch_id,
    grand_total,status,idempotency_key) values($1,$2,$3,100,'issued',$4)`, [company, invoice, dispatch, id(201)])), /Reverse the standalone credit adjustment/);
  await privileged(() => db.query("update payments set payment_status='CANCELLED' where invoice_id=$1", [invoice]));
  await issue();
  await assert.rejects(privileged(() => db.query(`insert into payments(company_id,invoice_id,amount,payment_method,payment_type,payment_status)
    values($1,$2,25,'credit_note','ADJUSTMENT','PAID')`, [company, invoice])), /issued credit note/);
});

test("activating a pending adjustment or restoring a reversed note cannot bypass the invariant", async () => {
  const note = await issue();
  const pending = await privileged(async () => (await db.query(`insert into payments(company_id,invoice_id,amount,
    payment_method,payment_type,payment_status) values($1,$2,10,'credit_note','ADJUSTMENT','PENDING') returning id`, [company, invoice])).rows[0].id);
  await assert.rejects(privileged(() => db.query("update payments set payment_status='PAID' where id=$1", [pending])), /issued credit note/);
  await db.query("select public.reverse_credit_note_atomic($1,$2)", [note, "Correction of the issued return document"]);
  await payment(10, "credit_note");
  await assert.rejects(privileged(() => db.query("update credit_notes set status='issued' where id=$1", [note])), /Reverse the standalone credit adjustment/);
});

test("cancelled and pending adjustments do not block issuance, while both non-cash discriminators are protected", async () => {
  await privileged(() => db.query(`insert into payments(company_id,invoice_id,amount,payment_method,payment_type,payment_status)
    values($1,$2,25,'credit_note','ADJUSTMENT','CANCELLED'),($1,$2,25,'credit_note','ADJUSTMENT','PENDING')`, [company, invoice]));
  const note = await issue();
  for (const [method, type] of [["credit_note", "PARTIAL_PAYMENT"], ["other", "ADJUSTMENT"]]) {
    await assert.rejects(privileged(() => db.query(`insert into payments(company_id,invoice_id,amount,payment_method,payment_type,payment_status)
      values($1,$2,10,$3,$4,'PAID')`, [company, invoice, method, type])), /issued credit note/);
  }
  assert.equal(await issue(), note);
});

test("cash receipt, legitimate cash refund and credit reversal retain their original accounting behavior", async () => {
  await payment(100);
  const note = await issue();
  assert.equal((await balances()).customer_credit_due, 100);
  await privileged(() => db.query(`insert into payments(company_id,invoice_id,payment_date,amount,payment_method,payment_type,payment_status)
    values($1,$2,'2026-01-01',40,'cash','REFUND','PAID')`, [company, invoice]));
  await privileged(() => db.query("select private.recalculate_invoice_collection_state($1,$2)", [invoice, company]));
  assert.equal((await balances()).customer_credit_due, 60);
  const events = (await db.query("select * from public.get_financial_collection_events(null)")).rows;
  assert.equal(events.reduce((sum, row) => sum + Number(row.amount), 0), 80); // Includes the historical 20 cash receipt.
  await db.query("select public.reverse_credit_note_atomic($1,$2)", [note, "Correction of the issued return document"]);
  assert.equal((await balances()).balance_due, 40);
  await payment(10, "credit_note", id(102));
  assert.equal((await balances()).balance_due, 30);
});

test("unrelated invoices and companies do not conflict, and caller-supplied company cannot bypass the guard", async () => {
  await payment(100, "credit_note", id(101), id(21));
  await db.query("select set_config('test.actor',$1,true)", [otherActor]);
  await payment(100, "credit_note", id(101), id(22));
  await db.query("select set_config('test.actor',$1,true)", [actor]);
  await issue();
  assert.equal((await balances()).credited_amount, 100);
  await assert.rejects(privileged(() => db.query(`insert into payments(company_id,invoice_id,amount,payment_method,payment_type,payment_status)
    values($1,$2,10,'credit_note','ADJUSTMENT','PAID')`, [otherCompany, invoice])), /Invoice not found for this company/);
});

test("authorization and private function execute boundaries remain intact", async () => {
  for (const role of ["owner", "admin", "accounts"]) {
    await privileged(() => db.query("update app_users set role=$1 where id=$2", [role, actor]));
    const row = await payment(1, "cash", id(110 + ["owner", "admin", "accounts"].indexOf(role)));
    assert.equal(row.idempotent_replay, false);
  }
  for (const role of ["viewer", "sales", "production", "dispatch", "dealer_staff"]) {
    await privileged(() => db.query("update app_users set role=$1 where id=$2", [role, actor]));
    await assert.rejects(payment(1), /Permission denied/);
    await assert.rejects(issue(), /Permission denied/);
  }
  await privileged(() => db.query("update app_users set is_active=false where id=$1", [actor]));
  await assert.rejects(issue(), /Authentication required/);
});

test("historical conflicts remain unchanged, are auditable, and existing retries and reversals remain reachable", async () => {
  assert.deepEqual(await balances(id(90)), { amount_paid: 50, credited_amount: 100, balance_due: 0, customer_credit_due: 50, status: "credited" });
  const replay = await payment(30, "credit_note", id(92), id(90));
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.payment_id, id(91));
  assert.equal(await issue(id(97), id(96)), id(95));
  const auditUrl = new URL("../sql/audit-credit-settlement-conflicts.sql", import.meta.url);
  const conflicts = await privileged(() => db.query(readFileSync(auditUrl, "utf8")));
  assert.equal(conflicts.rows.length, 1);
  assert.equal(conflicts.rows[0].invoice_id, id(90));
  assert.equal(Number(conflicts.rows[0].cash_only_customer_credit_due), 20);
  assert.equal(Number(conflicts.rows[0].recorded_customer_credit_due), 50);
  await reversePayment(id(91));
  assert.equal((await balances(id(90))).customer_credit_due, 20);
  await assert.rejects(privileged(() => db.query(`insert into payments(company_id,invoice_id,amount,payment_method,payment_type,payment_status)
    values($1,$2,1,'credit_note','ADJUSTMENT','PAID')`, [company, id(90)])), /issued credit note/);
});

test("historical metadata can be retained but changing its conflicted settlement amounts is rejected", async () => {
  const original = await balances(id(90));
  await privileged(() => db.query("update payments set notes='Reviewed historical adjustment' where id=$1", [id(91)]));
  await privileged(() => db.query("update credit_notes set reason='Reviewed historical return document' where id=$1", [id(95)]));
  assert.deepEqual(await balances(id(90)), original);
  await assert.rejects(privileged(() => db.query("update payments set amount=31 where id=$1", [id(91)])), /issued credit note/);
  await assert.rejects(privileged(() => db.query("update credit_notes set grand_total=101 where id=$1", [id(95)])), /Reverse the standalone credit adjustment/);
  assert.deepEqual(await balances(id(90)), original);
});

test("the historical audit executes read-only and the guard is private with both triggers enabled", async () => {
  await db.exec("rollback;reset role;begin read only;");
  const result = await db.query(readFileSync(new URL("../sql/audit-credit-settlement-conflicts.sql", import.meta.url), "utf8"));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].invoice_id, id(90));
  const acl = (await db.query(`select
    has_function_privilege('authenticated','private.enforce_invoice_credit_settlement_exclusivity()','EXECUTE') direct_guard,
    has_function_privilege('anon','private.enforce_invoice_credit_settlement_exclusivity()','EXECUTE') anonymous_guard,
    has_function_privilege('anon','public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid)','EXECUTE') anonymous_issue`)).rows[0];
  assert.deepEqual(acl, { direct_guard: false, anonymous_guard: false, anonymous_issue: false });
  assert.equal((await db.query(`select count(*)::int n from pg_trigger
    where tgfoid='private.enforce_invoice_credit_settlement_exclusivity()'::regprocedure and tgenabled='O' and not tgisinternal`)).rows[0].n, 2);
  const preflight = readFileSync(new URL("../sql/audit-deployment-preflight.sql", import.meta.url), "utf8")
    .split("-- Credit settlement guards are private triggers and cannot be verified through REST RPC discovery.")[1]
    .split(";")[0];
  assert.ok(preflight);
  const catalog = (await db.query(preflight)).rows;
  assert.equal(catalog.length, 2);
  assert.ok(catalog.every(row => row.attached && row.enabled && row.security_definer
    && row.authenticated_execute === false && row.anonymous_execute === false));
});
