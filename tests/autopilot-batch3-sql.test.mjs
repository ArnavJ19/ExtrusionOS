import test from "node:test";
import assert from "node:assert/strict";
import { createCashFixture, cIds as i, nid, istDay, GSTIN } from "../scripts/lib/autopilot-batch3-fixture.mjs";

let f;
test.before(async () => { f = await createCashFixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const n = value => (value === null || value === undefined ? value : Number(value));
const count = async (sql, params = []) => Number((await f.one(sql, params)).c);
const credit = (command, payload = {}, actor = i.accounts) => f.call("ap_credit", command, payload, actor);
const drafts = (command, payload = {}, actor = i.productionManager) => f.call("ap_jobdrafts", command, payload, actor);
const billing = (command, payload = {}, actor = i.accounts) => f.call("ap_billing", command, payload, actor);
const cash = (command, payload = {}, actor = i.accounts) => f.call("ap_cash", command, payload, actor);
const quotes = (command, payload = {}, actor = i.sales) => f.call("ap_quotes", command, payload, actor);
const dupes = (command, payload = {}, actor = i.sales) => f.call("ap_dupes", command, payload, actor);
const decide = (id, decision, extra = {}, actor = i.accounts) => f.call("ap_proposals", "decide", { id, decision, ...extra }, actor);
const confirmRule = (extra = {}) => billing("gst_confirm", { hsn_profile: "7604", hsn_scrap: "7602", note: "Confirmed with the CA", ...extra });

test("AP-037 place of supply comes from the billing GSTIN, or the recorded state when unregistered; unknown stays blank", async () => {
  const mh = await billing("gst_derive", { customer_id: i.customer2 });
  assert.equal(mh.state, "27");
  assert.equal(mh.basis, "billing_gstin");
  assert.equal(mh.tax_type, "igst");
  const dl = await billing("gst_derive", { customer_id: i.customer });
  assert.equal(dl.tax_type, "cgst_sgst");
  const unregistered = await billing("gst_derive", { customer_id: i.customer3 });
  assert.equal(unregistered.state, "07");
  assert.equal(unregistered.basis, "customer_state");
  const unknown = await billing("gst_derive", { customer_id: i.customer4 });
  assert.equal(unknown.state, null, "no GSTIN and no state stays blank, never guessed");
  assert.equal(unknown.tax_type, null);
  await assert.rejects(() => billing("gst_derive", { customer_id: i.customer2 }, i.sales), err => err.code === "42501");
});

test("AP-037 an invoice without a place of supply takes the derived state; a different state needs a recorded override once the rule is confirmed", async () => {
  await f.confirmOrder({ id: nid(3099), value: 1000 });
  const insert = (id, pos, dispatch = null) => f.asOwnerFor(`insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,dispatch_id,order_id)
    values($1,$2,$3,$4,current_date,'generated',100,18,118,0,$5,$6,$7) returning place_of_supply_state_code, igst_amount, cgst_amount`,
    [id, i.company, i.customer2, `T-${id.slice(-4)}`, pos, dispatch, dispatch ? nid(3099) : null], i.accounts);
  const derived = (await insert(nid(3001), null))[0];
  assert.equal(derived.place_of_supply_state_code, "27");
  assert.equal(n(derived.igst_amount), 18, "inter-state: IGST");
  const advisory = (await insert(nid(3002), "07"))[0];
  assert.equal(advisory.place_of_supply_state_code, "07", "before accounts confirms the rule, a different state is recorded but not refused");
  await confirmRule();
  await assert.rejects(() => insert(nid(3003), "07"), /differs from 27/);
  await f.packDispatch({ id: nid(3100), order: nid(3099), lines: [{ id: nid(3101), kg: 100 }] });
  await assert.rejects(() => billing("gst_override", { dispatch_id: nid(3100), state: "07", reason: "short" }), /10 to 300/);
  await billing("gst_override", { dispatch_id: nid(3100), state: "07", reason: "Bill-to party instructed delivery to Delhi branch" });
  const ok = (await insert(nid(3004), "07", nid(3100)))[0];
  assert.equal(n(ok.cgst_amount), 9, "intra-state after override: CGST + SGST");
  const snap = await f.one("select * from invoice_supply_derivations where invoice_id=$1", [nid(3004)]);
  assert.equal(snap.derived_state, "27");
  assert.equal(snap.chosen_state, "07");
  assert.ok(snap.override_id, "the override reason is linked to the invoice");
  const token = await f.one("select consumed_invoice_id, consumed_at from invoice_supply_overrides where dispatch_id=$1", [nid(3100)]);
  assert.equal(token.consumed_invoice_id, nid(3004), "an override is used once, by the invoice it was recorded for");
  const sample = await billing("gst_sample", { only_mismatch: true });
  assert.equal(sample.rows.filter(r => r.override_reason).length, 1);
});

test("AP-037 HSN defaults by item type: new profiles take the confirmed code and accounts can fill the blanks", async () => {
  await f.db.query("update aluminium_profiles set hsn_code=null where id=$1", [i.profile]);
  await confirmRule();
  await f.asUser("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,alloy,temper) values($1,$2,'OM-NEW','New section',1.1,'6063','T6')", [nid(3200), i.company], i.owner);
  assert.equal((await f.one("select hsn_code from aluminium_profiles where id=$1", [nid(3200)])).hsn_code, "7604");
  const applied = await billing("hsn_apply");
  assert.equal(applied.profiles_updated, 1);
  await assert.rejects(() => billing("gst_confirm", { hsn_profile: "760" }), /4, 6 or 8 digits/);
});

test("AP-032 credit limits are set by accounts with a reason and versioned; exposure adds open balances, unbilled dispatches and the order, less on-account money", async () => {
  await assert.rejects(() => credit("set_limit", { customer_id: i.customer2, credit_limit: "50000", reason: "Agreed terms" }, i.sales), err => err.code === "42501");
  await credit("set_limit", { customer_id: i.customer2, credit_limit: "40000", credit_days: "30", grace_days: "0", reason: "Agreed at review" });
  await credit("set_limit", { customer_id: i.customer2, credit_limit: "60000", credit_days: "30", grace_days: "7", reason: "Raised after advance" });
  assert.equal(await count("select count(*) c from customer_credit_limits where customer_id=$1 and status='active'", [i.customer2]), 1);
  assert.equal(await count("select count(*) c from customer_credit_limits where customer_id=$1", [i.customer2]), 2);
  await f.seed("insert into customer_on_account_credits(company_id,customer_id,source,payment_method,reference,received_on,amount,created_by) values($1,$2,'receipt','bank_transfer','UTR-OA',current_date,2000,$3)",
    [i.company, i.customer2, i.accounts]);
  const view = await credit("customer", { customer_id: i.customer2 }, i.sales);
  assert.equal(n(view.exposure.outstanding), 35000);
  assert.equal(n(view.exposure.on_account), 2000);
  assert.equal(n(view.exposure.exposure), 33000);
  assert.equal(n(view.exposure.overdue_beyond_grace), 10000, "only the invoice 20 days late is beyond the 7-day grace");
  assert.equal(view.exposure.result, "overdue");
});

test("AP-032 an over-limit order confirms into credit hold with an approval request; within-limit and no-limit customers pass", async () => {
  await credit("set_limit", { customer_id: i.customer2, credit_limit: "50000", grace_days: "30", reason: "Agreed at review" });
  await f.confirmOrder({ id: nid(3300), value: 10000 });
  let check = await f.one("select * from order_credit_checks where order_id=$1", [nid(3300)]);
  assert.equal(check.result, "within");
  assert.equal(check.outcome, "passed");
  assert.equal(n(check.exposure), 45000);
  await f.confirmOrder({ id: nid(3301), value: 30000 });
  const hold = await f.one("select * from order_credit_holds where order_id=$1", [nid(3301)]);
  assert.equal(hold.status, "held");
  assert.equal(n(hold.exposure), 65000, "35,000 open + 30,000 this order (the first order is not dispatched)");
  assert.match(hold.reasons[0], /above the INR 50,000.00 credit limit/);
  assert.equal(await count("select count(*) c from notifications where condition_key=$1 and recipient_role in ('owner','accounts')", [`credit-hold:${nid(3301)}`]), 2);
  await f.confirmOrder({ id: nid(3302), customer: i.customer3, value: 900000 });
  assert.equal((await f.one("select outcome from order_credit_checks where order_id=$1", [nid(3302)])).outcome, "not_checked");
  assert.equal(await count("select count(*) c from order_credit_holds where order_id=$1", [nid(3302)]), 0);
});

test("AP-032 holds are decided by an approver other than the order's creator; dispatch needs an unexpired approval that covers the exposure", async () => {
  await credit("set_limit", { customer_id: i.customer2, credit_limit: "50000", grace_days: "30", reason: "Agreed at review" });
  await f.confirmOrder({ id: nid(3310), value: 30000, creator: i.accounts });
  const hold = await f.one("select * from order_credit_holds where order_id=$1", [nid(3310)]);
  await assert.rejects(() => credit("decide", { hold_id: hold.id, decision: "approve" }, i.sales), /does not approve credit/);
  await assert.rejects(() => credit("decide", { hold_id: hold.id, decision: "approve" }, i.accounts), /Another person/);
  await assert.rejects(() => credit("decide", { hold_id: hold.id, decision: "reject" }, i.owner), /Note is required/);
  await f.packDispatch({ id: nid(3311), order: nid(3310), lines: [{ id: nid(3312), kg: 50, rate: 300 }] });
  await assert.rejects(() => f.gateOut(nid(3311)), /Credit hold on order/);
  const approved = await credit("decide", { hold_id: hold.id, decision: "approve", note: "Advance cheque received" }, i.owner);
  assert.equal(approved.status, "approved");
  assert.ok(n(approved.approved_exposure) >= 65000);
  await f.gateOut(nid(3311));
  assert.equal((await f.one("select outcome from order_credit_checks where dispatch_id=$1", [nid(3311)])).outcome, "approved_cover");
  await f.db.query("update order_credit_holds set expires_at=now()-interval '1 minute' where id=$1", [hold.id]);
  await f.packDispatch({ id: nid(3313), order: nid(3310), lines: [{ id: nid(3314), kg: 50, rate: 300 }] });
  await assert.rejects(() => f.gateOut(nid(3313)), /Credit hold on order/, "an expired approval does not cover a later dispatch");
});

test("AP-032 / AP-098 a payment that brings the customer within limit clears the hold by itself and records why", async () => {
  await credit("set_limit", { customer_id: i.customer2, credit_limit: "50000", grace_days: "30", reason: "Agreed at review" });
  await f.confirmOrder({ id: nid(3320), value: 30000 });
  assert.equal((await f.one("select status from order_credit_holds where order_id=$1", [nid(3320)])).status, "held");
  await f.asUser("select public.post_financial_receipt_atomic($1,$2,$3)", [{ amount: 20000, payment_date: istDay(0), payment_method: "bank_transfer", reference_number: "UTR-CLEAR-1" },
    [{ invoice_id: i.inv1, amount: 10000 }, { invoice_id: i.inv2, amount: 10000 }], nid(3321)], i.accounts);
  const hold = await f.one("select * from order_credit_holds where order_id=$1 order by created_at desc limit 1", [nid(3320)]);
  assert.equal(hold.status, "cleared");
  assert.match(hold.cleared_note, /within the credit limit/);
  assert.equal(await count("select count(*) c from alert_resolutions where source_kind='credit_hold' and source_id=$1", [hold.id]), 1);
  assert.equal(await count("select count(*) c from notifications where condition_key=$1 and resolved_at is not null", [`credit-hold:${nid(3320)}`]), 2,
    "the credit-hold alerts close when the hold clears");
});

test("AP-045 confirmed orders become draft jobs grouped by die, alloy and temper; drafts reserve nothing", async () => {
  await f.confirmOrder({ id: nid(3400), lines: [{ id: nid(3401), kg: 570, pieces: 100, die: i.die }] });
  await f.confirmOrder({ id: nid(3402), lines: [{ id: nid(3403), kg: 285, pieces: 50, die: i.die }, { id: nid(3404), kg: 300, pieces: 60, die: i.die, spec: { temper: "T6" } }] });
  const groups = await f.db.query("select d.group_key, count(l.*) lines, sum(l.required_kg) kg from production_job_drafts d join production_job_draft_lines l on l.draft_id=d.id where d.company_id=$1 group by d.group_key order by 1", [i.company]);
  assert.equal(groups.rows.length, 2, "T5 lines of both orders share one draft; the T6 line has its own");
  const t5 = groups.rows.find(r => r.group_key.endsWith("|t5"));
  assert.equal(Number(t5.lines), 2);
  assert.equal(n(t5.kg), 855);
  assert.equal(await count("select count(*) c from production_jobs where order_id = any($1)", [[nid(3400), nid(3402)]]), 0, "no job until released");
  assert.equal(await count("select count(*) c from profile_stock_reservations where order_id = any($1)", [[nid(3400), nid(3402)]]), 0);
  const list = await drafts("list");
  assert.equal(list.total_count, 2);
  await assert.rejects(() => drafts("list", {}, i.sales), err => err.code === "42501");
});

test("AP-045 releasing a draft creates planned jobs per order line through the job save; held, covered and released lines are not re-released", async () => {
  await credit("set_limit", { customer_id: i.customer2, credit_limit: "50000", grace_days: "30", reason: "Agreed at review" });
  await f.confirmOrder({ id: nid(3410), value: 10000, lines: [{ id: nid(3411), kg: 570, pieces: 100, die: i.die }] });
  await f.confirmOrder({ id: nid(3412), value: 90000, lines: [{ id: nid(3413), kg: 285, pieces: 50, die: i.die }] });
  const draft = await f.one("select id from production_job_drafts where company_id=$1 and status='open'", [i.company]);
  await assert.rejects(() => drafts("release", { id: draft.id }, i.sales), err => err.code === "42501");
  const out = await drafts("release", { id: draft.id, planned_date: istDay(1) });
  assert.equal(out.released.length, 1);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /credit hold/);
  const job = await f.one("select * from production_jobs where id=$1", [out.released[0].job_id]);
  assert.equal(job.status, "planned");
  assert.equal(job.source_line_id, nid(3411));
  assert.equal(n(job.planned_quantity_kg), 570);
  assert.equal(job.die_id, i.die);
  const again = await drafts("release", { id: draft.id });
  assert.equal(again.released.length, 0, "the released line is not released twice");
  const stats = await drafts("stats");
  assert.equal(stats.jobs_from_drafts, 1);
});

// ---------------------------------------------------------------------------------------------------------------
async function gatedDispatch(base, { rate = 300, kg = 100, value = 1000 } = {}) {
  await f.confirmOrder({ id: nid(base), value, lines: [{ id: nid(base + 1), kg }] });
  await f.packDispatch({ id: nid(base + 2), order: nid(base), lines: [{ id: nid(base + 3), kg, rate, item: nid(base + 1) }] });
  await f.gateOut(nid(base + 2));
  return f.one("select * from invoice_drafts where dispatch_id=$1", [nid(base + 2)]);
}

test("AP-046 gate-out prepares an invoice draft with totals and no number; an unpriced packing list stays blocked with its reason", async () => {
  const d = await gatedDispatch(3500);
  assert.equal(d.status, "open");
  assert.equal(n(d.goods_value), 30000);
  assert.equal(n(d.tax_value), 5400);
  assert.equal(n(d.total_value), 35400);
  assert.equal(d.place_of_supply_state_code, "27");
  assert.match(d.source_fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(await count("select count(*) c from invoices where dispatch_id=$1", [nid(3502)]), 0, "no invoice number is allocated for a draft");
  const blocked = await gatedDispatch(3510, { rate: 0 });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.blocker, /positive weight and rate/);
  const list = await billing("drafts", { status: "all" });
  assert.equal(list.total_count, 2);
  assert.equal(list.summary.open, 1);
  await assert.rejects(() => billing("drafts", {}, i.sales), err => err.code === "42501");
});

test("AP-046 an invoice for the dispatch closes its draft and cancelling it reopens the draft; unbilled dispatches age in working days and need an explanation", async () => {
  const d = await gatedDispatch(3520);
  await f.seed("update dispatches set actual_dispatched_at=now()-interval '6 days' where id=$1", [nid(3522)]);
  const late = await billing("unbilled", { only_late: true });
  assert.equal(late.total_count, 1);
  assert.equal(late.rows[0].late, true);
  assert.equal(late.summary.late_unexplained, 1);
  await assert.rejects(() => billing("explain", { dispatch_id: nid(3522), reason: "no" }), /5 to 300/);
  await billing("explain", { dispatch_id: nid(3522), reason: "Customer asked to hold billing till rate is confirmed" });
  assert.equal((await billing("unbilled", { only_late: true })).summary.late_explained, 1);
  await f.seed("update packing_list_items set net_rate=310 where id=$1", [nid(3523)]);
  const changed = await billing("post_data", { ids: [d.id] });
  assert.equal(changed.rows[0].state, "changed", "a packing change after the draft makes it re-review, not post");
  const ready = await billing("post_data", { ids: [d.id] });
  assert.equal(ready.rows[0].state, "ready");
  assert.equal(n((await f.one("select goods_value from invoice_drafts where id=$1", [d.id])).goods_value), 31000);
  await f.asOwnerFor(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,invoice_number,invoice_date,status,subtotal,tax_total,grand_total,amount_paid)
    values($1,$2,$3,$4,$5,'INV-B3-1',current_date,'generated',31000,5580,36580,0)`, [nid(3529), i.company, i.customer2, nid(3520), nid(3522)], i.accounts);
  let after = await f.one("select status, invoice_id from invoice_drafts where id=$1", [d.id]);
  assert.equal(after.status, "posted");
  assert.equal(after.invoice_id, nid(3529));
  assert.equal((await billing("unbilled")).total_count, 0);
  await f.asOwnerFor("update invoices set status='cancelled' where id=$1", [nid(3529)], i.accounts);
  after = await f.one("select status, invoice_id from invoice_drafts where id=$1", [d.id]);
  assert.equal(after.status, "open", "a cancelled invoice reopens the draft so the dispatch is billed again");
});

test("AP-058 allocation takes invoices named in the narration first, then the oldest; anything above the open invoices stays on account", async () => {
  const named = await cash("propose", { customer_id: i.customer2, amount: "28000", narration: "NEFT CR SHARMA FAB OMX/26-27/0102" });
  assert.deepEqual(named.allocations.map(a => [a.invoice_id, n(a.amount), a.basis]), [[i.inv2, 20000, "named"], [i.inv1, 8000, "oldest"]]);
  assert.equal(n(named.on_account), 0);
  const big = await cash("propose", { customer_id: i.customer2, amount: "40000" });
  assert.deepEqual(big.allocations.map(a => n(a.amount)), [10000, 20000, 5000]);
  assert.equal(n(big.on_account), 5000);
  await assert.rejects(() => cash("propose", { customer_id: i.customer2, amount: "100" }, i.sales), err => err.code === "42501");
});

test("AP-058 a reviewed receipt posts the allocated part and keeps the rest on account; retries are idempotent; on-account money is applied later oldest first", async () => {
  const proposed = await cash("propose", { customer_id: i.customer2, amount: "40000" });
  const body = { key: nid(3600), customer_id: i.customer2, amount: "40000", payment_date: istDay(0), payment_method: "bank_transfer", reference_number: "UTR40000",
    allocations: proposed.allocations.map(a => ({ invoice_id: a.invoice_id, amount: n(a.amount) })), on_account: "5000", proposed };
  await assert.rejects(() => cash("post", { ...body, key: nid(3601), on_account: "4000" }), /must add up/);
  await assert.rejects(() => cash("post", { ...body, key: nid(3602), allocations: [{ invoice_id: i.invoice, amount: 35000 }] }), /belong to this customer/);
  const res = await cash("post", body);
  assert.equal(n(res.allocated), 35000);
  assert.equal(n(res.on_account), 5000);
  assert.equal(await count("select count(*) c from invoices where customer_id=$1 and balance_due > 0", [i.customer2]), 0);
  const replay = await cash("post", body);
  assert.equal(replay.replayed, true);
  await assert.rejects(() => cash("post", { ...body, notes: "changed" }), /different details/);
  assert.equal((await f.one("select changed from receipt_allocation_audits where idempotency_key=$1", [nid(3600)])).changed, false);
  await f.seed(`insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,supplier_state_code)
    values($1,$2,$3,'OMX/26-27/0110',current_date,current_date+30,'generated',3000,0,3000,0,'27','07')`, [nid(3610), i.company, i.customer2]);
  const credit = await f.one("select id from customer_on_account_credits where customer_id=$1 and status='open'", [i.customer2]);
  const applied = await cash("apply_on_account", { credit_id: credit.id, key: nid(3611) });
  assert.equal(n(applied.applied), 3000);
  assert.equal(n(applied.remaining), 2000);
  assert.equal((await f.one("select reference_number from financial_receipt_events where id=$1", [applied.receipt_id])).reference_number, "UTR40000/OA1");
  assert.equal(n((await f.one("select applied_amount from customer_on_account_credits where id=$1", [credit.id])).applied_amount), 3000);
});

const statement = (fingerprint, rows, actor = i.accounts) => cash("bank_import", { source_name: "HDFC-Nov.csv", file_fingerprint: fingerprint, rows }, actor);
const fp = k => k.repeat(32).slice(0, 32);

test("AP-024 importing a statement dedupes lines, ignores debits, reports unreadable rows and refuses the same file twice", async () => {
  const rows = [
    { line_no: 1, txn_date: istDay(-1), narration: "NEFT CR-SBIN0001234-SHARMA FABRICATORS-OMX/26-27/0101", reference: "SBIN123456789", credit: "10000" },
    { line_no: 2, txn_date: istDay(-1), narration: "NEFT CR-SBIN0001234-SHARMA FABRICATORS-OMX/26-27/0101", reference: "SBIN123456789", credit: "10000" },
    { line_no: 3, txn_date: istDay(-1), narration: "ATM WDL", debit: "5000" },
    { line_no: 4, txn_date: istDay(-1), narration: "IMPS 998877 RAJ ENTERPRISES", credit: "7777" },
    { line_no: 5, txn_date: "not-a-date", narration: "Unreadable", credit: "1" },
    { line_no: 6, txn_date: istDay(-1), narration: "UPI/CR/1234567890/PAYMENT", credit: "5000" }
  ];
  const r = await statement(fp("a"), rows);
  assert.equal(r.new_lines, 4);
  assert.equal(r.duplicates, 1);
  assert.equal(r.credits, 3);
  assert.deepEqual([r.exact, r.likely, r.unknown], [1, 1, 1]);
  assert.equal(r.errors.length, 1);
  assert.equal((await statement(fp("a"), rows)).already_imported, true);
  const overlap = await statement(fp("b"), [rows[0], { line_no: 2, txn_date: istDay(0), narration: "NEFT CR NEW PARTY", credit: "1234" }]);
  assert.equal(overlap.duplicates, 1, "a line seen in an earlier statement is not imported again");
  assert.equal((await f.one("select state from bank_statement_lines where narration='ATM WDL'")).state, "ignored");
  await assert.rejects(() => statement(fp("d"), rows, i.sales), err => err.code === "42501");
});

test("AP-024 accepting a match posts one receipt; an unknown remitter is assigned once and learned; reversal needs a reason and frees the line", async () => {
  await statement(fp("e"), [
    { line_no: 1, txn_date: istDay(-1), narration: "NEFT CR-SBIN0001234-SHARMA FABRICATORS-OMX/26-27/0101", reference: "SBIN123456789", credit: "10000" },
    { line_no: 2, txn_date: istDay(-1), narration: "IMPS 998877 RAJ ENTERPRISES", credit: "700" }]);
  const line1 = await f.one("select * from bank_statement_lines where reference='SBIN123456789'");
  assert.equal(line1.match_class, "exact");
  const p = await f.one("select * from proposals where proposal_type='bank.receipt_match' and target_key=$1 and status='open'", [line1.id]);
  const accepted = await decide(p.id, "accept");
  assert.equal(accepted.state, "accepted");
  const done = await f.one("select * from bank_statement_lines where id=$1", [line1.id]);
  assert.equal(done.state, "receipted");
  assert.ok(done.receipt_event_id);
  assert.equal(n((await f.one("select balance_due from invoices where id=$1", [i.inv1])).balance_due), 0);
  const line2 = await f.one("select * from bank_statement_lines where narration like 'IMPS 998877%'");
  assert.equal(line2.state, "unmatched");
  const assigned = await cash("bank_assign", { line_id: line2.id, customer_id: i.customer });
  assert.equal(assigned.learned_remitter, "RAJ ENTERPRISES");
  assert.equal(assigned.class, "exact", "a person's assignment within the open balance is exact");
  await statement(fp("f"), [{ line_no: 1, txn_date: istDay(0), narration: "IMPS 445566 RAJ ENTERPRISES", credit: "250" }]);
  const next = await f.one("select * from bank_statement_lines where narration like 'IMPS 445566%'");
  assert.equal(next.match_class, "exact");
  assert.deepEqual(next.match_evidence.signals, ["learned_remitter"]);
  await assert.rejects(() => cash("bank_reverse", { line_id: line1.id, reason: "wrong" }), /10 to 300/);
  const rev = await cash("bank_reverse", { line_id: line1.id, reason: "Credit belonged to another customer" });
  assert.equal(rev.payments_reversed, 1);
  assert.equal((await f.one("select state, reversal_count from bank_statement_lines where id=$1", [line1.id])).state, "unmatched");
  assert.equal(n((await f.one("select balance_due from invoices where id=$1", [i.inv1])).balance_due), 10000);
  const rate = await cash("bank_rate", {});
  assert.ok(rate.credits >= 3);
});

test("AP-024 a match goes stale when the customer's open invoices change before it is accepted", async () => {
  await statement(fp("c"), [{ line_no: 1, txn_date: istDay(-1), narration: "NEFT CR SHARMA FABRICATORS OMX/26-27/0102", reference: "UTR-STALE", credit: "20000" }]);
  const line = await f.one("select * from bank_statement_lines where reference='UTR-STALE'");
  const p = await f.one("select * from proposals where target_key=$1 and status='open'", [line.id]);
  await f.asUser("select public.post_financial_receipt_atomic($1,$2,$3)", [{ amount: 1000, payment_date: istDay(0), payment_method: "cash" },
    [{ invoice_id: i.inv2, amount: 1000 }], nid(3700)], i.accounts);
  const result = await decide(p.id, "accept");
  assert.equal(result.state, "stale");
  assert.equal((await f.one("select state from bank_statement_lines where id=$1", [line.id])).state, "unmatched");
});

test("AP-084 the morning queue prepares one reminder per customer; commitments skip invoices; nothing is sent automatically", async () => {
  await f.seed(`insert into collection_promises(id,company_id,invoice_id,employee_id,original_due_date,due_date,amount,baseline_paid,baseline_cash,baseline_credited)
    values($1,$2,$3,$4,$5,$6,10000,0,0,0)`, [nid(3800), i.company, i.inv1, i.accounts, istDay(-20), istDay(5)]);
  const run = await cash("prepare_reminders");
  assert.equal(run.prepared, 1);
  const r = await f.one("select * from payment_reminders where customer_id=$1", [i.customer2]);
  assert.deepEqual(r.invoices.map(x => x.invoice_number), ["OMX/26-27/0102", "OMX/26-27/0103"], "the invoice with an active payment promise is skipped");
  assert.equal(n(r.total_due), 25000);
  assert.match(r.message, /Rs 25,000\.00/);
  assert.match(r.message, /5 days overdue/);
  assert.doesNotMatch(r.message, /margin|cost|internal/i);
  assert.equal(r.status, "prepared");
  assert.equal((await cash("prepare_reminders")).prepared, 0, "one reminder per customer per day");
  await cash("reminder_copied", { id: r.id });
  assert.equal((await f.one("select status from payment_reminders where id=$1", [r.id])).status, "prepared", "copying is not sending");
  await assert.rejects(() => cash("reminder_sent", { id: r.id, channel: "sms" }), /how the reminder was sent/);
  await cash("reminder_sent", { id: r.id, channel: "whatsapp" });
  await assert.rejects(() => cash("reminder_skip", { id: r.id, reason: "Already paid" }), /already sent/);
  const coverage = await cash("reminder_coverage");
  assert.equal(coverage.summary.covered_by_commitment, 1);
  assert.equal(coverage.summary.covered_by_reminder, 1);
});

async function seedQuote(id, { status = "sent", validUntil = istDay(-1), quoteDate = istDay(-16), creator = i.sales } = {}) {
  await f.seed(`insert into quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,subtotal,total_before_gst,gst_percent,gst_amount,grand_total,revision_number,created_by)
    values($1,$2,$3,$4,$5,$6,$7,23000,23000,18,4140,27140,1,$8)`, [id, i.company, `Q-B3-${id.slice(-4)}`, i.customer2, quoteDate, validUntil, status, creator]);
  await f.seed(`insert into quote_items(id,company_id,quote_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,total_weight_kg,billet_rate_per_kg,conversion_charge_per_kg,
      gst_percent,hsn_code,drawing_approval_status,costing_complete,revision_number,expected_recovery_percent,margin_percent)
    values($1,$2,$3,$4,'Sliding track',100,6,0.95,570,230,35,18,'7604','Approved',true,1,90,10)`, [nid(Number(id.slice(-4)) + 1), i.company, id, i.profile2]);
}

test("AP-031 the nightly job expires sent quotations with history; an order cannot be created from a lapsed quotation", async () => {
  await seedQuote(nid(3900));
  await f.call("ap_jobs", "run_now", { job_key: "quotes.expire" }, i.owner);
  assert.equal((await f.one("select status from quotes where id=$1", [nid(3900)])).status, "expired");
  assert.equal((await f.one("select event from quote_validity_events where quote_id=$1", [nid(3900)])).event, "expired");
  assert.equal(await count("select count(*) c from notifications where recipient_user_id=$1 and condition_key=$2", [i.sales, `quote-expired:${nid(3900)}`]), 1);
  await seedQuote(nid(3910), { status: "customer_approved" });
  await assert.rejects(() => f.asOwnerFor(`insert into orders(id,company_id,order_number,customer_id,order_date,priority,current_stage,quote_id) values($1,$2,'SO-LAPSED',$3,current_date,'normal','order_confirmed',$4)`,
    [nid(3912), i.company, i.customer2, nid(3910)], i.owner), /was valid until/);
});

test("AP-031 extending validity needs an approver other than the requester; approval brings an expired quotation back to sent", async () => {
  await seedQuote(nid(3920), { status: "expired" });
  await assert.rejects(() => quotes("extend", { quote_id: nid(3920), valid_until: istDay(10), reason: "short" }), /10 to 500/);
  const req = await quotes("extend", { quote_id: nid(3920), valid_until: istDay(10), reason: "Customer confirms order after site visit" });
  assert.equal(req.state, "requested");
  await assert.rejects(() => quotes("decide_extension", { request_id: req.request_id, decision: "approve" }, i.sales), /does not approve/);
  await assert.rejects(() => quotes("decide_extension", { request_id: req.request_id, decision: "reject" }, i.salesManager), /Note is required/);
  await quotes("decide_extension", { request_id: req.request_id, decision: "approve", note: "Rates unchanged this week" }, i.salesManager);
  const q = await f.one("select status, valid_until::text v from quotes where id=$1", [nid(3920)]);
  assert.equal(q.status, "sent");
  assert.equal(q.v, istDay(10));
  const direct = await quotes("extend", { quote_id: nid(3920), valid_until: istDay(20), reason: "Second extension by manager" }, i.salesManager);
  assert.equal(direct.state, "extended", "an approver's own extension applies directly (recorded with the reason)");
});

test("AP-031 requote copies the lines into a new revision at today's approved rates and returns the quotation to draft", async () => {
  await seedQuote(nid(3930), { status: "expired" });
  await assert.rejects(() => quotes("requote", { quote_id: nid(3930) }, i.sales), /owner or admin/);
  const res = await quotes("requote", { quote_id: nid(3930) }, i.owner);
  assert.equal(res.revision_number, 2);
  assert.equal(res.status, "draft");
  const q = await f.one("select status, revision_number from quotes where id=$1", [nid(3930)]);
  assert.equal(q.status, "draft");
  assert.equal(q.revision_number, 2);
  const item = await f.one("select billet_rate_per_kg, conversion_charge_per_kg from quote_items where quote_id=$1", [nid(3930)]);
  assert.equal(n(item.billet_rate_per_kg), 245);
  assert.equal(n(item.conversion_charge_per_kg), 38);
  assert.equal(await count("select count(*) c from quote_revisions where quote_id=$1", [nid(3930)]), 1, "the expired revision is kept");
});

test("AP-097 possible duplicates are reported before saving and the person's decision is logged", async () => {
  await f.confirmOrder({ id: nid(4000), value: 50000 });
  const order = await dupes("check", { kind: "order", customer_id: i.customer2, order_value: "50100" });
  assert.equal(order.matches.length, 1);
  assert.match(order.matches[0].why, /Same customer and value/);
  assert.equal((await dupes("check", { kind: "order", customer_id: i.customer2, order_value: "55000" })).matches.length, 0);
  await f.asUser("select public.post_financial_receipt_atomic($1,$2,$3)", [{ amount: 1000, payment_date: istDay(0), payment_method: "bank_transfer", reference_number: "UTR-DUP-9" },
    [{ invoice_id: i.inv1, amount: 1000 }], nid(4001)], i.accounts);
  assert.equal((await dupes("check", { kind: "receipt", reference_number: "utr-dup-9" }, i.accounts)).matches.length, 1);
  await f.packDispatch({ id: nid(4002), order: nid(4000), lines: [{ id: nid(4003), kg: 100 }] });
  assert.equal((await dupes("check", { kind: "dispatch", order_id: nid(4000), total_weight_kg: "100.2" })).matches.length, 1);
  await seedQuote(nid(4010), { validUntil: istDay(10), quoteDate: istDay(0) });
  assert.equal((await dupes("check", { kind: "quote", customer_id: i.customer2, profile_ids: [i.profile2] })).matches.length, 1);
  await dupes("acknowledge", { kind: "order", matches: order.matches.map(m => m.id), decision: "saved_anyway", note: "Second truckload order" });
  assert.equal((await dupes("log", {}, i.salesManager)).total_count, 1);
  await f.confirmOrder({ id: nid(4020), value: 50000 });
  assert.equal((await dupes("scan", { kind: "order" }, i.salesManager)).total_count, 1);
});

test("AP-098 a trigger task closes itself when its invoice is paid, and a failing-job alert resolves after the job succeeds", async () => {
  await f.seed(`insert into task_trigger_rules(id,company_id,name,event_type,threshold,assignee_mode,assignee_role,priority,is_active,created_by,updated_by)
    values($1,$2,'Overdue invoices','invoice_overdue',0,'role','accounts','high',true,$3,$3)`, [nid(4100), i.company, i.owner]);
  await f.seed(`insert into tasks(id,company_id,task_type,title,status,priority,trigger_rule_id,trigger_key,trigger_source_type,trigger_source_id,trigger_event_at,trigger_assignment,related_entity_type,related_entity_id)
    values($1,$2,'general','Payment overdue: OMX/26-27/0101','open','high',$3,$4,'invoice',$5,now(),'unassigned','invoice',$5)`, [nid(4101), i.company, nid(4100), `${nid(4100)}:invoice:${i.inv1}`, i.inv1]);
  await f.seed(`insert into notifications(id,company_id,recipient_role,notification_type,severity,title,body,entity_reference,created_at) values($1,$2,'owner','system_job_failing','critical','Scheduled job failing','x','job-failing:alerts.reevaluate',now()-interval '2 hours')`,
    [nid(4102), i.company]);
  await f.asUser("select public.post_financial_receipt_atomic($1,$2,$3)", [{ amount: 10000, payment_date: istDay(0), payment_method: "cash" }, [{ invoice_id: i.inv1, amount: 10000 }], nid(4103)], i.accounts);
  const task = await f.one("select status, system_resolution, resolved_by_system_at from tasks where id=$1", [nid(4101)]);
  assert.ok(task.resolved_by_system_at, "the payment event re-evaluates the task");
  assert.match(task.system_resolution, /condition cleared/i);
  await f.call("ap_jobs", "run_now", { job_key: "alerts.reevaluate" }, i.owner);
  // The next window's run sees the earlier success.
  await f.db.query("select private.ap3_reevaluate($1, null, 'job')", [i.company]);
  const note = await f.one("select resolved_at, is_read from notifications where id=$1", [nid(4102)]);
  assert.ok(note.resolved_at, "the job-failing alert resolves once the job has succeeded after it");
  assert.equal(note.is_read, true);
  const log = await dupes("alerts", {}, i.owner);
  assert.ok(log.total_count >= 2);
});

test("Batch 3 tables have RLS, a company-scoped read policy, a company-leading index and no client grants; only the six new entry points are callable", async () => {
  const tables = ["o2c_settings", "customer_credit_limits", "order_credit_checks", "order_credit_holds", "production_job_drafts", "production_job_draft_lines", "invoice_drafts",
    "gst_supply_rules", "invoice_supply_overrides", "invoice_supply_derivations", "quote_validity_events", "quote_validity_requests", "duplicate_warnings", "alert_resolutions",
    "customer_on_account_credits", "customer_on_account_applications", "receipt_allocation_audits", "customer_remitter_aliases", "bank_format_profiles", "bank_statements",
    "bank_statement_lines", "payment_reminders"];
  for (const t of tables) {
    const r = await f.one("select relrowsecurity from pg_class where oid=$1::regclass", [`public.${t}`]);
    assert.equal(r.relrowsecurity, true, `${t} has RLS`);
    assert.equal(await count("select count(*) c from pg_policies where schemaname='public' and tablename=$1 and qual like '%get_current_user_company_id%'", [t]), 1, `${t} company read policy`);
    assert.equal(await count("select count(*) c from information_schema.role_table_grants where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')", [t]), 0, `${t} no client grants`);
    assert.ok(t === "o2c_settings" || await count("select count(*) c from pg_indexes where schemaname='public' and tablename=$1 and indexdef ~ '\\(company_id'", [t]) >= 1, `${t} company index`);
  }
  const callable = (await f.db.query(`select p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'ap\\_%'
    and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)).rows.map(r => r.proname);
  for (const name of ["ap_credit", "ap_jobdrafts", "ap_billing", "ap_cash", "ap_quotes", "ap_dupes"]) assert.ok(callable.includes(name), name);
  assert.equal(await count(`select count(*) c from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='private' and p.proname like 'ap3\\_%'
    and has_function_privilege('authenticated', p.oid, 'execute')`), 0, "no private batch 3 function is callable by clients");
  await assert.rejects(() => f.call("ap_cash", "propose", { customer_id: i.customer2, amount: "1" }, i.dealer), err => err.code === "42501");
  await assert.rejects(() => f.call("ap_credit", "customer", { customer_id: i.customer2 }, i.foreign), /Customer not found/);
});

test("Batch 3 jobs are registered and run from the cron entry", async () => {
  const keys = (await f.db.query("select job_key, schedule from private.ap_job_registry() order by job_key")).rows.map(r => `${r.job_key}:${r.schedule}`);
  for (const k of ["alerts.reevaluate:hourly", "bank.rematch:hourly", "billing.prepare_drafts:hourly", "quotes.expire:nightly", "receivables.reminders:morning"]) assert.ok(keys.includes(k), k);
  const hourly = await f.cron("hourly");
  assert.ok(JSON.stringify(hourly).includes("billing.prepare_drafts"));
});

test("AP-024 the remitter rule is the same in SQL and TypeScript", async () => {
  const { remitterFromNarration } = await import("../lib/financials/bank-statement.ts");
  const samples = ["NEFT CR-SBIN0001234-SHARMA FABRICATORS-OMX/26-27/0101", "IMPS 998877 RAJ ENTERPRISES", "UPI/CR/1234567890/PAYMENT", "BY TRANSFER FROM M/S GUPTA ALUMINIUM PVT LTD",
    "RTGS-HDFCR52026111100123-KRISHNA EXTRUSIONS LIMITED-ICIC0000123", "chq dep 004512 shree ganesh windows", "INB/NEFT/AXIS/N123456789/PATEL & SONS"];
  for (const narration of samples) {
    const sql = (await f.one("select private.ap3_remitter($1) r", [narration])).r;
    assert.equal(sql, remitterFromNarration(narration), narration);
  }
});
