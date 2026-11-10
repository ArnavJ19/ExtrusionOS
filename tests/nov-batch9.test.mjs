import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url); require("tsx/cjs");
const { COMMERCIAL_ROLES, COMMERCIAL_STATUS, COMMERCIAL_VIEWS, NOTELESS_ACTIONS, canReadCommercial, canUseCommercialAction, commercialCommandSchema, commercialLookupSchema, commercialListSchema, commercialMutationSchema,
  commercialMutationView, commercialRecoveryKey, commercialStatusLabel, transferCsv } = require("../lib/workflow/commercial.ts");
const { buildCommercialMutation, commercialFieldVisible, parseBrackets } = require("../lib/workflow/commercial-form.ts");
const { DEFAULT_DENSITY, DENSITY_TOKENS, DENSITIES, browserStore, densityKey, parseDensity, readDensity, resetDensity, writeDensity } = require("../lib/preferences/density.ts");

const u = n => `bd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const note = "Reviewed with the responsible department";
const parse = value => commercialMutationSchema.safeParse(value);
const bad = (value, message) => { const r = parse(value); assert.equal(r.success, false, JSON.stringify(value)); if (message) assert.match(r.error.issues.map(i => i.message).join(" | "), message); };
const sql = readFileSync(new URL("../supabase/migrations/20261103700000_november_commercial.sql", import.meta.url), "utf8");

test("pricing rules: bracket tables are validated the same way the database validates them", () => {
  const base = { action: "pricing.define", code: "vol_kg", name: "Volume rate", charge_type: "bracket_rate", unit_basis: "kg", precedence: 0, effective_from: "2026-11-01", note };
  assert.equal(parse({ ...base, brackets: [{ from: 0, to: 100, rate: 250 }, { from: 100, rate: 230 }] }).success, true);
  bad({ ...base }, /needs its brackets/);
  bad({ ...base, brackets: [{ from: 5, to: 100, rate: 250 }] }, /first bracket starts at 0/);
  bad({ ...base, brackets: [{ from: 0, to: 100, rate: 250 }, { from: 120, rate: 230 }] }, /start exactly where bracket 1 ends/);
  bad({ ...base, brackets: [{ from: 0, rate: 250 }, { from: 100, rate: 230 }] }, /Only the last bracket may be open-ended/);
  bad({ ...base, brackets: [{ from: 0, to: 0, rate: 250 }] }, /must end after it starts|Bracket end/);
  bad({ ...base, brackets: [{ from: 0, rate: 250.12345 }] }, /at most 4 decimal/);
  bad({ ...base, brackets: [{ from: 0, rate: 250 }], amount: 100 }, /uses brackets, not a single amount/);
  bad({ ...base, brackets: Array.from({ length: 13 }, (_, k) => ({ from: k, to: k + 1, rate: 1 })) });
  bad({ ...base, brackets: [{ from: 0, rate: 250 }], effective_to: "2026-10-01" }, /cannot end before it starts/);
  bad({ ...base, code: "Bad Code", brackets: [{ from: 0, rate: 250 }] }, /lowercase letters/);
  bad({ ...base, brackets: [{ from: 0, rate: 250 }], extra: 1 });
  const min = { ...base, charge_type: "minimum_charge", brackets: undefined };
  bad(min, /Enter the minimum charge/);
  assert.equal(parse({ ...min, amount: 5000 }).success, true);
  bad({ ...min, amount: 5000, processing_code: "cutting" }, /Only a processing charge has a code/);
  bad({ ...min, charge_type: "processing_charge", amount: 3 }, /needs a code/);
  assert.equal(parse({ ...min, charge_type: "processing_charge", amount: 3, processing_code: "cutting" }).success, true);
  bad({ ...min, amount: 10.005 }, /at most 2 decimal/);
  bad({ ...min, amount: 5000, brackets: [{ from: 0, rate: 1 }] }, /Only a volume rate has brackets/);
});

test("pricing: quantity, overrides and processing codes are bounded; a price carries no separate note", () => {
  const price = { action: "pricing.price", customer_id: u(1), unit_basis: "kg", quantity: 120 };
  assert.equal(parse(price).success, true);
  assert.equal(NOTELESS_ACTIONS.includes("pricing.price"), true);
  for (const quantity of [0, -1, 1.2345, 100000001]) bad({ ...price, quantity });
  bad({ ...price, unit_basis: "tonne" });
  bad({ ...price, override_rate: 200 }, /reason for the override/);
  bad({ ...price, override_reason: "Match competitor" }, /needs an override rate/);
  assert.equal(parse({ ...price, override_rate: 200, override_reason: "Match competitor" }).success, true);
  bad({ ...price, processing_codes: ["cutting", "cutting"] }, /once/);
  bad({ ...price, processing_codes: ["Cutting"] });
  bad({ ...price, processing_codes: [] });
  bad({ ...price, note });
  bad({ ...price, customer_id: "not-a-uuid" });
});

test("claims: agreed figures, recovery links and closure carry the fields the database requires", () => {
  const submit = { action: "claim.submit", purchase_order_line_id: u(1), claim_type: "shortage", quantity: 100, amount: 21000, remedy: "credit", owner_id: u(2), response_due: "2026-11-12", note };
  assert.equal(parse(submit).success, true);
  for (const patch of [{ quantity: 0 }, { amount: 0 }, { claim_type: "lost" }, { remedy: "gift" }, { response_due: "tomorrow" }, { note: "no" }]) bad({ ...submit, ...patch });
  const respond = { action: "claim.respond", id: u(3), note };
  bad({ ...respond, response: "agreed" }, /agreed quantity and amount/);
  bad({ ...respond, response: "agreed", agreed_quantity: 0, agreed_amount: 0 }, /agreed quantity or amount/);
  assert.equal(parse({ ...respond, response: "agreed", agreed_quantity: 0, agreed_amount: 5000 }).success, true);
  bad({ ...respond, response: "disputed", agreed_amount: 5 }, /agreed response only/);
  assert.equal(parse({ ...respond, response: "rejected" }).success, true);
  const link = { action: "claim.link", id: u(3), note };
  bad({ ...link, kind: "replacement" }, /receipt line and the quantity/);
  bad({ ...link, kind: "replacement", receipt_line_id: u(4), quantity: 5, credit_id: u(5) }, /does not link a credit/);
  bad({ ...link, kind: "credit" }, /links one posted supplier credit/);
  bad({ ...link, kind: "refund", credit_id: u(5), quantity: 3 }, /does not link a receipt/);
  assert.equal(parse({ ...link, kind: "replacement", receipt_line_id: u(4), quantity: 5 }).success, true);
  assert.equal(parse({ ...link, kind: "credit", credit_id: u(5) }).success, true);
});

test("outcomes, commitments and snapshots: enumerations are closed and a note is required where the action has one", () => {
  const outcome = { action: "outcome.record", quote_id: u(1), outcome: "lost", reason_code: "price", evidence: "customer_stated" };
  assert.equal(parse(outcome).success, true);
  assert.equal(NOTELESS_ACTIONS.includes("outcome.record"), true);
  for (const patch of [{ outcome: "won" }, { reason_code: "rumour" }, { evidence: "gossip" }, { product_family: "x" }, { note }]) bad({ ...outcome, ...patch });
  assert.equal(parse({ action: "outcome.reopen", quote_id: u(1), note }).success, true);
  bad({ action: "outcome.reopen", quote_id: u(1) });
  assert.equal(parse({ action: "commitment.set", purchase_order_id: u(1), promised_date: "2026-11-20", note }).success, true);
  bad({ action: "commitment.set", purchase_order_id: u(1), promised_date: "20/11/2026", note });
  assert.equal(parse({ action: "profit.snapshot", order_id: u(1), finalize: false, note }).success, true);
  bad({ action: "profit.snapshot", order_id: u(1), finalize: "yes", note });
});

test("remnants, exports, runs and scenarios: measurements, results and changes are bounded", () => {
  const lot = { action: "remnant.record", profile_id: u(1), length_mm: 3500, pieces: 10, finish: "anodizing", origin_type: "cutting_remnant", location: "Rack R4", note };
  assert.equal(parse(lot).success, true);
  for (const patch of [{ length_mm: 99 }, { length_mm: 12001 }, { length_mm: 3500.5 }, { pieces: 0 }, { pieces: 10001 }, { origin_type: "found" }, { condition: "ruined" }]) bad({ ...lot, ...patch });
  assert.equal(parse({ action: "remnant.reserve", id: u(1), order_item_id: u(2), pieces: 4, note }).success, true);
  bad({ action: "remnant.reserve", id: u(1), order_item_id: u(2), pieces: 0, note });
  assert.equal(parse({ action: "remnant.correct", id: u(1), length_mm: 3400, pieces: 6, note }).success, true);
  assert.equal(parse({ action: "mapping.define", sales_ledger: "Sales", tax_ledger: "GST", party_key: "gst_number", note }).success, true);
  bad({ action: "mapping.define", sales_ledger: "Sales", tax_ledger: "GST", party_key: "pan", note });
  for (const count of [0, 26, 1.5]) bad({ action: "transfer.prepare", count, note });
  bad({ action: "transfer.result", id: u(1), result: "accepted", note }, /reference the accounting package gave/);
  bad({ action: "transfer.result", id: u(1), result: "rejected", external_reference: "X", note }, /no package reference/);
  assert.equal(parse({ action: "transfer.result", id: u(1), result: "accepted", external_reference: "TALLY-1", note }).success, true);
  bad({ action: "run.save", group_key: "xyz", note });
  assert.equal(parse({ action: "run.save", group_key: "a".repeat(32), note }).success, true);
  const change = { type: "machine_down", machine_id: u(1), from_date: "2026-11-06", days: 2 };
  const scenario = { action: "scenario.create", name: "Press A breakdown", horizon_days: 7, changes: [change], note };
  assert.equal(parse(scenario).success, true);
  for (const patch of [{ horizon_days: 2 }, { horizon_days: 15 }, { changes: [] }, { changes: Array.from({ length: 7 }, () => change) }, { changes: [{ ...change, days: 0 }] }, { changes: [{ type: "teleport" }] }, { changes: [{ ...change, extra: 1 }] }, { name: "no" }]) bad({ ...scenario, ...patch });
  assert.equal(parse({ ...scenario, changes: [{ type: "urgent_order", machine_id: u(1), kg: 250.5, due_date: "2026-11-09" }, { type: "extra_shift", machine_id: u(1), date: "2026-11-07", kg: 100 }, { type: "delayed_receipt", job_id: u(2), days: 3 }] }).success, true);
  bad({ ...scenario, changes: [{ type: "delayed_receipt", job_id: u(2), days: 15 }] });
});

test("the command envelope is strict, defaults filters and refuses unknown fields", () => {
  const ok = commercialCommandSchema.parse({ command: "list", view: "pricing" });
  assert.deepEqual([ok.page, ok.state, ok.sort, ok.search], [1, "active", "priority", ""]);
  for (const bad of [{ command: "list", view: "nonsense" }, { command: "list", view: "pricing", page: 0 }, { command: "list", view: "pricing", company_id: u(9) }, { command: "lookup", kind: "secrets" }, { command: "commit", request_id: u(1), fingerprint: "short" }, { command: "preview", request_id: u(1) }])
    assert.equal(commercialCommandSchema.safeParse(bad).success, false);
  assert.equal(commercialLookupSchema.safeParse([{ value: u(1), label: "A", context: "b" }]).success, true);
  assert.equal(commercialListSchema.safeParse({ rows: Array.from({ length: 11 }, () => ({})), total_count: 11, as_of: "x" }).success, false, "a page never carries more than ten rows");
});

test("role mirrors: reading and acting are separate, a viewer never acts, and dealers have no access", () => {
  const actions = commercialMutationSchema._def.schema.options.map(option => option.shape.action.value);
  assert.equal(actions.length, 35);
  for (const action of actions) {
    assert.ok(commercialMutationView(action) in COMMERCIAL_VIEWS, action);
    assert.equal(canUseCommercialAction("viewer", action), false, `viewer ${action}`);
    assert.equal(canUseCommercialAction("dealer_admin", action), false);
    for (const role of COMMERCIAL_ROLES) if (canUseCommercialAction(role, action)) assert.equal(canReadCommercial(role, commercialMutationView(action)), true, `${role} acts on ${action} so it must read the view`);
  }
  assert.equal(canReadCommercial("dealer_staff"), false);
  assert.equal(canReadCommercial("unknown"), false);
  assert.equal(canReadCommercial("sales", "profitability"), false, "cost and margin stay with accounts and owners");
  assert.equal(canReadCommercial("sales_manager", "cohorts"), true);
  assert.equal(canReadCommercial("sales", "cohorts"), false);
  assert.equal(canReadCommercial("production", "transfers"), false);
  assert.equal(canUseCommercialAction("accounts", "transfer.prepare"), true);
  assert.equal(canUseCommercialAction("sales_manager", "transfer.prepare"), false);
  assert.equal(canUseCommercialAction("sales", "pricing.price"), true);
  assert.equal(canUseCommercialAction("sales", "pricing.define"), false);
});

test("every row status the database can return has a plain-language label", () => {
  const statuses = new Set();
  for (const match of sql.matchAll(/(?:then|else) '([a-z_]+)'(?= (?:when|else|end)|\s*end)/g)) statuses.add(match[1]);
  for (const status of ["draft", "approved", "scheduled", "expired", "retired", "recorded", "superseded", "voided", "response_overdue", "disputed", "submitted", "agreed", "partially_recovered", "rejected", "closed", "provisional", "finalized", "no_estimate",
    "attention", "low_sample", "measured", "needs_reason", "open", "won", "partially_won", "lost", "withdrawn", "no_decision", "in_progress", "complete", "available", "held", "scrapped", "exhausted", "results_open", "prepared", "exported", "cancelled",
    "suggested", "proposed", "accepted", "dismissed", "stale", "shared", "discarded"]) assert.ok(COMMERCIAL_STATUS[status], `label for ${status}`);
  assert.equal(commercialStatusLabel("something_new"), "something new");
  assert.equal(commercialStatusLabel("draft", "scenarios"), "Draft; not yet shared for review");
  assert.match(commercialStatusLabel("draft", "pricing"), /second approver/);
  assert.equal(commercialRecoveryKey("c", "u"), "extrusionos:commercial:v1:c:u");
});

test("the form builder omits blank optional values, converts types and carries structured fields", () => {
  const fields = [{ key: "customer_id", label: "Customer" }, { key: "unit_basis", label: "Unit" }, { key: "quantity", label: "Quantity", type: "number" }, { key: "finishing_type", label: "Finish", optional: true },
    { key: "processing_codes", label: "Codes", type: "codes", optional: true }, { key: "override_rate", label: "Override", type: "number", optional: true }, { key: "override_reason", label: "Reason", type: "note", optional: true }];
  const built = buildCommercialMutation("pricing.price", fields, { customer_id: u(1), unit_basis: "kg", quantity: "120", finishing_type: "  ", processing_codes: "cutting, packing", override_rate: "", override_reason: "" }, {});
  assert.equal(built.success, true, JSON.stringify(built.error?.issues));
  assert.deepEqual(built.data, { action: "pricing.price", customer_id: u(1), unit_basis: "kg", quantity: 120, processing_codes: ["cutting", "packing"] });
  assert.equal(buildCommercialMutation("pricing.price", fields, { customer_id: u(1), unit_basis: "kg", quantity: "" }, {}).success, false);
  assert.equal(buildCommercialMutation("pricing.price", fields, { customer_id: u(1), unit_basis: "kg", quantity: "5", note }, {}).data?.note, undefined, "a noteless action never sends a note");
  // A fixed value (such as a claim identity) cannot be overridden by what was typed.
  const link = buildCommercialMutation("claim.close", [{ key: "id", label: "Claim" }, { key: "note", label: "Reason", type: "note" }], { id: u(9), note }, { id: u(2) });
  assert.equal(link.data.id, u(2));
  // A field that depends on a choice is left out when the choice does not use it.
  const field = { key: "receipt_line_id", label: "Receipt", when: { kind: ["replacement"] } };
  assert.equal(commercialFieldVisible(field, { kind: "credit" }, {}), false);
  assert.equal(commercialFieldVisible(field, { kind: "replacement" }, {}), true);
  assert.equal(commercialFieldVisible(field, {}, { kind: "replacement" }), true);
  // Multi-line text is joined into one line because the database refuses line breaks.
  const joined = buildCommercialMutation("claim.close", [{ key: "id", label: "Claim" }, { key: "note", label: "Reason", type: "note" }], { id: u(2), note: "Line one\nline two is here" }, {});
  assert.equal(joined.data.note, "Line one line two is here");
  // Bracket lines and hypothetical changes become structured values.
  assert.deepEqual(parseBrackets("0 | 100 | 250\n100 | | 230.5"), [{ from: 0, to: 100, rate: 250 }, { from: 100, rate: 230.5 }]);
  for (const text of ["", "0 | 100", "a | b | c", "0 | 100 | -5", "0 | 100 | 250 | 9"]) assert.equal(parseBrackets(text), null, text);
  const changes = buildCommercialMutation("scenario.create", [{ key: "name", label: "Name" }, { key: "horizon_days", label: "Horizon", type: "number" }, { key: "changes", label: "Changes", type: "changes" }, { key: "note", label: "Reason", type: "note" }],
    { name: "Press A breakdown", horizon_days: "7", changes: JSON.stringify([{ type: "machine_down", machine_id: u(1), from_date: "2026-11-06", days: 1 }]), note }, {});
  assert.equal(changes.success, true);
  assert.equal(buildCommercialMutation("scenario.create", [{ key: "changes", label: "Changes", type: "changes" }], { changes: "{broken" }, {}).success, false);
});

test("the accounting file neutralises formulas and quotes separators, and never trusts a name", () => {
  const csv = transferCsv([{ external_ref: "EOS-INV-1", invoice_number: "INV-1", invoice_date: "2026-11-05", party: "+91 98200", amount: 1000, tax_amount: 180 }, { external_ref: "EOS-INV-2", invoice_number: "INV-2", invoice_date: "2026-11-05", party: "\"Quoted\" & Co, Ltd", amount: 10.5, tax_amount: 1.89 },
    { external_ref: "EOS-INV-3", invoice_number: "INV-3", invoice_date: "2026-11-05", party: "@cmd|' /C calc'!A0", amount: 1, tax_amount: 0.18 }], { sales_ledger: "Sales", tax_ledger: "=GST" });
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 4);
  assert.match(lines[1], /,'\+91 98200,/);
  assert.match(lines[2], /"""Quoted"" & Co, Ltd"/);
  assert.match(lines[3], /,'@cmd/);
  assert.match(lines[1], /,'=GST,/, "the ledger name is neutralised too");
  assert.match(lines[2], /,10.50,'=GST,1.89,12.39$/);
});

test("NOV-082: density is a device preference that falls back safely and never changes data volume", () => {
  assert.deepEqual([...DENSITIES], ["comfortable", "compact"]);
  assert.equal(DEFAULT_DENSITY, "comfortable");
  for (const value of ["compact"]) assert.equal(parseDensity(value), "compact");
  for (const value of ["comfortable", "", null, undefined, "dense", 5, {}, "COMPACT"]) assert.equal(parseDensity(value), "comfortable");
  const scope = { companyId: "c1", userId: "u1" };
  assert.equal(densityKey(scope), "extrusionos:density:v1:c1:u1");
  assert.notEqual(densityKey(scope), densityKey({ companyId: "c1", userId: "u2" }), "each user keeps their own choice");
  const memory = new Map();
  const store = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); }, removeItem: key => { memory.delete(key); } };
  assert.equal(readDensity(store, scope), "comfortable");
  assert.equal(writeDensity(store, scope, "compact"), true);
  assert.equal(readDensity(store, scope), "compact");
  assert.equal(readDensity(store, { companyId: "c1", userId: "u2" }), "comfortable");
  assert.equal(resetDensity(store, scope), true);
  assert.equal(readDensity(store, scope), "comfortable");
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(readDensity(broken, scope), "comfortable");
  assert.equal(writeDensity(broken, scope, "compact"), false);
  assert.equal(resetDensity(broken, scope), false);
  assert.equal(readDensity(null, scope), "comfortable");
  assert.equal(writeDensity(null, scope, "compact"), false);
  assert.equal(browserStore(), null, "no window on the server");
  // Compact is denser but never below a readable minimum, and the stylesheet keeps touch layouts comfortable.
  const rem = value => Number.parseFloat(value);
  assert.ok(rem(DENSITY_TOKENS.compact.controlPadding) < rem(DENSITY_TOKENS.comfortable.controlPadding));
  assert.ok(rem(DENSITY_TOKENS.compact.rowPadding) >= 0.25 && rem(DENSITY_TOKENS.compact.controlPadding) >= 0.25);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(pointer: fine\) \{\s*html\[data-density="compact"\]/);
  for (const [name, value] of Object.entries({ "--density-control-y": DENSITY_TOKENS.comfortable.controlPadding, "--density-row-y": DENSITY_TOKENS.comfortable.rowPadding, "--density-gap": DENSITY_TOKENS.comfortable.gap })) assert.match(css, new RegExp(`${name}: ${value}`));
  for (const [name, value] of Object.entries({ "--density-control-y": DENSITY_TOKENS.compact.controlPadding, "--density-row-y": DENSITY_TOKENS.compact.rowPadding, "--density-gap": DENSITY_TOKENS.compact.gap })) assert.match(css.slice(css.indexOf("@media (pointer: fine)")), new RegExp(`${name}: ${value}`));
  assert.equal(/\.density-row/.test(css), true);
});

test("migration audit: every new table has company scoping, RLS and no client grant beyond a person's own request", () => {
  const tables = [...sql.matchAll(/^create table public\.([a-z_]+) \(/gm)].map(match => match[1]);
  assert.equal(tables.length, 17);
  const rlsBlock = sql.slice(sql.indexOf("foreach t in array array["), sql.indexOf("] loop"));
  for (const table of tables) {
    assert.ok(rlsBlock.includes(`'${table}'`), `${table} has RLS enabled and client access revoked`);
    const definition = sql.slice(sql.indexOf(`create table public.${table} (`)); const end = definition.indexOf("\n);");
    assert.match(definition.slice(0, end), /company_id uuid not null references public\.companies\(id\)/, `${table} carries company_id`);
  }
  assert.match(sql, /revoke all on public\.%I from public,anon,authenticated/);
  const grants = [...sql.matchAll(/^grant ([^;]+);/gm)].map(match => match[1]);
  assert.deepEqual(grants.filter(grant => /select|insert|update|delete/.test(grant)), ["select on public.commercial_requests to authenticated"]);
  assert.match(sql, /create policy commercial_request_owner on public\.commercial_requests for select to authenticated using \(\s*company_id=private\.get_current_user_company_id\(\) and actor_id=auth\.uid\(\) and private\.get_current_user_dealer_id\(\) is null/);
  // Every function is security definer with a pinned search path or a pure immutable helper, and none is executable by clients except the entry point and the role matrix.
  const functions = [...sql.matchAll(/create function ((?:public|private)\.[a-z_]+)\(/g)].map(match => match[1]);
  const executable = new Set(sql.match(/grant execute on function [^;]+;/g).flatMap(grant => [...grant.matchAll(/((?:public|private)\.[a-z_]+)\(/g)].map(match => match[1])));
  assert.deepEqual([...executable].sort(), ["private.commercial_action_allowed", "private.commercial_read_allowed", "private.commercial_view", "public.commercial_command"]);
  for (const name of functions.filter(name => !executable.has(name))) assert.match(sql, new RegExp(`revoke all on function[^;]*${name.replace(".", "\\.")}\\(`), `${name} is not executable by clients`);
  assert.equal(/drop table|drop column|truncate|alter table [a-z_.]+ drop|disable row level security/i.test(sql), false, "the migration is additive");
  assert.equal(/service_role/i.test(sql), false);
  assert.equal(/frontend company|p_company uuid default/i.test(sql), false);
  // Company and actor come from the session, never from the payload.
  assert.match(sql, /v_actor uuid:=auth\.uid\(\);v_company uuid:=private\.get_current_user_company_id\(\)/);
  assert.equal(/p_payload->>'company_id'|p_mutation->>'company_id'/.test(sql), false);
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort();
  // Later batches may follow; the batch 9 migration must be present and none may be inserted before it out of order.
  assert.ok(migrations.includes("20261103700000_november_commercial.sql"), "the batch 9 migration is present");
  assert.ok(migrations.filter(name => name > "20261103700000_november_commercial.sql").every(name => name.startsWith("202611038") || name.startsWith("20261109") || name.startsWith("20261110")), "only later batches follow batch 9");
});

test("source audit: the hub is server-guarded, client files never touch privileged keys, and the actions parse every response", () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const action = read("lib/actions/commercial.ts");
  assert.match(action, /"use server"/);
  assert.match(action, /getSessionContext\(\)/);
  assert.match(action, /context\.dealerId \|\| !canReadCommercial\(context\.role\)/);
  assert.match(action, /parseCommercialData\(command, result\.data\)/);
  assert.match(action, /startsWith\("NOV: "\)/, "only messages raised by this module are shown");
  assert.equal(/SERVICE_ROLE|service_role|createAdminClient/.test(action), false);
  for (const path of ["components/modules/commercial/action-center.tsx", "components/modules/commercial/mutation-form.tsx", "components/modules/commercial/record.tsx", "components/layout/density-control.tsx"]) {
    const source = read(path);
    assert.match(source, /^"use client";/);
    assert.equal(/SERVICE_ROLE|service_role|process\.env|@\/lib\/supabase/.test(source), false, `${path} stays free of privileged access`);
    if (path.includes("commercial/")) assert.equal(/company_id/.test(source), false, `${path} never sends a company identity`);
    else assert.equal(/fetch\(|use server|commercialAction/.test(source), false, "the density control makes no network or server call");
  }
  const layout = read("app/(dashboard)/tasks/commercial/layout.tsx");
  assert.match(layout, /context\.dealerId \|\| !canReadCommercial\(context\.role\)/);
  assert.match(layout, /redirect\("\/tasks"\)/);
  for (const page of ["page.tsx", "database/page.tsx", "[view]/[id]/page.tsx", "new/page.tsx"]) {
    const source = read(`app/(dashboard)/tasks/commercial/${page}`);
    assert.match(source, /getSessionContext\(\)/, page);
    assert.match(source, /canReadCommercial|canUseCommercialAction/, page);
  }
  assert.match(read("app/(dashboard)/tasks/commercial/database/page.tsx"), /density-row/);
  assert.match(read("components/layout/app-shell.tsx"), /<DensityControl scope=/);
  assert.equal(COMMERCIAL_ROLES.includes("dealer_admin"), false);
});
