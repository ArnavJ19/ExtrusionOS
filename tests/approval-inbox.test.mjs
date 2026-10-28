import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvalCommandSchema, approvalHistorySchema, approvalInboxSchema, canUseApprovalInbox, decisionEffect, sourceHref } from "../lib/workflow/approval-inbox.ts";
import { createApprovalInboxFixture, aids } from "../scripts/lib/approval-inbox-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";
const v = "a".repeat(32);

test("only approvers use the inbox", () => {
  for (const role of ["owner", "admin", "sales_manager", "accounts"]) assert.ok(canUseApprovalInbox(role), role);
  for (const role of ["sales", "viewer", "production_manager", "dealer_admin"]) assert.ok(!canUseApprovalInbox(role), role);
});

test("decisions need a version; rejections and questions need a reason", () => {
  const base = { command: "inbox.decide", source_type: "quote", source_id: id, version: v, decision: "approve", request_id: id };
  assert.equal(approvalCommandSchema.safeParse(base).success, true);
  assert.equal(approvalCommandSchema.safeParse({ ...base, version: "stale" }).success, false);
  assert.equal(approvalCommandSchema.safeParse({ ...base, decision: "reject" }).success, false);
  assert.equal(approvalCommandSchema.safeParse({ ...base, decision: "clarify", note: "Why?" }).success, false);
  assert.equal(approvalCommandSchema.safeParse({ ...base, decision: "clarify", note: "Why is the rate low?" }).success, true);
  assert.equal(approvalCommandSchema.safeParse({ ...base, decision: "escalate" }).success, false);
  assert.equal(approvalCommandSchema.safeParse({ ...base, source_type: "invoice" }).success, false);
  assert.equal(approvalCommandSchema.safeParse({ ...base, note: "bad\u0000" }).success, false);
  assert.equal(approvalCommandSchema.safeParse({ ...base, company_id: id }).success, false);
});

test("each decision's effect is stated before confirming, and links open the source", () => {
  assert.match(decisionEffect({ source_type: "quote" }, "approve"), /approved for sending/);
  assert.match(decisionEffect({ source_type: "quote" }, "reject"), /returns to draft/);
  assert.match(decisionEffect({ source_type: "expense" }, "approve"), /approved for payment/);
  assert.match(decisionEffect({ source_type: "expense" }, "clarify"), /stays pending/);
  assert.equal(sourceHref({ source_type: "quote", source_id: "q" }), "/quotes/q");
  assert.equal(sourceHref({ source_type: "expense", source_id: "e" }), "/expenses/e");
});

test("every database error message the action passes through is one the database can raise", () => {
  const action = readFileSync("lib/actions/approval-inbox.ts", "utf8");
  const listed = [...action.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((text) => /^[A-Z]/.test(text) && text.length > 12 && !text.startsWith("The approval inbox") && !text.startsWith("Confirmation") && !text.startsWith("The decision") && !text.startsWith("This decision") && !text.startsWith("The inbox") && !text.startsWith("The approval request") && !text.startsWith("You do not have") && !text.startsWith("Invalid approval"));
  const sql = ["supabase/migrations/20261022280000_approval_inbox.sql", "supabase/migrations/20261020010000_expense_ledger_integrity.sql", "supabase/migrations/20261021190916_collaboration_procedure_routines.sql", "supabase/migrations/20260929000000_business_logic_fixes.sql"].map((file) => readFileSync(file, "utf8")).join("\n");
  for (const message of listed) assert.ok(sql.includes(message.replace(/'/g, "''")) || sql.includes(message), message);
});

let f;
test.before(async () => { f = await createApprovalInboxFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database inbox and history parse with the app's schemas for every approver role", async () => {
  for (const actor of [aids.owner, aids.admin, aids.salesManager, aids.accounts]) assert.ok(approvalInboxSchema.safeParse(await f.inbox(actor)).success, actor);
  await f.decide(aids.lowMarginQuote, "clarify", "Why is the conversion charge low?");
  await f.decide(aids.normalQuote, "approve", null, aids.salesManager);
  assert.ok(approvalInboxSchema.parse(await f.inbox()).rows.find((r) => r.source_id === aids.lowMarginQuote).last_clarification);
  assert.equal(approvalHistorySchema.parse(await f.command("inbox.history", {})).total_count, 2);
});

test("the page and action gate on approver roles and exclude dealer sessions", () => {
  assert.match(readFileSync("lib/actions/approval-inbox.ts", "utf8"), /if \(context\.dealerId \|\| !canUseApprovalInbox\(context\.role\)\)/);
  assert.match(readFileSync("app/(dashboard)/tasks/approvals/page.tsx", "utf8"), /if \(context\.dealerId \|\| !canUseApprovalInbox\(context\.role\)\) redirect\("\/tasks"\)/);
});
