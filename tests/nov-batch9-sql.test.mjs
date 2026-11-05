import test from "node:test";
import assert from "node:assert/strict";
import { createNov9Fixture, nids as i, day } from "../scripts/lib/nov-batch9-fixture.mjs";
import { migrationFiles } from "../scripts/lib/migration-chain-replay.mjs";
import { commercialListSchema, commercialOutcomeSchema, commercialMutationSchema, canReadCommercial, canUseCommercialAction,
  COMMERCIAL_ROLES, COMMERCIAL_VIEWS } from "../lib/workflow/commercial.ts";

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
const idOf = result => result.result.href.split("/").pop();
const byLabel = async (view, text, actor = i.owner) => (await list(view, actor, { search: text })).rows.find(r => r.label.includes(text));

// NOV-064 helpers -------------------------------------------------------------------------------
const brackets = [{ from: 0, to: 100, rate: 250 }, { from: 100, to: 500, rate: 230 }, { from: 500, rate: 210 }];
async function rule(patch = {}, approver = i.accounts, definer = i.salesManager) {
  const body = { action: "pricing.define", code: "vol_kg", name: "Standard volume rate", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(-30), brackets, note, ...patch };
  const id = idOf(confirmed(await f.apply(body, definer)));
  if (approver) confirmed(await f.apply({ action: "pricing.approve", id, note }, approver));
  return id;
}
const price = (patch = {}, actor = i.sales) => f.prepare({ action: "pricing.price", customer_id: i.customer, unit_basis: "kg", quantity: 120, ...patch }, actor);

test("the TypeScript role mirrors match the database matrix for every role, view and action", async () => {
  const roles = [...COMMERCIAL_ROLES, "dealer_admin", "dealer_staff", "unknown"];
  const actions = commercialMutationSchema._def.schema.options.map(option => option.shape.action.value);
  assert.equal(actions.length, 35);
  for (const role of roles) {
    assert.equal((await one("select private.commercial_read_allowed($1,null) v", [role])).v, canReadCommercial(role), `${role} read`);
    for (const view of Object.keys(COMMERCIAL_VIEWS)) assert.equal((await one("select private.commercial_read_allowed($1,$2) v", [role, view])).v, canReadCommercial(role, view), `${role} read ${view}`);
    for (const action of actions) assert.equal((await one("select private.commercial_action_allowed($1,$2) v", [role, action])).v, canUseCommercialAction(role, action), `${role} ${action}`);
  }
});

test("migration replay, every read model and the shared protocol match the production contracts", async () => {
  assert.equal(f.applied, migrationFiles().length + 2);
  for (const view of Object.keys(COMMERCIAL_VIEWS)) {
    commercialListSchema.parse(await list(view));
    commercialListSchema.parse(await f.command("list", { view }, i.owner));
  }
  await assert.rejects(() => list("pricing", i.dealer), /Not permitted/);
  await assert.rejects(() => list("profitability", i.sales), /Not permitted/);
  await assert.rejects(() => list("transfers", i.salesManager), /Not permitted/);
  await assert.rejects(() => list("nonsense"), /Not permitted/);
  await assert.rejects(() => f.command("list", { view: "pricing", company_id: i.foreignCompany }), /Invalid commercial request/);
  await assert.rejects(() => f.command("lookup", { kind: "customers", search: "x".repeat(81) }), /80 characters/);
  await assert.rejects(() => f.command("list", { view: "pricing", page: 0 }), /Invalid commercial filters/);
  const body = { action: "mapping.define", sales_ledger: "Sales - aluminium", tax_ledger: "Output GST", party_key: "gst_number", note };
  const preview = await f.prepare(body, i.accounts);
  assert.equal(preview.state, "prepared");
  assert.equal(n((await one("select count(*) c from transfer_mappings")).c), 0, "a review records nothing");
  assert.equal((await f.command("outcome", { request_id: f.nextId() })).state, "not_recorded");
  assert.equal((await f.command("abandon", { request_id: preview.request_id }, i.accounts)).state, "abandoned");
  await assert.rejects(() => f.commit(preview, i.owner), /Not permitted/);
  await assert.rejects(() => f.prepare({ ...body, company_id: i.foreignCompany }), /Review the required action details/);
  await assert.rejects(() => f.prepare({ ...body, tax_ledger: null }), /Review the required action details/);
  await assert.rejects(() => f.prepare(body, i.dealer), /Not permitted/);
  await assert.rejects(() => f.prepare(body, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare(body, i.sales), /Not permitted/);
  const request = f.nextId();
  const first = await f.prepare(body, i.accounts, request);
  assert.equal((await f.prepare(body, i.accounts, request)).fingerprint, first.fingerprint);
  await assert.rejects(() => f.prepare({ ...body, tax_ledger: "Other" }, i.accounts, request), /different details/);
  const done = confirmed(await f.commit(first, i.accounts));
  assert.deepEqual(await f.commit(first, i.accounts), done, "a lost response is recovered without a second write");
  assert.equal(n((await one("select count(*) c from transfer_mappings")).c), 1);
  const late = await f.prepare({ action: "pricing.define", code: "late_rule", name: "Late rule", charge_type: "minimum_charge", unit_basis: "kg", precedence: 0, effective_from: day(0), amount: 100, note }, i.accounts);
  await f.db.query("update commercial_requests set expires_at=now()-interval '1 minute' where request_id=$1", [late.request_id]);
  rejected(await f.commit(late, i.accounts), /expired/);
});

test("tenant isolation: other companies see nothing, lookups never leak, and no table is directly readable", async () => {
  for (const view of Object.keys(COMMERCIAL_VIEWS)) assert.equal((await list(view, i.foreign)).total_count, 0, `${view} for another company`);
  const id = await rule();
  await assert.rejects(() => detail("pricing", id, i.foreign), /unavailable/);
  assert.equal((await f.command("lookup", { kind: "customers" }, i.foreign)).length, 0);
  assert.equal((await f.command("lookup", { kind: "employees" }, i.owner)).some(x => x.value === i.foreign), false);
  await assert.rejects(() => f.asUser("select * from pricing_rules"), /permission denied/);
  await assert.rejects(() => f.asUser("select * from supplier_claims"), /permission denied/);
  await assert.rejects(() => f.asUser("select * from commercial_events"), /permission denied/);
  await assert.rejects(() => f.asUser("insert into pricing_rules(company_id,code,version,name,charge_type,unit_basis,effective_from,created_by) values($1,'x_rule',1,'Rule x','bracket_rate','kg',current_date,$2)", [i.company, i.owner]), /permission denied/);
  const request = f.nextId();
  await f.prepare({ action: "mapping.define", sales_ledger: "Sales", tax_ledger: "Tax", party_key: "customer_name", note }, i.accounts, request);
  assert.equal((await f.asUser("select count(*) c from commercial_requests where request_id=$1", [request], i.accounts))[0].c, 1);
  assert.equal((await f.asUser("select count(*) c from commercial_requests where request_id=$1", [request], i.owner))[0].c, 0, "a request belongs to its author");
  await assert.rejects(() => f.command("outcome", { request_id: request }, i.foreign), /Not permitted/);
});

// NOV-064 ---------------------------------------------------------------------------------------
test("NOV-064: bracket boundaries, partial quantities and rounding price the whole quantity at the bracket reached", async () => {
  const id = await rule();
  const total = async (quantity, extra = {}) => { const p = await price({ quantity, ...extra }); assert.equal(p.state, "prepared", JSON.stringify(p)); return p.review.facts.Total; };
  assert.equal(await total(99.999), "INR 24,999.75");  // 99.999 x 250 = 24999.75
  assert.equal(await total(100), "INR 23,000.00");     // the boundary belongs to the higher bracket
  assert.equal(await total(499.999), "INR 114,999.77".replace("114,999.77", "1,14,999.77"));
  assert.equal(await total(500), "INR 1,05,000.00");
  assert.equal(await total(3.333), "INR 833.25");
  const p = await price({ quantity: 99 });
  assert.match(p.review.warnings.join(" "), /1 more kg reaches the next bracket \(from 100 at INR 230\).*lower than now/);
  assert.match(p.review.facts["Rule applied"], /vol_kg v1: 0 to 100 at INR 250 per kg/);
  const high = await price({ quantity: 100000000 });
  assert.equal(high.state, "prepared");
  // A per-metre request does not use the per-kilogram rule.
  await assert.rejects(() => price({ unit_basis: "metre", quantity: 10 }), /No approved volume rate applies/);
  // Decimal places beyond three, zero and negative quantities are refused.
  for (const quantity of [0, -5, 1.2345, 100000001]) await assert.rejects(() => price({ quantity }), /Review the required action details|Quantity must be between/);
  const pennies = await one("select round(3.333*230.1234,2)::text v");
  await rule({ code: "vol_pennies", brackets: [{ from: 0, rate: 230.1234 }], customer_id: i.customer, unit_basis: "metre" });
  const metre = await price({ unit_basis: "metre", quantity: 3.333 });
  assert.equal(metre.review.facts.Total, `INR ${Number(pennies.v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`);
  assert.ok(id);
});

test("NOV-064: minimum charges, processing charges and per-unit bases combine without stacking conflicting rules", async () => {
  await rule();
  await rule({ code: "min_kg", name: "Minimum order charge", charge_type: "minimum_charge", amount: 5000, brackets: undefined });
  await rule({ code: "cut_kg", name: "Cutting charge", charge_type: "processing_charge", processing_code: "cutting", amount: 3, brackets: undefined });
  const small = await price({ quantity: 10, processing_codes: ["cutting"] });
  assert.equal(small.review.facts.Subtotal, "INR 2,530.00");
  assert.equal(small.review.facts["Minimum charge"].startsWith("Applied"), true);
  assert.equal(small.review.facts.Total, "INR 5,000.00");
  assert.match(small.review.warnings.join(" "), /minimum charge of INR 5,000.00 applies.*raised by INR 2,470.00/);
  const large = await price({ quantity: 120, processing_codes: ["cutting"] });
  assert.equal(large.review.facts.Total, "INR 27,960.00"); // 120 x 230 + 120 x 3
  assert.match(large.review.facts["Minimum charge"], /Not reached/);
  await assert.rejects(() => price({ quantity: 120, processing_codes: ["bending"] }), /No approved processing charge "bending"/);
  await assert.rejects(() => price({ quantity: 120, processing_codes: ["cutting", "cutting"] }), /Review the required action details|once/);
  // A per-piece and a per-metre rule live side by side with the kilogram rule.
  await rule({ code: "vol_piece", name: "Piece rate", unit_basis: "piece", brackets: [{ from: 0, rate: 12.5 }] });
  assert.equal((await price({ unit_basis: "piece", quantity: 41 })).review.facts.Total, "INR 512.50");
  // The minimum charge is declared in INR 2 decimal places only.
  await assert.rejects(() => f.prepare({ action: "pricing.define", code: "min_bad", name: "Bad minimum", charge_type: "minimum_charge", unit_basis: "kg", precedence: 0, effective_from: day(0), amount: 10.005, note }, i.salesManager), /Amount must be between/);
});

test("NOV-064: precedence, scope, effective dates and second-person approval decide which rule applies", async () => {
  await rule();
  const specific = await rule({ code: "vol_customer", name: "Customer agreement", customer_id: i.customer, brackets: [{ from: 0, rate: 200 }] });
  assert.match((await price({ quantity: 120 })).review.facts["Rule applied"], /vol_customer v1: 0 to and above at INR 200/);
  // Another customer still sees the standard rate.
  assert.match((await price({ customer_id: i.customer2, quantity: 120 })).review.facts["Rule applied"], /vol_kg v1/);
  // An expired agreement and a future-dated one are not applied.
  await rule({ code: "vol_expired", name: "Old agreement", customer_id: i.customer2, effective_from: day(-60), effective_to: day(-1), brackets: [{ from: 0, rate: 100 }] });
  await rule({ code: "vol_future", name: "Future agreement", customer_id: i.customer2, effective_from: day(5), brackets: [{ from: 0, rate: 90 }] });
  assert.match((await price({ customer_id: i.customer2, quantity: 120 })).review.facts["Rule applied"], /vol_kg v1/);
  assert.equal((await byLabel("pricing", "vol_expired")).status, "expired");
  assert.equal((await byLabel("pricing", "vol_future")).status, "scheduled");
  // The person who defined a rule cannot approve it; a non-pricing role cannot define it.
  const draft = idOf(confirmed(await f.apply({ action: "pricing.define", code: "vol_self", name: "Self approved", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(0), brackets: [{ from: 0, rate: 150 }], note }, i.salesManager)));
  await refused(f.apply({ action: "pricing.approve", id: draft, note }, i.salesManager), /second person approves a rule/);
  await assert.rejects(() => f.prepare({ action: "pricing.define", code: "vol_prod", name: "Production rule", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(0), brackets: [{ from: 0, rate: 150 }], note }, i.production), /Not permitted/);
  // Two different rules with the same scope, dates and precedence conflict at approval.
  const clash = idOf(confirmed(await f.apply({ action: "pricing.define", code: "vol_clash", name: "Clashing agreement", charge_type: "bracket_rate", unit_basis: "kg", customer_id: i.customer, precedence: 0, effective_from: day(-10), brackets: [{ from: 0, rate: 180 }], note }, i.salesManager)));
  await refused(f.apply({ action: "pricing.approve", id: clash, note }, i.accounts), /already covers the same scope and dates at the same precedence/);
  // A different precedence resolves the conflict deliberately.
  const higher = await rule({ code: "vol_higher", name: "Higher precedence", customer_id: i.customer, precedence: 5, brackets: [{ from: 0, rate: 190 }] });
  assert.match((await price({ quantity: 120 })).review.facts["Rule applied"], /vol_higher v1.* at INR 190/);
  assert.ok(specific && higher);
  // A draft of the same code blocks a second draft; a changed charge type under a used code is refused.
  await f.apply({ action: "pricing.define", code: "vol_kg", name: "Next version", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(0), brackets, note }, i.salesManager);
  await assert.rejects(() => f.prepare({ action: "pricing.define", code: "vol_kg", name: "Another draft", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(0), brackets, note }, i.salesManager), /draft of this rule already exists/);
  await assert.rejects(() => f.prepare({ action: "pricing.define", code: "vol_customer", name: "Wrong kind", charge_type: "minimum_charge", unit_basis: "kg", precedence: 0, effective_from: day(0), amount: 100, note }, i.salesManager), /already prices a different charge/);
});

test("NOV-064: an unusable bracket table is refused with a specific reason", async () => {
  const define = patch => f.prepare({ action: "pricing.define", code: "bad_rate", name: "Bad rate", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(0), brackets, note, ...patch }, i.salesManager);
  await assert.rejects(() => define({ brackets: [{ from: 10, to: 100, rate: 250 }] }), /first bracket starts at 0/);
  await assert.rejects(() => define({ brackets: [{ from: 0, to: 100, rate: 250 }, { from: 120, rate: 230 }] }), /must start exactly where bracket 1 ends/);
  await assert.rejects(() => define({ brackets: [{ from: 0, to: 100, rate: 250 }, { from: 90, rate: 230 }] }), /must start exactly where bracket 1 ends/);
  await assert.rejects(() => define({ brackets: [{ from: 0, rate: 250 }, { from: 100, rate: 230 }] }), /Only the last bracket may have no upper end/);
  await assert.rejects(() => define({ brackets: [{ from: 0, to: 0, rate: 250 }] }), /end after its start/);
  await assert.rejects(() => define({ brackets: [{ from: 0, rate: 0 }] }), /positive rate/);
  await assert.rejects(() => define({ brackets: [{ from: 0, rate: 250.12345 }] }), /positive rate with at most four decimals/);
  await assert.rejects(() => define({ brackets: undefined }), /Enter the quantity brackets/);
  await assert.rejects(() => define({ amount: 100 }), /uses brackets, not a single amount/);
  await assert.rejects(() => define({ effective_to: day(-5), effective_from: day(0) }), /cannot end before it starts/);
  await assert.rejects(() => define({ code: "Bad Code" }), /lowercase letters/);
  await assert.rejects(() => define({ customer_id: i.foreignCompany }), /Choose a customer of this company/);
  await assert.rejects(() => define({ brackets: Array.from({ length: 13 }, (_, k) => ({ from: k, to: k + 1, rate: 100 })) }), /1 to 12 brackets/);
  await assert.rejects(() => define({ note: "no" }), /Review the required action details/);
  await assert.rejects(() => define({ name: "x\u0001yz" }), /Name must be/);
});

test("NOV-064: a recorded price keeps its rule snapshot, supersedes a revised draft, and goes stale if a rule changes before confirmation", async () => {
  const v1 = await rule();
  const preview = await price({ quantity: 120, quote_id: i.quoteDraft });
  confirmed(await f.commit(preview, i.sales));
  const first = (await list("pricing", i.owner)).rows.find(r => r.details.kind === "calculation");
  assert.equal(first.details.snapshot.bracket.code, "vol_kg");
  assert.equal(first.details.snapshot.bracket.version, 1);
  assert.equal(n(first.details.final_total), 27600);
  // A revised draft supersedes the earlier price for the quotation, which stays as history.
  confirmed(await f.apply({ action: "pricing.price", customer_id: i.customer, unit_basis: "kg", quantity: 600, quote_id: i.quoteDraft }, i.sales));
  const states = (await list("pricing", i.owner)).rows.filter(r => r.details.kind === "calculation").map(r => r.status).sort();
  assert.deepEqual(states, ["recorded", "superseded"]);
  // A new rule version retires v1 for new prices; the old calculation keeps version 1.
  confirmed(await f.apply({ action: "pricing.define", code: "vol_kg", name: "Standard volume rate v2", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(-1), brackets: [{ from: 0, rate: 300 }], note }, i.salesManager));
  const v2 = (await byLabel("pricing", "vol_kg v2")).id;
  confirmed(await f.apply({ action: "pricing.approve", id: v2, note }, i.accounts));
  assert.equal((await row("pricing", v1)).status, "retired");
  const kept = (await detail("pricing", first.id)).row.details.snapshot;
  assert.equal(kept.bracket.version, 1, "the earlier price still shows the rule version that produced it");
  assert.match((await price({ quantity: 120 })).review.facts["Rule applied"], /vol_kg v2/);
  // Between review and confirmation a rule is replaced: the confirmation is refused, not silently repriced.
  const stale = await price({ quantity: 120 });
  confirmed(await f.apply({ action: "pricing.define", code: "vol_kg", name: "Standard volume rate v3", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: day(-1), brackets: [{ from: 0, rate: 310 }], note }, i.salesManager));
  confirmed(await f.apply({ action: "pricing.approve", id: (await byLabel("pricing", "vol_kg v3")).id, note }, i.accounts));
  rejected(await f.commit(stale, i.sales), /relevant source changed/);
  // A voided price stays on record.
  const recorded = (await list("pricing", i.owner)).rows.find(r => r.details.kind === "calculation" && r.status === "recorded");
  confirmed(await f.apply({ action: "pricing.void", id: recorded.id, note }, i.salesManager));
  assert.equal((await row("pricing", recorded.id)).status, "voided");
  await refused(f.apply({ action: "pricing.void", id: recorded.id, note }, i.salesManager), /Only a recorded price/);
});

test("NOV-064: an issued quotation is not repriced, and an override needs a manager, a reason and a limit it does not exceed", async () => {
  await rule();
  await assert.rejects(() => price({ quantity: 120, quote_id: i.quoteSent }), /issued quotation keeps the price/);
  await assert.rejects(() => price({ quantity: 120, quote_id: i.quoteDraft, customer_id: i.customer2 }), /Choose a quotation of this customer/);
  // Sales may price but not override.
  await assert.rejects(() => price({ quantity: 120, override_rate: 200, override_reason: "Match competitor" }, i.sales), /Only a sales manager, admin or owner/);
  await assert.rejects(() => price({ quantity: 120, override_rate: 200 }, i.salesManager), /Review the required action details|reason for the override/);
  await assert.rejects(() => price({ quantity: 120, override_reason: "Match competitor" }, i.salesManager), /Review the required action details|override reason needs an override rate/);
  const ok = await price({ quantity: 120, override_rate: 220, override_reason: "Match competitor quote" }, i.salesManager);
  assert.equal(ok.review.facts.Total, "INR 26,400.00");
  assert.match(ok.review.warnings.join(" "), /Override: the rule rate of INR 230 is replaced by INR 220/);
  // An authority revision caps the reduction each role may grant (percentage points).
  await f.db.query(`insert into decision_authority_revisions(id,company_id,decision_type,revision,limits,effective_from,published_by,note) values(gen_random_uuid(),$1,'low_margin_quote',1,'{"sales_manager":5}',now()-interval '1 day',$2,'Test limit')`, [i.company, i.owner]);
  await assert.rejects(() => price({ quantity: 120, override_rate: 200, override_reason: "Match competitor quote" }, i.salesManager), /above your approval limit of 5 points/);
  const within = confirmed(await f.commit(await price({ quantity: 120, override_rate: 225, override_reason: "Match competitor quote" }, i.salesManager), i.salesManager));
  const stored = await row("pricing", idOf(within), i.salesManager);
  assert.equal(n(stored.details.override_rate), 225);
  assert.ok(stored.details.snapshot.bracket.rate === 230 || n(stored.details.snapshot.bracket.rate) === 230);
  // An owner has no ceiling in the revision, so the larger reduction is allowed for them.
  assert.equal((await price({ quantity: 120, override_rate: 100, override_reason: "Owner approved special price" }, i.owner)).state, "prepared");
  // An override cannot undercut the minimum charge.
  await rule({ code: "min_kg", name: "Minimum charge", charge_type: "minimum_charge", amount: 30000, brackets: undefined });
  assert.equal((await price({ quantity: 120, override_rate: 220, override_reason: "Match competitor quote" }, i.owner)).review.facts.Total, "INR 30,000.00");
});

// NOV-078 ---------------------------------------------------------------------------------------
const claimBody = (patch = {}) => ({ action: "claim.submit", purchase_order_line_id: i.poLine, claim_type: "shortage", quantity: 500, amount: 105000, remedy: "credit", owner_id: i.inventory, response_due: day(7), note, ...patch });
const submitClaim = async (patch = {}, actor = i.inventory) => idOf(confirmed(await f.apply(claimBody(patch), actor)));
const agree = (id, aq, aa, actor = i.inventory) => f.apply({ action: "claim.respond", id, response: "agreed", agreed_quantity: aq, agreed_amount: aa, note }, actor);

test("NOV-078: the same quantity cannot be claimed twice, and shortage and rejected pools stay separate", async () => {
  // The line ordered 2000 kg and received 1000 kg: 1000 kg short; 50 rejected and 950 held at receipt.
  const first = await submitClaim({ quantity: 400, amount: 84000 });
  const created = await row("claims", first);
  assert.equal(created.status, "submitted");
  assert.equal(created.details.pool.available, 200, 'received 1400 of the 2000 kg ordered, so 600 kg are short and 400 are claimed');
  await assert.rejects(() => f.prepare(claimBody({ quantity: 300 }), i.inventory), /Only 200 kg are open to claim/);
  const second = await submitClaim({ quantity: 200, amount: 42000 });
  await assert.rejects(() => f.prepare(claimBody({ quantity: 1 }), i.inventory), /Only 0 kg are open to claim/);
  // Rejected, wrong-specification and damage claims share the rejected and held quantity.
  const rejectedClaim = await submitClaim({ claim_type: "rejected_receipt", quantity: 800, amount: 168000, remedy: "replacement" });
  await assert.rejects(() => f.prepare(claimBody({ claim_type: "wrong_specification", quantity: 300, remedy: "replacement" }), i.inventory), /Only 200 kg are open to claim for a wrong specification claim/);
  await submitClaim({ claim_type: "damage", quantity: 200, amount: 42000, remedy: "replacement" });
  // A rejected supplier response releases the quantity for another claim.
  confirmed(await f.apply({ action: "claim.respond", id: rejectedClaim, response: "rejected", note }, i.inventory));
  assert.equal((await f.prepare(claimBody({ claim_type: "wrong_specification", quantity: 800, amount: 168000, remedy: "replacement" }), i.inventory)).state, "prepared");
  assert.ok(second);
  // The amount is only a warning against the purchase rate; the supplier-reported figure is kept as entered.
  const odd = await f.prepare(claimBody({ claim_type: "damage", quantity: 100, amount: 5000, remedy: "refund" }), i.inventory);
  assert.match(odd.review.warnings.join(" "), /differs from the quantity at the purchase rate \(INR 21,000.00\)/);
  assert.match(odd.review.warnings.join(" "), /Nothing is credited or replaced until/);
});

test("NOV-078: partial settlement, replacement plus credit, a reversed credit and a competing link keep the claim honest", async () => {
  const claim = await submitClaim({ quantity: 500, amount: 105000, remedy: "replacement" });
  await refused(f.apply({ action: "claim.link", id: claim, kind: "replacement", receipt_line_id: i.receiptLineNew, quantity: 100, note }, i.inventory), /only to an agreed claim/);
  confirmed(await agree(claim, 400, 20000));
  assert.equal((await row("claims", claim)).status, "agreed");
  // A replacement receipt that came after the claim is linked for part of the agreed quantity.
  confirmed(await f.apply({ action: "claim.link", id: claim, kind: "replacement", receipt_line_id: i.receiptLineNew, quantity: 150, note }, i.inventory));
  let current = await row("claims", claim);
  assert.equal(current.status, "partially_recovered");
  assert.equal(n(current.details.recovered_quantity), 150);
  // The same receipt cannot count twice, an earlier receipt cannot count at all, and the quantity is capped.
  await refused(f.apply({ action: "claim.link", id: claim, kind: "replacement", receipt_line_id: i.receiptLineNew, quantity: 50, note }, i.inventory), /already linked to a claim/);
  await refused(f.apply({ action: "claim.link", id: claim, kind: "replacement", receipt_line_id: i.receiptLineOld, quantity: 50, note }, i.inventory), /before the claim/);
  await refused(f.apply({ action: "claim.link", id: claim, kind: "replacement", receipt_line_id: i.receiptLineNew, quantity: 400, note }, i.inventory), /accepted only 300|already linked/);
  // A credit note completes the amount; the claim closes only when quantity and amount are both recovered.
  await refused(f.apply({ action: "claim.link", id: claim, kind: "refund", credit_id: i.credit1, note }, i.inventory), /This is a credit note but you chose refund/);
  await refused(f.apply({ action: "claim.link", id: claim, kind: "credit", credit_id: i.creditOld, note }, i.inventory), /posted before the claim/);
  await refused(f.apply({ action: "claim.link", id: claim, kind: "credit", credit_id: nid758(), note }, i.inventory), /same supplier/);
  confirmed(await f.apply({ action: "claim.link", id: claim, kind: "credit", credit_id: i.credit1, note }, i.inventory));
  current = await row("claims", claim);
  assert.equal(current.status, "partially_recovered");
  assert.equal(n(current.details.recovered_amount), 10000);
  // The credit could not satisfy a second claim at the same time.
  const rival = await submitClaim({ claim_type: "damage", quantity: 100, amount: 21000, remedy: "credit" });
  confirmed(await agree(rival, 0, 10000));
  await refused(f.apply({ action: "claim.link", id: rival, kind: "credit", credit_id: i.credit1, note }, i.inventory), /already linked to a claim/);
  // Reverse the credit: the amount is open again and the history keeps both events.
  const link = current.details.recoveries.find(r => r.kind === "credit");
  confirmed(await f.apply({ action: "claim.unlink", id: claim, recovery_id: link.id, note }, i.inventory));
  current = await row("claims", claim);
  assert.equal(n(current.details.recovered_amount), 0);
  assert.equal(current.details.recoveries.find(r => r.kind === "credit").reversed, true);
  // Recover everything agreed: the claim closes by itself and reopens if a link is reversed.
  confirmed(await f.apply({ action: "claim.respond", id: claim, response: "agreed", agreed_quantity: 150, agreed_amount: 10000, note }, i.inventory));
  confirmed(await f.apply({ action: "claim.link", id: claim, kind: "credit", credit_id: i.credit1, note }, i.inventory));
  current = await row("claims", claim);
  assert.equal(current.status, "closed");
  assert.equal(current.details.close_note, "Fully recovered");
  const again = current.details.recoveries.find(r => r.kind === "credit" && !r.reversed);
  confirmed(await f.apply({ action: "claim.unlink", id: claim, recovery_id: again.id, note }, i.inventory));
  assert.equal((await row("claims", claim)).status, "partially_recovered");
  const history = (await detail("claims", claim)).events.map(e => e.action);
  assert.ok(history.includes("claim.unlink") && history.includes("claim.link") && history.includes("claim.respond"));
  // Nothing in finance or stock was created by any of this.
  assert.equal(n((await one("select count(*) c from expense_supplier_credits")).c), 4);
});
const nid758 = () => "be500000-0000-4000-8000-000000000758";

test("NOV-078: a dispute, a changed response, a rejection, a close with an unresolved difference and overdue follow-up", async () => {
  const claim = await submitClaim({ response_due: day(1) });
  await f.db.query("update supplier_claims set response_due=current_date-3 where id=$1", [claim]);
  assert.equal((await row("claims", claim)).status, "response_overdue");
  assert.equal((await list("claims", i.owner, { state: "active" })).rows[0].id, claim, "overdue claims lead the list");
  confirmed(await f.apply({ action: "claim.respond", id: claim, response: "disputed", note }, i.inventory));
  assert.equal((await row("claims", claim)).status, "response_overdue", "a dispute that is past its follow-up date is still shown as needing a response");
  await f.db.query("update supplier_claims set response_due=current_date+5 where id=$1", [claim]);
  assert.equal((await row("claims", claim)).status, "disputed");
  await refused(f.apply({ action: "claim.respond", id: claim, response: "agreed", agreed_quantity: 600, agreed_amount: 1, note }, i.inventory), /Review the required|between 0 and 500/);
  await assert.rejects(() => f.prepare({ action: "claim.respond", id: claim, response: "agreed", agreed_quantity: 100, note }, i.inventory), /agreed quantity and the agreed amount/);
  await assert.rejects(() => f.prepare({ action: "claim.respond", id: claim, response: "agreed", agreed_quantity: 0, agreed_amount: 0, note }, i.inventory), /agreed quantity or an agreed amount|agreed quantity and the agreed amount/);
  await assert.rejects(() => f.prepare({ action: "claim.respond", id: claim, response: "disputed", agreed_quantity: 1, note }, i.inventory), /belong to an agreed response only/);
  confirmed(await agree(claim, 300, 63000));
  const preview = await f.prepare({ action: "claim.close", id: claim, note }, i.inventory);
  assert.match(preview.review.warnings.join(" "), /Unresolved difference kept on the record: 300 kg and INR 63,000.00/);
  confirmed(await f.commit(preview, i.inventory));
  const closed = await row("claims", claim);
  assert.equal(closed.status, "closed");
  assert.equal(n(closed.details.unresolved_quantity), 300);
  await refused(f.apply({ action: "claim.respond", id: claim, response: "agreed", agreed_quantity: 1, agreed_amount: 1, note }, i.inventory), /cannot take a new supplier response/);
  await refused(f.apply({ action: "claim.close", id: claim, note }, i.inventory), /already finished/);
  // A rejected claim cannot be rejected after recoveries exist; reject before any link.
  const other = await submitClaim({ claim_type: "damage", quantity: 50, amount: 10500, remedy: "replacement" });
  confirmed(await agree(other, 50, 5000));
  confirmed(await f.apply({ action: "claim.link", id: other, kind: "replacement", receipt_line_id: i.receiptLineNew, quantity: 50, note }, i.inventory));
  await refused(f.apply({ action: "claim.respond", id: other, response: "rejected", note }, i.inventory), /Recoveries are already linked/);
  // Production cannot act; quality can read.
  await assert.rejects(() => f.prepare(claimBody(), i.production), /Not permitted/);
  assert.equal((await list("claims", i.quality)).total_count, 2);
  await assert.rejects(() => f.prepare(claimBody({ response_due: day(120) }), i.inventory).then(p => f.commit(p, i.inventory)).then(r => { if (r.state !== "confirmed") throw Error(r.result.message); }), /within the next 90 days/);
});
