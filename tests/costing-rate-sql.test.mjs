import test from "node:test";
import assert from "node:assert/strict";
import { createCostingRateFixture, rids, rid } from "../scripts/lib/costing-rate-fixture.mjs";

let f;
test.before(async () => { f = await createCostingRateFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const n = (v) => (v === null || v === undefined ? v : Number(v));
async function standardRates() {
  await f.approved(rids.billetGeneral, { rate_type: "billet", rate: 250, effective_from: "2026-10-01" });
  await f.approved(rids.conversion, { rate_type: "conversion", rate: 45, effective_from: "2026-10-01" });
  await f.approved(rids.kumarConversion, { rate_type: "conversion", rate: 40, effective_from: "2026-10-01", customer_id: rids.kumar, note: "Annual agreement 2026-27" });
  await f.approved(rids.powderSqft, { rate_type: "finishing", basis: "per_sqft", finishing_type: "powder_coating", rate: 18, effective_from: "2026-10-01" });
}
const check = (quote = rids.quote, actor) => f.command("quote.check", { quote_id: quote }, actor);
const byType = (line) => Object.fromEntries(line.checks.map((c) => [c.rate_type, c]));

// ---------- Approval and periods ----------

test("a draft is approved by someone other than its author; owners may approve their own", async () => {
  await f.command("rates.save_draft", { id: rid(60), rate_type: "billet", rate: 250, effective_from: "2026-10-01" }, rids.salesManager);
  await assert.rejects(f.command("rates.approve", { id: rid(60) }, rids.salesManager), /Another person must approve/);
  await assert.rejects(f.command("rates.approve", { id: rid(60) }, rids.accounts), /not permitted/);
  await f.command("rates.save_draft", { id: rid(61), rate_type: "conversion", rate: 45, effective_from: "2026-10-01" }, rids.owner);
  await f.command("rates.approve", { id: rid(61) }, rids.owner);
  await assert.rejects(f.command("rates.approve", { id: rid(61) }, rids.owner), /Only a draft rate can be approved/);
});

test("editing someone else's draft makes the editor its author, so they cannot then approve it", async () => {
  await f.command("rates.save_draft", { id: rid(66), rate_type: "billet", rate: 250, effective_from: "2026-10-01" }, rids.accounts);
  await f.command("rates.save_draft", { id: rid(66), rate_type: "billet", rate: 199, effective_from: "2026-10-01" }, rids.salesManager);
  await assert.rejects(f.command("rates.approve", { id: rid(66) }, rids.salesManager), /Another person must approve/, "four eyes cannot be bypassed by editing");
  const row = (await f.db.query(`select created_by, created_by_name, rate::float8 rate from costing_rates where id='${rid(66)}'`)).rows[0];
  assert.deepEqual([row.created_by, row.created_by_name, row.rate], [rids.salesManager, "Sales Mgr Priya", 199]);
  await f.command("rates.approve", { id: rid(66) }, rids.owner);
  await assert.rejects(f.command("rates.save_draft", { id: rid(66), rate_type: "billet", rate: 1, effective_from: "2026-10-01" }, rids.accounts), /Only a draft rate can be edited/, "an approved rate is immutable");
  await assert.rejects(f.command("rates.save_draft", { id: rid(66), rate_type: "billet", rate: 1, effective_from: "2026-10-01" }, rids.foreign), /Only a draft rate can be edited/, "another company cannot overwrite it by id");
});

test("approving a newer rate ends the predecessor the day before; an earlier start than an existing rate is refused", async () => {
  await f.approved(rids.billetGeneral, { rate_type: "billet", rate: 250, effective_from: "2026-10-01" });
  await f.approved(rids.billetNew, { rate_type: "billet", rate: 262, effective_from: "2026-11-01" });
  const rows = (await f.db.query("select id, effective_from::text ef, effective_to::text et from costing_rates order by effective_from")).rows;
  assert.deepEqual(rows.map((r) => [r.ef, r.et]), [["2026-10-01", "2026-10-31"], ["2026-11-01", null]]);
  await f.command("rates.save_draft", { id: rid(62), rate_type: "billet", rate: 255, effective_from: "2026-10-15" }, rids.accounts);
  await assert.rejects(f.command("rates.approve", { id: rid(62) }), /already starts on or after 2026-10-15/);
});

test("rate input is validated against the type: scope, basis, positive rate, dates", async () => {
  const bad = [
    { rate_type: "billet", rate: 0, effective_from: "2026-10-01" },
    { rate_type: "billet", rate: 250, effective_from: "2026-13-01" },
    { rate_type: "billet", rate: 250, effective_from: "2026-10-10", effective_to: "2026-10-01" },
    { rate_type: "conversion", rate: 45, effective_from: "2026-10-01", finishing_type: "anodizing" },
    { rate_type: "finishing", rate: 18, effective_from: "2026-10-01" },
    { rate_type: "conversion", basis: "per_sqft", rate: 45, effective_from: "2026-10-01" },
    { rate_type: "conversion", rate: 45, effective_from: "2026-10-01", alloy: "6063" },
    { rate_type: "die", rate: 45, effective_from: "2026-10-01" }
  ];
  for (const [index, fields] of bad.entries()) await assert.rejects(f.command("rates.save_draft", { id: rid(70 + index), ...fields }, rids.accounts), /Enter a positive rate/, JSON.stringify(fields));
  await assert.rejects(f.command("rates.save_draft", { id: rid(80), rate_type: "billet", rate: 1, effective_from: "2026-10-01", customer_id: rid(999) }, rids.accounts), /Customer is unavailable/);
});

// ---------- Precedence and lookup ----------

test("a customer agreement takes precedence over the general rate; other customers get the general rate", async () => {
  await standardRates();
  const kumar = await f.command("rates.lookup", { date: "2026-10-15", customer_id: rids.kumar });
  assert.deepEqual([n(kumar.billet.rate), n(kumar.conversion.rate)], [250, 40]);
  const mehta = await f.command("rates.lookup", { date: "2026-10-15", customer_id: rids.mehta });
  assert.equal(n(mehta.conversion.rate), 45);
  assert.equal((await f.command("rates.lookup", { date: "2026-09-15" })).billet, null, "no rate before it takes effect");
  const finishing = await f.command("rates.lookup", { date: "2026-10-15", finishing_type: "powder_coating", finishing_basis: "per_sqft" });
  assert.equal(n(finishing.finishing.rate), 18);
});

test("alloy-specific billet rates apply only to that alloy", async () => {
  await f.approved(rids.billetGeneral, { rate_type: "billet", rate: 250, effective_from: "2026-10-01" });
  await f.approved(rid(63), { rate_type: "billet", rate: 268, effective_from: "2026-10-01", alloy: "6061" });
  assert.equal(n((await f.command("rates.lookup", { date: "2026-10-15", alloy: "6061" })).billet.rate), 268);
  assert.equal(n((await f.command("rates.lookup", { date: "2026-10-15", alloy: "6063" })).billet.rate), 250);
});

// ---------- Quote check and binding ----------

test("the quote check compares each line's entered rates with the applicable approved rate", async () => {
  await standardRates();
  const result = await check();
  assert.equal(result.bound, false);
  const track = result.lines.find((line) => line.description === "Sliding track");
  const interlock = result.lines.find((line) => line.description === "Interlock");
  const t = byType(track);
  assert.deepEqual([t.billet.status, n(t.billet.difference), t.conversion.status, t.conversion.source, t.finishing.status], ["below_approved", -2, "matches", "customer", "matches"]);
  const i = byType(interlock);
  assert.equal(i.conversion.status, "above_approved", "45 entered against Kumar's agreed 40");
  assert.equal(i.finishing, undefined, "mill finish has no finishing rate to check");
  const mehta = byType((await check(rids.quote2)).lines[0]);
  assert.equal(mehta.finishing.status, "no_rate", "no approved per-kg anodizing rate exists");
});

test("approving a quotation binds the rates of its quote date; later rate changes do not alter it", async () => {
  await standardRates();
  await f.db.exec(`update quotes set status='approved_for_sending' where id='${rids.quote}'`);
  const bound = await check();
  assert.equal(bound.bound, true);
  assert.deepEqual(bound.bindings.map((b) => [b.rate_type, n(b.rate), b.customer_specific]).sort(), [["billet", 250, false], ["conversion", 40, true], ["finishing", 18, false]]);
  await f.approved(rids.billetNew, { rate_type: "billet", rate: 262, effective_from: "2026-10-10" });
  const after = byType((await check()).lines.find((line) => line.description === "Sliding track"));
  assert.deepEqual([n(after.billet.approved), after.billet.source], [250, "bound"], "the accepted quotation keeps the agreed billet rate");
  await f.db.exec(`update quotes set status='sent' where id='${rids.quote}'; update quotes set status='approved_for_sending' where id='${rids.quote}'`);
  assert.equal((await f.db.query("select count(*)::int c from quote_rate_bindings")).rows[0].c, 3, "re-approval of the same revision binds nothing twice");
});

test("an expired rate with no successor is flagged for review and in the quote check", async () => {
  await f.approved(rids.billetGeneral, { rate_type: "billet", rate: 250, effective_from: "2026-09-01", effective_to: "2026-10-10" });
  const line = byType((await check()).lines.find((l) => l.description === "Sliding track"));
  assert.deepEqual([line.billet.status, line.billet.expired_on], ["expired_rate", "2026-10-10"]);
  const review = await f.command("rates.review", {});
  assert.deepEqual(review.map((r) => [r.rate_type, r.expired]), [["billet", true]]);
  await f.approved(rids.billetNew, { rate_type: "billet", rate: 262, effective_from: "2026-10-11" });
  assert.deepEqual(await f.command("rates.review", {}), [], "a successor clears the review");
});

test("withdrawing needs a reason and is refused for a rate bound to issued quotations", async () => {
  await standardRates();
  await f.db.exec(`update quotes set status='approved_for_sending' where id='${rids.quote}'`);
  await assert.rejects(f.command("rates.withdraw", { id: rids.billetGeneral, reason: "x" }, rids.accounts), /3 to 300 characters/);
  await assert.rejects(f.command("rates.withdraw", { id: rids.billetGeneral, reason: "Entered in error" }, rids.accounts), /bound to issued quotations/);
  await f.command("rates.withdraw", { id: rids.conversion, reason: "Replaced by agreement" }, rids.accounts);
  await assert.rejects(f.command("rates.withdraw", { id: rids.conversion, reason: "Again please" }, rids.accounts), /already withdrawn/);
});

// ---------- Visibility ----------

test("rates are commercial: production, dealers and other companies cannot read them", async () => {
  await standardRates();
  for (const actor of [rids.production, rids.dealer]) await assert.rejects(f.command("rates.list", {}, actor), /not permitted/);
  assert.equal((await f.command("rates.list", {}, rids.foreign)).total_count, 0);
  await assert.rejects(check(rids.quote, rids.foreign), /Quotation is unavailable/);
  assert.deepEqual(await f.asUser("select id from costing_rates", [], rids.production), [], "row security hides rates");
  await assert.rejects(f.command("rates.save_draft", { id: rid(90), rate_type: "billet", rate: 1, effective_from: "2026-10-01" }, rids.sales), /not permitted/);
  await assert.rejects(f.asUser(`insert into costing_rates(id,company_id,rate_type,basis,rate,effective_from,created_by,created_by_name) values('${rid(91)}','${rids.company}','billet','per_kg',1,'2026-10-01','${rids.sales}','x')`, [], rids.sales), /permission denied/);
  await assert.rejects(f.asUser("select public.costing_rate_command('rates.list','{}'::jsonb)", [], ""), /Authentication required/);
});

test("the list separates current, draft and history, paged at 10", async () => {
  await standardRates();
  await f.command("rates.save_draft", { id: rid(64), rate_type: "billet", rate: 270, effective_from: "2026-12-01" }, rids.accounts);
  await f.approved(rid(65), { rate_type: "finishing", basis: "per_kg", finishing_type: "anodizing", rate: 22, effective_from: "2026-01-01", effective_to: "2026-03-31" });
  assert.equal((await f.command("rates.list", { status: "current" })).total_count, 4);
  assert.equal((await f.command("rates.list", { status: "draft" })).total_count, 1);
  assert.equal((await f.command("rates.list", { status: "history" })).total_count, 1);
  const kumarRow = (await f.command("rates.list", { rate_type: "conversion" })).rows.find((r) => r.customer_id === rids.kumar);
  assert.equal(kumarRow.customer_name, "Kumar Facades");
  await assert.rejects(f.command("rates.list", { status: "all" }), /Invalid rate list request/);
});
