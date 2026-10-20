import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let state;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "react" && parent?.filename.replaceAll("\\", "/").endsWith("/payment-form-client.tsx")) {
    return { ...React,
      useMemo: callback => callback(), useEffect() {},
      useRef(initial) { const index = state.refIndex++; return state.refs[index] ??= { current: initial }; },
      useState(initial) {
        const index = state.stateIndex++;
        if (!(index in state.values)) state.values[index] = initial;
        return [state.values[index], value => { state.values[index] = value; }];
      },
      useTransition: () => [false, callback => { state.task = callback(); }]
    };
  }
  if (request === "next/navigation") return { useRouter: () => ({ push: path => state.paths.push(path), refresh: () => { state.refreshes++; } }) };
  if (request === "sonner") return { toast: { error: message => state.errors.push(message), success: message => state.successes.push(message) } };
  if (request === "@/lib/supabase/browser") return { createClient: () => ({}) };
  if (request === "@/lib/actions/payments") return { recordPaymentAction: async input => { state.inputs.push(input); return state.result; } };
  return originalLoad(request, parent, isMain);
};
let Component;
try { Component = require("../components/modules/financials/payment-form-client.tsx").PaymentFormClient; }
finally { Module._load = originalLoad; }

function reset(method = "credit_note") {
  state = { refIndex: 0, stateIndex: 0, refs: [],
    values: [[{ id: id(20), invoice_number: "INV-001", invoice_date: "2026-01-01", due_date: null,
      grand_total: 100, amount_paid: 0, balance_due: 100, status: "sent", order_id: id(15),
      customers: { customer_name: "Synthetic Customer" }, orders: { order_number: "ORD-001" } }],
    id(20), "2026-01-01", "25", method, "", "", false, null],
    inputs: [], paths: [], errors: [], successes: [], refreshes: 0, task: null,
    result: { success: false, error: "This invoice already has an issued credit note. Reverse that note before recording a standalone credit adjustment." } };
}
function render() {
  state.refIndex = 0; state.stateIndex = 0;
  return Component({ context: { companyId: id(1), role: "accounts" }, initialInvoiceId: id(20) });
}
function postingControl(node) {
  if (Array.isArray(node)) {
    for (const child of node) { const result = postingControl(child); if (result) return result; }
  } else if (node && typeof node === "object") {
    if (typeof node.props?.onClick === "function") return node.props;
    return postingControl(node.props?.children);
  }
  return null;
}
async function submit() {
  const control = postingControl(render());
  assert.ok(control); assert.equal(control.disabled, false);
  control.onClick(); await state.task;
}

test("non-cash adjustment entry explains the separate return document and labels its amount and action accurately", () => {
  reset();
  const html = renderToStaticMarkup(render());
  assert.match(html, /Credit adjustment \(non-cash\)/);
  assert.match(html, /Adjustment amount/);
  assert.match(html, /Post Credit Adjustment/);
  assert.match(html, /Record Credit Adjustment/);
  assert.match(html, /Adjustment Details/);
  assert.match(html, /no issued return credit note/);
  assert.match(html, /dispatch record instead/);
  assert.doesNotMatch(html, /Amount received/);
});

test("a rejected credit adjustment stays retryable with the same key and navigates only after success", async () => {
  reset();
  await submit();
  assert.equal(state.inputs[0].payment_method, "credit_note");
  assert.equal(state.inputs[0].amount, 25);
  assert.deepEqual(state.paths, []);
  assert.equal(state.refreshes, 0);
  assert.match(state.errors[0], /issued credit note/);
  state.result = { success: true, data: { payment_id: id(50), balance_due: 75 } };
  await submit();
  assert.deepEqual(state.inputs[1], state.inputs[0]);
  assert.deepEqual(state.paths, [`/payments/${id(50)}`]);
  assert.equal(state.refreshes, 1);
  assert.match(state.successes[0], /^Credit adjustment posted/);
});

test("cash entry retains receipt labels and receipt posting behavior", async () => {
  reset("cash");
  const html = renderToStaticMarkup(render());
  assert.match(html, /Amount received/);
  assert.match(html, /Post Receipt/);
  assert.match(html, /Record Customer Receipt/);
  assert.doesNotMatch(html, /Use a standalone adjustment only/);
  state.result = { success: true, data: { payment_id: id(51), balance_due: 75 } };
  await submit();
  assert.equal(state.inputs[0].payment_method, "cash");
  assert.match(state.successes[0], /^Receipt posted/);
});
