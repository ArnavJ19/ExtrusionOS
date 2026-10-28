import test from "node:test";
import assert from "node:assert/strict";
import { createOrderLineScheduleFixture, lids, lid, day } from "../scripts/lib/order-line-schedule-fixture.mjs";

let f;
test.before(async () => { f = await createOrderLineScheduleFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const n = (value) => (value === null ? null : Number(value));
const queue = async (payload = {}, actor) => f.command("schedule.queue", { scope: "production", ...payload }, actor);

// ---------- Effective requirements ----------

test("lines without their own schedule inherit the order's date and priority", async () => {
  const rows = await f.lines();
  assert.equal(Object.keys(rows).length, 3);
  for (const id of [lids.line1, lids.line2, lids.line3]) {
    assert.equal(rows[id].effective_date, day(10));
    assert.equal(rows[id].effective_priority, "normal");
    assert.equal(rows[id].date_source, "order");
    assert.equal(rows[id].priority_source, "order");
    assert.equal(rows[id].version, 0);
  }
  assert.equal(rows[lids.line1].line_label, "Sliding track");
  assert.equal(rows[lids.line2].line_label, "Interlock", "falls back to the component description");
  assert.equal(rows[lids.line3].line_label, "EX-101", "falls back to the profile code");
});

test("one urgent line gets its own date and priority while the other lines keep the order requirement", async () => {
  assert.deepEqual(await f.set(), { order_item_id: lids.line1, version: 1 });
  const rows = await f.lines();
  assert.equal(rows[lids.line1].effective_date, day(3));
  assert.equal(rows[lids.line1].effective_priority, "urgent");
  assert.equal(rows[lids.line1].date_source, "line");
  assert.equal(rows[lids.line1].updated_by_name, "Owner Asha");
  assert.equal(rows[lids.line2].effective_date, day(10));
  assert.equal(rows[lids.line2].date_source, "order");
  const order = (await f.db.query("select current_stage, expected_dispatch_date::text d, priority from orders where id=$1", [lids.order])).rows[0];
  assert.deepEqual(order, { current_stage: "extrusion_planned", d: day(10), priority: "normal" }, "parent order is unchanged");
});

test("a line may override only the priority or only the date", async () => {
  await f.set({ required_date: null, priority: "high" });
  let row = (await f.lines())[lids.line1];
  assert.deepEqual([row.effective_date, row.date_source, row.effective_priority, row.priority_source], [day(10), "order", "high", "line"]);
  await f.set({ required_date: day(4), priority: null, expected_version: 1, request_id: lid(5001) });
  row = (await f.lines())[lids.line1];
  assert.deepEqual([row.effective_date, row.date_source, row.effective_priority, row.priority_source], [day(4), "line", "normal", "order"]);
});

test("single-line orders fall back to the order-level production quantity, as the order workspace does", async () => {
  const rows = await f.lines(lids.owner, lids.singleOrder);
  assert.equal(n(rows[lids.singleLine].ordered_kg), 800);
  assert.equal(rows[lids.singleLine].effective_priority, "high");
  assert.equal(n((await f.lines())[lids.line3].ordered_kg), null, "a multi-line order never invents a line quantity");
});

test("progress uses completed output, live planned jobs, uncredited stock and non-returned packing", async () => {
  await f.db.exec(`insert into production_jobs(company_id,order_id,source_line_id,status,planned_quantity_kg,actual_quantity_kg) values
    ('${lids.company}','${lids.order}','${lids.line1}','completed',400,380),
    ('${lids.company}','${lids.order}','${lids.line1}','in_progress',300,120),
    ('${lids.company}','${lids.order}','${lids.line1}','cancelled',999,0);
    insert into order_dealer_stock_fulfillments(company_id,order_item_id,fulfilled_weight_kg,credited_at) values('${lids.company}','${lids.line1}',50,null),('${lids.company}','${lids.line1}',70,now());
    insert into packing_list_items(company_id,dispatch_id,source_line_id,net_weight_kg) values('${lids.company}','${lids.dispatch}','${lids.line1}',200),('${lids.company}','${lids.returned}','${lids.line1}',90);`);
  const row = (await f.lines())[lids.line1];
  assert.deepEqual([n(row.produced_kg), n(row.planned_open_kg), n(row.from_stock_kg), n(row.packed_kg), n(row.dispatched_kg)], [380, 300, 50, 200, 200]);
});

// ---------- Change rules ----------

test("retrying the same request is idempotent; reusing its identity for other details is refused", async () => {
  await f.set();
  assert.deepEqual(await f.set(), { order_item_id: lids.line1, version: 1 });
  assert.equal((await f.db.query("select count(*)::int c from order_line_schedule_events")).rows[0].c, 1);
  await assert.rejects(f.set({ priority: "high" }), /already used for different details/);
});

test("a stale editor cannot overwrite a newer requirement", async () => {
  await f.set();
  await assert.rejects(f.set({ priority: "high", request_id: lid(5001) }), /changed since you opened it/);
  await f.set({ priority: "high", expected_version: 1, request_id: lid(5001) });
  assert.equal((await f.lines())[lids.line1].version, 2);
});

test("clearing an override restores inheritance, keeps the version moving and records both changes", async () => {
  await f.set();
  assert.deepEqual(await f.set({ required_date: null, priority: null, reason: "Customer withdrew urgency", expected_version: 1, request_id: lid(5001) }), { order_item_id: lids.line1, version: 2 });
  const row = (await f.lines())[lids.line1];
  assert.deepEqual([row.effective_date, row.date_source, row.effective_priority, row.version], [day(10), "order", "normal", 2]);
  await assert.rejects(f.set({ expected_version: 0, request_id: lid(5002) }), /changed since you opened it/, "an editor who saw the original version 0 is stale");
  const history = await f.command("schedule.history", { order_item_id: lids.line1 }, lids.viewer);
  assert.equal(history.total_count, 2);
  assert.deepEqual(history.rows.map((r) => [r.previous_priority, r.new_priority, r.reason]), [["urgent", null, "Customer withdrew urgency"], [null, "urgent", "Site needs tracks first"]]);
  assert.equal(history.rows[1].new_required_date, day(3));
});

test("invalid input is refused with a clear reason", async () => {
  await assert.rejects(f.set({ reason: "  " }), /Record why/);
  await assert.rejects(f.set({ reason: "x".repeat(501) }), /Record why/);
  await assert.rejects(f.set({ reason: "bell\u0007" }), /Record why/);
  await assert.rejects(f.set({ priority: "asap" }), /valid priority/);
  await assert.rejects(f.set({ required_date: "31/12/2026" }), /valid required date/);
  await assert.rejects(f.set({ required_date: day(-1) }), /today or a later/);
  await assert.rejects(f.set({ required_date: day(800) }), /two years/);
  await assert.rejects(f.set({ request_id: null }), /request identity, line and version/);
  await assert.rejects(f.set({ required_date: null, priority: null }), /Nothing changed/);
});

test("an already-recorded past date may stay while the priority changes, but cannot be newly chosen", async () => {
  await f.db.exec(`insert into order_line_schedules(order_item_id,company_id,order_id,required_date,priority,version,updated_by,updated_by_name)
    values('${lids.line1}','${lids.company}','${lids.order}','${day(-2)}','normal',1,'${lids.owner}','Owner Asha')`);
  await f.set({ required_date: day(-2), priority: "urgent", expected_version: 1 });
  assert.equal((await f.lines())[lids.line1].effective_priority, "urgent");
  await assert.rejects(f.set({ required_date: day(-1), priority: "urgent", expected_version: 2, request_id: lid(5001) }), /today or a later/);
});

test("delivered, closed, cancelled, deleted and fully supplied lines cannot change", async () => {
  await assert.rejects(f.set({ order_item_id: lids.closedLine }), /delivered, closed or cancelled/);
  await f.db.exec(`update orders set current_stage='cancelled' where id='${lids.order}'`);
  await assert.rejects(f.set(), /delivered, closed or cancelled/);
  await f.db.exec(`update orders set current_stage='extrusion_planned', deleted_at=now() where id='${lids.order}'`);
  await assert.rejects(f.set(), /Order line is unavailable/);
  await f.db.exec(`update orders set deleted_at=null where id='${lids.order}';
    insert into packing_list_items(company_id,dispatch_id,source_line_id,net_weight_kg) values('${lids.company}','${lids.dispatch}','${lids.line1}',950);
    insert into order_dealer_stock_fulfillments(company_id,order_item_id,fulfilled_weight_kg,credited_at) values('${lids.company}','${lids.line1}',50,null);`);
  await assert.rejects(f.set(), /fully packed/);
  await f.db.exec(`update dispatches set delivery_status='returned' where id='${lids.dispatch}'`);
  assert.equal((await f.set()).version, 1, "returned material no longer counts as supplied");
});

// ---------- Queues ----------

test("the production queue lists open lines overdue first, then by priority and date", async () => {
  await f.set({ required_date: day(2), priority: "urgent" });
  const data = await queue();
  assert.deepEqual(data.rows.map((r) => [r.order_number, r.line_label, r.overdue]), [
    ["SO-0002", "Mullion", true],
    ["SO-0001", "Sliding track", false],
    ["SO-0001", "Interlock", false],
    ["SO-0001", "EX-101", false]
  ]);
  assert.equal(data.total_count, 4, "closed, dispatched and foreign orders are excluded");
  assert.equal(n(data.rows[1].remaining_kg), 1000);
  assert.equal(data.rows[3].remaining_kg, null, "unknown quantity stays in the queue instead of counting as done");
});

test("lines fully produced leave the production queue but stay in the dispatch queue until packed", async () => {
  await f.db.exec(`insert into production_jobs(company_id,order_id,source_line_id,status,planned_quantity_kg,actual_quantity_kg) values('${lids.company}','${lids.order}','${lids.line2}','completed',500,505)`);
  assert.ok(!(await queue()).rows.some((r) => r.order_item_id === lids.line2));
  const dispatch = await queue({ scope: "dispatch" });
  assert.equal(n(dispatch.rows.find((r) => r.order_item_id === lids.line2).remaining_kg), 500);
  await f.db.exec(`insert into packing_list_items(company_id,dispatch_id,source_line_id,net_weight_kg) values('${lids.company}','${lids.dispatch}','${lids.line2}',500)`);
  assert.ok(!(await queue({ scope: "dispatch" })).rows.some((r) => r.order_item_id === lids.line2));
});

test("queue filters: overdue, due within three days, and lines with their own requirement", async () => {
  await f.set({ required_date: day(2), priority: "urgent" });
  assert.deepEqual((await queue({ filter: "overdue" })).rows.map((r) => r.order_item_id), [lids.singleLine]);
  assert.deepEqual((await queue({ filter: "due_soon" })).rows.map((r) => r.order_item_id), [lids.line1]);
  assert.deepEqual((await queue({ filter: "line_set" })).rows.map((r) => r.order_item_id), [lids.line1]);
  await assert.rejects(queue({ filter: "everything" }), /Invalid queue request/);
  await assert.rejects(queue({ scope: "billing" }), /Invalid queue request/);
});

test("the queue is paged at 10 rows with the true total", async () => {
  const values = Array.from({ length: 12 }, (_, i) => `('${lid(900 + i)}','${lids.company}','${lids.order}','${lids.profile}','Extra ${String(i).padStart(2, "0")}',null,null,10)`).join(",");
  await f.db.exec(`insert into order_items values ${values}`);
  const first = await queue({ page: 1 });
  assert.equal(first.total_count, 16);
  assert.equal(first.rows.length, 10);
  assert.equal((await queue({ page: 2 })).rows.length, 6);
});

// ---------- Roles and tenancy ----------

test("read-only roles can see requirements but cannot change them", async () => {
  for (const actor of [lids.viewer, lids.production, lids.accountsUser]) {
    assert.equal(Object.keys(await f.lines(actor)).length, 3);
    await assert.rejects(f.set({}, actor), /not permitted/);
  }
  assert.equal((await f.set({}, lids.sales)).version, 1, "sales can record a customer's line requirement");
});

test("dealers, other companies and anonymous callers have no access", async () => {
  await f.set();
  await assert.rejects(f.lines(lids.dealer), /not permitted/);
  await assert.rejects(f.lines(lids.foreign), /Order is unavailable/);
  await assert.rejects(f.set({ request_id: lid(5009) }, lids.foreign), /Order line is unavailable/);
  await assert.rejects(f.command("schedule.history", { order_item_id: lids.line1 }, lids.foreign), /Order line is unavailable/);
  assert.ok(!(await queue({}, lids.foreign)).rows.some((r) => r.order_number !== "FOREIGN-1"));
  for (const actor of [lids.dealer, lids.foreign]) {
    assert.deepEqual(await f.asUser("select * from order_line_schedules", [], actor), []);
    assert.deepEqual(await f.asUser("select * from order_line_schedule_events", [], actor), []);
  }
  await assert.rejects(f.asUser("select public.order_line_schedule_command('schedule.queue','{}'::jsonb)", [], ""), /Authentication required/);
});

test("schedules cannot be written directly, bypassing the audited command", async () => {
  await assert.rejects(f.asUser(`insert into order_line_schedules(order_item_id,company_id,order_id,priority,updated_by,updated_by_name) values('${lids.line2}','${lids.company}','${lids.order}','urgent','${lids.owner}','x')`), /permission denied/);
  await f.set();
  await assert.rejects(f.asUser(`update order_line_schedules set priority='low'`), /permission denied/);
  await assert.rejects(f.asUser(`delete from order_line_schedule_events`), /permission denied/);
  await assert.rejects(f.asUser("select * from private.order_line_requirements($1,null)", [lids.otherCompany]), /permission denied/);
});
