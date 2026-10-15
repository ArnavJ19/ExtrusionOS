import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), sibling = id(2), actor = id(3), siblingActor = id(4);
const dispatch = id(30), invoice = id(20), key = id(100);
const reason = "Verified full transit damage return";
const candidateFile = "20261015030000_credit_note_retry_binding.sql";
const candidateUrl = new URL(`../supabase/migrations/${candidateFile}`, import.meta.url);
let db;

async function attempt(callback) {
  await db.exec("savepoint credit_attempt;");
  try {
    const result = await callback();
    await db.exec("release savepoint credit_attempt;");
    return result;
  } catch (error) {
    await db.exec("rollback to savepoint credit_attempt;release savepoint credit_attempt;");
    throw error;
  }
}
async function inspect(callback) {
  await db.exec("reset role;");
  try { return await attempt(callback); }
  finally { await db.exec("set role authenticated;"); }
}
const issue = (dispatchId = dispatch, requestKey = key, requestReason = reason) => attempt(async () =>
  (await db.query("select public.issue_dispatch_return_credit_note_atomic($1,$2,$3) id", [dispatchId, requestReason, requestKey])).rows[0].id);
const reverse = noteId => attempt(() => db.query("select public.reverse_credit_note_atomic($1,$2)", [noteId, "Correct the original return document"]));
async function snapshot() {
  return inspect(async () => ({ notes: (await db.query("select id,company_id,invoice_id,dispatch_id,reason,status,idempotency_key from credit_notes order by id")).rows,
    invoices: (await db.query("select id,amount_paid,credited_amount,balance_due,customer_credit_due,status from invoices order by id")).rows,
    audits: (await db.query("select action,entity_id from audit_logs order by action,entity_id")).rows }));
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
    create table dispatches(id uuid primary key,company_id uuid,delivery_status text);
    create table invoices(id uuid primary key,company_id uuid,invoice_number text,dispatch_id uuid,
      subtotal numeric(14,2),tax_total numeric(14,2),grand_total numeric(14,2),
      amount_paid numeric(14,2) default 0,credited_amount numeric(14,2) default 0,
      balance_due numeric(14,2) generated always as (greatest(grand_total-amount_paid-credited_amount,0)) stored,
      customer_credit_due numeric(14,2) generated always as (greatest(amount_paid+credited_amount-grand_total,0)) stored,
      status text,due_date date,paid_date date,updated_at timestamptz);
    create table invoice_items(id uuid primary key,company_id uuid,invoice_id uuid,line_total numeric(14,2));
    create table payments(company_id uuid,invoice_id uuid,amount numeric(14,2),payment_method text,payment_type text,payment_status text,payment_date date);
    create table credit_notes(id uuid primary key default gen_random_uuid(),company_id uuid,invoice_id uuid,
      dispatch_id uuid,credit_note_number text,credit_date date,reason text,subtotal numeric(14,2),tax_total numeric(14,2),
      grand_total numeric(14,2),status text default 'issued',item_snapshot jsonb,idempotency_key uuid,
      reversed_at timestamptz,reversed_by uuid,reversal_reason text,created_by uuid,
      created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,idempotency_key));
    create unique index one_active_credit on credit_notes(company_id,dispatch_id) where status='issued';
    create table audit_logs(company_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata_json jsonb);
    insert into app_users values('${actor}','${company}','accounts',true),('${siblingActor}','${sibling}','accounts',true);
    insert into dispatches values('${dispatch}','${company}','returned'),('${id(31)}','${company}','damaged'),
      ('${id(32)}','${sibling}','returned');
    insert into invoices(id,company_id,invoice_number,dispatch_id,subtotal,tax_total,grand_total,status) values
      ('${invoice}','${company}','INV-001','${dispatch}',80,20,100,'sent'),
      ('${id(21)}','${company}','INV-002','${id(31)}',80,20,100,'sent'),
      ('${id(22)}','${sibling}','OTHER-001','${id(32)}',80,20,100,'sent');
    insert into invoice_items values('${id(40)}','${company}','${invoice}',80);`);
  await db.exec(sqlDefinition("20260929000000_business_logic_fixes.sql", "private.recalculate_invoice_collection_state"));
  for (const name of ["private.issue_dispatch_return_credit_note_atomic", "private.reverse_credit_note_atomic"]) {
    await db.exec(sqlDefinition("20260723070000_dispatch_return_credit_notes.sql", name));
  }
  for (const name of ["public.issue_dispatch_return_credit_note_atomic", "public.reverse_credit_note_atomic"]) {
    await db.exec(sqlDefinition("20261008020000_factory_workflow_integrity.sql", name));
  }
  await db.exec(sqlDefinition("20261015020000_credit_settlement_exclusivity.sql", "private.enforce_invoice_credit_settlement_exclusivity"));
  for (const statement of readFileSync(new URL("../supabase/migrations/20261015020000_credit_settlement_exclusivity.sql", import.meta.url), "utf8")
    .match(/(?:create trigger|revoke)[^;]+;/gi) ?? []) await db.exec(statement);
  await db.exec(sqlDefinition(candidateFile, "private.issue_dispatch_return_credit_note_atomic"));
  for (const statement of readFileSync(candidateUrl, "utf8").match(/revoke[^;]+;/gi) ?? []) await db.exec(statement);
  await db.exec(`revoke all on function private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public,anon,authenticated;
    revoke all on function private.reverse_credit_note_atomic(uuid,text) from public,anon,authenticated;
    revoke all on function public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid) from public,anon;
    revoke all on function public.reverse_credit_note_atomic(uuid,text) from public,anon;
    grant execute on function public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid),public.reverse_credit_note_atomic(uuid,text) to authenticated;`);
});
test.after(async () => { if (db) await db.close(); });
test.beforeEach(async () => {
  await db.exec("reset role;begin;");
  await db.query("select set_config('test.actor',$1,true)", [actor]);
  await db.exec("set role authenticated;");
});
test.afterEach(async () => { await db.exec("rollback;reset role;"); });

test("an exact normalized retry returns the original note without a new posting or audit", async () => {
  const first = await issue();
  const before = await snapshot();
  assert.equal(await issue(dispatch, key, `  ${reason}  `), first);
  assert.equal(await issue(), first);
  assert.deepEqual(await snapshot(), before);
  assert.equal(before.notes.length, 1);
  assert.equal(before.audits.length, 1);
});

test("a key used for one dispatch cannot acknowledge another, foreign, unknown or null dispatch", async t => {
  const original = await issue();
  const before = await snapshot();
  for (const target of [id(31), id(32), id(9999), null]) {
    await assert.rejects(async () => {
      const returned = await issue(target);
      t.diagnostic(`Wrong target acknowledged: requested=${target}, returned_original=${returned === original}`);
    }, /already used for different credit note details/);
    assert.deepEqual(await snapshot(), before);
  }
});

test("a changed return reason cannot silently replay a document containing the old reason", async t => {
  await issue();
  const before = await snapshot();
  await assert.rejects(async () => {
    await issue(dispatch, key, "A different confirmed return reason");
    t.diagnostic(`Stored reason remained ${JSON.stringify((await snapshot()).notes[0].reason)}`);
  }, /already used for different credit note details/);
  assert.deepEqual(await snapshot(), before);
});

test("reversed-note retries retain history and corrected issuance requires a fresh key", async () => {
  const first = await issue();
  await reverse(first);
  const reversed = await snapshot();
  assert.equal(await issue(), first);
  assert.deepEqual(await snapshot(), reversed);
  await assert.rejects(issue(dispatch, key, "Corrected reason after review"), /already used for different credit note details/);
  const corrected = await issue(dispatch, id(101), "Corrected reason after review");
  assert.notEqual(corrected, first);
  const final = await snapshot();
  assert.equal(final.notes.length, 2);
  assert.equal(final.notes.filter(note => note.status === "issued").length, 1);
  assert.equal(final.audits.length, 3);
});

test("a failed credit request does not claim the key and can retry after the standalone adjustment is reversed", async () => {
  await inspect(() => db.query(`insert into payments(company_id,invoice_id,amount,payment_method,payment_type,payment_status)
    values($1,$2,10,'credit_note','ADJUSTMENT','PAID')`, [company, invoice]));
  await assert.rejects(issue(), /Reverse the standalone credit adjustment/);
  const failed = await snapshot();
  assert.equal(failed.notes.length, 0);
  assert.equal(failed.audits.length, 0);
  await inspect(() => db.query("update payments set payment_status='CANCELLED' where invoice_id=$1", [invoice]));
  const posted = await issue();
  assert.equal(await issue(), posted);
  assert.equal((await snapshot()).notes.length, 1);
});

test("retry keys remain company-scoped and foreign dispatch requests reveal no sibling note", async () => {
  const first = await issue();
  await db.query("select set_config('test.actor',$1,true)", [siblingActor]);
  const other = await issue(id(32));
  assert.notEqual(other, first);
  assert.equal(await issue(id(32)), other);
  await assert.rejects(issue(dispatch, id(102)), /Dispatch not found for this company/);
  await assert.rejects(issue(dispatch), /already used for different credit note details/);
  const rows = (await snapshot()).notes;
  assert.deepEqual(rows.map(note => note.company_id).sort(), [company, sibling]);
});

test("authorization is checked before returning an existing key and private execution remains denied", async () => {
  await issue();
  for (const role of ["viewer", "sales", "production", "dispatch", "dealer_staff", null]) {
    await inspect(() => db.query("update app_users set role=$1 where id=$2", [role, actor]));
    await assert.rejects(issue(), /Permission denied/);
  }
  await inspect(() => db.query("update app_users set is_active=false where id=$1", [actor]));
  await assert.rejects(issue(), /Authentication required/);
  const acl = (await inspect(() => db.query(`select
    has_function_privilege('authenticated','private.issue_dispatch_return_credit_note_atomic(uuid,text,uuid)','EXECUTE') direct_issue,
    has_function_privilege('anon','public.issue_dispatch_return_credit_note_atomic(uuid,text,uuid)','EXECUTE') anonymous_issue`))).rows[0];
  assert.deepEqual(acl, { direct_issue: false, anonymous_issue: false });
});

test("owner, admin and accounts retain allowed issuance and replay", async () => {
  let noteId;
  for (const role of ["owner", "admin", "accounts"]) {
    await inspect(() => db.query("update app_users set role=$1 where id=$2", [role, actor]));
    const result = await issue();
    if (noteId) assert.equal(result, noteId); else noteId = result;
  }
  assert.equal((await snapshot()).audits.length, 1);
});

test("invalid reason/key and ineligible invoice/dispatch states still reject without posting", async () => {
  const empty = await snapshot();
  await assert.rejects(issue(dispatch, null), /idempotency key is required/);
  await assert.rejects(issue(dispatch, key, null), /clear return or damage reason/);
  await assert.rejects(issue(dispatch, key, "short"), /clear return or damage reason/);
  assert.deepEqual(await snapshot(), empty);
  for (const status of ["pending", "delivered"]) {
    await inspect(() => db.query("update dispatches set delivery_status=$1 where id=$2", [status, dispatch]));
    const before = await snapshot();
    await assert.rejects(issue(), /returned or damaged dispatch/);
    assert.deepEqual(await snapshot(), before);
  }
  await inspect(() => db.query("update dispatches set delivery_status='returned' where id=$1", [dispatch]));
  for (const status of ["draft", "cancelled"]) {
    await inspect(() => db.query("update invoices set status=$1 where id=$2", [status, invoice]));
    const before = await snapshot();
    await assert.rejects(issue(), /draft invoice|No issued invoice/);
    assert.deepEqual(await snapshot(), before);
  }
});
