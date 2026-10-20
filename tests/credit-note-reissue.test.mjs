import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { sqlDefinition } from "../scripts/lib/historical-schema-fixture.mjs";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let state;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "react" && parent?.filename.replaceAll("\\", "/").endsWith("/dispatch-credit-note-client.tsx")) {
    return {
      ...React,
      useRef(initial) {
        const index = state.refIndex++;
        return state.refs[index] ??= { current: initial };
      },
      useState(initial) {
        const index = state.stateIndex++;
        if (!(index in state.values)) state.values[index] = initial;
        return [state.values[index], value => { state.values[index] = value; }];
      },
      useTransition() {
        return [state.pending, callback => { state.task = callback(); }];
      }
    };
  }
  if (request === "next/navigation") return { useRouter: () => ({ refresh() { state.refreshes++; } }) };
  if (request === "sonner") return { toast: {
    error: message => state.errors.push(message), success: message => state.successes.push(message)
  } };
  if (request === "@/lib/actions/credit-notes") return {
    issueDispatchCreditNoteAction: async input => {
      state.issues.push(input);
      if (state.issueError) throw state.issueError;
      return state.issueHandler ? state.issueHandler(input) : state.issueResult;
    },
    reverseCreditNoteAction: async input => {
      state.reversals.push(input);
      if (state.reverseError) throw state.reverseError;
      return state.reverseHandler ? state.reverseHandler(input) : state.reverseResult;
    }
  };
  return originalLoad(request, parent, isMain);
};
let Component;
try {
  Component = require("../components/modules/dispatch-credit-note-client.tsx").DispatchCreditNoteClient;
} finally {
  Module._load = originalLoad;
}

function reset() {
  state = {
    refIndex: 0, stateIndex: 0, refs: [], values: ["Corrected transit return reason", "Reverse the incorrect return credit"],
    pending: false, task: null, issues: [], reversals: [], refreshes: 0, errors: [], successes: [],
    issueResult: { success: false, error: "Receipt service unavailable" }, reverseResult: { success: true }
  };
}
const note = (status = "reversed", noteId = id(3)) => ({ id: noteId, credit_note_number: "CN-001",
  grand_total: 100, status, reason: "Original return reason", reversal_reason: "Correction required" });
const props = (patch = {}) => ({
  dispatchId: id(1), deliveryStatus: "returned", invoice: { id: id(2), invoice_number: "INV-001",
    grand_total: 100, amount_paid: 0, status: "sent" }, creditNote: null, canManage: true, ...patch
});
const textOf = node => Array.isArray(node) ? node.map(textOf).join("")
  : node && typeof node === "object" ? textOf(node.props?.children) : typeof node === "string" ? node : "";
function buttons(node, result = []) {
  if (Array.isArray(node)) { for (const child of node) buttons(child, result); }
  else if (node && typeof node === "object") {
    if (typeof node.props?.onClick === "function") result.push({ label: textOf(node), ...node.props });
    buttons(node.props?.children, result);
  }
  return result;
}
function render(input = props()) {
  state.refIndex = 0;
  state.stateIndex = 0;
  const tree = Component(input);
  const controls = buttons(tree);
  return { tree, controls, issue: controls.find(button => /Issue .*credit note/.test(button.label)),
    reverse: controls.find(button => button.label.includes("Reverse credit note")) };
}
async function click(control) {
  assert.ok(control, "Expected an available workflow action");
  assert.equal(control.disabled, false);
  control.onClick();
  await state.task;
}

test("a reversed credit note exposes a corrected issue action while retaining the original reversal evidence", () => {
  reset();
  const view = render(props({ creditNote: note() }));
  assert.ok(view.issue, "Accounts must be able to issue a corrected note after reversal");
  assert.equal(view.reverse, undefined);
  const html = renderToStaticMarkup(view.tree);
  assert.match(html, /CN-001/);
  assert.match(html, /reversed/);
  assert.match(html, /Correction required/);
});

test("initial and corrected issue retries reuse their own key after transport failure", async () => {
  for (const creditNote of [null, note()]) {
    reset();
    await click(render(props({ creditNote })).issue);
    await click(render(props({ creditNote })).issue);
    assert.equal(state.issues.length, 2);
    assert.match(state.issues[0].idempotency_key, /^[0-9a-f-]{36}$/);
    assert.deepEqual(state.issues[0], state.issues[1]);
    assert.equal(state.refreshes, 0);
    assert.equal(state.errors.length, 2);
  }
});

test("each reversed predecessor and dispatch receives a fresh key on the same mounted component", async () => {
  reset();
  await click(render().issue);
  const originalKey = state.issues[0].idempotency_key;
  state.issueResult = { success: true, creditNoteId: id(3) };
  await click(render(props({ creditNote: note("issued") })).reverse);
  assert.deepEqual(state.reversals, [{ credit_note_id: id(3), dispatch_id: id(1), reason: state.values[1] }]);
  await click(render(props({ creditNote: note() })).issue);
  const correctedKey = state.issues[1].idempotency_key;
  assert.notEqual(correctedKey, originalKey);
  await click(render(props({ creditNote: note("reversed", id(4)) })).issue);
  const secondCorrectionKey = state.issues[2].idempotency_key;
  assert.notEqual(secondCorrectionKey, correctedKey);
  await click(render(props({ dispatchId: id(5) })).issue);
  assert.notEqual(state.issues[3].idempotency_key, secondCorrectionKey);
  assert.notEqual(state.issues[3].idempotency_key, originalKey);
});

test("issued notes, unauthorized users, missing invoices and ineligible statuses have no issue action", () => {
  for (const patch of [{ creditNote: note("issued") }, { canManage: false }, { invoice: null, creditNote: note() },
    { invoice: { ...props().invoice, status: "draft" } }, { invoice: { ...props().invoice, status: "cancelled" } },
    { deliveryStatus: "delivered" }, { deliveryStatus: "pending" }, { creditNote: note("unknown") }]) {
    reset();
    assert.equal(render(props(patch)).issue, undefined, JSON.stringify(patch));
    assert.deepEqual(state.issues, []);
  }
});

test("both return and damage corrections require a clear reason and respect the pending state", () => {
  for (const deliveryStatus of ["returned", "damaged"]) {
    reset();
    state.values[0] = "short";
    assert.equal(render(props({ deliveryStatus, creditNote: note() })).issue?.disabled, true);
    state.values[0] = "Corrected return or damage reason";
    state.pending = true;
    assert.equal(render(props({ deliveryStatus, creditNote: note() })).issue?.disabled, true);
    state.pending = false;
    assert.equal(render(props({ deliveryStatus, creditNote: note() })).issue?.disabled, false);
  }
});

test("successful issue refreshes the record, and failed reversal preserves the existing issued note", async () => {
  reset();
  state.issueResult = { success: true, creditNoteId: id(4) };
  await click(render(props({ creditNote: note() })).issue);
  assert.equal(state.refreshes, 1);
  assert.equal(state.successes.length, 1);
  state.reverseResult = { success: false, error: "Reversal unavailable" };
  await click(render(props({ creditNote: note("issued", id(4)) })).reverse);
  assert.equal(state.refreshes, 1);
  assert.equal(state.errors.at(-1), "Reversal unavailable");
  assert.equal(render(props({ creditNote: note("issued", id(4)) })).issue, undefined);
});

test("thrown transport failures retain the attempt key and keep issue and reversal retryable", async () => {
  reset();
  state.issueError = new Error("Network unavailable");
  await click(render(props({ creditNote: note() })).issue);
  const originalKey = state.issues[0].idempotency_key;
  state.issueError = null;
  await click(render(props({ creditNote: note() })).issue);
  assert.equal(state.issues[1].idempotency_key, originalKey);
  assert.equal(state.refreshes, 0);
  state.reverseError = new Error("Network unavailable");
  await click(render(props({ creditNote: note("issued") })).reverse);
  assert.equal(state.refreshes, 0);
  assert.equal(state.errors.at(-1), "Network unavailable");
});

test("return credit explains adjustment reversal and a settlement conflict preserves its retry attempt", async () => {
  reset();
  const html = renderToStaticMarkup(render().tree);
  assert.match(html, /standalone credit adjustment/);
  assert.match(html, /reverse that adjustment from Payments/);
  assert.match(html, /Net receipts \/ adjustments/);
  state.issueResult = { success: false, error: "Reverse the standalone credit adjustment before issuing a return credit note for this invoice." };
  await click(render().issue);
  assert.equal(state.refreshes, 0);
  assert.match(state.errors[0], /Reverse the standalone credit adjustment/);
  state.issueResult = { success: true, creditNoteId: id(4) };
  await click(render().issue);
  assert.equal(state.issues[0].idempotency_key, state.issues[1].idempotency_key);
  assert.equal(state.refreshes, 1);
});

test("actual credit functions issue, reverse and reissue once, preserving cash and refund balances on retries", async () => {
  reset();
  const company = id(10), invoiceId = id(2), dispatchId = id(1);
  const db = new PGlite();
  try {
    // This isolated fixture installs existing function bodies; it does not apply migration scripts or Supabase RLS.
    await db.exec(`create schema auth;create schema private;
      create function auth.uid() returns uuid language sql as $$select '${id(11)}'::uuid$$;
      create function private.get_current_user_company_id() returns uuid language sql as $$select '${company}'::uuid$$;
      create function private.get_current_user_role() returns text language sql as $$select current_setting('test.role')$$;
      set test.role='accounts';
      create sequence credit_number;
      create function private.next_business_number_locked(regclass,text,uuid,text,date) returns text
        language sql as $$select 'FIXTURE-CN-'||nextval('credit_number')::text$$;
      create table dispatches(id uuid primary key,company_id uuid,delivery_status text);
      create table invoices(id uuid primary key,company_id uuid,invoice_number text,
        subtotal numeric(14,2),tax_total numeric(14,2),grand_total numeric(14,2),
        amount_paid numeric(14,2) default 0,credited_amount numeric(14,2) default 0,
        balance_due numeric(14,2) generated always as (greatest(grand_total-amount_paid-credited_amount,0)) stored,
        customer_credit_due numeric(14,2) generated always as (greatest(amount_paid+credited_amount-grand_total,0)) stored,
        dispatch_id uuid,status text,due_date date,paid_date date,updated_at timestamptz);
      create table invoice_items(id uuid primary key,company_id uuid,invoice_id uuid,line_total numeric(14,2));
      create table payments(company_id uuid,invoice_id uuid,amount numeric(14,2),payment_method text,
        payment_status text,payment_type text,payment_date date);
      create table credit_notes(id uuid primary key default gen_random_uuid(),company_id uuid,invoice_id uuid,
        dispatch_id uuid,credit_note_number text,credit_date date,reason text,subtotal numeric(14,2),tax_total numeric(14,2),
        grand_total numeric(14,2),status text default 'issued',item_snapshot jsonb,idempotency_key uuid,
        reversed_at timestamptz,reversed_by uuid,reversal_reason text,created_by uuid,
        created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,idempotency_key));
      create unique index one_active_credit on credit_notes(company_id,dispatch_id) where status='issued';
      create table audit_logs(company_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata_json jsonb);
      insert into dispatches values('${dispatchId}','${company}','returned');
      insert into invoices(id,company_id,invoice_number,subtotal,tax_total,grand_total,amount_paid,dispatch_id,status)
        values('${invoiceId}','${company}','INV-001',80,20,100,20,'${dispatchId}','partially_paid');
      insert into invoice_items values('${id(12)}','${company}','${invoiceId}',80);
      insert into payments values('${company}','${invoiceId}',20,'cash','PAID','PARTIAL_PAYMENT',current_date);`);
    await db.exec(sqlDefinition("20260929000000_business_logic_fixes.sql", "private.recalculate_invoice_collection_state"));
    for (const name of ["private.issue_dispatch_return_credit_note_atomic", "private.reverse_credit_note_atomic"]) {
      await db.exec(sqlDefinition("20260723070000_dispatch_return_credit_notes.sql", name));
    }
    await db.exec(sqlDefinition("20261015030000_credit_note_retry_binding.sql", "private.issue_dispatch_return_credit_note_atomic"));
    for (const name of ["public.issue_dispatch_return_credit_note_atomic", "public.reverse_credit_note_atomic"]) {
      await db.exec(sqlDefinition("20261008020000_factory_workflow_integrity.sql", name));
    }
    state.issueHandler = async input => {
      const result = await db.query("select public.issue_dispatch_return_credit_note_atomic($1,$2,$3) id",
        [input.dispatch_id, input.reason, input.idempotency_key]);
      return { success: true, creditNoteId: result.rows[0].id };
    };
    state.reverseHandler = async input => {
      await db.query("select public.reverse_credit_note_atomic($1,$2)", [input.credit_note_id, input.reason]);
      return { success: true };
    };
    const balance = async () => Object.fromEntries(Object.entries((await db.query(
      "select amount_paid,credited_amount,balance_due,customer_credit_due from invoices where id=$1", [invoiceId]
    )).rows[0]).map(([name, value]) => [name, Number(value)]));
    const returnedProps = () => props({ dispatchId });
    await click(render(returnedProps()).issue);
    await click(render(returnedProps()).issue);
    assert.equal((await db.query("select count(*)::int n from credit_notes")).rows[0].n, 1);
    const first = (await db.query("select * from credit_notes")).rows[0];
    const originalReason = state.values[0];
    const beforeChangedRetry = state.refreshes;
    state.values[0] = "A different reason from a stale screen";
    await click(render(returnedProps()).issue);
    assert.match(state.errors.at(-1), /already used for different credit note details/);
    assert.equal(state.refreshes, beforeChangedRetry);
    assert.equal((await db.query("select reason from credit_notes where id=$1", [first.id])).rows[0].reason, originalReason);
    state.values[0] = originalReason;
    await click(render(props({ creditNote: first })).reverse);
    await click(render(props({ creditNote: first })).reverse);
    assert.deepEqual(await balance(), { amount_paid: 20, credited_amount: 0, balance_due: 80, customer_credit_due: 0 });
    const reversed = (await db.query("select * from credit_notes where id=$1", [first.id])).rows[0];
    state.values[0] = "Corrected return reason after accounts review";
    await click(render(props({ creditNote: reversed })).issue);
    await click(render(props({ creditNote: reversed })).issue);
    assert.deepEqual(await balance(), { amount_paid: 20, credited_amount: 100, balance_due: 0, customer_credit_due: 20 });
    assert.deepEqual((await db.query("select count(*)::int total,count(*) filter(where status='issued')::int active from credit_notes")).rows[0], { total: 2, active: 1 });
    assert.equal((await db.query("select count(*)::int n from audit_logs")).rows[0].n, 3);
    assert.equal((await db.query("select count(*)::int n from payments")).rows[0].n, 1);
    await assert.rejects(db.query("select public.issue_dispatch_return_credit_note_atomic($1,$2,$3)",
      [dispatchId, "Duplicate active credit attempt", id(20)]), /already exists/);
    assert.deepEqual(await balance(), { amount_paid: 20, credited_amount: 100, balance_due: 0, customer_credit_due: 20 });
    await db.exec("set test.role='viewer';");
    await assert.rejects(db.query("select public.issue_dispatch_return_credit_note_atomic($1,$2,$3)",
      [dispatchId, "Unauthorized credit attempt", id(21)]), /Permission denied/);
  } finally {
    await db.close();
  }
});
