import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyApprovedRates, canApproveDraft, canApproveRates, canReadRates, canWriteRates, draftProblem, finishingRateKey, lineAttention, marginToMarkup,
  parseCostingRateCommand, quoteRateCheckSchema, rateListSchema, rateLookupSchema, rateReviewSchema, scopeText, sellingPriceFromMargin
} from "../lib/workflow/costing-rates.ts";
import { calculateQuoteItem } from "../lib/calculations/quote.ts";
import { createCostingRateFixture, rids, rid } from "../scripts/lib/costing-rate-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("margin is on selling price: cost 250 at 20% margin sells at 312.50 (a 25% markup)", () => {
  assert.equal(sellingPriceFromMargin(250, 20), 312.5);
  assert.equal(marginToMarkup(20), 25);
  assert.equal(sellingPriceFromMargin(250, 0), 250);
  assert.equal(sellingPriceFromMargin(250, 100), 0, "a margin of 100% has no price");
  assert.equal(marginToMarkup(100), null);
  assert.equal(sellingPriceFromMargin(-5, 20), 0, "negative cost is treated as zero");
  // The quote engine uses the same rule: a line costing 250 at 20% margin is priced 312.50.
  const line = calculateQuoteItem({
    quantity_pieces: 1, length_per_piece_m: 1, section_weight_kg_per_m: 1, scrap_allowance_percent: 0, expected_recovery_percent: 100, billet_rate_per_kg: 250,
    conversion_charge_per_kg: 0, finishing_charge_type: "per_kg", finishing_charge: 0, die_charge: 0, packing_charge: 0, transport_charge: 0, other_charges: 0, margin_percent: 20
  });
  assert.deepEqual([line.line_subtotal, line.line_total_before_gst], [250, 312.5]);
});

test("draft rules mirror the table checks", () => {
  const base = { rate_type: "billet", basis: "per_kg", alloy: null, finishing_type: null, effective_from: "2026-10-01", effective_to: null };
  assert.equal(draftProblem(base), null);
  assert.match(draftProblem({ ...base, rate_type: "conversion", basis: "per_sqft" }), /per kg/);
  assert.match(draftProblem({ ...base, rate_type: "conversion", alloy: "6063" }), /alloy/);
  assert.match(draftProblem({ ...base, rate_type: "finishing" }), /Choose the finishing type/);
  assert.match(draftProblem({ ...base, finishing_type: "anodizing" }), /Only a finishing rate/);
  assert.match(draftProblem({ ...base, rate_type: "finishing", finishing_type: "mill_finish" }), /Mill finish/);
  assert.match(draftProblem({ ...base, effective_to: "2026-09-30" }), /before the start/);
  assert.equal(draftProblem({ ...base, effective_to: "2026-10-01" }), null, "a one-day rate is allowed");
});

test("commands are parsed by name and refuse bad input with a specific message", () => {
  assert.equal(parseCostingRateCommand({ command: "rates.drop" }).error, "Invalid costing rate request");
  assert.equal(parseCostingRateCommand(null).success, false);
  assert.match(parseCostingRateCommand({ command: "rates.save_draft", id, rate_type: "billet", rate: 0, effective_from: "2026-10-01" }).error, /positive rate/);
  assert.match(parseCostingRateCommand({ command: "rates.save_draft", id, rate_type: "billet", rate: 250, effective_from: "2026-02-30" }).error, /real date/);
  assert.match(parseCostingRateCommand({ command: "rates.save_draft", id, rate_type: "finishing", rate: 18, effective_from: "2026-10-01" }).error, /finishing type/);
  assert.match(parseCostingRateCommand({ command: "rates.withdraw", id, reason: "x" }).error, /3 to 300/);
  assert.equal(parseCostingRateCommand({ command: "rates.list", status: "all" }).success, false);
  assert.equal(parseCostingRateCommand({ command: "quote.check", quote_id: id, company_id: id }).success, false, "no client-supplied company");
  const draft = parseCostingRateCommand({ command: "rates.save_draft", id, rate_type: "billet", rate: 250, alloy: " 6061 ", effective_from: "2026-10-01" });
  assert.deepEqual([draft.data.alloy, draft.data.basis, draft.data.customer_id], ["6061", "per_kg", null]);
});

test("role gates: dealers excluded by the action, approval needs four eyes except for the owner", () => {
  assert.ok(canReadRates("sales") && canReadRates("accounts") && !canReadRates("production") && !canReadRates("viewer"));
  assert.ok(canWriteRates("accounts") && !canWriteRates("sales"));
  assert.ok(canApproveRates("sales_manager") && !canApproveRates("accounts"));
  assert.equal(canApproveDraft("sales_manager", id, id), false);
  assert.equal(canApproveDraft("owner", id, id), true);
  assert.equal(canApproveDraft("admin", id, rid(1)), true);
});

test("applying approved rates fills each line and reports what has no approved rate", () => {
  const lines = [
    { billet_rate_per_kg: 248, conversion_charge_per_kg: 45, finishing_type: "powder_coating", finishing_charge_type: "per_sqft", finishing_charge: 0 },
    { billet_rate_per_kg: 250, conversion_charge_per_kg: 40, finishing_type: "mill_finish", finishing_charge_type: "per_kg", finishing_charge: 0 },
    { billet_rate_per_kg: 0, conversion_charge_per_kg: 0, finishing_type: "anodizing", finishing_charge_type: "fixed", finishing_charge: 900 }
  ];
  const applied = applyApprovedRates(lines, { billet: 250, conversion: 40, finishing: { "powder_coating|per_sqft": 18 } });
  assert.deepEqual(applied.lines.map((l) => [l.billet_rate_per_kg, l.conversion_charge_per_kg, l.finishing_charge]), [[250, 40, 18], [250, 40, 0], [250, 40, 900]]);
  assert.equal(applied.changed, 5, "line 2 already matched");
  assert.deepEqual(applied.missing, [], "a fixed finishing charge is not rate-based");
  assert.equal(lines[0].billet_rate_per_kg, 248, "input lines are not mutated");
  const none = applyApprovedRates(lines, { billet: null, conversion: 40, finishing: {} });
  assert.deepEqual(none.missing, ["billet", "finishing powder coating"]);
  assert.equal(none.lines[0].billet_rate_per_kg, 248, "no approved billet rate leaves the entered value");
  assert.equal(finishingRateKey({ finishing_type: "anodizing", finishing_charge_type: "per_meter" }), "anodizing|per_meter");
  assert.equal(finishingRateKey({ finishing_type: null, finishing_charge_type: "per_kg" }), null);
});

test("a line's summary shows the most urgent status first", () => {
  assert.equal(lineAttention([{ status: "matches" }, { status: "above_approved" }, { status: "below_approved" }]), "below_approved");
  assert.equal(lineAttention([{ status: "matches" }, { status: "no_rate" }]), "no_rate");
  assert.equal(lineAttention([]), "matches");
  assert.equal(scopeText({ rate_type: "billet", basis: "per_kg", alloy: "6061", finishing_type: null, customer_name: null }), "Billet · alloy 6061 · all customers");
  assert.equal(scopeText({ rate_type: "finishing", basis: "per_sqft", alloy: null, finishing_type: "powder_coating", customer_name: "Kumar Facades" }), "Finishing · powder coating · Kumar Facades");
});

test("the action shows exactly the database's business messages", () => {
  const sql = readFileSync("supabase/migrations/20261022340000_costing_rates.sql", "utf8");
  const action = readFileSync("lib/actions/costing-rates.ts", "utf8");
  const raised = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]).filter((m) => !m.includes("%") && !["Authentication required", "This action is not permitted for your role", "Invalid costing rate request"].includes(m));
  for (const message of raised) assert.ok(action.includes(`"${message}"`), message);
});

let f;
test.before(async () => { f = await createCostingRateFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

test("database list, lookup, review and quote check responses parse with the app's schemas", async () => {
  await f.approved(rids.billetGeneral, { rate_type: "billet", rate: 250, effective_from: "2026-10-01", effective_to: "2026-10-12" });
  await f.approved(rids.kumarConversion, { rate_type: "conversion", rate: 40, effective_from: "2026-10-01", customer_id: rids.kumar, note: "Agreement" });
  await f.approved(rids.powderSqft, { rate_type: "finishing", basis: "per_sqft", finishing_type: "powder_coating", rate: 18, effective_from: "2026-10-01" });
  await f.command("rates.save_draft", { id: rid(64), rate_type: "billet", rate: 270, effective_from: "2026-12-01" }, rids.accounts);
  for (const status of ["current", "draft", "history"]) rateListSchema.parse(await f.command("rates.list", { status }));
  const lookup = rateLookupSchema.parse(await f.command("rates.lookup", { date: "2026-10-10", customer_id: rids.kumar, finishing_type: "powder_coating", finishing_basis: "per_sqft" }));
  assert.deepEqual([lookup.billet?.rate, lookup.conversion?.rate, lookup.finishing?.rate], [250, 40, 18]);
  assert.equal(rateLookupSchema.parse(await f.command("rates.lookup", { date: "2026-09-01" })).conversion, null);
  rateReviewSchema.parse(await f.command("rates.review", {}));
  const unbound = quoteRateCheckSchema.parse(await f.command("quote.check", { quote_id: rids.quote }));
  const track = unbound.lines.find((line) => line.description === "Sliding track");
  assert.deepEqual(track.checks.map((c) => c.status), ["expired_rate", "matches", "matches"]);
  await f.db.exec(`update quotes set status='approved_for_sending', quote_date='2026-10-10' where id='${rids.quote}'`);
  const bound = quoteRateCheckSchema.parse(await f.command("quote.check", { quote_id: rids.quote }));
  assert.equal(bound.bound, true);
  assert.equal(bound.bindings.length, 3);
  assert.equal(quoteRateCheckSchema.parse(await f.command("quote.check", { quote_id: rids.quote2 })).lines[0].checks.find((c) => c.rate_type === "conversion").status, "no_rate");
});

test("pages gate on the rate roles; the quote page checks rates only for internal commercial roles", () => {
  assert.match(readFileSync("app/(dashboard)/quotes/rates/page.tsx", "utf8"), /context\.dealerId \|\| !canReadRates\(context\.role\)/);
  assert.match(readFileSync("app/(dashboard)/quotes/rates/new/page.tsx", "utf8"), /context\.dealerId \|\| !canWriteRates\(context\.role\)/);
  assert.match(readFileSync("app/(dashboard)/quotes/rates/page.tsx", "utf8"), /canApproveDraft\(context\.role, context\.userId, row\.created_by\)/);
  assert.match(readFileSync("app/(dashboard)/quotes/[id]/page.tsx", "utf8"), /!context\.dealerId && canReadRates\(context\.role\) && items\.length/);
  assert.match(readFileSync("lib/actions/costing-rates.ts", "utf8"), /if \(context\.dealerId \|\| !allowed\)/);
});
