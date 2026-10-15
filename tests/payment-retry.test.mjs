import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), invoiceId = id(2), paymentId = id(3), key = id(4);
let state;
const input = () => ({ invoice_id: invoiceId, payment_date: "2026-10-15", amount: 100,
  payment_method: "cash", idempotency_key: key });

class NextResponse extends Response {
  static json(body, init) {
    return new NextResponse(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } });
  }
}

const originalLoad = Module._load;
let actions, route;
Module._load = function (request, parent, isMain) {
  if (request === "next/cache") return { revalidatePath: path => state.paths.push(path) };
  if (request === "next/server") return { NextResponse };
  if (request === "@/lib/auth") return { getSessionContext: async () => {
    if (state.authError) throw state.authError;
    return { companyId: company, role: state.role };
  } };
  if (request === "@/lib/supabase/server") return { createClient: async () => ({
    from(table) {
      const query = { table, filters: [] };
      state.queries.push(query);
      return {
        select() { return this; },
        eq(column, value) { query.filters.push([column, value]); return this; },
        async maybeSingle() { return state.readInvoice ? state.readInvoice(query) : state.invoiceResult; }
      };
    },
    async rpc(name, args) { state.calls.push({ name, args }); return state.rpcHandler ? state.rpcHandler(name, args) : state.rpcResult; }
  }) };
  if (request === "@/lib/actions/payments" && actions) return actions;
  return originalLoad(request, parent, isMain);
};
try {
  actions = require("../lib/actions/payments.ts");
  route = require("../app/api/payments/route.ts");
} finally {
  Module._load = originalLoad;
}

function reset() {
  state = {
    role: "accounts", queries: [], calls: [], paths: [], authError: null,
    invoiceResult: { data: { id: invoiceId, status: "paid", balance_due: 0 }, error: null },
    rpcResult: { data: { payment_id: paymentId, invoice_id: invoiceId, amount_paid: 100,
      balance_due: 0, invoice_status: "paid", idempotent_replay: true }, error: null }
  };
}

test("a receipt retry still reaches the idempotent RPC after its invoice is fully paid", async () => {
  reset();
  const result = await actions.recordPaymentAction(input());
  assert.deepEqual(result, { success: true, data: state.rpcResult.data });
  assert.deepEqual(state.calls, [{ name: "record_payment_atomic", args: {
    p_invoice_id: invoiceId, p_payment: { payment_date: "2026-10-15", amount: 100,
      payment_method: "cash", reference_number: null, notes: null, idempotency_key: key }
  } }]);
  assert.ok(state.paths.includes(`/payments/${paymentId}`));
  assert.ok(state.paths.includes(`/invoices/${invoiceId}`));
});

test("a partial-payment retry is not rejected because the current balance is less than the original receipt", async () => {
  reset();
  state.invoiceResult.data = { id: invoiceId, status: "partially_paid", balance_due: 20 };
  state.rpcResult.data = { ...state.rpcResult.data, balance_due: 20, invoice_status: "partially_paid" };
  const result = await actions.recordPaymentAction(input());
  assert.equal(result.success, true);
  assert.equal(result.data.idempotent_replay, true);
  assert.equal(result.data.balance_due, 20);
  assert.equal(state.calls.length, 1);
});

test("the payments API honors the original header idempotency key after settlement", async () => {
  reset();
  const { idempotency_key: idempotencyKey, ...body } = input();
  const response = await route.POST(new Request("http://localhost/api/payments", {
    method: "POST", headers: { "Content-Type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body)
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { payment: state.rpcResult.data });
  assert.equal(state.calls[0].args.p_payment.idempotency_key, key);
});

test("new payments still return the atomic status, balance, date, reference and key-conflict rejections", async () => {
  for (const message of [
    "Payments can only be posted to an issued, unpaid invoice",
    "Payment amount exceeds the outstanding invoice balance",
    "Payment date cannot be in the future",
    "Reference number is required for bank, UPI, and cheque receipts",
    "The idempotency key is already assigned to another invoice"
  ]) {
    reset();
    state.rpcResult = { data: null, error: new Error(message) };
    assert.deepEqual(await actions.recordPaymentAction(input()), { success: false, error: message });
    assert.equal(state.calls.length, 1);
    assert.deepEqual(state.paths, []);
  }
});

test("a successful new receipt and credit adjustment still use one atomic call and preserve their payment method", async () => {
  for (const method of ["cash", "credit_note"]) {
    reset();
    state.invoiceResult.data = { id: invoiceId, status: "sent", balance_due: 100 };
    state.rpcResult.data.idempotent_replay = false;
    const result = await actions.recordPaymentAction({ ...input(), payment_method: method, company_id: id(99) });
    assert.equal(result.success, true);
    assert.equal(result.data.idempotent_replay, false);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].args.p_payment.payment_method, method);
    assert.equal(state.calls[0].args.p_payment.company_id, undefined);
    assert.deepEqual(state.queries, [{ table: "invoices", filters: [["company_id", company], ["id", invoiceId]] }]);
  }
});

test("missing, foreign or unavailable invoices do not reach the receipt write boundary", async () => {
  for (const result of [{ data: null, error: null }, { data: null, error: new Error("Invoice lookup unavailable") }]) {
    reset();
    state.invoiceResult = result;
    assert.equal((await actions.recordPaymentAction(input())).success, false);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.paths, []);
    assert.ok(state.queries[0].filters.some(([column, value]) => column === "company_id" && value === company));
  }
});

test("invalid amounts, identities and idempotency keys reject before accessing financial data", async () => {
  for (const patch of [{ amount: 0 }, { amount: -1 }, { amount: Infinity }, { invoice_id: "invalid" },
    { idempotency_key: "invalid" }, { idempotency_key: undefined }, { payment_method: "invalid" }]) {
    reset();
    assert.equal((await actions.recordPaymentAction({ ...input(), ...patch })).success, false);
    assert.deepEqual(state.queries, []);
    assert.deepEqual(state.calls, []);
  }
});

test("unauthenticated and unauthorized roles cannot reach invoice reads or payment RPCs", async () => {
  for (const role of ["viewer", "production", "dispatch", "dealer_staff"]) {
    reset();
    state.role = role;
    assert.equal((await actions.recordPaymentAction(input())).success, false, role);
    assert.deepEqual(state.queries, []);
    assert.deepEqual(state.calls, []);
  }
  reset();
  state.authError = new Error("Authentication required");
  assert.equal((await actions.recordPaymentAction(input())).success, false);
  assert.deepEqual(state.queries, []);
  assert.deepEqual(state.calls, []);
});

test("actual payment transaction preserves one receipt and audit on replay, rejecting new invalid payments", async () => {
  reset();
  const db = new PGlite();
  try {
    // Only the relevant existing function bodies run here, without replaying migrations or installing RLS.
    await db.exec(`create schema auth; create schema private;
      create function auth.uid() returns uuid language sql as $$select '${id(6)}'::uuid$$;
      create function private.get_current_user_company_id() returns uuid language sql as $$select '${company}'::uuid$$;
      create function private.get_current_user_role() returns text language sql as $$select current_setting('test.role')$$;
      set test.role='accounts';
      create table customers(id uuid primary key, company_id uuid);
      create table orders(id uuid primary key, company_id uuid, customer_id uuid, dealer_id uuid);
      create table dispatches(id uuid primary key, company_id uuid, order_id uuid);
      create table invoices(id uuid primary key, company_id uuid, customer_id uuid, order_id uuid, branch_id uuid,
        dispatch_id uuid, grand_total numeric(14,2), amount_paid numeric(14,2) default 0,
        credited_amount numeric(14,2) default 0,
        balance_due numeric(14,2) generated always as (greatest(grand_total-amount_paid-credited_amount,0)) stored,
        status text, due_date date, paid_date date, updated_at timestamptz);
      create table payments(id uuid primary key default gen_random_uuid(), company_id uuid, invoice_id uuid,
        order_id uuid, branch_id uuid, dealership_id uuid, payment_date date, amount numeric(14,2),
        payment_method text, payment_type text, payment_status text, reference_number text, notes text,
        recorded_by_user_id uuid, idempotency_key uuid, created_at timestamptz, updated_at timestamptz,
        unique(company_id,idempotency_key));
      create table audit_logs(id uuid primary key default gen_random_uuid(), company_id uuid, actor_id uuid,
        action text, entity_type text, entity_id uuid, metadata_json jsonb);
      insert into customers values('${id(7)}','${company}');
      insert into invoices(id,company_id,customer_id,grand_total,status) values
        ('${invoiceId}','${company}','${id(7)}',100,'sent'),
        ('${id(20)}','${company}','${id(7)}',150,'sent'),
        ('${id(30)}','${company}','${id(7)}',100,'draft'),
        ('${id(31)}','${company}','${id(7)}',100,'sent');`);
    await db.exec(sqlDefinition("20260929000000_business_logic_fixes.sql", "private.recalculate_invoice_collection_state"));
    for (const name of ["private.record_payment_atomic", "public.record_payment_atomic"]) {
      await db.exec(sqlDefinition("20260718010000_financial_closure.sql", name));
    }
    state.readInvoice = async query => {
      const filters = Object.fromEntries(query.filters);
      const result = await db.query("select id,status,balance_due from invoices where company_id=$1 and id=$2", [filters.company_id, filters.id]);
      return { data: result.rows[0] ?? null, error: null };
    };
    state.rpcHandler = async (name, args) => {
      assert.equal(name, "record_payment_atomic");
      try {
        const result = await db.query("select public.record_payment_atomic($1,$2::jsonb) as result", [args.p_invoice_id, JSON.stringify(args.p_payment)]);
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    };
    const { today } = (await db.query("select current_date::text today")).rows[0];
    const post = patch => actions.recordPaymentAction({ ...input(), payment_date: today, ...patch });
    const first = await post({});
    assert.equal(first.success, true);
    assert.equal(first.data.idempotent_replay, false);
    const replay = await post({});
    assert.equal(replay.success, true);
    assert.equal(replay.data.idempotent_replay, true);
    assert.equal(replay.data.payment_id, first.data.payment_id);
    assert.deepEqual((await db.query("select (select count(*)::int from payments) receipts,(select count(*)::int from audit_logs) audits")).rows[0], { receipts: 1, audits: 1 });

    const settledNewPayment = await post({ idempotency_key: id(10) });
    assert.equal(settledNewPayment.success, false);
    assert.match(settledNewPayment.error, /issued, unpaid invoice/);
    const partial = await post({ invoice_id: id(20), idempotency_key: id(21) });
    assert.equal(partial.success, true);
    assert.equal(partial.data.balance_due, 50);
    const partialReplay = await post({ invoice_id: id(20), idempotency_key: id(21) });
    assert.equal(partialReplay.success, true);
    assert.equal(partialReplay.data.payment_id, partial.data.payment_id);
    assert.equal(partialReplay.data.idempotent_replay, true);
    const oversize = await post({ invoice_id: id(20), idempotency_key: id(22) });
    assert.equal(oversize.success, false);
    assert.match(oversize.error, /exceeds the outstanding/);
    const conflict = await post({ invoice_id: id(20), idempotency_key: key });
    assert.equal(conflict.success, false);
    assert.match(conflict.error, /another invoice/);
    const draft = await post({ invoice_id: id(30), idempotency_key: id(32) });
    assert.equal(draft.success, false);
    assert.match(draft.error, /issued, unpaid/);
    const missingReference = await post({ invoice_id: id(31), idempotency_key: id(33), payment_method: "bank_transfer" });
    assert.equal(missingReference.success, false);
    assert.match(missingReference.error, /Reference number is required/);
    const futureDate = (await db.query("select (current_date+1)::text tomorrow")).rows[0].tomorrow;
    const future = await post({ invoice_id: id(31), idempotency_key: id(34), payment_date: futureDate });
    assert.equal(future.success, false);
    assert.match(future.error, /cannot be in the future/);
    assert.deepEqual((await db.query("select (select count(*)::int from payments) receipts,(select count(*)::int from audit_logs) audits")).rows[0], { receipts: 2, audits: 2 });
    await db.exec("set test.role='viewer';");
    await assert.rejects(db.query("select public.record_payment_atomic($1,$2::jsonb)", [invoiceId, JSON.stringify({ ...input(), payment_date: today })]), /Permission denied/);
  } finally {
    await db.close();
  }
});
