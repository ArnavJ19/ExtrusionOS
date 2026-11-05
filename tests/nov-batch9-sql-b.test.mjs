import test from "node:test";
import assert from "node:assert/strict";
import { createNov9Fixture, nids as i, day } from "../scripts/lib/nov-batch9-fixture.mjs";
import { commercialOutcomeSchema } from "../lib/workflow/commercial.ts";

let f;
test.before(async () => { f = await createNov9Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { commercialOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { commercialOutcomeSchema.parse(result); assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const refused = (promise, pattern) => assert.rejects(promise, pattern);
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const row = async (view, id, actor = i.owner) => (await detail(view, id, actor)).row;
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
let expenseSeq = 0;
const addExpense = amount => f.db.query(`insert into expense_ledger(company_id,expense_number,source_module,expense_category,quantity,rate,base_amount,tax_amount,freight_amount,discount_amount,total_amount,currency,amount_paid,balance_amount,payment_status,approval_status,source_record_id)
  values($1,$2,'finishing','freight',1,$3,$3,0,0,0,$3,'INR',0,$3,'unpaid','approved',$4)`, [i.company, `EXP-NOV9-X${++expenseSeq}`, amount, i.orderProfit]);

// NOV-035 ---------------------------------------------------------------------------------------
test("NOV-035: estimate, invoiced revenue and linked cost are compared with every gap stated", async () => {
  const model = (await row("profitability", i.orderProfit, i.accounts)).details.model;
  assert.equal(model.has_estimate, true);
  assert.equal(n(model.estimated_revenue), 100000);
  assert.equal(n(model.estimated_cost), 83000); // 60000 + 10000 + 8000 + 2000 + 1000 + 1500 + 500
  assert.equal(n(model.invoiced_revenue), 90000, "the draft invoice is not revenue");
  assert.equal(model.invoice_count, 1);
  assert.equal(n(model.recorded_cost_total), 10500);
  assert.equal(model.recorded_cost_lines, 2);
  assert.equal(n(model.cost_variance), 10500 - 83000);
  assert.equal(n(model.revenue_variance), -10000);
  assert.equal(n(model.recorded_margin), 90000 - 10500);
  assert.equal(model.status, "provisional");
  assert.deepEqual(model.recorded_costs.map(c => c.category), ["finishing_vendor", "freight"]);
  // An order without an accepted estimate or an invoice says so instead of showing zero.
  const bare = (await row("profitability", i.orderBare, i.accounts));
  assert.equal(bare.status, "no_estimate");
  assert.equal(bare.details.model.has_estimate, false);
  assert.equal(bare.details.model.estimated_cost, null);
  assert.equal(bare.details.model.cost_variance, null);
  assert.equal(n(bare.details.model.recorded_cost_total), 700);
  assert.match(bare.details.model.missing.join(" "), /No accepted quotation snapshot/);
  assert.equal(n(bare.details.model.net_revenue), 5000);
  assert.doesNotMatch(bare.details.model.missing.join(" "), /No issued invoice yet/);
});

test("NOV-035: a credit note reduces net revenue", async () => {
  await f.db.exec("set session_replication_role = replica");
  await f.db.query("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,number_of_bundles,total_weight_kg,delivery_status) values('be500000-0000-4000-8000-0000000007a0',$1,$2,'D-NOV9-CN',current_date,1,10,'delivered')", [i.company, i.orderProfit]);
  await f.db.query("insert into credit_notes(company_id,invoice_id,dispatch_id,credit_note_number,reason,subtotal,tax_total,grand_total,status,idempotency_key) values($1,$2,'be500000-0000-4000-8000-0000000007a0','CN-NOV9','Returned goods',2000,360,2360,'issued',gen_random_uuid())", [i.company, i.invProfit]);
  await f.db.exec("set session_replication_role = origin");
  const credited = (await row("profitability", i.orderProfit, i.accounts)).details.model;
  assert.equal(n(credited.credited), 2000);
  assert.equal(n(credited.net_revenue), 88000);
  assert.match((await list("profitability", i.accounts)).rows.find(r => r.id === i.orderProfit).summary, /invoiced INR 88,000.00/);
});

test("NOV-035: snapshots are provisional until finalised, later adjustments are new evidence, and a changed source goes stale", async () => {
  const snapshot = (finalize, actor = i.accounts) => f.apply({ action: "profit.snapshot", order_id: i.orderProfit, finalize, note }, actor);
  confirmed(await snapshot(false));
  assert.equal((await row("profitability", i.orderProfit, i.accounts)).status, "provisional");
  const preview = await f.prepare({ action: "profit.snapshot", order_id: i.orderProfit, finalize: true, note }, i.accounts);
  assert.match(preview.review.warnings.join(" "), /Recorded cost covers only expenses linked/);
  // A new linked cost appears between review and confirmation: the confirmation is refused.
  await addExpense(100);
  rejected(await f.commit(preview, i.accounts), /relevant source changed/);
  confirmed(await snapshot(true));
  const finalised = await row("profitability", i.orderProfit, i.accounts);
  assert.equal(finalised.status, "finalized");
  assert.equal(n(finalised.details.model.recorded_cost_total), 10600);
  await refused(snapshot(true), /already finalised/);
  // A later cost is a new provisional snapshot that does not edit the finalised one.
  await addExpense(400);
  confirmed(await snapshot(false));
  const snapshots = (await f.db.query("select finalized,(model->>'recorded_cost_total')::numeric cost from job_profit_snapshots where order_id=$1 order by recorded_at,id", [i.orderProfit])).rows;
  assert.deepEqual(snapshots.map(s => [s.finalized, n(s.cost)]), [[false, 10500], [true, 10600], [false, 11000]]);
  await refused(f.prepare({ action: "profit.snapshot", order_id: i.orderBare, finalize: true, note }, i.accounts), /no estimate and cannot be finalised/);
  await refused(f.prepare({ action: "profit.snapshot", order_id: i.orderProfit, finalize: false, note }, i.sales), /Not permitted/);
  await refused(list("profitability", i.salesManager), /Not permitted/);
  await refused(f.prepare({ action: "profit.snapshot", order_id: i.foreignOrder, finalize: false, note }, i.accounts), /order is unavailable/);
  assert.equal((await detail("profitability", i.orderProfit, i.factory)).row.status, "finalized", "a factory manager may read but not record");
  await refused(f.prepare({ action: "profit.snapshot", order_id: i.orderProfit, finalize: false, note }, i.factory), /Not permitted/);
});

// NOV-039 ---------------------------------------------------------------------------------------
test("NOV-039: on-time, late and still-open promises are counted against the original date, with the sample size shown", async () => {
  const vendor = await row("reliability", i.vendor2, i.owner);
  const m = vendor.details.metrics;
  assert.equal(m.purchase_orders, 6);
  assert.equal(m.with_commitment, 6);
  assert.equal(m.on_time, 3, "received on or before the original promise");
  assert.equal(m.late, 2);
  assert.equal(m.open_past_date, 1, "promised date passed with nothing received");
  assert.equal(m.sample_ok, true);
  assert.equal(vendor.status, "attention");
  assert.deepEqual(m.units[0], { unit: "kg", ordered: 600, received: 500, accepted: 450, rejected: 50, held: 0 });
  const results = Object.fromEntries(vendor.details.orders.map(o => [o.po_number, o.result]));
  assert.equal(results["VPO-NOV9-1"], "on time");
  assert.equal(results["VPO-NOV9-2"], "late");
  assert.equal(results["VPO-NOV9-5"], "on time");
  assert.equal(results["VPO-NOV9-6"], "past promised date, nothing received");
  // The first supplier has one order and no promise: a small sample that is not ranked.
  const first = await row("reliability", i.vendor, i.owner);
  assert.equal(first.details.metrics.sample_ok, false);
  assert.equal(first.status, "low_sample");
  assert.match(first.summary, /small sample: not a ranking/);
  // Units are never added together: the first order has kilogram and metre lines.
  assert.deepEqual(first.details.metrics.units.map(u => u.unit).sort(), ["kg", "m"]);
});

test("NOV-039: a revised promise keeps the original date, so rescheduling never erases lateness", async () => {
  const set = (promised_date, actor = i.inventory, order = i.vpo2) => f.apply({ action: "commitment.set", purchase_order_id: order, promised_date, note }, actor);
  // VPO-NOV9-2 was promised 30 days ago and received 28 days ago: late. Revising the promise later cannot change that.
  confirmed(await set(day(-26)));
  const c = await one("select original_date::text o,current_date_promised::text c,revision_count r,jsonb_array_length(history) h from supplier_commitments where purchase_order_id=$1", [i.vpo2]);
  assert.equal(c.o, day(-30));
  assert.equal(c.c, day(-26));
  assert.equal(c.r, 1);
  assert.equal(c.h, 1);
  const m = (await row("reliability", i.vendor2, i.owner)).details.metrics;
  assert.equal(m.late, 2, "still late against the original promise");
  await refused(set(day(-26)), /already promised/);
  await refused(set(day(500)), /within a year of the order date/);
  await refused(set(day(-400)), /within a year of the order date/);
  await refused(set("2026-02-30"), /valid promised date/);
  // A first promise for an order that has no commitment becomes its original date.
  const firstTime = await f.prepare({ action: "commitment.set", purchase_order_id: i.po, promised_date: day(5), note }, i.inventory);
  assert.match(firstTime.review.facts["Original promise"], /This will be the original promise/);
  confirmed(await f.commit(firstTime, i.inventory));
  await refused(f.prepare({ action: "commitment.set", purchase_order_id: i.po, promised_date: day(6), note }, i.sales), /Not permitted/);
  await refused(list("reliability", i.sales), /Not permitted/);
  await refused(f.prepare({ action: "commitment.set", purchase_order_id: "be500000-0000-4000-8000-0000000009ff", promised_date: day(6), note }, i.inventory), /Choose a purchase order of this company/);
  assert.equal((await list("reliability", i.quality)).total_count, 2, "quality may read");
  await refused(f.prepare({ action: "commitment.set", purchase_order_id: i.po, promised_date: day(6), note }, i.quality), /Not permitted/);
});

// NOV-066 ---------------------------------------------------------------------------------------
test("NOV-066: wins come from orders, partial wins are measured in kilograms, and losses need a reason", async () => {
  const all = (await list("outcomes", i.salesManager)).rows;
  const byNumber = Object.fromEntries(all.map(r => [r.label.split(" ")[0], r.status]));
  assert.equal(byNumber["Q-NOV9-WON"], "won");
  assert.equal(byNumber["Q-NOV9-PART"], "partially_won");
  assert.equal(byNumber["Q-NOV9-OPEN"], "open");
  assert.equal(byNumber["Q-NOV9-SENT"], "needs_reason", "the validity date passed with no order");
  assert.equal(byNumber["Q-NOV9-REJ"], "needs_reason");
  assert.equal(byNumber["Q-NOV9-OLD"], "needs_reason");
  assert.equal(byNumber["Q-NOV9-DRAFT"], undefined, "a draft is not an opportunity");
  const part = all.find(r => r.label.startsWith("Q-NOV9-PART"));
  assert.equal(n(part.details.share.ordered_kg), 700);
  assert.equal(n(part.details.share.quoted_kg), 1000);
  // A loss is recorded once, with its evidence, against the current revision.
  confirmed(await f.apply({ action: "outcome.record", quote_id: i.quoteSent, outcome: "lost", reason_code: "price", evidence: "customer_stated", product_family: "Windows" }, i.sales));
  const recorded = await row("outcomes", i.quoteSent, i.sales);
  assert.equal(recorded.status, "lost");
  assert.equal(recorded.details.outcome_revision, 2);
  assert.equal(recorded.details.evidence, "customer_stated");
  await refused(f.prepare({ action: "outcome.record", quote_id: i.quoteSent, outcome: "withdrawn", reason_code: "other", evidence: "sales_observed" }, i.sales), /already recorded/);
  await refused(f.prepare({ action: "outcome.record", quote_id: i.quoteWon, outcome: "lost", reason_code: "price", evidence: "sales_observed" }, i.sales), /already show this quotation was won/);
  await refused(f.prepare({ action: "outcome.record", quote_id: i.quotePart, outcome: "lost", reason_code: "price", evidence: "sales_observed" }, i.sales), /already show this quotation was won/);
  await refused(f.prepare({ action: "outcome.record", quote_id: i.quoteDraft, outcome: "lost", reason_code: "price", evidence: "sales_observed" }, i.sales), /Only an issued quotation/);
  await refused(f.prepare({ action: "outcome.record", quote_id: i.quoteRejected, outcome: "lost", reason_code: "made_up", evidence: "sales_observed" }, i.sales), /Choose a reason/);
  await refused(f.prepare({ action: "outcome.record", quote_id: i.quoteRejected, outcome: "lost", reason_code: "price", evidence: "rumour" }, i.sales), /customer stated the reason or sales observed it/);
  const observed = await f.prepare({ action: "outcome.record", quote_id: i.quoteRejected, outcome: "lost", reason_code: "competitor", evidence: "sales_observed" }, i.sales);
  assert.match(observed.review.warnings.join(" "), /observation, not a customer-confirmed cause/);
  // Reopening keeps the earlier outcome in the history and returns the quotation to waiting for a reason.
  confirmed(await f.apply({ action: "outcome.reopen", quote_id: i.quoteSent, note }, i.salesManager));
  assert.equal((await row("outcomes", i.quoteSent, i.sales)).status, "needs_reason");
  assert.equal(n((await one("select count(*) c from quote_outcomes where quote_id=$1 and status='reopened'", [i.quoteSent])).c), 1);
  await refused(f.prepare({ action: "outcome.reopen", quote_id: i.quoteSent, note }, i.sales), /No outcome is recorded/);
  confirmed(await f.apply({ action: "outcome.record", quote_id: i.quoteSent, outcome: "no_decision", reason_code: "no_response", evidence: "sales_observed" }, i.sales));
  assert.equal((await detail("outcomes", i.quoteSent, i.sales)).events.length, 3);
  await refused(list("outcomes", i.accounts), /Not permitted/);
});

test("NOV-066: cohorts state the denominator, count each opportunity once and never count a cancelled order as a win", async () => {
  confirmed(await f.apply({ action: "outcome.record", quote_id: i.quoteSent, outcome: "lost", reason_code: "price", evidence: "customer_stated" }, i.sales));
  confirmed(await f.apply({ action: "outcome.record", quote_id: i.quoteRejected, outcome: "withdrawn", reason_code: "specification", evidence: "sales_observed" }, i.sales));
  let cohort = (await list("cohorts", i.salesManager)).rows[0];
  const d = cohort.details;
  assert.equal(d.quotations, 7, "seven issued quotations; the draft is not an opportunity and revisions are not extra opportunities");
  assert.deepEqual([d.won, d.partially_won, d.lost, d.withdrawn, d.no_decision, d.needs_reason, d.open], [2, 1, 1, 1, 0, 1, 1]);
  assert.equal(d.decided, 5);
  assert.deepEqual(d.reasons, { price: 1, specification: 1 });
  assert.deepEqual(d.evidence, { customer_stated: 1, sales_observed: 1 });
  assert.equal(cohort.status, "in_progress");
  assert.equal((await detail("cohorts", cohort.id, i.salesManager)).row.details.quotations, 7);
  // A cancelled order no longer proves the win.
  await f.db.query("update orders set current_stage='cancelled' where id=$1", [i.orderWon]);
  cohort = (await list("cohorts", i.salesManager)).rows[0];
  assert.equal(cohort.details.won, 1);
  assert.equal((await row("outcomes", i.quoteWon, i.sales)).status, "open", "without an order the approved quotation is simply open again");
  await refused(list("cohorts", i.sales), /Not permitted/);
  assert.equal(JSON.stringify(cohort).includes("margin"), false, "no margin or internal cost appears in the cohort");
});
