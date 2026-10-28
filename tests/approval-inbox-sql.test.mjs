import test from "node:test";
import assert from "node:assert/strict";
import { createApprovalInboxFixture, aids, aid } from "../scripts/lib/approval-inbox-fixture.mjs";

let f;
test.before(async () => { f = await createApprovalInboxFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const refs = (result) => result.rows.map((row) => row.reference);
const quote = async (id) => (await f.db.query("select status, approved_by, approval_notes from quotes where id=$1", [id])).rows[0];
const expense = async (id) => (await f.db.query("select approval_status, approved_by, approval_note from expense_ledger where id=$1", [id])).rows[0];

// ---------- Who sees what ----------

test("the policy trigger put the seeded expenses where expected", async () => {
  assert.equal((await expense(aids.smallExpense)).approval_status, "pending_approval");
  assert.equal((await expense(aids.draftExpense)).approval_status, "draft");
});

test("owners see every pending quotation and expense, oldest first, with business context", async () => {
  const data = await f.inbox();
  assert.deepEqual(refs(data), ["QT-0001", "EXP-0001", "EXP-0002", "EXP-0004", "QT-0002", "QT-0003", "QT-0005"]);
  const low = data.rows[0];
  assert.deepEqual([low.counterparty, Number(low.amount), low.low_margin, Number(low.profit_percent), low.requester_name], ["Kumar Facades", 118000, true, 1.7, "Sales Ravi"]);
  assert.match(low.version, /^[0-9a-f]{32}$/);
  const big = data.rows.find((r) => r.reference === "EXP-0002");
  assert.deepEqual([big.counterparty, big.category, big.detail], ["Shree Powder Coaters", "die_purchase", "New die for EX-205"]);
});

test("sales managers see only ordinary quotations; accounts see only expenses within their limit", async () => {
  assert.deepEqual(refs(await f.inbox(aids.salesManager)), ["QT-0002", "QT-0003", "QT-0005"]);
  assert.deepEqual(refs(await f.inbox(aids.accounts)), ["EXP-0001"]);
  assert.deepEqual(refs(await f.inbox(aids.owner, { type: "expense" })), ["EXP-0001", "EXP-0002", "EXP-0004"]);
});

test("a requester's own item is visible but marked as not theirs to decide", async () => {
  const own = (await f.inbox(aids.salesManager)).rows.find((r) => r.reference === "QT-0005");
  assert.deepEqual([own.can_decide, own.blocked_reason], [false, "Your own request"]);
  await assert.rejects(f.decide(aids.ownQuote, "approve", null, aids.salesManager), /cannot decide your own request/);
});

// ---------- Deciding quotations ----------

test("approving a quotation moves it to approved for sending, recording the approver", async () => {
  assert.equal((await f.decide(aids.normalQuote, "approve", "Rates verified", aids.salesManager)).decision, "approve");
  assert.deepEqual(await quote(aids.normalQuote), { status: "approved_for_sending", approved_by: aids.salesManager, approval_notes: "Rates verified" });
  assert.ok(!refs(await f.inbox(aids.salesManager)).includes("QT-0002"), "decided requests leave the inbox");
});

test("a low-margin quotation can be decided only by an owner or admin", async () => {
  await assert.rejects(f.decide(aids.lowMarginQuote, "approve", null, aids.salesManager, "a".repeat(32)), /Only owners and admins/);
  await f.decide(aids.lowMarginQuote, "approve", "Strategic customer", aids.admin);
  assert.equal((await quote(aids.lowMarginQuote)).status, "approved_for_sending");
});

test("approval requires complete costing on every line, the same rule as the quote's own guard", async () => {
  await assert.rejects(f.decide(aids.incompleteQuote, "approve"), /Complete the costing on every quotation line/);
  assert.equal((await quote(aids.incompleteQuote)).status, "internal_review");
});

test("rejecting returns the quotation to draft with the reason and clears approval", async () => {
  await assert.rejects(f.decide(aids.normalQuote, "reject", "no"), /Explain the rejection/);
  await f.decide(aids.normalQuote, "reject", "Margin below the floor for this alloy");
  assert.deepEqual(await quote(aids.normalQuote), { status: "draft", approved_by: null, approval_notes: "Margin below the floor for this alloy" });
});

// ---------- Superseded and already-decided requests ----------

test("a request edited after it was opened cannot be decided on the old version", async () => {
  const opened = await f.item(aids.normalQuote, aids.salesManager);
  await f.db.exec(`update quotes set grand_total=61000 where id='${aids.normalQuote}'`);
  await assert.rejects(f.decide(aids.normalQuote, "approve", null, aids.salesManager, opened.version), /changed since you opened it/);
  await f.decide(aids.normalQuote, "approve", null, aids.salesManager);
  assert.equal((await quote(aids.normalQuote)).status, "approved_for_sending");
});

test("a decided request cannot be approved again, by the same or another approver", async () => {
  const opened = await f.item(aids.normalQuote);
  await f.decide(aids.normalQuote, "approve", null, aids.owner, opened.version);
  await assert.rejects(f.command("inbox.decide", { source_type: "quote", source_id: aids.normalQuote, version: opened.version, decision: "approve", request_id: aid(7001) }, aids.admin), /already decided/);
  await assert.rejects(f.command("inbox.decide", { source_type: "quote", source_id: aids.normalQuote, version: opened.version, decision: "reject", note: "late reject", request_id: aid(7002) }), /already decided/);
  assert.equal((await f.db.query("select count(*)::int n from approval_decisions where decision in ('approve','reject')")).rows[0].n, 1);
});

test("retrying the same decision returns the recorded result without deciding twice", async () => {
  const opened = await f.item(aids.normalQuote);
  const payload = { source_type: "quote", source_id: aids.normalQuote, version: opened.version, decision: "approve", request_id: aid(7100) };
  const first = await f.command("inbox.decide", payload);
  const retry = await f.command("inbox.decide", payload);
  assert.deepEqual([retry.id, retry.replayed], [first.id, true]);
  await assert.rejects(f.command("inbox.decide", { ...payload, decision: "reject", note: "different decision" }), /already used for different details/);
});

// ---------- Clarification ----------

test("requesting clarification keeps the request pending, records the question and notifies the requester", async () => {
  await f.decide(aids.lowMarginQuote, "clarify", "Why is the conversion charge Rs 18/kg below list?");
  assert.equal((await quote(aids.lowMarginQuote)).status, "internal_review");
  const row = await f.item(aids.lowMarginQuote);
  assert.equal(row.clarifications, 1);
  assert.equal(row.last_clarification.note, "Why is the conversion charge Rs 18/kg below list?");
  const [note] = (await f.db.query("select recipient_user_id, notification_type, action_link, entity_reference from notifications")).rows;
  assert.deepEqual(note, { recipient_user_id: aids.sales, notification_type: "approval_clarification", action_link: `/quotes/${aids.lowMarginQuote}`, entity_reference: "QT-0001" });
  await f.decide(aids.lowMarginQuote, "approve", "Explained: annual contract rate");
  assert.equal((await quote(aids.lowMarginQuote)).status, "approved_for_sending", "a clarified request can still be decided");
  await assert.rejects(f.decide(aids.normalQuote, "clarify", "?"), /Explain the rejection or the question/);
});

// ---------- Deciding expenses through the existing workflow ----------

test("expenses are decided through the existing approval workflow and its Rs 25,000 limit", async () => {
  await f.decide(aids.smallExpense, "approve", null, aids.accounts);
  assert.deepEqual(await expense(aids.smallExpense), { approval_status: "approved", approved_by: aids.accounts, approval_note: null });
  await assert.rejects(f.command("inbox.decide", { source_type: "expense", source_id: aids.bigExpense, version: (await f.item(aids.bigExpense)).version, decision: "approve", request_id: aid(7200) }, aids.accounts), /need owner or admin approval/);
  await f.decide(aids.bigExpense, "reject", "Get a second quotation for the die");
  assert.deepEqual(await expense(aids.bigExpense), { approval_status: "rejected", approved_by: null, approval_note: "Get a second quotation for the die" });
  assert.equal((await f.db.query("select count(*)::int n from audit_logs where action like 'expense_approval_%'")).rows[0].n, 2, "the workflow's own audit entries are written");
});

test("an accounts user cannot decide an expense they raised; the owner can", async () => {
  await assert.rejects(f.command("inbox.decide", { source_type: "expense", source_id: aids.ownExpense, version: "b".repeat(32), decision: "approve", request_id: aid(7400) }, aids.accounts), /owner or admin approval/);
  await f.db.exec(`update expense_ledger set total_amount=20000 where id='${aids.ownExpense}'`);
  await assert.rejects(f.decide(aids.ownExpense, "approve", null, aids.accounts), /cannot decide your own request/);
  await f.decide(aids.ownExpense, "approve", null, aids.owner);
  assert.equal((await expense(aids.ownExpense)).approval_status, "approved");
});

// ---------- Roles and tenancy ----------

test("other roles, dealers, other companies and anonymous callers are refused", async () => {
  for (const actor of [aids.sales, aids.viewer, aids.dealer]) await assert.rejects(f.inbox(actor), /not permitted/);
  assert.equal((await f.inbox(aids.foreign)).rows.map((r) => r.reference).join(), "FOREIGN-Q");
  await assert.rejects(f.command("inbox.decide", { source_type: "quote", source_id: aids.normalQuote, version: "c".repeat(32), decision: "approve", request_id: aid(7300) }, aids.foreign), /Approval request is unavailable/);
  await assert.rejects(f.asUser("select public.approval_inbox_command('inbox.list','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser(`insert into approval_decisions(company_id,request_id,source_type,source_id,version,decision,actor_id,actor_name,actor_role) values('${aids.company}','${aid(1)}','quote','${aids.normalQuote}','${"d".repeat(32)}','approve','${aids.owner}','x','owner')`), /permission denied/);
  await assert.rejects(f.command("inbox.decide", { source_type: "invoice", source_id: aids.normalQuote, version: "e".repeat(32), decision: "approve", request_id: aid(7301) }), /Choose a request, its version and a decision/);
});

test("decision history: owners see all, others see their own, 10 per page", async () => {
  await f.decide(aids.normalQuote, "approve", null, aids.salesManager);
  await f.decide(aids.smallExpense, "approve", null, aids.accounts);
  assert.equal((await f.command("inbox.history", {}, aids.owner)).total_count, 2);
  const mine = await f.command("inbox.history", {}, aids.accounts);
  assert.deepEqual(mine.rows.map((r) => [r.source_reference, r.decision, r.actor_name]), [["EXP-0001", "approve", "Accounts Meena"]]);
  await assert.rejects(f.command("inbox.history", { page: 0 }), /Invalid page/);
});

test("requests with no recorded requester can be decided and still parse (no unknown permission flag)", async () => {
  await f.db.exec(`update quotes set created_by=null where id='${aids.normalQuote}'`);
  const row = await f.item(aids.normalQuote, aids.salesManager);
  assert.strictEqual(row.can_decide, true);
  assert.strictEqual(row.blocked_reason, null);
  await f.decide(aids.normalQuote, "approve", null, aids.salesManager);
});
