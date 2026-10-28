import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DYNAMIC_EXCEPTION_MESSAGES, EXCEPTION_TYPES, canApproveExceptions, canRequestException, canSetExceptionPolicy, decisionSchema, exceptionSummary, parseExceptionCommand,
  policyListSchema, policySchema, requestListSchema, restrictionSchema
} from "../lib/workflow/exception-requests.ts";
import { createExceptionFixture, eids, eid } from "../scripts/lib/exception-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";
const shown = (message) => DYNAMIC_EXCEPTION_MESSAGES.some((pattern) => pattern.test(message));

test("commands are validated before reaching the database", () => {
  assert.equal(parseExceptionCommand({ command: "policy.drop" }).error, "Invalid exception request");
  assert.match(parseExceptionCommand({ command: "request.create", id, exception_type: "overdue_dispatch", entity_id: id, reason: "Payment promised Friday" }).error, /weight to dispatch/);
  assert.match(parseExceptionCommand({ command: "request.create", id, exception_type: "low_margin_quote", entity_id: id, reason: "Payment promised Friday", weight_kg: 10 }).error, /weight to dispatch/);
  assert.match(parseExceptionCommand({ command: "request.create", id, exception_type: "low_margin_quote", entity_id: id, reason: "short" }).error, /10 to 500/);
  assert.match(parseExceptionCommand({ command: "request.decide", id, decision: "reject", version: "a".repeat(32) }).error, /Say why/);
  assert.equal(parseExceptionCommand({ command: "request.decide", id, decision: "approve", version: "a".repeat(32) }).success, true);
  assert.match(parseExceptionCommand({ command: "policy.set", exception_type: "low_margin_quote", is_active: true, approver_roles: ["accounts"], validity_hours: 24 }).error, /approvers allowed/);
  assert.match(parseExceptionCommand({ command: "policy.set", exception_type: "overdue_dispatch", is_active: true, approver_roles: ["owner"], validity_hours: 24, min_overdue_amount: 100, hard_limit_amount: 50 }).error, /at or above the minimum/);
  assert.equal(parseExceptionCommand({ command: "restriction.check", exception_type: "low_margin_quote", entity_id: id, company_id: id }).success, false);
});

test("role gates and summaries", () => {
  assert.ok(canRequestException("sales", "low_margin_quote") && !canRequestException("owner", "low_margin_quote") && canRequestException("dispatch", "overdue_dispatch"));
  assert.ok(canSetExceptionPolicy("admin") && !canSetExceptionPolicy("sales_manager"));
  assert.ok(canApproveExceptions("accounts") && !canApproveExceptions("dispatch"));
  const inr = (n) => `INR ${n}`;
  assert.equal(exceptionSummary({ exception_type: "low_margin_quote", reference: "QT-0101", detail: { grand_total: 500000, margin_percent: 4.4, required_percent: 8 } }, inr), "QT-0101 · INR 500000 · margin 4.4% (8% required)");
  assert.equal(exceptionSummary({ exception_type: "overdue_dispatch", reference: "SO-0042", detail: { customer: "Kumar Facades", overdue_amount: 180000, weight_kg: 1250.5 } }, inr), "SO-0042 · Kumar Facades · INR 180000 overdue · 1250.5 kg to dispatch");
});

test("the action shows exactly the database's fixed business messages", () => {
  const sql = readFileSync("supabase/migrations/20261022380000_exception_requests.sql", "utf8");
  const action = readFileSync("lib/actions/exception-requests.ts", "utf8");
  const raised = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1])
    .filter((m) => !m.includes("%") && !["Authentication required", "This action is not permitted for your role", "Invalid exception request"].includes(m));
  // Guard messages surface through the quote status and dispatch actions, not this one.
  const guardMessages = ["The quotation changed after its exception was approved. Request an exception for this version", "The order changed after its exception was approved. Request an exception again", "Only owners and admins may approve low-margin quotations"];
  for (const message of raised.concat(["Your company has not enabled exceptions for low-margin quotations", "A quotation priced below cost cannot be released by exception"]).filter((m) => !guardMessages.includes(m))) {
    assert.ok(action.includes(`"${message}"`) || shown(message), message);
  }
  assert.ok(readFileSync("app/(dashboard)/quotes/[id]/page.tsx", "utf8").includes(`"${guardMessages[0]}") return "exception_changed"`), "the quote page explains a changed quotation");
  assert.ok(guardMessages[1].length <= 240, "the dispatch actions show messages up to 240 characters as written");
  const quoteAction = readFileSync("lib/actions/quotes-orders.ts", "utf8");
  assert.match(quoteAction, /exception_command", \{ p_command: "restriction\.check", p_payload: \{ exception_type: "low_margin_quote", entity_id: quoteId \} \}/);
  assert.match(quoteAction, /request\.status === "approved" && request\.covers_current === true/);
});

let f;
test.before(async () => { f = await createExceptionFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

test("requester and approver roles match the database", async () => {
  for (const [type, meta] of Object.entries(EXCEPTION_TYPES)) {
    const requesters = (await f.db.query("select private.exception_requester_roles($1) r", [type])).rows[0].r;
    assert.deepEqual([...meta.requesters].sort(), [...requesters].sort(), type);
    for (const role of ["owner", "admin", "sales_manager", "accounts", "sales", "dispatch"]) {
      const accepted = await f.policy(type, { approver_roles: [role] }).then(() => true, () => false);
      assert.equal(accepted, (meta.approvers).includes(role), `${type} approver ${role}`);
    }
  }
});

test("every dynamic database message reaches the user as written", async () => {
  const messages = [];
  const capture = (promise) => promise.then(() => assert.fail("expected a refusal"), (error) => messages.push(error.message));
  await f.policy("low_margin_quote", { approver_roles: ["owner"], max_shortfall_points: 3 });
  await capture(f.request("low_margin_quote", eids.quote));
  await f.policy("overdue_dispatch", { approver_roles: ["owner"], overdue_days: 30, min_overdue_amount: 50000, hard_limit_amount: 150000 });
  await capture(f.request("overdue_dispatch", eids.order, eids.dispatcher, { weight_kg: 10 }));
  await capture(f.step(`update dispatches set delivery_status='dispatched' where id='${eids.dispatch}'`, eids.dispatcher));
  await f.policy("overdue_dispatch", { approver_roles: ["owner"], overdue_days: 30, min_overdue_amount: 50000 });
  await capture(f.step(`update dispatches set delivery_status='dispatched' where id='${eids.dispatch}'`, eids.dispatcher));
  const { id: requestId } = await f.request("overdue_dispatch", eids.order, eids.dispatcher, { weight_kg: 100 });
  await f.command("request.decide", { id: requestId, decision: "approve", version: (await f.toDecide(eids.owner))[0].version }, eids.owner);
  await capture(f.step(`update dispatches set delivery_status='dispatched' where id='${eids.dispatch}'`, eids.dispatcher));
  await f.db.exec(`insert into invoices(id,company_id,customer_id,invoice_number,due_date,status,grand_total) values('${eid(62)}','${eids.company}','${eids.kumar}','INV-0007',current_date - 60,'sent',5000)`);
  await capture(f.step(`update dispatches set delivery_status='dispatched' where id='${eids.dispatch2}'`, eids.dispatcher));
  assert.equal(messages.length, 6);
  for (const message of messages) assert.ok(shown(message), message);
});

test("database responses parse with the app's schemas", async () => {
  assert.deepEqual(policyListSchema.parse(await f.command("policy.list", {})), []);
  policySchema.parse(await f.policy("low_margin_quote", { approver_roles: ["owner", "admin"], max_shortfall_points: 5 }));
  policySchema.parse(await f.policy("overdue_dispatch", { approver_roles: ["owner", "accounts"], overdue_days: 30, min_overdue_amount: 50000 }));
  restrictionSchema.parse(await f.command("restriction.check", { exception_type: "low_margin_quote", entity_id: eids.quote }));
  restrictionSchema.parse(await f.command("restriction.check", { exception_type: "overdue_dispatch", entity_id: eids.order }, eids.dispatcher));
  const { id: quoteRequest } = await f.request("low_margin_quote", eids.quote);
  await f.request("overdue_dispatch", eids.order, eids.dispatcher, { weight_kg: 500 });
  const queue = requestListSchema.parse(await f.command("request.list", { view: "to_decide" }, eids.owner));
  assert.equal(queue.total_count, 2);
  decisionSchema.parse(await f.command("request.decide", { id: quoteRequest, decision: "approve", version: queue.rows.find((r) => r.id === quoteRequest).version }, eids.owner));
  requestListSchema.parse(await f.command("request.list", { view: "mine" }));
  requestListSchema.parse(await f.command("request.list", { view: "decided" }, eids.owner));
  assert.equal(restrictionSchema.parse(await f.command("restriction.check", { exception_type: "low_margin_quote", entity_id: eids.quote })).requests[0].covers_current, true);
});

test("pages show the restriction beside the step and keep policy settings to owners and admins", () => {
  assert.match(readFileSync("app/(dashboard)/quotes/[id]/page.tsx", "utf8"), /!context\.dealerId && quote\.low_margin_approval_required && canRequestException\(context\.role, "low_margin_quote"\) \? <RestrictionPanel/);
  assert.match(readFileSync("app/(dashboard)/orders/[id]/page.tsx", "utf8"), /!context\.dealerId && canRequestException\(context\.role, "overdue_dispatch"\) \? <RestrictionPanel exceptionType="overdue_dispatch"/);
  assert.match(readFileSync("app/(dashboard)/tasks/approvals/exceptions/page.tsx", "utf8"), /context\.dealerId \|\| !canSetExceptionPolicy\(context\.role\)/);
  assert.match(readFileSync("app/(dashboard)/tasks/approvals/page.tsx", "utf8"), /exception_command", \{ p_command: "request\.list", p_payload: \{ view: "to_decide"/);
  assert.match(readFileSync("lib/actions/exception-requests.ts", "utf8"), /if \(context\.dealerId \|\|/);
});
