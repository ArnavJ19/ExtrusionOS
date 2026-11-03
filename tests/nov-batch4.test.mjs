import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { controlCommandSchema, controlMutationSchema, canReadControl, canUseControlAction, controlMutationView, ledgerSchema, remainingToDepart } from "../lib/workflow/operations-control.ts";
import { DRAFT_MODULES, draftDefinition, draftPayload, formDraftKey, formDraftRevisionMatches, isDraftModule, isSensitiveDraftField, nextFormDraft, readFormDraft, FORM_DRAFT_LIFETIME_MS } from "../lib/forms/form-draft.ts";
import { createNov4ActionsFixture, nov4Outcome } from "../scripts/lib/nov-batch4-actions-fixture.mjs";
import { nids as i, nid } from "../scripts/lib/nov-batch4-fixture.mjs";

const f = createNov4ActionsFixture();
test.beforeEach(() => f.reset());
const note = "Reviewed with the responsible department";
const observe = () => ({ action: "wip.observe", job_id: i.job3, location_id: i.location, note });
const preview = () => ({ command: "preview", request_id: nid(1000), mutation: observe() });

test("input contracts reject injected identity, unknown actions, ambiguous quantities and owner limits", () => {
  assert.equal(controlCommandSchema.safeParse({ ...preview(), company_id: i.foreignCompany }).success, false);
  assert.equal(controlCommandSchema.safeParse({ ...preview(), mutation: { ...observe(), actor_id: i.foreign } }).success, false);
  assert.equal(controlMutationSchema.safeParse({ action: "stock.adjust", note }).success, false);
  for (const quantity_kg of [0, -1, NaN, Infinity, 1.0001, 1000001]) assert.equal(controlMutationSchema.safeParse({ ...observe(), quantity_kg }).success, false, String(quantity_kg));
  assert.equal(controlMutationSchema.safeParse({ ...observe(), quantity_kg: 85.125 }).success, true);
  assert.equal(controlMutationSchema.safeParse({ ...observe(), quantity_kg: null }).success, false, "absent and zero are different from unknown");
  const authority = { action: "authority.publish", decision_type: "overdue_dispatch", effective_from: "2026-11-03T10:00:00+05:30", note };
  assert.equal(controlMutationSchema.safeParse({ ...authority, limits: { owner: 10 } }).success, false);
  assert.equal(controlMutationSchema.safeParse({ ...authority, decision_type: "low_margin_quote", limits: { accounts: 10 } }).success, false);
  assert.equal(controlMutationSchema.safeParse({ ...authority, limits: { accounts: 10.555 } }).success, false);
  assert.equal(controlMutationSchema.safeParse({ ...authority, limits: { accounts: 100000, sales_manager: 0 } }).success, true);
  assert.equal(controlMutationSchema.safeParse({ ...authority, effective_from: "2026-11-03T10:00", limits: {} }).success, false);
  const policy = { action: "policy.set", alloy: " 6063 ", diameter_inch: 7, lead_days: 5, min_order_kg: 0, safety_stock_kg: 0, note };
  assert.equal(controlMutationSchema.parse(policy).alloy, "6063");
  for (const patch of [{ alloy: "60;63" }, { diameter_inch: 0.1 }, { lead_days: 2.5 }, { pack_kg: 0 }]) assert.equal(controlMutationSchema.safeParse({ ...policy, ...patch }).success, false, JSON.stringify(patch));
  for (const task_kind of ["general", "handoff:accounts", "type:Upper", "type:"]) assert.equal(controlMutationSchema.safeParse({ action: "contract.publish", task_kind, exclusive_source: true, note }).success, false, task_kind);
  assert.equal(controlMutationSchema.safeParse({ ...observe(), note: "Bad\u0007note" }).success, false);
});

test("role mirrors match the database matrix for every action and view", () => {
  const roles = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer", "dealer_admin", "dealer_staff"];
  for (const role of ["dealer_admin", "dealer_staff"]) assert.equal(canReadControl(role), false);
  for (const role of roles) assert.equal(canUseControlAction(role, "rollout.acknowledge"), !["viewer", "dealer_admin", "dealer_staff"].includes(role), role);
  assert.equal(canReadControl("sales", "custody"), false); assert.equal(canReadControl("accounts", "custody"), true); assert.equal(canReadControl("accounts", "inheritance"), false);
  assert.equal(canUseControlAction("accounts", "plan.review"), false); assert.equal(canUseControlAction("inventory_manager", "plan.review"), true);
  assert.equal(canUseControlAction("viewer", "wip.observe"), false); assert.equal(canUseControlAction("admin", "authority.publish"), true); assert.equal(canUseControlAction("factory_manager", "authority.publish"), false);
  assert.equal(controlMutationView("supply.link"), "procurement"); assert.equal(controlMutationView("rollout.classify"), "rollouts");
});

test("NOV-005: remaining quantity keeps unknown values unknown and never goes negative", () => {
  assert.equal(remainingToDepart(null, 10), null); assert.equal(remainingToDepart(100, null), null); assert.equal(remainingToDepart(100, 120), 0);
  fc.assert(fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0, max: 1e6, noNaN: true }), (ordered, departed) => {
    const remaining = remainingToDepart(ordered, departed); assert.ok(remaining !== null && remaining >= 0 && remaining <= Math.round(ordered * 1000) / 1000 + 0.001);
  }), { numRuns: 150 });
  const base = { order_id: i.order, as_of: "2026-11-03T10:00:00Z", status: "in_production", line_count: 1, basis: "x", ordered_kg: 1, departed_kg: 0, packed_kg: 0, delivered_kg: 0,
    sources: { production: "available" }, unlinked: { packing_rows: 0, packing_kg: 0, returns: 0, returned_kg: 0, jobs: 0, held_jobs: 0 }, lines: [] };
  assert.equal(ledgerSchema.safeParse(base).success, true);
  assert.equal(ledgerSchema.safeParse({ ...base, sources: { production: "partial" } }).success, false);
  assert.equal(ledgerSchema.safeParse({ ...base, company_id: i.company }).success, false);
});

test("NOV-013: drafts are scoped, versioned, expiring and never store financial fields", () => {
  const scope = { companyId: i.company, userId: i.production };
  const definition = draftDefinition("record_quality", ["production_job_id", "quantity_checked_kg", "notes", "unit_rate", "amount", "gst_percent", "surface_finish_ok"]);
  assert.deepEqual(definition.fields, ["production_job_id", "quantity_checked_kg", "notes", "surface_finish_ok"]);
  assert.equal(isSensitiveDraftField("final_line_value"), true); assert.equal(isSensitiveDraftField("quantity_checked_kg"), false);
  assert.deepEqual([...DRAFT_MODULES].sort(), ["machines", "packaging", "quality"]); assert.equal(isDraftModule("payments"), false); assert.equal(isDraftModule("production"), false);
  assert.notEqual(formDraftKey(definition, scope), formDraftKey(definition, { ...scope, userId: i.quality }));
  assert.throws(() => formDraftKey(definition, { companyId: "x", userId: i.production }));
  const values = { production_job_id: i.job1, quantity_checked_kg: "120.5", notes: "Bow checked", unit_rate: "210", surface_finish_ok: false, extra: "ignored", nested: { a: 1 } };
  assert.deepEqual(draftPayload(definition, values), { production_job_id: i.job1, quantity_checked_kg: "120.5", notes: "Bow checked", surface_finish_ok: false });
  const now = Date.UTC(2026, 10, 3, 6);
  const saved = nextFormDraft(definition, scope, values, null, nid(1), nid(2), now);
  const raw = JSON.stringify(saved);
  assert.equal(readFormDraft(definition, raw, scope, now).state, "available");
  assert.deepEqual(readFormDraft(definition, raw, { ...scope, userId: i.quality }, now), { state: "discarded", reason: "other_scope" });
  assert.deepEqual(readFormDraft(definition, raw, scope, now + FORM_DRAFT_LIFETIME_MS), { state: "discarded", reason: "expired" });
  assert.deepEqual(readFormDraft(definition, raw, scope, now - 120000), { state: "discarded", reason: "expired" }, "drafts from the future are rejected");
  assert.deepEqual(readFormDraft(draftDefinition("record_quality", definition.fields, 2), raw, scope, now), { state: "discarded", reason: "older_format" });
  assert.deepEqual(readFormDraft(definition, "{broken", scope, now), { state: "discarded", reason: "unreadable" });
  assert.deepEqual(readFormDraft(definition, null, scope, now), { state: "none" });
  const tampered = JSON.stringify({ ...saved, payload: { ...saved.payload, unit_rate: "999" } });
  const restored = readFormDraft(definition, tampered, scope, now);
  assert.equal(restored.state, "available"); assert.equal("unit_rate" in restored.draft.payload, false, "a stored sensitive field is not restored");
  const next = nextFormDraft(definition, scope, { ...values, notes: "Rechecked" }, saved, nid(3), nid(4), now + 1000);
  assert.equal(next.id, saved.id); assert.notEqual(next.revision, saved.revision);
  assert.equal(formDraftRevisionMatches(raw, saved.revision), true); assert.equal(formDraftRevisionMatches(JSON.stringify(next), saved.revision), false);
  assert.equal(formDraftRevisionMatches(null, null), true); assert.equal(formDraftRevisionMatches("{", saved.revision), false);
  assert.equal("notes" in nextFormDraft(definition, scope, { notes: "x".repeat(4001) }, null, nid(5), nid(6), now).payload, false, "oversized text stays on the page only");
});

test("real server action rejects denied roles, dealer sessions and malformed payload before the RPC", async () => {
  for (const role of ["viewer", "dealer_admin", "dealer_staff", "sales"]) { f.reset(); f.state.context.role = role; assert.equal((await f.action(preview())).success, false, role); assert.equal(f.state.calls.length, 0); }
  f.reset(); f.state.context.dealerId = nid(90); assert.equal((await f.action(preview())).success, false); assert.equal(f.state.calls.length, 0);
  f.reset(); f.state.authenticated = false; assert.equal((await f.action(preview())).success, false); assert.equal(f.state.calls.length, 0);
  f.reset(); assert.equal((await f.action({ ...preview(), company_id: i.company })).success, false); assert.equal(f.state.calls.length, 0);
  f.reset(); f.state.context.role = "sales"; assert.equal((await f.action({ command: "list", view: "custody" })).success, false); assert.equal(f.state.calls.length, 0);
  f.reset(); f.state.context.role = "dealer_admin"; assert.equal((await f.ledger({ order_id: i.order })).success, false); assert.equal(f.state.calls.length, 0);
});

test("real server action keeps confirmed outcomes, strips identity and treats lost responses as uncertain", async () => {
  f.state.response = nov4Outcome({ state: "confirmed", result: { label: "J-NOV4-3", href: "/tasks/control/wip/" + i.job3, message: "Observed location recorded." } }); f.state.revalidateThrows = true;
  const result = await f.action({ command: "commit", request_id: nid(1000), fingerprint: "a".repeat(32) });
  assert.equal(result.success, true); assert.equal(result.data.state, "confirmed");
  assert.equal(f.state.calls[0].name, "control_command"); assert.equal("company_id" in f.state.calls[0].payload.p_payload, false);
  for (const setup of [() => { f.state.throws = true; }, () => { f.state.malformed = true; }, () => { f.state.error = { code: "", message: "transport failure naming secret tables" }; }]) {
    f.reset(); setup(); const outcome = await f.action(preview()); assert.equal(outcome.success, false); assert.equal(outcome.uncertain, true); assert.doesNotMatch(outcome.error, /secret/);
  }
  f.reset(); f.state.error = { code: "P0001", message: "NOV: Only 4 kg is not yet accounted for at this vendor." }; const refused = await f.action(preview());
  assert.equal(refused.error, "Only 4 kg is not yet accounted for at this vendor."); assert.equal(refused.uncertain, undefined);
  f.reset(); f.state.error = { code: "P0001", message: "internal private detail" }; assert.doesNotMatch((await f.action(preview())).error, /private detail/);
  f.reset(); f.state.error = { code: "PGRST202", message: "missing" }; const missing = await f.action({ command: "list", view: "wip" }); assert.equal(missing.unavailable, true);
  f.reset(); f.state.error = { code: "42501", message: "tenant detail" }; assert.doesNotMatch((await f.action({ command: "outcome", request_id: nid(1000) })).error, /tenant/);
});

test("NOV-005: the order ledger action validates the server response and never fabricates balances", async () => {
  f.state.response = { order_id: i.order, as_of: new Date().toISOString(), status: "packed", line_count: 0, basis: "x", ordered_kg: null, departed_kg: 0, packed_kg: 10, delivered_kg: 0,
    sources: { production: "available" }, unlinked: { packing_rows: 0, packing_kg: 0, returns: 0, returned_kg: 0, jobs: 0, held_jobs: 0 }, lines: [] };
  const ok = await f.ledger({ order_id: i.order }); assert.equal(ok.success, true); assert.equal(ok.data.ordered_kg, null);
  f.reset(); f.state.response = { order_id: i.order, status: "packed" }; assert.equal((await f.ledger({ order_id: i.order })).success, false);
  f.reset(); assert.equal((await f.ledger({ order_id: "not-a-uuid" })).success, false); assert.equal(f.state.calls.length, 0);
  f.reset(); f.state.error = { code: "42883", message: "missing" }; assert.equal((await f.ledger({ order_id: i.order })).unavailable, true);
});
