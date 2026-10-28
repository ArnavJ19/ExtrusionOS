import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canReadLineSchedule, canSetLineSchedule, describeScheduleChange, lineDueState, lineHistorySchema, lineListSchema, lineQueueSchema,
  lineScheduleCommandSchema, lineSupply
} from "../lib/workflow/order-line-schedule.ts";
import { createOrderLineScheduleFixture, lids, lid, day } from "../scripts/lib/order-line-schedule-fixture.mjs";

const id = "00000000-0000-4000-8000-000000000060";

test("roles: commercial and planning leads set requirements; floor and finance roles only read; dealers neither", () => {
  for (const role of ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager"]) assert.ok(canSetLineSchedule(role) && canReadLineSchedule(role), role);
  for (const role of ["production", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"]) assert.ok(!canSetLineSchedule(role) && canReadLineSchedule(role), role);
  for (const role of ["dealer_admin", "dealer_staff"]) assert.ok(!canReadLineSchedule(role), role);
});

test("command schema: real dates only, known priorities, a reason, no forged context", () => {
  const valid = { command: "schedule.set", order_item_id: id, required_date: "2026-11-05", priority: "urgent", reason: "Site", expected_version: 0, request_id: id };
  assert.equal(lineScheduleCommandSchema.safeParse(valid).success, true);
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, required_date: null, priority: null }).success, true, "clearing is allowed");
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, required_date: "2026-02-30" }).success, false);
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, required_date: "05/11/2026" }).success, false);
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, priority: "asap" }).success, false);
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, reason: " " }).success, false);
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, reason: "a\u0001" }).success, false);
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, expected_version: -1 }).success, false);
  assert.equal(lineScheduleCommandSchema.safeParse({ ...valid, company_id: id }).success, false);
  assert.equal(lineScheduleCommandSchema.safeParse({ command: "schedule.queue", scope: "billing" }).success, false);
  assert.deepEqual(lineScheduleCommandSchema.parse({ command: "schedule.queue", scope: "dispatch" }), { command: "schedule.queue", scope: "dispatch", filter: "all", page: 1 });
});

test("due state uses the database's today; supplied lines are never overdue", () => {
  assert.equal(lineDueState("2026-10-21", "2026-10-22"), "overdue");
  assert.equal(lineDueState("2026-10-22", "2026-10-22"), "due_soon");
  assert.equal(lineDueState("2026-10-25", "2026-10-22"), "due_soon");
  assert.equal(lineDueState("2026-10-26", "2026-10-22"), "scheduled");
  assert.equal(lineDueState(null, "2026-10-22"), "none");
  assert.equal(lineDueState("2026-10-01", "2026-10-22", true), "fulfilled");
});

test("supply counts packing and uncredited stock; an unknown quantity is never treated as supplied", () => {
  assert.deepEqual(lineSupply({ ordered_kg: 1000, packed_kg: 600, from_stock_kg: 100 }), { supplied: 700, remaining: 300, fulfilled: false });
  assert.deepEqual(lineSupply({ ordered_kg: 1000, packed_kg: 1000.5, from_stock_kg: 0 }), { supplied: 1000.5, remaining: 0, fulfilled: true });
  assert.deepEqual(lineSupply({ ordered_kg: null, packed_kg: 900, from_stock_kg: 0 }), { supplied: 900, remaining: null, fulfilled: false });
  assert.deepEqual(lineSupply({ ordered_kg: 0, packed_kg: 0, from_stock_kg: 0 }), { supplied: 0, remaining: null, fulfilled: false });
});

test("history rows describe exactly what changed", () => {
  assert.equal(describeScheduleChange({ previous_required_date: null, new_required_date: "2026-10-25", previous_priority: null, new_priority: "urgent" }), "Date order date → 2026-10-25; priority order priority → urgent");
  assert.equal(describeScheduleChange({ previous_required_date: "2026-10-25", new_required_date: "2026-10-25", previous_priority: "urgent", new_priority: "high" }), "priority urgent → high");
  assert.equal(describeScheduleChange({ previous_required_date: "2026-10-25", new_required_date: null, previous_priority: null, new_priority: null }), "Date 2026-10-25 → order date");
});

let f;
test.before(async () => { f = await createOrderLineScheduleFixture(); await f.reset(); });
test.after(async () => { await f?.close(); });

test("database responses parse with the app's schemas (lines, queue, history)", async () => {
  await f.set();
  const list = lineListSchema.parse(await f.command("schedule.lines", { order_id: lids.order }));
  assert.equal(list.rows.length, 3);
  assert.equal(list.today, day(0));
  assert.equal(list.rows[0].order_item_id, lids.line1, "the urgent line sorts first");
  for (const scope of ["production", "dispatch"]) {
    const queue = lineQueueSchema.parse(await f.command("schedule.queue", { scope, filter: "all", page: 1 }));
    assert.ok(queue.rows.length > 0, scope);
  }
  const history = lineHistorySchema.parse(await f.command("schedule.history", { order_item_id: lids.line1, page: 1 }));
  assert.equal(history.total_count, 1);
  await f.set({ request_id: lid(5050), priority: "high", expected_version: 1 });
  assert.equal(lineListSchema.parse(await f.command("schedule.lines", { order_id: lids.order })).rows[0].version, 2);
});

test("pages gate on role and dealer status; the action never takes a company from input", () => {
  const action = readFileSync("lib/actions/order-line-schedule.ts", "utf8");
  assert.match(action, /context\.dealerId \|\| !\(mutation \? canSetLineSchedule\(context\.role\) : canReadLineSchedule\(context\.role\)\)/);
  assert.doesNotMatch(action, /company_id/);
  const order = readFileSync("app/(dashboard)/orders/[id]/page.tsx", "utf8");
  assert.match(order, /showProgress && canReadLineSchedule\(context\.role\) \? await loadOrderLineSchedule/);
  assert.match(order, /canWrite=\{canSetLineSchedule\(context\.role\)\}/);
  for (const page of ["app/(dashboard)/production/page.tsx", "app/(dashboard)/dispatches/page.tsx"]) {
    assert.match(readFileSync(page, "utf8"), /canReadLineSchedule\(context\.role\) && !context\.dealerId \? await loadLineDeliveryQueue/, page);
  }
});
