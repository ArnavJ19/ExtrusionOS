import test from "node:test";
import assert from "node:assert/strict";
import { createExceptionFixture, eids, eid } from "../scripts/lib/exception-fixture.mjs";

let f;
test.before(async () => { f = await createExceptionFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const release = (quote = eids.quote, actor = eids.sales) => f.step(`update quotes set status='approved_for_sending' where id='${quote}'`, actor);
const dispatch = (id = eids.dispatch, actor = eids.dispatcher) => f.step(`update dispatches set delivery_status='dispatched' where id='${id}'`, actor);
const lowMargin = (fields = {}) => f.policy("low_margin_quote", { approver_roles: ["owner", "admin"], validity_hours: 24, ...fields });
const overdueHold = (fields = {}) => f.policy("overdue_dispatch", { approver_roles: ["owner", "accounts"], overdue_days: 30, min_overdue_amount: 50000, ...fields });
const approve = async (request, actor = eids.owner) => {
  const row = (await f.toDecide(actor)).find((r) => r.id === request);
  return f.command("request.decide", { id: request, decision: "approve", version: row.version, note: "Approved for the project" }, actor);
};

// ---------- Low-margin quotations ----------

test("without a policy the existing rule is unchanged: only owners and admins release a low-margin quotation", async () => {
  await assert.rejects(release(), /Only owners and admins may approve low-margin quotations/);
  await assert.rejects(f.request("low_margin_quote", eids.quote), /not enabled exceptions/);
  await release(eids.quote, eids.admin);
});

test("an approved exception lets sales release exactly that quotation version, once approved by someone else", async () => {
  await lowMargin();
  const check = await f.command("restriction.check", { exception_type: "low_margin_quote", entity_id: eids.quote });
  assert.deepEqual([check.restricted, check.can_request, check.blocker], [true, true, null]);
  assert.match(check.reason, /Margin 4.4% is below the required 8% \(3.6 points short\)/);
  const { id } = await f.request("low_margin_quote", eids.quote);
  const alert = (await f.db.query("select recipient_role from notifications where notification_type='exception_request' order by recipient_role")).rows.map((r) => r.recipient_role);
  assert.deepEqual(alert, ["admin", "owner"], "every approver role is told");
  await assert.rejects(release(), /Only owners and admins/, "a pending request lifts nothing");
  await approve(id);
  await release();
  assert.equal((await f.db.query(`select status from quotes where id='${eids.quote}'`)).rows[0].status, "approved_for_sending");
  await f.step(`update quotes set status='sent' where id='${eids.quote}'`, eids.sales);
  const used = (await f.db.query(`select first_used_at is not null used from exception_requests where id='${id}'`)).rows[0].used;
  assert.equal(used, true, "the first use is recorded");
});

test("an approval does not cover changed quantities, other quotations or an expired period", async () => {
  await lowMargin();
  const { id } = await f.request("low_margin_quote", eids.quote);
  await approve(id);
  await f.db.exec(`update quote_items set quantity_kg = 1800 where quote_id='${eids.quote}'`);
  await assert.rejects(release(), /changed after its exception was approved/);
  await f.db.exec(`update quote_items set quantity_kg = 1500 where quote_id='${eids.quote}'`);
  await f.db.exec(`insert into quotes(id,company_id,customer_id,quote_number,status,grand_total,total_margin_amount,estimated_profit_amount,estimated_profit_percent,low_margin_approval_required)
    values('${eid(33)}','${eids.company}','${eids.kumar}','QT-0103','internal_review',500000,22000,22000,4.4,true)`);
  await assert.rejects(release(eid(33)), /Only owners and admins/, "an identical-looking quotation is a different record");
  await f.db.exec(`update exception_requests set expires_at = now() - interval '1 minute'`);
  await assert.rejects(release(), /Only owners and admins/, "expired");
  assert.equal((await f.command("restriction.check", { exception_type: "low_margin_quote", entity_id: eids.quote })).requests[0].status, "expired");
});

test("non-overridable: a loss-making price, a shortfall beyond the policy, or a disabled policy", async () => {
  await lowMargin({ max_shortfall_points: 3 });
  await assert.rejects(f.request("low_margin_quote", eids.lossQuote), /priced below cost cannot be released by exception/);
  await assert.rejects(f.request("low_margin_quote", eids.quote), /3.6 points short, more than the 3 points an exception may cover/);
  await lowMargin({ max_shortfall_points: 5 });
  const { id } = await f.request("low_margin_quote", eids.quote);
  await approve(id);
  await lowMargin({ max_shortfall_points: 3 });
  await assert.rejects(release(), /Only owners and admins/, "limits are rechecked when the exception is used");
  await lowMargin({ max_shortfall_points: 5, is_active: false });
  await assert.rejects(release(), /Only owners and admins/, "a withdrawn policy honours no exception");
  await f.db.exec(`update exception_policies set is_active = true`);
  await release();
});

test("deciding: four eyes, approver roles, the version seen, and records that moved on", async () => {
  await lowMargin({ approver_roles: ["owner", "sales_manager"] });
  const { id } = await f.request("low_margin_quote", eids.quote, eids.salesMgr);
  assert.deepEqual(await f.toDecide(eids.salesMgr), [], "requesters do not see their own request to decide");
  await assert.rejects(f.command("request.decide", { id, decision: "approve", version: "0".repeat(32) }, eids.salesMgr), /Another person must decide/);
  await assert.rejects(f.command("request.decide", { id, decision: "approve", version: "0".repeat(32) }, eids.admin), /Your role cannot decide/);
  await assert.rejects(f.command("request.decide", { id, decision: "approve", version: "0".repeat(32) }, eids.owner), /different version/);
  await assert.rejects(f.command("request.decide", { id, decision: "reject", version: (await f.toDecide(eids.owner))[0].version, note: "" }, eids.owner), /Say why/);
  await f.db.exec(`update quotes set grand_total = 520000 where id='${eids.quote}'`);
  const [row] = await f.toDecide(eids.owner);
  assert.equal(row.current, false, "the approver sees that the record changed");
  assert.equal(Number(row.current_detail.grand_total), 520000);
  const superseded = await f.command("request.decide", { id, decision: "approve", version: row.version }, eids.owner);
  assert.deepEqual([superseded.status, superseded.message], ["superseded", "The record changed after the request. The requester must ask again for the current version."]);
  assert.equal((await f.db.query(`select status from exception_requests where id='${id}'`)).rows[0].status, "superseded", "the superseded state is kept");
  assert.equal((await f.toDecide(eids.owner)).some((r) => r.id === id), false, "a superseded request leaves the queue");
  await assert.rejects(f.command("request.decide", { id, decision: "approve", version: row.version }, eids.owner), /already decided or withdrawn/);
  const again = await f.request("low_margin_quote", eids.quote, eids.salesMgr);
  const rejected = await f.command("request.decide", { id: again.id, decision: "reject", version: (await f.toDecide(eids.owner))[0].version, note: "Price must be revised" }, eids.owner);
  assert.equal(rejected.status, "rejected");
  const told = (await f.db.query(`select title, action_link from notifications where recipient_user_id='${eids.salesMgr}' order by created_at`)).rows;
  assert.deepEqual(told.map((n) => n.action_link), [`/quotes/${eids.quote}`, `/quotes/${eids.quote}`], "the requester gets a route back to the paused work");
});

test("requests are validated, deduplicated, retry-safe and withdrawable only by the requester", async () => {
  await lowMargin();
  await assert.rejects(f.request("low_margin_quote", eids.quote, eids.sales, { reason: "please" }), /10 to 500 characters/);
  await assert.rejects(f.request("low_margin_quote", eids.quote, eids.owner), /cannot request this exception/, "owners release it themselves");
  await assert.rejects(f.request("low_margin_quote", eids.quote, eids.production), /cannot request/);
  await assert.rejects(f.request("low_margin_quote", eids.foreignQuote), /Record is unavailable/);
  const id = crypto.randomUUID();
  await f.request("low_margin_quote", eids.quote, eids.sales, { id });
  assert.equal((await f.request("low_margin_quote", eids.quote, eids.sales, { id })).replayed, true);
  await assert.rejects(f.request("low_margin_quote", eids.quote, eids.salesMgr), /already waiting for a decision/);
  await assert.rejects(f.command("request.withdraw", { id }, eids.salesMgr), /Only the requester/);
  await f.command("request.withdraw", { id });
  await approve((await f.request("low_margin_quote", eids.quote)).id);
  await assert.rejects(f.request("low_margin_quote", eids.quote, eids.salesMgr), /already covers this version/);
  await f.db.exec(`update quotes set low_margin_approval_required = false where id='${eids.quote}'`);
  assert.equal((await f.command("restriction.check", { exception_type: "low_margin_quote", entity_id: eids.quote })).can_request, false);
});

// ---------- Overdue dispatch hold ----------

test("the dispatch hold applies only once a policy is enabled and the overdue amount reaches it", async () => {
  await dispatch(eids.dispatch2);
  await overdueHold({ min_overdue_amount: 200000 });
  await dispatch(eids.dispatch, eids.dispatcher);
  await f.db.exec(`update dispatches set delivery_status='pending'`);
  await overdueHold();
  await assert.rejects(dispatch(), /Dispatch held: INR 180000.00 is overdue for more than 30 days/);
  await assert.rejects(dispatch(eids.dispatch, eids.owner), /Dispatch held/, "the hold applies to owners too");
  await dispatch(eids.mehtaDispatch);
  await f.db.exec(`update invoices set amount_paid = 150000 where id='${eids.overdueInvoice}'`);
  await dispatch();
});

test("an approved hold exception covers one dispatch on that order up to the approved weight, and not more exposure", async () => {
  await overdueHold();
  const check = await f.command("restriction.check", { exception_type: "overdue_dispatch", entity_id: eids.order }, eids.dispatcher);
  assert.match(check.reason, /Kumar Facades has INR 180000.00 overdue for more than 30 days/);
  await assert.rejects(f.request("overdue_dispatch", eids.order, eids.dispatcher), /weight to dispatch in kg/);
  const { id } = await f.request("overdue_dispatch", eids.order, eids.dispatcher, { weight_kg: 1250.5 });
  await approve(id, eids.accounts);
  await f.db.exec(`update dispatches set total_weight_kg = 1500 where id='${eids.dispatch}'`);
  await assert.rejects(dispatch(), /This dispatch \(1500 kg\) is more than the 1250.5 kg the exception approved/);
  await f.db.exec(`update dispatches set total_weight_kg = 1250.5 where id='${eids.dispatch}'`);
  await f.db.exec(`insert into invoices(id,company_id,customer_id,invoice_number,due_date,status,grand_total) values('${eid(62)}','${eids.company}','${eids.kumar}','INV-0007',current_date - 60,'sent',20000)`);
  await assert.rejects(dispatch(), /More has fallen overdue since the exception was approved \(now INR 200000.00\)/);
  await f.db.exec(`delete from invoices where id='${eid(62)}'`);
  await dispatch();
  const used = (await f.db.query(`select consumed_dispatch_id from exception_requests where id='${id}'`)).rows[0].consumed_dispatch_id;
  assert.equal(used, eids.dispatch, "the exception is used up by the dispatch it let through");
  await assert.rejects(dispatch(eids.dispatch2), /Dispatch held/, "a second dispatch on the order needs its own exception");
  assert.equal((await f.command("restriction.check", { exception_type: "overdue_dispatch", entity_id: eids.order }, eids.dispatcher)).requests[0].status, "used");
});

test("a new dispatch inserted already dispatched is held, and passes with an approved exception for its order", async () => {
  await overdueHold();
  const insert = (n, kg) => f.step(`insert into dispatches values('${eid(n)}','${eids.company}','DSP-00${n}','${eids.order}',${kg},4,'dispatched')`, eids.dispatcher);
  await assert.rejects(insert(53, 200), /Dispatch held/);
  const { id } = await f.request("overdue_dispatch", eids.order, eids.dispatcher, { weight_kg: 200 });
  await approve(id, eids.owner);
  await f.step(`insert into dispatches values('${eid(54)}','${eids.company}','DSP-0054','${eids.mehtaOrder}',100,2,'dispatched')`, eids.dispatcher);
  await assert.rejects(insert(55, 250), /more than the 200 kg/, "the approval is for this order's dispatch of up to 200 kg");
  await insert(53, 200);
  await assert.rejects(f.request("overdue_dispatch", eids.order, eids.sales, { weight_kg: 10 }), /cannot request this exception/, "sales does not dispatch");
});

test("above the hard limit the hold cannot be lifted by exception", async () => {
  await overdueHold({ hard_limit_amount: 150000 });
  const check = await f.command("restriction.check", { exception_type: "overdue_dispatch", entity_id: eids.order }, eids.dispatcher);
  assert.deepEqual([check.can_request, check.blocker], [false, "INR 180000.00 overdue is above the INR 150000.00 hard limit: collect payment before dispatching"]);
  await assert.rejects(f.request("overdue_dispatch", eids.order, eids.dispatcher, { weight_kg: 100 }), /above the INR 150000.00 hard limit/);
  await assert.rejects(dispatch(), /above the INR 150000.00 hard limit/);
  await overdueHold({ hard_limit_amount: 400000 });
  const { id } = await f.request("overdue_dispatch", eids.order, eids.dispatcher, { weight_kg: 1250.5 });
  await f.db.exec(`insert into invoices(id,company_id,customer_id,invoice_number,due_date,status,grand_total) values('${eid(62)}','${eids.company}','${eids.kumar}','INV-0007',current_date - 60,'sent',30000)`);
  const row = (await f.toDecide(eids.accounts))[0];
  assert.equal((await f.command("request.decide", { id, decision: "approve", version: row.version }, eids.accounts)).status, "superseded", "exposure grew after the request");
});

// ---------- Policies and access ----------

test("policies are set by owners and admins within allowed approvers; requests are visible to their parties and approvers", async () => {
  await assert.rejects(f.policy("low_margin_quote", { approver_roles: ["owner"] }, eids.salesMgr), /not permitted/);
  await assert.rejects(f.policy("low_margin_quote", { approver_roles: ["accounts"] }), /Choose approvers allowed/);
  await assert.rejects(f.policy("overdue_dispatch", { approver_roles: ["owner"], min_overdue_amount: 100, hard_limit_amount: 50 }), /hard limit at or above the minimum/);
  await assert.rejects(f.policy("overdue_dispatch", { approver_roles: ["owner"], validity_hours: 200 }), /1 to 168 hours/);
  await assert.rejects(f.policy("credit_note", { approver_roles: ["owner"] }), /supported exception/);
  await lowMargin();
  await f.request("low_margin_quote", eids.quote);
  assert.equal((await f.asUser("select id from exception_requests", [], eids.production)).length, 0);
  assert.equal((await f.asUser("select id from exception_requests", [], eids.admin)).length, 1, "approvers see the request");
  assert.equal((await f.asUser("select id from exception_requests", [], eids.sales)).length, 1, "the requester sees it");
  assert.equal((await f.asUser("select id from exception_requests", [], eids.foreign)).length, 0);
  await assert.rejects(f.asUser(`update exception_requests set status='approved', expires_at=now()+interval '1 day', decided_by='${eids.sales}'`), /permission denied/);
  await assert.rejects(f.command("request.list", {}, eids.dealer), /not permitted/);
  await assert.rejects(f.asUser("select public.exception_command('policy.list','{}'::jsonb)", [], ""), /Authentication required/);
});
