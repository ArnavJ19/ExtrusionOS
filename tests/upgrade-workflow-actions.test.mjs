import test from "node:test";
import assert from "node:assert/strict";
import { createWorkflowActionsFixture, workflowId, workflowIds as ids } from "../scripts/lib/upgrade-workflow-actions-fixture.mjs";

const f = createWorkflowActionsFixture();
test.beforeEach(() => f.reset());

test("instant find is bounded, scoped and excludes financial or private response fields", async () => {
  f.state.context.role = "production";
  f.state.rows.orders_authorized.push({ ...f.state.rows.orders_authorized[0], id: workflowId(99), company_id: ids.otherCompany });
  const result = await f.instantFindAction("ORD-100");
  assert.equal(result.items.length, 1); assert.equal(result.items[0].id, ids.order);
  assert.equal(JSON.stringify(result).includes("999999"), false); assert.equal("order_value" in result.items[0], false);
  for (const call of f.state.calls) { assert.equal(call.limit, 6); assert.ok(call.filters.some(([, key, value]) => key === "company_id" && value === ids.company)); assert.doesNotMatch(call.columns, /\*|cost|margin|grand_total|order_value|notes/); }
});
test("quick actions point to an exact permitted source, with repricing restricted", async () => {
  const order = await f.instantFindAction("ORD-100"); assert.match(order.items[0].action.href, new RegExp(`order_id=${ids.order}`));
  const quote = await f.instantFindAction("QT-OLD"); assert.match(quote.items[0].action.href, new RegExp(`repeat_from=${ids.quote}`));
  f.state.context.role = "accounts"; const restricted = await f.instantFindAction("QT-OLD"); assert.equal(restricted.items[0].action, undefined);
});

test("instant find retains slash and hyphen separators used in business record numbers", async () => {
  f.state.rows.orders_authorized[0].order_number = "ORD/26-100";
  const result = await f.instantFindAction("ORD/26-100");
  assert.equal(result.query, "ORD/26-100"); assert.equal(result.items[0].id, ids.order);
});
test("unavailable search resources are separate from verified empty matches", async () => {
  f.state.errorTables.add("orders_authorized"); const result = await f.instantFindAction("ORD-100"); assert.ok(result.unavailable.includes("orders")); assert.deepEqual(result.items, []);
});
test("malformed, short and unauthenticated reads perform no business query", async () => {
  await f.instantFindAction("x"); await f.instantFindAction("x".repeat(81)); await f.repeatQuoteAction("broken"); await f.orderStageAgeAction(["broken"]);
  assert.equal(f.state.calls.length, 0); f.state.authenticated = false; assert.ok((await f.instantFindAction("ORD")).error); assert.equal(f.state.calls.length, 0);
});
test("repeat permissions are checked before any priced data is read", async () => {
  for (const role of ["sales", "sales_manager", "accounts", "production", "viewer", "dealer_admin"]) { f.state.context.role = role; assert.equal((await f.repeatQuoteAction(ids.quote)).success, false); }
  assert.equal(f.state.calls.length, 0);
});
test("repeat creates no record, strips identity and approvals, and refreshes profile and dates", async () => {
  const before = structuredClone(f.state.rows); const result = await f.repeatQuoteAction(ids.quote);
  assert.equal(result.success, true); assert.equal(result.draft.expired, true); assert.equal(result.draft.form.status, "draft"); assert.equal(result.draft.form.approval_notes, "");
  assert.notEqual(result.draft.form.valid_until, "2020-01-01"); assert.equal(result.draft.items[0].section_weight_kg_per_m, 0.8); assert.equal(result.draft.items[0].die_id, ""); assert.equal(result.draft.items[0].die_charge, 0);
  for (const key of ["id", "quote_id", "company_id", "created_by", "revision_number"]) assert.equal(key in result.draft.items[0], false);
  assert.equal("id" in result.draft.form, false); assert.deepEqual(f.state.rows, before);
});
test("repeat rejects other-company sources, inactive customers and unavailable profiles", async () => {
  f.state.rows.quotes_authorized[0].company_id = ids.otherCompany; assert.equal((await f.repeatQuoteAction(ids.quote)).success, false);
  await f.reset(); f.state.rows.customers[0].is_active = false; assert.equal((await f.repeatQuoteAction(ids.quote)).success, false);
  await f.reset(); f.state.rows.aluminium_profiles[0].is_active = false; assert.equal((await f.repeatQuoteAction(ids.quote)).success, false);
});
test("repeat rejects oversized and invalid legacy lines rather than making partial drafts", async () => {
  f.state.rows.quote_items_authorized = Array.from({ length: 101 }, (_, index) => ({ ...f.state.rows.quote_items_authorized[0], id: workflowId(1000 + index) })); assert.equal((await f.repeatQuoteAction(ids.quote)).success, false);
  await f.reset(); f.state.rows.quote_items_authorized[0].quantity_pieces = -1; assert.equal((await f.repeatQuoteAction(ids.quote)).success, false);
});
test("stage time uses the latest reopened interval and returns no history notes", async () => {
  const result = await f.orderStageAgeAction([ids.order]); assert.equal(result.rows[0].enteredAt, "2026-10-20T10:00:00Z"); assert.equal(JSON.stringify(result).includes("Private note"), false); assert.equal(result.rows[0].dueDate, "2026-10-25");
});
test("duplicate stage events do not restart an interval; initial events and truncated history differ", () => {
  const events = [{ stage: "packing", changed_at: "2026-10-21T00:00:00Z" }, { stage: "packing", changed_at: "2026-10-20T00:00:00Z" }, { stage: "production", changed_at: "2026-10-19T00:00:00Z" }];
  assert.equal(f.model.currentStageEntry("packing", events), events[1].changed_at); assert.equal(f.model.currentStageEntry("packing", events.slice(0, 2), true), null); assert.equal(f.model.currentStageEntry("packing", events.slice(0, 1)), events[0].changed_at); assert.equal(f.model.currentStageEntry("production", events), null);
});
test("stage reads are bounded and missing or failed evidence stays explicitly unavailable", async () => {
  f.state.rows.order_stage_history = []; let result = await f.orderStageAgeAction([ids.order]); assert.equal(result.rows[0].enteredAt, null);
  f.state.errorTables.add("order_stage_history"); result = await f.orderStageAgeAction([ids.order]); assert.match(result.rows[0].reason, /unavailable/);
  const call = f.state.calls.find((call) => call.table === "order_stage_history"); assert.equal(call.limit, 50); assert.equal(call.columns, "stage, changed_at");
  assert.ok((await f.orderStageAgeAction(Array(11).fill(ids.order))).error);
});
test("stage elapsed formatting separates missing, future, invalid and zero elapsed", () => {
  const now = Date.parse("2026-10-21T12:00:00Z"); assert.equal(f.model.elapsedStageTime(null, now), "Stage entry not recorded"); assert.equal(f.model.elapsedStageTime("bad", now), "Stage time requires review"); assert.equal(f.model.elapsedStageTime("2026-10-22T00:00:00Z", now), "Stage time requires review"); assert.equal(f.model.elapsedStageTime("2026-10-21T12:00:00Z", now), "0 min"); assert.equal(f.model.elapsedStageTime("2026-10-19T10:30:00Z", now), "2 d 1 h");
});
test("ambiguous simultaneous stage changes and external callers do not receive a fabricated interval", async () => {
  assert.equal(f.model.currentStageEntry("packing", [{ stage: "packing", changed_at: "2026-10-21T00:00:00Z" }, { stage: "production", changed_at: "2026-10-21T00:00:00Z" }]), null);
  const latest = { stage: "packing", changed_at: "2026-10-22T00:00:00Z" };
  const tied = [{ stage: "packing", changed_at: "2026-10-21T00:00:00Z" }, { stage: "production", changed_at: "2026-10-21T00:00:00Z" }];
  assert.equal(f.model.currentStageEntry("packing", [latest, ...tied]), null);
  assert.equal(f.model.currentStageEntry("packing", [latest, ...tied.reverse()]), null);
  f.state.context.role = "dealer_admin"; assert.ok((await f.orderStageAgeAction([ids.order])).error); assert.equal(f.state.calls.length, 0);
});
test("dispatch preview reconciles grouped sources and rejects stale or invalid quantities", () => {
  const sources = [{ id: ids.source, sourceKind: "production", sourceLabel: "JOB-1", profileId: ids.profile, profileLabel: "AL-101", stockBatchId: null, stockBatchLabel: null, availableWeightKg: 100, availablePieces: 10, availableLengthM: 60 }];
  const bundle = { bundle_number: "B-1", source_line_id: ids.source, number_of_pieces: "2", net_length_m: "12", gross_weight_kg: "21", tare_weight_kg: "1" };
  const result = f.review.buildDispatchReview(sources, ids.company, ids.order, [bundle, { ...bundle, bundle_number: "B-2" }]);
  assert.deepEqual(result.totals, { pieces: 4, metres: 24, gross: 42, tare: 2, net: 40 }); assert.equal(result.balances[0].kg, 60); assert.equal(result.balances[0].pieces, 6); assert.equal(result.balances[0].metres, 36);
  assert.throws(() => f.review.buildDispatchReview([{ ...sources[0], availableWeightKg: 19 }], ids.company, ids.order, [bundle])); assert.throws(() => f.review.buildDispatchReview(sources, ids.company, ids.order, [{ ...bundle, tare_weight_kg: "22" }]));
});

test("dispatch order balance uses ordered physical quantities and complete packing history", async () => {
  const result = await f.dispatchOrderBalanceAction(ids.order);
  assert.equal(result.success, true);
  assert.deepEqual(result.balance.ordered, { pieces: 100, metres: 600 });
  assert.deepEqual(result.balance.shipped, { pieces: 10, metres: 60 });
  assert.deepEqual(f.review.projectOrderRemainder(result.balance, { pieces: 20, metres: 120 }), { pieces: 70, metres: 420 });
  assert.equal(JSON.stringify(result).includes("999999"), false);
  for (const call of f.state.calls) assert.ok(call.filters.some(([, key, value]) => key === "company_id" && value === ids.company));
});

test("dispatch order balance rejects unauthorized, foreign, closed and malformed sources", async () => {
  f.state.context.role = "viewer"; assert.equal((await f.dispatchOrderBalanceAction(ids.order)).success, false); assert.equal(f.state.calls.length, 0);
  await f.reset(); f.state.rows.orders_authorized[0].company_id = ids.otherCompany; assert.equal((await f.dispatchOrderBalanceAction(ids.order)).success, false);
  await f.reset(); f.state.rows.orders_authorized[0].current_stage = "delivered"; assert.equal((await f.dispatchOrderBalanceAction(ids.order)).success, false);
  await f.reset(); f.state.rows.order_items_authorized[0].quantity_pieces = null; assert.equal((await f.dispatchOrderBalanceAction(ids.order)).success, false);
  await f.reset(); f.state.errorTables.add("packing_list_items"); assert.equal((await f.dispatchOrderBalanceAction(ids.order)).success, false);
});

test("order quantity reads paginate past one response and never hide an overdispatch", async () => {
  const row = f.state.rows.order_items_authorized[0];
  f.state.rows.order_items_authorized = Array.from({ length: 205 }, (_, index) => ({ ...row, id: workflowId(1000 + index), quantity_pieces: 1, total_meters: "0.1" }));
  const result = await f.dispatchOrderBalanceAction(ids.order);
  assert.equal(result.success, true); assert.deepEqual(result.balance.ordered, { pieces: 205, metres: 20.5 });
  assert.deepEqual(f.state.calls.filter((call) => call.table === "order_items_authorized").map((call) => call.range), [[0, 199], [200, 399]]);
  assert.deepEqual(f.review.projectOrderRemainder(result.balance, { pieces: 200, metres: 0.1 }), { pieces: -5, metres: -39.6 });
});
