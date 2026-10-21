import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url); require("tsx/cjs");
const { loadNotificationActions, notificationTarget } = require("../lib/operations/notification-actions.ts");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { companyId: id(1), userId: id(2), role: "owner", dealerId: null };
const notification = (n, type = "invoice", notificationType = "overdue_invoice") => ({ id: id(100 + n), related_entity_type: type, related_entity_id: id(n), notification_type: notificationType });

function fixture(rows = {}, errors = []) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [], projection: "", limit: null };
    const query = { select(columns) { call.projection = columns; return query; }, eq(field, value) { call.filters.push(["eq", field, value]); return query; }, in(field, values) { call.filters.push(["in", field, values]); return query; }, is(field, value) { call.filters.push(["is", field, value]); return query; }, async limit(limit) { call.limit = limit; calls.push(call); return { data: rows[table] ?? [], error: errors.includes(table) ? { message: "SECRET DATABASE ERROR" } : null }; } };
    return query;
  } };
  return { client, calls };
}

test("an overdue invoice links its exact permitted record and resolves only from current balances", async () => {
  const f = fixture({ invoices_authorized: [{ id: id(10), status: "partially_paid", due_date: "2026-10-01", balance_due: 100 }, { id: id(11), status: "paid", due_date: "2026-10-01", balance_due: 0 }] });
  const result = await loadNotificationActions(f.client, context, [notification(10), notification(11)], "2026-10-21");
  assert.equal(result[id(110)].href, `/invoices/${id(10)}`); assert.equal(result[id(110)].state, "active"); assert.equal(result[id(111)].state, "resolved");
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].filters[0], ["eq", "company_id", context.companyId]); assert.equal(f.calls[0].limit, 10);
  assert.ok(f.calls[0].filters.some(filter => filter[1] === "deleted_at"));
});

test("an unprivileged role cannot trigger an invoice query or obtain a financial destination", async () => {
  const f = fixture();
  const actions = await loadNotificationActions(f.client, { ...context, role: "sales" }, [notification(10)], "2026-10-21");
  assert.equal(actions[id(110)].state, "restricted"); assert.equal(actions[id(110)].href, null); assert.equal(f.calls.length, 0);
});

test("unavailable or missing sources never turn a query failure into a resolved alert", async () => {
  for (const f of [fixture({}, ["invoices_authorized"]), fixture()]) {
    const action = (await loadNotificationActions(f.client, context, [notification(10)], "2026-10-21"))[id(110)];
    assert.equal(action.state, "unavailable"); assert.equal(action.href, null); assert.doesNotMatch(JSON.stringify(action), /SECRET/);
  }
});

test("missing balances remain unresolved and a replenished stock alert uses its current source", async () => {
  const f = fixture({ invoices_authorized: [{ id: id(10), status: "sent", due_date: "2026-10-01", balance_due: null }], inventory_items: [{ id: id(11), current_stock: 100, reorder_level: 10 }, { id: id(12), current_stock: 10, reorder_level: 10 }] });
  const result = await loadNotificationActions(f.client, context, [notification(10), notification(11, "inventory_item", "low_stock"), notification(12, "inventory_items", "low_stock")], "2026-10-21");
  assert.equal(result[id(110)].state, "active"); assert.equal(result[id(111)].state, "resolved"); assert.equal(result[id(112)].state, "active");
});

test("malformed identities, arbitrary paths and object prototype names produce no destination or query", async () => {
  const f = fixture();
  for (const type of ["__proto__", "constructor", "https://external.invalid", "unknown"]) assert.equal(notificationTarget(type), null);
  const actions = await loadNotificationActions(f.client, context, [notification(1, "__proto__"), { ...notification(2), related_entity_id: "../../settings" }], "2026-10-21");
  assert.ok(Object.values(actions).every(action => action.state === "unlinked" && action.href === null)); assert.equal(f.calls.length, 0);
});

test("closed tasks resolve while original alert text and read receipts remain separate", async () => {
  const n = { ...notification(10, "task", "task_assigned"), body: "Historical task assignment", is_read: false };
  const f = fixture({ tasks: [{ id: id(10), status: "completed" }] });
  assert.equal((await loadNotificationActions(f.client, context, [n], "2026-10-21"))[n.id].state, "resolved");
  assert.equal(n.body, "Historical task assignment"); assert.equal(n.is_read, false);
});

test("the helper bounds its work to one ten-row notification page", async () => {
  const f = fixture(); const result = await loadNotificationActions(f.client, context, Array.from({ length: 100 }, (_, i) => notification(1000 + i)), "2026-10-21");
  assert.equal(Object.keys(result).length, 10); assert.equal(f.calls[0].filters.find(filter => filter[0] === "in")[2].length, 10);
});
