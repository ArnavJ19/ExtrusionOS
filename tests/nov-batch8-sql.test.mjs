import test from "node:test";
import assert from "node:assert/strict";
import { createNov8Fixture, nids as i, day } from "../scripts/lib/nov-batch8-fixture.mjs";
import { migrationFiles } from "../scripts/lib/migration-chain-replay.mjs";
import { executionListSchema, executionOutcomeSchema, executionLookupSchema, executionMutationSchema, orderProgressSchema, canReadExecution, canUseExecutionAction,
  EXECUTION_ROLES, EXECUTION_VIEWS } from "../lib/workflow/execution.ts";

let f;
test.before(async () => { f = await createNov8Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { executionOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const rejected = (result, message) => { executionOutcomeSchema.parse(result); assert.equal(result.state, "rejected", JSON.stringify(result.result)); if (message) assert.match(result.result.message, message); return result; };
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const detail = (view, id, actor = i.owner) => f.command("detail", { view, id }, actor);
const row = async (view, id, actor = i.owner) => (await detail(view, id, actor)).row;
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
const ist = (offsetHours, base = Date.now()) => { const d = new Date(base + offsetHours * 3600000); return d.toISOString().slice(0, 19) + "Z"; };
const lookup = (kind, patch = {}, actor = i.owner) => f.command("lookup", { kind, ...patch }, actor);
const idOf = result => result.result.href.split("/").pop();

async function requestAppointment(patch = {}, actor = i.dispatchManager) {
  return idOf(confirmed(await f.apply({ action: "appointment.request", order_id: i.order, requested_start: ist(30), requested_end: ist(34), owner_id: i.dispatch, note, ...patch }, actor)));
}

test("the TypeScript role mirrors match the database matrix for every role, view and action", async () => {
  const roles = [...EXECUTION_ROLES, "dealer_admin", "dealer_staff", "unknown"];
  const actions = executionMutationSchema._def.schema.options.map(option => option.shape.action.value);
  assert.equal(actions.length, 39);
  for (const role of roles) {
    assert.equal((await one("select private.execution_read_allowed($1,null) v", [role])).v, canReadExecution(role), `${role} read`);
    for (const view of Object.keys(EXECUTION_VIEWS)) assert.equal((await one("select private.execution_read_allowed($1,$2) v", [role, view])).v, canReadExecution(role, view), `${role} read ${view}`);
    for (const action of actions) assert.equal((await one("select private.execution_action_allowed($1,$2) v", [role, action])).v, canUseExecutionAction(role, action), `${role} ${action}`);
  }
});

test("migration replay, every read model and the shared protocol match the production contracts", async () => {
  assert.equal(f.applied, migrationFiles().length + 2);
  for (const view of Object.keys(EXECUTION_VIEWS)) {
    executionListSchema.parse(await list(view));
    executionListSchema.parse(await f.command("list", { view }, i.owner));
  }
  await assert.rejects(() => list("appointments", i.dealer), /Not permitted/);
  await assert.rejects(() => list("queue", i.production), /Not permitted/);
  await assert.rejects(() => list("messages", i.production), /Not permitted/);
  await assert.rejects(() => list("nonsense"), /Not permitted/);
  await assert.rejects(() => f.command("list", { view: "queue", company_id: i.foreignCompany }), /Invalid execution request/);
  await assert.rejects(() => f.command("lookup", { kind: "employees", search: "x".repeat(81) }), /80 characters/);
  const body = { action: "gatepass.issue", item_kind: "gauge", item_label: "Bore gauge set", quantity: 2, custodian_name: "Calibration Lab", custodian_kind: "vendor", purpose: "Annual calibration", due_date: day(10), owner_id: i.inventory, note };
  const preview = await f.prepare(body, i.inventory);
  assert.equal(preview.state, "prepared");
  assert.equal(n((await one("select count(*) c from returnable_gate_passes")).c), 0, "a review records nothing");
  assert.equal((await f.command("outcome", { request_id: f.nextId() })).state, "not_recorded");
  assert.equal((await f.command("abandon", { request_id: preview.request_id }, i.inventory)).state, "abandoned");
  await assert.rejects(() => f.commit(preview, i.owner), /Not permitted/);
  await assert.rejects(() => f.prepare({ ...body, company_id: i.foreignCompany }), /Review the required action details/);
  await assert.rejects(() => f.prepare({ ...body, purpose: null }), /Review the required action details/);
  await assert.rejects(() => f.prepare(body, i.dealer), /Not permitted/);
  await assert.rejects(() => f.prepare(body, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare({ ...body, owner_id: i.foreign }), /active employee of this company/);
  const request = f.nextId();
  const first = await f.prepare(body, i.inventory, request);
  assert.equal((await f.prepare(body, i.inventory, request)).fingerprint, first.fingerprint);
  await assert.rejects(() => f.prepare({ ...body, quantity: 3 }, i.inventory, request), /different details/);
  const done = confirmed(await f.commit(first, i.inventory));
  assert.deepEqual(await f.commit(first, i.inventory), done, "a lost response is recovered without a second write");
  assert.equal(n((await one("select count(*) c from returnable_gate_passes")).c), 1);
  const late = await f.prepare({ ...body, item_label: "Second gauge set" }, i.inventory);
  await f.db.query("update execution_requests set expires_at=now()-interval '1 minute' where request_id=$1", [late.request_id]);
  rejected(await f.commit(late, i.inventory), /expired/);
});

// NOV-075 ---------------------------------------------------------------------------------------
test("NOV-075: a requested slot, a confirmation and an arrival are separate facts with every revision kept", async () => {
  const id = await requestAppointment({ dispatch_id: i.dispatchPending, contact_name: "Site store keeper", contact_phone: "98200 11122", access_restrictions: "Gate 2 only; no entry after 6 pm", preparations: "Forklift for 3 bundles" });
  let record = await row("appointments", id, i.dispatchManager);
  executionListSchema.shape.rows.element.parse(record);
  assert.equal(record.status, "requested");
  assert.equal(record.details.contact_phone, "+919820011122");
  assert.equal(record.details.differs_from_customer, false);
  assert.equal(record.details.revision, 1);
  // Phone numbers are masked for roles outside dispatch and sales.
  assert.match((await row("appointments", id, i.inventory)).details.contact_phone, /^XXXXXX1122$/);
  assert.equal((await row("appointments", id, i.inventory)).details.contact_masked, true);
  confirmed(await f.apply({ action: "appointment.confirm", id, confirmed_start: ist(31), confirmed_end: ist(33), confirmed_by_name: "Mr Patil (stores)", note }, i.dispatchManager));
  record = await row("appointments", id);
  assert.equal(record.status, "confirmed");
  assert.equal(record.details.revision, 2);
  assert.equal(record.details.confirmed_by_name, "Mr Patil (stores)");
  assert.ok(record.details.requested_start, "the requested slot is still recorded");
  confirmed(await f.apply({ action: "appointment.reschedule", id, requested_start: ist(55), requested_end: ist(59), site_address: "Gate 7, New Yard, Bhosari, Pune", note: "Site moved the delivery to the new yard" }, i.dispatchManager));
  record = await row("appointments", id);
  assert.equal(record.status, "changed");
  assert.equal(record.details.changed_after_confirmation, true);
  assert.equal(record.details.site_revision, 2);
  assert.equal(record.details.differs_from_customer, true);
  assert.equal(record.details.confirmed_start, null);
  assert.equal(record.details.revisions.length, 3);
  assert.ok(record.details.revisions.some(item => item.status === "confirmed"), "the earlier confirmation is retained, not rewritten");
  assert.equal(n((await one("select count(*) c from notifications where related_entity_id=$1", [id])).c) >= 1, true, "the follow-up owner is told of the change");
  confirmed(await f.apply({ action: "appointment.confirm", id, confirmed_start: ist(56), confirmed_end: ist(58), confirmed_by_name: "Mr Patil (stores)", note }, i.dispatchManager));
  confirmed(await f.apply({ action: "appointment.cancel", id, note: "Order is being split" }, i.dispatchManager));
  assert.equal((await row("appointments", id)).status, "cancelled");
});

test("NOV-075: edge cases - overnight slot, bad windows, wrong order, duplicate and out-of-state actions", async () => {
  const bad = patch => f.prepare({ action: "appointment.request", order_id: i.order, requested_start: ist(30), requested_end: ist(34), owner_id: i.dispatch, note, ...patch }, i.dispatchManager);
  confirmed(await f.apply({ action: "appointment.request", order_id: i.order, requested_start: "2099-01-01T20:00:00+05:30", requested_end: "2099-01-02T06:00:00+05:30", owner_id: i.dispatch, note }, i.dispatchManager));
  await assert.rejects(() => bad({ requested_end: ist(20) }), /end must be after the start/);
  await assert.rejects(() => bad({ requested_end: ist(90) }), /within 48 hours/);
  await assert.rejects(() => bad({ requested_start: ist(-5), requested_end: ist(-3) }), /already passed/);
  await assert.rejects(() => bad({ order_id: i.foreignOrder }), /order is unavailable/);
  await assert.rejects(() => bad({ order_id: i.orderPay }), /payment pending/);
  await assert.rejects(() => bad({ dispatch_id: i.dispatch4 }), /does not belong to this order/);
  await assert.rejects(() => bad({ contact_phone: "12345" }), /valid 10-digit/);
  await assert.rejects(() => bad({ owner_id: i.dealer }), /active employee/);
  await assert.rejects(() => bad({ owner_id: i.viewer }), /active employee/);
  const id = await requestAppointment({ dispatch_id: i.dispatchPending });
  await assert.rejects(() => f.prepare({ action: "appointment.request", order_id: i.order, dispatch_id: i.dispatchPending, requested_start: ist(40), requested_end: ist(44), owner_id: i.dispatch, note }, i.dispatchManager), /already has an open appointment/);
  await assert.rejects(() => f.prepare({ action: "appointment.arrive", id, note }, i.dispatchManager), /Only a confirmed appointment/);
  await assert.rejects(() => f.prepare({ action: "appointment.outcome", id, result: "completed", note }, i.dispatchManager), /arrival before/);
  await assert.rejects(() => f.prepare({ action: "appointment.outcome", id, result: "missed", note }, i.dispatchManager), /slot has passed/);
  await assert.rejects(() => f.prepare({ action: "appointment.confirm", id: f.nextId(), confirmed_start: ist(31), confirmed_end: ist(33), confirmed_by_name: "Patil", note }, i.dispatchManager), /appointment is unavailable/);
  await assert.rejects(() => f.prepare({ action: "appointment.confirm", id, confirmed_start: ist(31), confirmed_end: ist(33), confirmed_by_name: "Patil", note }, i.production), /Not permitted/);
  confirmed(await f.apply({ action: "appointment.confirm", id, confirmed_start: ist(31), confirmed_end: ist(33), confirmed_by_name: "Patil", note }, i.dispatchManager));
  await assert.rejects(() => f.prepare({ action: "appointment.confirm", id, confirmed_start: ist(31), confirmed_end: ist(33), confirmed_by_name: "Patil", note }, i.dispatchManager), /Only a requested appointment/);
  // An arrival, then the outcome. A dispatch stays pending: confirmation never releases it.
  confirmed(await f.apply({ action: "appointment.arrive", id, note: "Vehicle at the gate" }, i.dispatchManager));
  const outcome = await f.prepare({ action: "appointment.outcome", id, result: "unloading_failed", note: "No forklift at the site" }, i.dispatchManager);
  confirmed(await f.commit(outcome, i.dispatchManager));
  assert.equal((await row("appointments", id)).status, "unloading_failed");
  assert.equal((await one("select delivery_status s from dispatches where id=$1", [i.dispatchPending])).s, "pending");
  // A confirmed slot that passed becomes "outcome due" and can be recorded as missed.
  const old = await requestAppointment({ order_id: i.order2, requested_start: ist(2), requested_end: ist(4) });
  confirmed(await f.apply({ action: "appointment.confirm", id: old, confirmed_start: ist(2), confirmed_end: ist(4), confirmed_by_name: "Patil", note }, i.dispatchManager));
  await f.db.query("update delivery_appointments set confirmed_start=now()-interval '5 hours',confirmed_end=now()-interval '3 hours' where id=$1", [old]);
  assert.equal((await row("appointments", old)).status, "outcome_due");
  confirmed(await f.apply({ action: "appointment.outcome", id: old, result: "missed", note: "Nobody was at the site" }, i.dispatchManager));
  assert.equal((await row("appointments", old)).status, "missed");
  // Another company's appointment is invisible.
  await assert.rejects(() => detail("appointments", old, i.foreign), /unavailable/);
});

// NOV-077 ---------------------------------------------------------------------------------------
async function issuePass(patch = {}, actor = i.inventory) {
  return idOf(confirmed(await f.apply({ action: "gatepass.issue", item_kind: "pallet", item_label: "Aluminium pallets", quantity: 10, custodian_name: "Shree Finishers", custodian_kind: "vendor", purpose: "Carrying anodised bundles",
    due_date: day(5), owner_id: i.inventory, note, ...patch }, actor)));
}

test("NOV-077: a quantity-based pass keeps a balance through partial returns, damage, loss, extension and closure", async () => {
  const id = await issuePass();
  let record = await row("gate_passes", id);
  assert.equal(record.status, "approved");
  assert.match(record.details.pass_number, /^RGP-\d{4}$/);
  await assert.rejects(() => f.prepare({ action: "gatepass.return", id, quantity: 1, condition: "good", note }, i.inventory), /Only an item that is out/);
  confirmed(await f.apply({ action: "gatepass.depart", id, note: "Left at 10:15 with LR-12" }, i.inventory));
  confirmed(await f.apply({ action: "gatepass.acknowledge", id, acknowledged_by_name: "Suresh, Shree Finishers", note }, i.inventory));
  await assert.rejects(() => f.prepare({ action: "gatepass.acknowledge", id, acknowledged_by_name: "Someone else", note }, i.inventory), /already acknowledged/);
  confirmed(await f.apply({ action: "gatepass.return", id, quantity: 4, condition: "good", note: "Counted at the gate" }, i.quality));
  record = await row("gate_passes", id);
  assert.equal(record.status, "partially_returned");
  assert.equal(record.details.balance, 6);
  await assert.rejects(() => f.prepare({ action: "gatepass.return", id, quantity: 7, condition: "good", note }, i.inventory), /Only 6 item\(s\) are outstanding/);
  confirmed(await f.apply({ action: "gatepass.return", id, quantity: 2, condition: "damaged", note: "Two pallets broken" }, i.inventory));
  await f.db.query("update returnable_gate_passes set due_date=current_date-2 where id=$1", [id]);
  assert.equal((await row("gate_passes", id)).status, "partially_returned_overdue");
  const extend = await f.prepare({ action: "gatepass.extend", id, due_date: day(8), note: "Vendor needs three more days" }, i.inventory);
  assert.ok(extend.review.warnings.some(w => /overdue/.test(w)));
  confirmed(await f.commit(extend, i.inventory));
  assert.equal((await row("gate_passes", id)).details.extension_count, 1);
  assert.equal((await row("gate_passes", id)).details.original_due_date, day(5));
  await assert.rejects(() => f.prepare({ action: "gatepass.extend", id, due_date: day(7), note }, i.inventory), /after the current expected return/);
  await f.db.query("update returnable_gate_passes set extension_count=3 where id=$1", [id]);
  await assert.rejects(() => f.prepare({ action: "gatepass.extend", id, due_date: day(12), note }, i.inventory), /extended three times/);
  const lost = await f.prepare({ action: "gatepass.lose", id, quantity: 4, note: "Custodian reports a theft at the yard" }, i.inventory);
  assert.ok(lost.review.warnings.some(w => /permanent/.test(w)));
  confirmed(await f.commit(lost, i.inventory));
  record = await row("gate_passes", id);
  assert.equal(record.status, "closed", "returned and lost quantities account for everything");
  assert.equal(record.details.balance, 0);
  assert.equal(record.details.damaged_quantity, 2);
  assert.equal(record.details.returns.length, 2);
  await assert.rejects(() => f.prepare({ action: "gatepass.return", id, quantity: 1, condition: "good", note }, i.inventory), /Only an item that is out/);
});

test("NOV-077: a die or serialised asset has one open pass, planning sees the custody and roles are enforced", async () => {
  const body = { action: "gatepass.issue", item_kind: "die", die_id: i.dieC, item_label: "DIE-NOV8-C", quantity: 1, custodian_name: "Nitriding House", custodian_kind: "vendor", purpose: "Nitriding cycle 2", due_date: day(4), owner_id: i.productionManager, note };
  const preview = await f.prepare(body, i.productionManager);
  assert.ok(preview.review.warnings.some(w => /planned or running job/.test(w)), "the job that needs the die before its return is flagged");
  const id = idOf(confirmed(await f.commit(preview, i.productionManager)));
  await assert.rejects(() => f.prepare(body, i.productionManager), /already has an open gate pass/);
  const lookupRows = executionLookupSchema.parse(await lookup("dies", { search: "NOV8-C" }, i.productionManager));
  assert.match(lookupRows[0].context, /on pass RGP-/);
  assert.equal((await row("gate_passes", id)).source_href, `/dies/${i.dieC}`);
  const withoutDie = { ...body };
  delete withoutDie.die_id;
  await assert.rejects(() => f.prepare(withoutDie, i.productionManager), /Choose the die/);
  await assert.rejects(() => f.prepare({ ...body, quantity: 2, die_id: i.dieB }, i.productionManager), /one serialised item/);
  await assert.rejects(() => f.prepare({ ...body, die_id: f.nextId() }, i.productionManager), /unavailable/);
  await assert.rejects(() => f.prepare({ ...body, die_id: i.dieB, item_kind: "gauge" }, i.productionManager), /Only a die pass/);
  await assert.rejects(() => f.prepare({ ...withoutDie, item_kind: "gauge", serial_ref: "G-1", quantity: 2 }, i.productionManager), /quantity 1/);
  await assert.rejects(() => f.prepare({ ...body, due_date: day(-1), die_id: i.dieB }, i.productionManager), /cannot be in the past/);
  await assert.rejects(() => f.prepare({ ...body, due_date: day(400), die_id: i.dieB }, i.productionManager), /within a year/);
  const blocked = await f.prepare({ ...body, die_id: i.dieB, item_label: "DIE-NOV7-B" }, i.productionManager);
  assert.ok(blocked.review.warnings.some(w => /currently blocked/.test(w)));
  // Serial assets.
  const serial = await issuePass({ item_kind: "gauge", item_label: "Go/no-go gauge", serial_ref: "GNG-0042", quantity: 1 });
  await assert.rejects(() => f.prepare({ action: "gatepass.issue", item_kind: "gauge", item_label: "Go/no-go gauge", serial_ref: "gng-0042", quantity: 1, custodian_name: "Calibration Lab", custodian_kind: "vendor", purpose: "Calibration", due_date: day(3), owner_id: i.inventory, note }, i.inventory), /already has an open gate pass/);
  // Only an approved pass that has not left can be cancelled; that frees the asset.
  confirmed(await f.apply({ action: "gatepass.cancel", id: serial, note: "Calibration booked for next month" }, i.inventory));
  await issuePass({ item_kind: "gauge", item_label: "Go/no-go gauge", serial_ref: "GNG-0042", quantity: 1 });
  confirmed(await f.apply({ action: "gatepass.depart", id, note }, i.productionManager));
  await assert.rejects(() => f.prepare({ action: "gatepass.cancel", id, note }, i.productionManager), /not left can be cancelled/);
  // Roles: production floor staff and viewers cannot issue; quality may record returns only.
  await assert.rejects(() => f.prepare({ ...body, die_id: i.dieB }, i.production), /Not permitted/);
  await assert.rejects(() => f.prepare({ ...body, die_id: i.dieB }, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "gatepass.depart", id, note }, i.quality), /Not permitted/);
  confirmed(await f.apply({ action: "gatepass.return", id, quantity: 1, condition: "good", note: "Back from nitriding" }, i.quality));
  assert.equal((await row("gate_passes", id)).status, "closed");
  confirmed(await f.apply({ ...body, due_date: day(6) }, i.productionManager));
  // Another company sees nothing.
  await assert.rejects(() => detail("gate_passes", id, i.foreign), /unavailable|Not permitted/);
});

// NOV-036 ---------------------------------------------------------------------------------------
const stop = (load, order, seq, actor = i.dispatchManager, extra = {}) => f.apply({ action: "loadplan.stop", load_id: load, order_id: order, stop_seq: seq, note, ...extra }, actor);
const loadItem = (item, status, method = "scan", actor = i.dispatch, text = note) => f.apply({ action: "loadplan.confirm", item_id: item, status, method, note: text }, actor);

test("NOV-036: a multi-order load is planned by stop, confirmed bundle by bundle and reviewed before departure", async () => {
  let record = await row("loads", i.load1);
  assert.equal(record.status, "planning");
  assert.equal(record.details.items_total, 3);
  assert.equal(record.details.order_count, 2);
  assert.equal(record.details.planned_kg, 650);
  assert.equal(record.details.orders_without_stop, 2);
  const early = confirmed(await f.apply({ action: "loadplan.review", load_id: i.load1, note }, i.dispatch));
  assert.match(early.result.label, /not ready/i);
  record = await row("loads", i.load1);
  assert.equal(record.status, "not_ready");
  assert.ok(record.details.review.findings.blockers.some(b => /no unloading stop/.test(b)));
  assert.ok(record.details.review.findings.blockers.some(b => /not yet confirmed/.test(b)));
  confirmed(await stop(i.load1, i.order, 2));
  confirmed(await stop(i.load1, i.order2, 1, i.dispatchManager, { unload_note: "Narrow lane; unload by hand" }));
  assert.equal((await row("loads", i.load1)).status, "loading", "a changed plan makes the earlier review not current");
  confirmed(await stop(i.load1, i.order2, 3));
  record = await row("loads", i.load1);
  assert.deepEqual(record.details.orders.map(o => [o.order_number, o.stop_seq]), [["SO-NOV5-01", 2], ["SO-NOV5-02", 3]]);
  await assert.rejects(() => stop(i.load1, i.orderGap, 1), /no bundle on this load/);
  await assert.rejects(() => stop(i.load1, i.order, 21), /between 1 and 20/);
  confirmed(await loadItem(i.item1, "loaded"));
  await assert.rejects(() => f.prepare({ action: "loadplan.confirm", item_id: i.item1, status: "loaded", method: "scan", note }, i.dispatch), /already recorded as loaded/);
  confirmed(await loadItem(i.item2, "loaded", "manual", i.dispatch, "Label damaged; checked against the list"));
  confirmed(await loadItem(i.item3, "not_loaded", "manual", i.inventory, "Bundle is still being wrapped"));
  record = await row("loads", i.load1);
  assert.equal(record.details.items_confirmed, 2);
  assert.equal(record.details.loaded_kg, 500);
  assert.equal(record.details.items.find(item => item.item_id === i.item3).confirmation, "not_loaded");
  const ready = confirmed(await f.apply({ action: "loadplan.review", load_id: i.load1, note }, i.dispatchManager));
  assert.match(ready.result.label, /Load ready/);
  record = await row("loads", i.load1);
  assert.equal(record.status, "ready");
  assert.ok(record.details.review.findings.warnings.some(w => /removed from this load/.test(w)));
  // Loading order puts the last stop first.
  assert.equal(record.details.items[0].order_number, "SO-NOV5-02");
  // An unloading exception only follows a loaded bundle.
  await assert.rejects(() => f.prepare({ action: "loadplan.confirm", item_id: i.item3, status: "unloaded_exception", method: "manual", note }, i.dispatch), /Only a loaded bundle/);
  confirmed(await loadItem(i.item1, "unloaded_exception", "manual", i.dispatch, "Two pieces bent at the site"));
  assert.equal((await row("loads", i.load1)).status, "loading");
  const again = confirmed(await f.apply({ action: "loadplan.review", load_id: i.load1, note }, i.dispatchManager));
  assert.match(again.result.label, /Load ready/);
  assert.ok((await row("loads", i.load1)).details.review.findings.warnings.some(w => /unloading exception/.test(w)));
});

test("NOV-036: capacity, held material, unconfirmed appointments, closed loads, roles and tenants are enforced", async () => {
  let record = await row("loads", i.load2);
  assert.equal(record.details.over_capacity, true);
  confirmed(await stop(i.load2, i.order, 1));
  confirmed(await stop(i.load2, i.order2, 2));
  confirmed(await loadItem(i.itemC1, "loaded"));
  await assert.rejects(() => f.prepare({ action: "loadplan.confirm", item_id: i.itemC2, status: "loaded", method: "scan", note }, i.dispatch), /on hold/);
  confirmed(await loadItem(i.itemC2, "not_loaded", "manual", i.dispatch, "Job on hold; bundle stays in the yard"));
  await f.db.query("delete from load_item_confirmations where item_id=$1", [i.itemC2]);
  await requestAppointment({ order_id: i.order2 });
  const review = await f.prepare({ action: "loadplan.review", load_id: i.load2, note }, i.dispatch);
  assert.ok(review.review.warnings.some(w => /Blocker: .*on hold/.test(w)), JSON.stringify(review.review.warnings));
  assert.ok(review.review.warnings.some(w => /appointment the site has not confirmed/.test(w)));
  assert.ok(review.review.warnings.some(w => /above the vehicle capacity/.test(w)));
  confirmed(await f.commit(review, i.dispatch));
  assert.equal((await row("loads", i.load2)).status, "not_ready");
  const stale = await f.prepare({ action: "loadplan.review", load_id: i.load2, note }, i.dispatch);
  confirmed(await loadItem(i.itemC2, "not_loaded", "manual", i.dispatch, "Job on hold; bundle stays in the yard"));
  rejected(await f.commit(stale, i.dispatch), /source changed/);
  await assert.rejects(() => f.prepare({ action: "loadplan.review", load_id: i.loadClosed, note }, i.dispatch), /Only a reviewed load/);
  await assert.rejects(() => f.prepare({ action: "loadplan.review", load_id: f.nextId(), note }, i.dispatch), /unavailable/);
  await assert.rejects(() => f.prepare({ action: "loadplan.review", load_id: i.load2, note }, i.production), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "loadplan.review", load_id: i.load2, note }, i.foreign), /unavailable|Not permitted/);
  await assert.rejects(() => detail("loads", i.load2, i.foreign), /unavailable|Not permitted/);
  await assert.rejects(() => f.prepare({ action: "loadplan.confirm", item_id: i.itemC1, status: "loaded", method: "scan", note }, i.foreign), /not on a load in this company|Not permitted/);
  await assert.rejects(() => f.prepare({ action: "loadplan.confirm", item_id: i.itemC1, status: "sold", method: "scan", note }, i.dispatch), /Choose loaded/);
});

// NOV-044 ---------------------------------------------------------------------------------------
const setWindow = (patch = {}, actor = i.productionManager) => f.apply({ action: "window.set", horizon_hours: 48, enforce: false, note: "Protect the next two days of press work", ...patch }, actor);
const requestChange = (job, patch = {}, actor = i.productionManager) => f.apply({ action: "window.request", job_id: job, new_date: day(4), customer_effect: "Delivery moves by three days; customer told", note: "Die was not ready for the planned date", ...patch }, actor);

test("NOV-044: a change inside the protected window needs a second approver, the unchanged job and a recorded before and after", async () => {
  await assert.rejects(() => f.prepare({ action: "window.request", job_id: i.jobWin1, new_date: day(4), customer_effect: "Delivery moves; customer told", note }, i.productionManager), /outside the protected window/);
  const window = idOf(confirmed(await setWindow()));
  assert.equal((await row("windows", window)).details.jobs_in_window >= 1, true);
  await assert.rejects(() => f.prepare({ action: "window.request", job_id: i.jobWin2, new_date: day(14), customer_effect: "Delivery moves; customer told", note }, i.productionManager), /outside the protected window/);
  await assert.rejects(() => f.prepare({ action: "window.request", job_id: i.jobWin3, new_date: day(4), customer_effect: "Delivery moves; customer told", note }, i.productionManager), /not rescheduled through the window/);
  await assert.rejects(() => f.prepare({ action: "window.request", job_id: i.jobWin1, new_date: day(-1), customer_effect: "Delivery moves; customer told", note }, i.productionManager), /cannot be in the past/);
  await assert.rejects(() => f.prepare({ action: "window.request", job_id: i.jobWin1, new_date: day(1), new_shift: "Day", customer_effect: "Delivery moves; customer told", note }, i.productionManager), /match the current plan/);
  await assert.rejects(() => f.prepare({ action: "window.request", job_id: i.jobWin1, new_date: day(4), customer_effect: "Delivery moves; customer told", note }, i.production), /Not permitted/);
  const preview = await f.prepare({ action: "window.request", job_id: i.jobWin4, new_date: day(1), new_shift: "Day", customer_effect: "None; same day", note: "Move to the day shift" }, i.productionManager);
  assert.ok(preview.review.warnings.some(w => /other job\(s\) already hold that machine, date and shift/.test(w)), "displaced slot work is shown");
  assert.ok(preview.review.warnings.some(w => /not modelled/.test(w)), "unmodelled effects are stated rather than implied");
  const id = idOf(confirmed(await requestChange(i.jobWin1)));
  await assert.rejects(() => requestChange(i.jobWin1), /already awaiting approval/);
  let record = await row("windows", id);
  assert.equal(record.status, "requested");
  assert.equal(record.details.impact.moves_after_expected_dispatch, false);
  await assert.rejects(() => f.prepare({ action: "window.approve", id, note }, i.productionManager), /second person/);
  await assert.rejects(() => f.prepare({ action: "window.approve", id, note }, i.production), /Not permitted/);
  confirmed(await f.apply({ action: "window.approve", id, note: "Approved with the dispatch lead" }, i.factory));
  const job = await one("select planned_date::text d,shift from production_jobs where id=$1", [i.jobWin1]);
  assert.equal(job.d, day(4));
  record = await row("windows", id);
  assert.equal(record.status, "applied");
  assert.equal(record.details.previous_date, day(1));
  assert.equal(record.details.new_date, day(4));
  assert.equal(n((await one("select count(*) c from notifications where related_entity_id=$1 and notification_type='execution_update'", [i.jobWin1])).c) >= 1, true);
  await assert.rejects(() => f.prepare({ action: "window.approve", id, note }, i.factory), /already applied/);
});

test("NOV-044: a job that changed after the request, a cancelled approval and a rejected request leave the plan alone", async () => {
  confirmed(await setWindow());
  const stale = idOf(confirmed(await requestChange(i.jobWin1)));
  await f.db.query("update production_jobs set updated_at=now()+interval '1 second' where id=$1", [i.jobWin1]);
  await assert.rejects(() => f.prepare({ action: "window.approve", id: stale, note }, i.factory), /changed after this request/);
  assert.equal((await row("windows", stale)).status, "stale");
  confirmed(await f.apply({ action: "window.reject", id: stale, note: "Plan changed; request again" }, i.factory));
  assert.equal((await one("select planned_date::text d from production_jobs where id=$1", [i.jobWin1])).d, day(1));
  const fresh = idOf(confirmed(await requestChange(i.jobWin1)));
  await f.db.exec("set session_replication_role = replica");
  await f.db.query("update production_jobs set status='in_progress' where id=$1", [i.jobWin1]);
  await f.db.exec("set session_replication_role = origin");
  await f.db.query("update execution_window_changes set job_version=(select updated_at from production_jobs where id=$1) where id=$2", [i.jobWin1, fresh]);
  await assert.rejects(() => f.prepare({ action: "window.approve", id: fresh, note }, i.factory), /can no longer be moved/);
  confirmed(await f.apply({ action: "window.reject", id: fresh, note: "Withdrawn by the requester" }, i.productionManager));
  await assert.rejects(() => f.prepare({ action: "window.reject", id: fresh, note }, i.factory), /already rejected/);
});

test("NOV-044: an enforcing window makes the server refuse direct date and shift changes inside it, and only inside it", async () => {
  const window = idOf(confirmed(await setWindow({ enforce: true })));
  await assert.rejects(() => f.asSystem("update production_jobs set planned_date=planned_date+3 where id=$1", [i.jobWin1]), /protected execution window/);
  await assert.rejects(() => f.asSystem("update production_jobs set shift='Night' where id=$1", [i.jobWin1]), /protected execution window/);
  await f.asSystem("update production_jobs set planned_date=planned_date+1 where id=$1", [i.jobWin2]);
  await f.asSystem("update production_jobs set remarks='note only' where id=$1", [i.jobWin1]);
  await f.asSystem("update production_jobs set planned_date=planned_date+1 where id=$1", [i.jobWin3]);
  const id = idOf(confirmed(await requestChange(i.jobWin1)));
  confirmed(await f.apply({ action: "window.approve", id, note: "Approved by the factory manager" }, i.factory));
  assert.equal((await one("select planned_date::text d from production_jobs where id=$1", [i.jobWin1])).d, day(4), "the reviewed path still works under enforcement");
  await assert.rejects(() => f.asSystem("update production_jobs set planned_date=planned_date+1 where id=$1", [i.jobWin4]), /protected execution window/);
  confirmed(await setWindow({ enforce: true, machine_id: i.press2, horizon_hours: 24 }));
  assert.equal(n((await one("select count(*) c from execution_windows where status='active'")).c), 2);
  confirmed(await f.apply({ action: "window.retire", id: window, note: "Plan is stable again" }, i.productionManager));
  await f.asSystem("update production_jobs set planned_date=planned_date+1 where id=$1", [i.jobWin4]);
  await assert.rejects(() => f.asSystem("update production_jobs set planned_date=planned_date+1 where id=$1", [i.jobHold]), /protected execution window/);
  await assert.rejects(() => f.prepare({ action: "window.retire", id: window, note }, i.productionManager), /Only an active window/);
  await assert.rejects(() => setWindow({ horizon_hours: 6 }), /between 12 and 168/);
  await assert.rejects(() => setWindow({ machine_id: i.foreignCompany }), /press is unavailable/);
  await assert.rejects(() => setWindow({}, i.dispatch), /Not permitted/);
});

// NOV-045 ---------------------------------------------------------------------------------------
const setLimit = (patch = {}, actor = i.productionManager) => f.apply({ action: "wip.set_limit", stage: "at_press", unit: "kg", limit_value: 1000, basis: "Press A and B can take about one shift of work", note: "Agreed with the shift supervisors", ...patch }, actor);
const wipRow = async stage => (await list("wip")).rows.find(item => item.details.stage === stage);

test("NOV-045: stage positions are measured in one unit against an advisory limit and never block the stage", async () => {
  let rows = (await list("wip")).rows;
  assert.equal(rows.length, 6);
  assert.ok(rows.every(item => item.status === "no_limit"));
  assert.equal((await f.command("list", { view: "wip" })).total_count, 0, "stages without limits are not offered as work needing attention");
  const press = await wipRow("at_press");
  assert.equal(press.details.jobs, 2);
  assert.equal(press.details.kg, 900);
  const id = idOf(confirmed(await setLimit()));
  let record = await row("wip", id);
  assert.equal(record.status, "near");
  assert.equal(record.details.current_value, 900);
  assert.equal(record.details.unit, "kg");
  assert.match(record.summary, /900 kg.*limit 1000 kg/);
  assert.equal(record.details.upstream_basis, "planned or ready jobs waiting to start");
  // A release that would pass the limit needs a recorded reason; one that stays inside does not.
  const small = await f.prepare({ action: "wip.release", job_id: i.jobWin4, stage: "at_press", note: "Urgent customer line; accepted by the shift lead" }, i.productionManager);
  assert.ok(small.review.warnings.some(w => /1200 kg against a limit of 1000/.test(w)));
  confirmed(await f.commit(small, i.productionManager));
  assert.equal((await row("wip", id)).details.decisions.length, 1);
  assert.equal((await row("wip", id)).details.decisions[0].wip, 1200);
  confirmed(await setLimit({ limit_value: 5000 }));
  await assert.rejects(() => f.prepare({ action: "wip.release", job_id: i.jobReady, stage: "at_press", note }, i.productionManager), /no override is needed/);
  assert.equal(n((await one("select count(*) c from stage_wip_limits where status='active' and stage='at_press'")).c), 1, "a new limit replaces the old one");
  await assert.rejects(() => f.prepare({ action: "wip.release", job_id: i.jobReady, stage: "awaiting_qc", note }, i.productionManager), /no active limit/);
  await assert.rejects(() => f.prepare({ action: "wip.release", job_id: f.nextId(), stage: "at_press", note }, i.productionManager), /job is unavailable/);
  await assert.rejects(() => f.prepare({ action: "wip.release", job_id: i.jobReady, stage: "at_press", note }, i.dispatchManager), /Not permitted/);
});

test("NOV-045: unknown quantities are not treated as zero, jobs and kg are never mixed, and edges are refused", async () => {
  const hold = idOf(confirmed(await setLimit({ stage: "on_hold", unit: "kg", limit_value: 10000 })));
  let record = await row("wip", hold);
  assert.equal(record.details.unmeasured_jobs, 1);
  assert.equal(record.status, "unmeasured_incomplete", "a held job with no recorded quantity means the kg position cannot be confirmed");
  const jobs = idOf(confirmed(await setLimit({ stage: "on_hold", unit: "jobs", limit_value: 1, basis: "One held job at a time" })));
  record = await row("wip", jobs);
  assert.equal(record.status, "over");
  assert.equal(record.details.unit, "jobs");
  assert.equal(record.details.current_value, 1);
  await assert.rejects(() => setLimit({ unit: "jobs", limit_value: 2.5 }), /between 1 and 100000000 with at most 0 decimals/);
  await assert.rejects(() => setLimit({ limit_value: 0.0005 }), /at most 3 decimals/);
  await assert.rejects(() => setLimit({ limit_value: 0 }), /between 0.001/);
  await assert.rejects(() => setLimit({ stage: "nonsense" }), /Choose the stage/);
  await assert.rejects(() => setLimit({ unit: "tons" }), /kg or jobs/);
  await assert.rejects(() => setLimit({}, i.production), /Not permitted/);
  confirmed(await f.apply({ action: "wip.retire_limit", id: jobs, note: "The line is stable now" }, i.productionManager));
  await assert.rejects(() => f.prepare({ action: "wip.retire_limit", id: jobs, note }, i.productionManager), /Only an active limit/);
  assert.equal((await wipRow("on_hold")).status, "no_limit", "a retired limit leaves the stage without one");
  await assert.rejects(() => detail("wip", hold, i.foreign), /unavailable|Not permitted/);
});

// NOV-047 ---------------------------------------------------------------------------------------
const setRule = (patch = {}, actor = i.productionManager) => f.apply({ action: "rule.set", task_type: "inspection", allowed_roles: ["quality", "production_manager"], competency_id: i.competency, estimate_minutes: 30, note: "Only trained inspectors take inspections", ...patch }, actor);
const candidates = async task => (await detail("assignments", task)).row.details.candidates;

test("NOV-047: hard eligibility (role, current competency) is separate from availability and workload, with an override reason", async () => {
  const rule = idOf(confirmed(await setRule()));
  assert.equal((await row("rules", rule)).details.estimate_minutes, 30);
  let rows = await candidates(i.taskIns);
  assert.ok(rows.every(c => !c.hard_ok), "nobody holds the competency yet");
  assert.ok(rows.find(c => c.user_id === i.quality).hard_reasons.some(r => /competency is missing or expired/.test(r)));
  assert.ok(rows.find(c => c.user_id === i.production).hard_reasons.some(r => /Role production is not eligible/.test(r)));
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskIns, assignee_id: i.quality, note }, i.productionManager), /cannot take this task: Required competency is missing or expired/);
  await f.db.query("insert into employee_competencies(company_id,employee_id,competency_id,level,granted_by,granted_by_name) values($1,$2,$3,'independent',$4,'Fixture factory')", [i.company, i.quality, i.competency, i.factory]);
  rows = await candidates(i.taskIns);
  const quality = rows.find(c => c.user_id === i.quality);
  assert.equal(quality.hard_ok, true);
  assert.equal(quality.recommended, true);
  // Expired competency is not eligibility.
  await f.db.query("update employee_competencies set expires_at=now()-interval '1 day' where employee_id=$1", [i.quality]);
  assert.equal((await candidates(i.taskIns)).find(c => c.user_id === i.quality).hard_ok, false);
  await f.db.query("update employee_competencies set expires_at=null where employee_id=$1", [i.quality]);
  // Unavailable today: allowed only with a reason, which is retained with the evidence.
  const away = idOf(confirmed(await f.apply({ action: "availability.record", employee_id: i.quality, starts_on: day(0), ends_on: day(2), kind: "leave", note: "Approved leave" }, i.productionManager)));
  await assert.rejects(() => f.prepare({ action: "availability.record", employee_id: i.quality, starts_on: day(1), ends_on: day(3), kind: "training", note }, i.productionManager), /overlapping unavailability/);
  assert.equal((await candidates(i.taskIns)).find(c => c.user_id === i.quality).recommended, false);
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskIns, assignee_id: i.quality, note }, i.productionManager), /Give the reason for assigning anyway/);
  const preview = await f.prepare({ action: "assignment.assign", id: i.taskIns, assignee_id: i.quality, override_reason: "Only inspector on site; leave starts after lunch", note }, i.productionManager);
  assert.ok(preview.review.warnings.some(w => /Unavailable today \(leave\)/.test(w)));
  confirmed(await f.commit(preview, i.productionManager));
  const decision = await one("select override_reason,eligibility->>'hard_ok' hard,source from task_assignment_decisions where task_id=$1", [i.taskIns]);
  assert.equal(decision.override_reason, "Only inspector on site; leave starts after lunch");
  assert.equal(decision.hard, "true");
  assert.equal((await one("select assigned_to from tasks where id=$1", [i.taskIns])).assigned_to, i.quality);
  assert.equal(n((await one("select count(*) c from notifications where recipient_user_id=$1 and related_entity_id=$2", [i.quality, i.taskIns])).c), 1);
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskIns, assignee_id: i.quality, note }, i.productionManager), /already assigned/);
  confirmed(await f.apply({ action: "availability.cancel", id: away, note: "Leave cancelled" }, i.productionManager));
  await assert.rejects(() => f.prepare({ action: "availability.cancel", id: away, note }, i.productionManager), /still standing/);
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskIns, assignee_id: i.production2, override_reason: "No conflict here at all", note }, i.productionManager), /already assigned|cannot take this task/);
});

test("NOV-047: workload is shown as commitment with missing estimates stated, running work is never moved and stale eligibility is refused", async () => {
  // No rule for general tasks: role and status only, said plainly.
  const preview = await f.prepare({ action: "assignment.assign", id: i.taskOverdue, assignee_id: i.production2, override_reason: "Cover for the overdue chase while the lead is away", note }, i.productionManager);
  assert.equal(preview.review.facts["Eligibility"], "No rule for this task type; role and status only");
  assert.ok(preview.review.warnings.some(w => /overdue task\(s\) already assigned/.test(w)));
  assert.ok(preview.review.warnings.some(w => /no duration estimate/.test(w)), "unestimated work is a stated lower bound, never zero");
  const people = await candidates(i.taskOverdue);
  const p2 = people.find(c => c.user_id === i.production2);
  assert.equal(p2.open_tasks, 2);
  assert.equal(p2.overdue_tasks, 1);
  assert.equal(p2.unestimated_tasks, 2);
  assert.equal(p2.estimated_minutes, 0);
  assert.ok(people.every(c => c.user_id !== i.viewer && c.user_id !== i.dealer && c.user_id !== i.foreign), "viewers, dealers and other companies are never candidates");
  assert.ok(people.some(c => c.recommended), "someone is eligible, available and lightly committed");
  assert.equal(people.find(c => c.user_id === i.production).recommended, false, "a person with more committed work is not the lightest");
  // Running work is changed from the task itself.
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskDue, assignee_id: i.production2, note }, i.productionManager), /Running tasks/);
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskDone, assignee_id: i.production2, note }, i.productionManager), /not reassigned from here/);
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskOverdue, assignee_id: i.viewer, note }, i.productionManager), /active employee/);
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskOverdue, assignee_id: i.foreign, note }, i.productionManager), /active employee/);
  await assert.rejects(() => f.prepare({ action: "assignment.assign", id: i.taskOverdue, assignee_id: i.production2, override_reason: "Not needed", note }, i.production), /Not permitted/);
  // Eligibility that changes between review and confirmation is refused, not applied.
  const reviewed = await f.prepare({ action: "assignment.assign", id: i.taskPrio, assignee_id: i.salesManager, note }, i.productionManager);
  confirmed(await setRule({ task_type: "general", allowed_roles: ["production"], competency_id: undefined, estimate_minutes: 15 }));
  rejected(await f.commit(reviewed, i.productionManager), /cannot take this task|source changed/);
  assert.equal((await one("select assigned_to from tasks where id=$1", [i.taskPrio])).assigned_to, i.production);
  // The rule now makes assignments to other roles ineligible and surfaces them without moving them.
  const queue = (await list("assignments")).rows;
  assert.equal(queue.find(item => item.id === i.taskOverdue).status, "unassigned");
  await f.db.query("update assignment_rules set allowed_roles='{owner}' where task_type='general'");
  const ineligible = (await list("assignments")).rows.filter(item => item.status === "assignee_ineligible");
  assert.ok(ineligible.length >= 3);
  assert.equal((await one("select assigned_to from tasks where id=$1", [i.taskPrio])).assigned_to, i.production, "re-evaluation never silently moves work");
  assert.equal((await list("assignments")).rows.find(item => item.id === i.taskDue)?.status, "assignee_ineligible");
  await assert.rejects(() => setRule({ allowed_roles: ["viewer"] }), /Choose employee roles only/);
  await assert.rejects(() => setRule({ task_type: "Bad Type" }), /lowercase letters/);
  await assert.rejects(() => setRule({ competency_id: f.nextId() }), /competency is unavailable/);
  await assert.rejects(() => setRule({}, i.quality), /Not permitted/);
  await assert.rejects(() => list("assignments", i.production), /Not permitted/);
  await assert.rejects(() => list("rules", i.sales), /Not permitted/);
});

// NOV-052 ---------------------------------------------------------------------------------------
const FULL = ["order_confirmed", "die_ready", "billet_ready", "billet_heating", "extrusion_planned", "extruded", "stretching", "cutting", "aging", "surface_treatment", "finishing", "packing", "dispatched", "delivered", "payment_pending", "closed"];
const defineRoute = (patch = {}, actor = i.productionManager) => f.apply({ action: "route.define", code: "stock_sale", name: "Stock sale", applies_when: "Sold from finished stock without extrusion",
  required_stages: ["order_confirmed", "packing", "dispatched", "delivered"], optional_stages: ["finishing"], note: "Agreed with sales and dispatch", ...patch }, actor);
async function approvedRoute(patch = {}) { const id = idOf(confirmed(await defineRoute(patch))); confirmed(await f.apply({ action: "route.approve", id, note: "Reviewed" }, i.factory)); return id; }
const bind = (order, family, actor = i.productionManager) => f.apply({ action: "route.bind", order_id: order, family_id: family, note: "Order type confirmed with sales" }, actor);

test("NOV-052: a route is defined, approved by a second person, versioned and bound to an order without bypassing core stages", async () => {
  await assert.rejects(() => defineRoute({ required_stages: ["order_confirmed", "dispatched"] }), /keeps order confirmation, packing and dispatch/);
  await assert.rejects(() => defineRoute({ optional_stages: ["packing"] }), /both required and optional/);
  await assert.rejects(() => defineRoute({ required_stages: ["order_confirmed", "packing", "dispatched", "dispatched"] }), /each known stage once/);
  await assert.rejects(() => defineRoute({ required_stages: ["order_confirmed", "packing", "dispatched", "teleport"] }), /each known stage once/);
  await assert.rejects(() => defineRoute({ code: "Bad Code" }), /lowercase letters/);
  await assert.rejects(() => defineRoute({}, i.sales), /Not permitted/);
  const draft = idOf(confirmed(await defineRoute()));
  await assert.rejects(() => defineRoute(), /draft of this route already exists/);
  await assert.rejects(() => bind(i.order, draft), /Choose an approved route/);
  await assert.rejects(() => f.prepare({ action: "route.approve", id: draft, note }, i.productionManager), /second person approves/);
  await assert.rejects(() => f.prepare({ action: "route.approve", id: draft, note }, i.sales), /Not permitted/);
  confirmed(await f.apply({ action: "route.approve", id: draft, note: "Reviewed against the dispatch checklist" }, i.factory));
  await assert.rejects(() => f.prepare({ action: "route.approve", id: draft, note }, i.owner), /Only a draft route/);
  assert.equal((await row("routes", draft)).details.required_stages.join(","), "order_confirmed,packing,dispatched,delivered");
  const preview = await f.prepare({ action: "route.bind", order_id: i.order, family_id: draft, note: "Order type confirmed with sales" }, i.productionManager);
  assert.ok(preview.review.warnings.some(w => /current stage \(extrusion planned\) is not part of this route/.test(w)));
  assert.ok(preview.review.warnings.some(w => /already recorded that this route does not include/.test(w)), "recorded history outside the route is kept and said so");
  confirmed(await f.commit(preview, i.productionManager));
  await assert.rejects(() => bind(i.order, draft), /already follows Stock sale/);
  assert.equal((await row("routes", draft)).details.orders_bound, 1);
  // A new version retires the old one for new orders; bound orders keep theirs.
  const v2 = idOf(confirmed(await defineRoute({ optional_stages: ["finishing", "surface_treatment"] })));
  assert.equal((await row("routes", v2)).details.version, 2);
  confirmed(await f.apply({ action: "route.approve", id: v2, note: "Version 2 adds surface treatment" }, i.factory));
  assert.equal((await row("routes", draft)).status, "retired");
  assert.equal((await one("select family_version v from order_route_bindings where order_id=$1 and status='active'", [i.order])).v, 1);
  confirmed(await bind(i.order, v2));
  assert.equal(n((await one("select count(*) c from order_route_bindings where order_id=$1 and status='superseded'", [i.order])).c), 1, "the earlier binding stays in history");
  const retire = await f.prepare({ action: "route.retire", id: v2, note: "Replaced by a custom route" }, i.factory);
  assert.ok(retire.review.warnings.some(w => /1 order\(s\) stay bound/.test(w)));
  await assert.rejects(() => bind(i.orderPay, v2), /payment pending is not bound/);
});

test("NOV-052: a deviation skips only an optional-by-policy stage ahead of the order, with a second approver, and progress shows why", async () => {
  const custom = await approvedRoute({ code: "custom_extrusion", name: "Custom extrusion", applies_when: "Made to order from billet", required_stages: FULL.slice(0, 14).filter(s => !["aging"].includes(s)), optional_stages: [] });
  confirmed(await bind(i.order2, custom));
  await assert.rejects(() => f.prepare({ action: "route.deviate", order_id: i.order2, stage: "packing", note }, i.productionManager), /core control/);
  await assert.rejects(() => f.prepare({ action: "route.deviate", order_id: i.order2, stage: "billet_heating", note }, i.productionManager), /ahead of the order/);
  await assert.rejects(() => f.prepare({ action: "route.deviate", order_id: i.order2, stage: "aging", note }, i.productionManager), /required stage of the route/);
  await assert.rejects(() => f.prepare({ action: "route.deviate", order_id: i.order, stage: "stretching", note }, i.productionManager), /Bind the order to a route/);
  const dev = idOf(confirmed(await f.apply({ action: "route.deviate", order_id: i.order2, stage: "stretching", note: "Profile is cut straight from the press; no stretching needed" }, i.productionManager)));
  await assert.rejects(() => f.prepare({ action: "route.deviate", order_id: i.order2, stage: "stretching", note }, i.productionManager), /already requested/);
  await assert.rejects(() => f.prepare({ action: "route.decide", id: dev, decision: "approve", note }, i.productionManager), /second person decides/);
  let progress = await f.progress(i.order2);
  assert.equal(progress.stages.find(s => s.stage === "stretching").state, "upcoming", "a pending request changes nothing");
  confirmed(await f.apply({ action: "route.decide", id: dev, decision: "reject", note: "Stretching is needed for this alloy" }, i.factory));
  const again = idOf(confirmed(await f.apply({ action: "route.deviate", order_id: i.order2, stage: "stretching", note: "Customer accepts unstretched sections" }, i.productionManager)));
  assert.equal(again, dev, "a rejected deviation is reopened rather than duplicated");
  confirmed(await f.apply({ action: "route.decide", id: dev, decision: "approve", note: "Customer accepted in writing" }, i.factory));
  progress = await f.progress(i.order2);
  orderProgressSchema.parse(progress);
  const stretching = progress.stages.find(s => s.stage === "stretching");
  assert.equal(stretching.state, "skipped_by_policy");
  assert.match(stretching.reason, /Skipped by an approved deviation: Customer accepts unstretched sections/);
  assert.equal(progress.stages.find(s => s.stage === "aging").state, "skipped_by_policy", "stages outside the route are policy skips, not completions");
  assert.match(progress.stages.find(s => s.stage === "aging").reason, /Not part of the approved route Custom extrusion/);
  // Rebinding ends the deviation's effect.
  const other = await approvedRoute({ code: "rework", name: "Returned-material rework", applies_when: "Material returned by a customer for rework", required_stages: ["order_confirmed", "finishing", "packing", "dispatched"], optional_stages: [] });
  confirmed(await bind(i.order2, other));
  assert.equal((await f.progress(i.order2)).stages.find(s => s.stage === "stretching").state, "skipped_by_policy", "stretching is not in the new route either");
  await assert.rejects(() => f.prepare({ action: "route.decide", id: dev, decision: "approve", note }, i.factory), /already approved/);
  await assert.rejects(() => bind(i.foreignOrder, other), /order is unavailable/);
});

// NOV-087 ---------------------------------------------------------------------------------------
test("NOV-087: progress comes from stage evidence; a passed stage without evidence is unavailable, not complete", async () => {
  const progress = await f.progress(i.order);
  orderProgressSchema.parse(progress);
  const by = stage => progress.stages.find(s => s.stage === stage);
  assert.equal(progress.stages.length, 16);
  assert.equal(by("order_confirmed").state, "complete");
  assert.ok(by("order_confirmed").evidence.changed_at);
  assert.equal(by("billet_heating").state, "unavailable");
  assert.match(by("billet_heating").reason, /without a recorded stage change/);
  assert.equal(by("extrusion_planned").state, "current");
  assert.equal(by("extruded").state, "upcoming");
  assert.equal(by("extruded").quantity.jobs >= 1, true);
  assert.ok(typeof by("extruded").quantity.produced_kg === "number" || typeof by("extruded").quantity.produced_kg === "string");
  assert.equal(progress.route, null);
  assert.equal(by("dispatched").quantity.dispatched_kg, 500, "partial dispatch is shown in kilograms, not as a percentage");
  assert.ok(!JSON.stringify(progress).includes("percent"));
  // Reopened work.
  const reopen = await f.progress(i.orderReopen);
  assert.equal(reopen.reopened, true);
  assert.equal(reopen.stages.find(s => s.stage === "extruded").reopened, true);
  assert.equal(reopen.stages.find(s => s.stage === "cutting").state, "upcoming");
  // Gaps: a late-stage order without history never shows completed stages it has no evidence for.
  const late = await f.progress(i.orderLate);
  assert.equal(late.stages.find(s => s.stage === "billet_ready").state, "unavailable");
  assert.equal(late.stages.find(s => s.stage === "dispatched").state, "current");
  // Tenancy, roles and links.
  await assert.rejects(() => f.progress(i.order, i.foreign), /unavailable/);
  await assert.rejects(() => f.progress(i.order, i.dealer), /Not permitted/);
  assert.equal((await f.progress(i.order, i.viewer)).order_id, i.order);
  assert.equal((await f.progress(i.order, i.sales)).stages.find(s => s.stage === "extruded").href, null, "sales has no link into production");
  assert.match((await f.progress(i.order, i.production)).stages.find(s => s.stage === "extruded").href, /^\/production\//);
  await assert.rejects(() => f.progress(f.nextId()), /unavailable/);
});

test("NOV-087: blockers, a cancelled order and a failed source read are explicit", async () => {
  await f.db.exec("set session_replication_role = replica");
  await f.db.query("update orders set current_stage='billet_ready',billets_short=3 where id=$1", [i.orderGap]);
  await f.db.exec("set session_replication_role = origin");
  let progress = await f.progress(i.orderGap);
  assert.equal(progress.stages.find(s => s.stage === "billet_ready").state, "blocked");
  assert.ok(progress.blockers.some(b => /3 billet\(s\) short/.test(b)));
  // A held production job blocks the stage the order is at.
  await f.db.exec("set session_replication_role = replica");
  await f.db.query("update orders set current_stage='extruded' where id=$1", [i.order2]);
  await f.db.exec("set session_replication_role = origin");
  progress = await f.progress(i.order2);
  assert.equal(progress.stages.find(s => s.stage === "extruded").state, "blocked");
  assert.ok(progress.blockers.some(b => /on hold/.test(b)));
  // Cancelled orders keep evidence and claim no current stage.
  await f.db.exec("set session_replication_role = replica");
  await f.db.query("update orders set current_stage='cancelled' where id=$1", [i.orderReopen]);
  await f.db.exec("set session_replication_role = origin");
  progress = await f.progress(i.orderReopen);
  assert.equal(progress.cancelled, true);
  assert.ok(progress.stages.every(s => s.state !== "current"));
  assert.equal(progress.stages.find(s => s.stage === "order_confirmed").state, "complete");
  // A source that cannot be read leaves its stages unavailable rather than guessing.
  await f.db.exec("alter table production_jobs rename to production_jobs_offline");
  try {
    progress = await f.progress(i.order);
    assert.equal(progress.errors.production, true);
    assert.equal(progress.stages.find(s => s.stage === "extruded").state, "unavailable");
    assert.match(progress.stages.find(s => s.stage === "extruded").reason, /could not be read/);
    assert.equal(progress.stages.find(s => s.stage === "order_confirmed").state, "complete", "unaffected stages keep their evidence");
  } finally { await f.db.exec("alter table production_jobs_offline rename to production_jobs"); }
});

// NOV-019 ---------------------------------------------------------------------------------------
const prepareMessage = (template, entity, actor = i.sales, extra = {}) => f.apply({ action: "message.prepare", template, entity_id: entity, ...extra }, actor);
const mark = (id, state, actor = i.sales) => f.apply({ action: "message.mark", id, state }, actor);

test("NOV-019: a prepared message shows its recipient, text and document, is never claimed as sent and goes stale when the source changes", async () => {
  const preview = await f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.order }, i.sales);
  assert.equal(preview.review.facts["Number"], "+919876543210");
  assert.equal(preview.review.facts["Number from"], "customer whatsapp");
  assert.equal(preview.review.facts["Delivery"], "Prepared only");
  assert.match(preview.review.facts["Message"], /SO-NOV5-01/);
  assert.doesNotMatch(preview.review.facts["Message"], /margin|cost|rate|discount|internal/i, "no internal commercial data");
  const id = idOf(confirmed(await f.commit(preview, i.sales)));
  let record = await row("messages", id, i.sales);
  assert.equal(record.status, "prepared");
  assert.equal(record.details.stale, false);
  assert.match(record.summary, /Prepared, not sent/);
  assert.match(record.details.delivery_note, /Sending, delivery and reading are not tracked/);
  // A changed order makes the preparation stale; it cannot be recorded as used.
  await f.db.query("update orders set expected_dispatch_date=expected_dispatch_date+3,updated_at=now() where id=$1", [i.order]);
  assert.equal((await row("messages", id, i.sales)).details.stale, true);
  await assert.rejects(() => f.prepare({ action: "message.mark", id, state: "copied" }, i.sales), /changed since this message was prepared/);
  const fresh = idOf(confirmed(await prepareMessage("order_confirmation", i.order)));
  assert.equal((await row("messages", id, i.sales)).status, "superseded", "a new preparation replaces the old one");
  confirmed(await mark(fresh, "copied"));
  record = await row("messages", fresh, i.sales);
  assert.equal(record.status, "copied");
  assert.equal(record.summary.startsWith("Copied for sending by hand"), true);
  await assert.rejects(() => f.prepare({ action: "message.mark", id: fresh, state: "printed" }, i.sales), /already copied/);
  await assert.rejects(() => f.prepare({ action: "message.cancel", id: fresh }, i.sales), /already copied/);
  const second = idOf(confirmed(await prepareMessage("order_confirmation", i.order)));
  confirmed(await f.apply({ action: "message.cancel", id: second }, i.sales));
  assert.equal((await row("messages", second, i.sales)).status, "cancelled");
  await assert.rejects(() => f.prepare({ action: "message.mark", id: second, state: "emailed" }, i.sales), /already cancelled|Choose copied/);
});

test("NOV-019: recipients, part dispatches, appointments, roles and tenancy are handled without false delivery claims", async () => {
  // No recipient recorded: refused until a valid number is entered; entered numbers are normalised.
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.orderNoPhone }, i.sales), /No valid mobile number/);
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.orderNoPhone, recipient_phone: "12345" }, i.sales), /valid 10-digit/);
  const entered = await f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.orderNoPhone, recipient_phone: "098 2001 1223" }, i.sales);
  assert.equal(entered.review.facts["Number"], "+919820011223");
  assert.equal(entered.review.facts["Number from"], "entered");
  // A part dispatch says so and the document link opens the dispatch.
  const part = await f.prepare({ action: "message.prepare", template: "dispatch_notice", entity_id: i.dispatch1 }, i.dispatch);
  assert.match(part.review.facts["Message"], /part dispatch/);
  assert.match(part.review.facts["Message"], /MH12AB1234/);
  assert.equal(part.review.facts["Document"], "Dispatch D-NOV5-1");
  assert.ok(part.review.warnings.some(w => /Part dispatch/.test(w)));
  const id = idOf(confirmed(await f.commit(part, i.dispatch)));
  assert.equal((await row("messages", id, i.dispatch)).details.document_href, `/dispatches/${i.dispatch1}`);
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "dispatch_notice", entity_id: i.dispatchPending }, i.dispatch), /has not left/);
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "dispatch_notice", entity_id: f.nextId() }, i.dispatch), /dispatch is unavailable/);
  // Appointment notices follow the site's confirmation and stop for closed appointments.
  const appointment = await requestAppointment({ dispatch_id: i.dispatchPending });
  const requested = await f.prepare({ action: "message.prepare", template: "appointment_notice", entity_id: appointment }, i.sales);
  assert.match(requested.review.facts["Message"], /we request delivery.*\(please confirm\)/);
  confirmed(await f.apply({ action: "appointment.confirm", id: appointment, confirmed_start: ist(31), confirmed_end: ist(33), confirmed_by_name: "Mr Patil", note }, i.dispatchManager));
  const confirmedNotice = await f.prepare({ action: "message.prepare", template: "appointment_notice", entity_id: appointment }, i.sales);
  assert.match(confirmedNotice.review.facts["Message"], /delivery is scheduled/);
  assert.match(confirmedNotice.review.facts["Message"], /Plot 14, MIDC Road/);
  assert.doesNotMatch(confirmedNotice.review.facts["Message"], /9820011122/, "the receiving contact's number is not copied into customer messages");
  confirmed(await f.apply({ action: "appointment.cancel", id: appointment, note: "Order is being split" }, i.dispatchManager));
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "appointment_notice", entity_id: appointment }, i.sales), /needs no notice/);
  // Roles and tenants.
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.order }, i.production), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.order }, i.dealer), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.foreignOrder }, i.sales), /order is unavailable/);
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.order }, i.viewer), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "message.prepare", template: "newsletter", entity_id: i.order }, i.sales), /Choose a message type/);
  await assert.rejects(() => detail("messages", id, i.foreign), /unavailable|Not permitted/);
  const accounts = await f.prepare({ action: "message.prepare", template: "order_confirmation", entity_id: i.order }, i.accounts);
  assert.equal(accounts.state, "prepared");
});

// NOV-014 ---------------------------------------------------------------------------------------
const version = async id => (await row("queue", id)).details.version;
const rec = async ids => Promise.all(ids.map(async id => ({ id, version: await version(id) })));
const queueUpdate = async (field, value, ids, actor = i.productionManager, extra = {}) => f.apply({ action: "queue.update", selection: "page", field, value, records: await rec(ids), ...extra }, actor);

test("NOV-014: selected tasks are previewed, judged again at apply time and every identity gets its own outcome", async () => {
  const ids = [i.taskPrio, i.taskPrio2, i.taskLater];
  const mine = (await list("queue")).rows;
  assert.ok(mine.every(item => item.details.version && item.details.task_status), "each row carries the version that was seen");
  assert.equal(mine.some(item => item.id === i.taskDone), false, "completed tasks are not in the queue");
  const preview = await f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: await rec(ids) }, i.productionManager);
  assert.equal(preview.review.records.length, 3);
  assert.equal(preview.review.facts["Will change"], 3);
  assert.ok(preview.review.warnings.some(w => /processed one by one/.test(w)));
  assert.equal(n((await one("select count(*) c from tasks where priority='high' and id = any($1)", [ids])).c), 0, "a review changes nothing");
  // One task changes between the review and the confirmation: it is reported, the others are applied.
  await f.db.query("update tasks set updated_at=now() where id=$1", [i.taskPrio2]);
  const done = confirmed(await f.commit(preview, i.productionManager));
  executionOutcomeSchema.parse(done);
  assert.equal(done.result.records.length, 3, "every selected identity is listed");
  const byId = Object.fromEntries(done.result.records.map(item => [item.id, item]));
  assert.equal(byId[i.taskPrio].outcome, "changed");
  assert.equal(byId[i.taskLater].outcome, "changed");
  assert.equal(byId[i.taskPrio2].outcome, "rejected");
  assert.match(byId[i.taskPrio2].reason, /Changed since the list was loaded/);
  assert.equal((await one("select priority from tasks where id=$1", [i.taskPrio2])).priority, "low", "the concurrently changed task was not overwritten");
  assert.deepEqual(await f.commit(preview, i.productionManager), done, "repeating the request returns the stored outcome without a second write");
  const history = await one("select action,facts from execution_events where entity_id=$1", [done.request_id]);
  assert.equal(history.action, "queue.update");
  assert.equal(history.facts.records.length, 3, "the retained history lists every selected identity");
  // No change needed is also reported, and a batch where nothing can change is refused.
  const again = confirmed(await queueUpdate("priority", "high", [i.taskPrio, i.taskDue]));
  assert.deepEqual(again.result.records.map(item => item.outcome).sort(), ["changed", "no_change"]);
  await assert.rejects(async () => f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: await rec([i.taskPrio]) }, i.productionManager), /None of the selected tasks can be changed: Already has this value/);
});

test("NOV-014: assignee changes use the same eligibility as assignment, other fields are validated and selection limits hold", async () => {
  const assignedTo = async id => (await one("select assigned_to from tasks where id=$1", [id])).assigned_to;
  const ok = confirmed(await queueUpdate("assigned_to", i.inventory, [i.taskIns, i.taskQc]));
  assert.deepEqual(ok.result.records.map(item => item.outcome), ["changed", "changed"]);
  assert.equal(await assignedTo(i.taskIns), i.inventory);
  assert.equal((await one("select source from task_assignment_decisions where task_id=$1", [i.taskIns])).source, "queue");
  // Running work and ineligible or unavailable people are refused per record, with the reason.
  const mixed = confirmed(await queueUpdate("assigned_to", i.production, [i.taskNoDue, i.taskAssigned1]));
  const outcome = Object.fromEntries(mixed.result.records.map(item => [item.id, item]));
  assert.match(outcome[i.taskNoDue].reason, /Running tasks are reassigned from the task itself/);
  assert.equal(outcome[i.taskAssigned1].outcome, "changed");
  confirmed(await setRule({ task_type: "general", allowed_roles: ["production"], competency_id: undefined }));
  const blocked = await f.prepare({ action: "queue.update", selection: "page", field: "assigned_to", value: i.salesManager, records: await rec([i.taskAssigned2, i.taskOverdue]) }, i.productionManager).catch(error => error);
  assert.match(String(blocked.message ?? blocked), /None of the selected tasks can be changed.*Role sales manager is not eligible for general tasks/);
  await f.apply({ action: "availability.record", employee_id: i.production2, starts_on: day(0), ends_on: day(1), kind: "leave", note: "Approved leave" }, i.productionManager);
  const away = await f.prepare({ action: "queue.update", selection: "page", field: "assigned_to", value: i.production2, records: await rec([i.taskPrio2, i.taskQc]) }, i.productionManager).catch(error => error);
  assert.match(String(away.message ?? away), /use the assignment screen.*Unavailable today \(leave\)/, "a conflict needs an override reason, which only the assignment screen collects");
  // Dates, priorities and shape.
  confirmed(await queueUpdate("due_date", day(6), [i.taskPrio, i.taskPrio2]));
  assert.equal((await one("select due_date::text d from tasks where id=$1", [i.taskPrio])).d, day(6));
  await assert.rejects(() => queueUpdate("due_date", day(-2), [i.taskPrio]), /cannot be in the past/);
  await assert.rejects(() => queueUpdate("priority", "critical", [i.taskPrio]), /Choose a priority/);
  await assert.rejects(() => queueUpdate("status", "completed", [i.taskPrio]), /Choose assignee, priority or planned date/);
  await assert.rejects(() => queueUpdate("assigned_to", i.viewer, [i.taskPrio]), /active employee/);
  await assert.rejects(() => queueUpdate("assigned_to", i.foreign, [i.taskPrio]), /active employee/);
  await assert.rejects(() => f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: [] }, i.productionManager), /Review the required action details|Select at least one/);
  const dup = await rec([i.taskPrio]);
  await assert.rejects(() => f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: [...dup, ...dup] }, i.productionManager), /selected twice/);
  await assert.rejects(() => f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: [{ id: i.taskPrio, version: "x" }] }, i.productionManager), /identity and the version/);
  await assert.rejects(async () => f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: [{ id: i.taskPrio, version: await version(i.taskPrio), extra: 1 }] }, i.productionManager), /identity and the version/);
  await assert.rejects(() => f.prepare({ action: "queue.update", selection: "everything", field: "priority", value: "high", records: dup }, i.productionManager), /page or everything matching/);
  const eleven = Array.from({ length: 11 }, () => ({ id: f.nextId(), version: "2026-11-05T00:00:00.000000Z" }));
  await assert.rejects(() => f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: eleven }, i.productionManager), /at most 10/);
  await assert.rejects(() => f.prepare({ action: "queue.update", selection: "filtered", field: "priority", value: "high", records: [...eleven, ...eleven, ...eleven, ...eleven, ...eleven] }, i.productionManager), /at most 50|selected twice/);
  // Other companies, finished tasks and roles.
  const unknown = await f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "high", records: [...dup, { id: i.taskDone, version: "2026-11-05T00:00:00.000000Z" }, { id: f.nextId(), version: "2026-11-05T00:00:00.000000Z" }] }, i.productionManager);
  assert.deepEqual(unknown.review.records.map(item => item.outcome), ["will_change", "rejected", "rejected"]);
  assert.match(unknown.review.records[1].reason, /task is completed/);
  assert.match(unknown.review.records[2].reason, /task is unavailable/);
  await assert.rejects(() => queueUpdate("priority", "high", [i.taskPrio], i.production), /Not permitted/);
  await assert.rejects(() => queueUpdate("priority", "high", [i.taskPrio], i.dealer), /Not permitted/);
  confirmed(await queueUpdate("priority", "urgent", [i.taskPrio2], i.dispatchManager));
  // Access revoked between review and confirmation.
  const review = await f.prepare({ action: "queue.update", selection: "page", field: "priority", value: "normal", records: await rec([i.taskPrio]) }, i.dispatchManager);
  await f.db.query("update app_users set role='viewer' where id=$1", [i.dispatchManager]);
  await assert.rejects(() => f.commit(review, i.dispatchManager), /Not permitted/);
});
