import test from "node:test";
import assert from "node:assert/strict";
import { createCustomerProjectFixture, pids, pid } from "../scripts/lib/customer-project-fixture.mjs";

let f;
test.before(async () => { f = await createCustomerProjectFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

const n = (value) => (value === null || value === undefined ? value : Number(value));
const load = (actor) => f.command("project.load", { project_id: pid(5000) }, actor);

// ---------- Creating projects ----------

test("creating a project assigns a sequential code and normalises the phone number", async () => {
  assert.deepEqual(await f.create(), { id: pid(5000), project_code: "PRJ-0001" });
  const second = await f.create({ request_id: pid(5001), name: "Tower C" });
  assert.equal(second.project_code, "PRJ-0002");
  const row = (await f.db.query("select contact_phone, created_by, status, version from customer_projects where id=$1", [pid(5000)])).rows[0];
  assert.deepEqual(row, { contact_phone: "+919820012345", created_by: pids.owner, status: "active", version: 1 });
});

test("a retried create returns the same project; reuse of its identity for another project is refused", async () => {
  await f.create();
  assert.deepEqual(await f.create(), { id: pid(5000), project_code: "PRJ-0001" });
  await assert.rejects(f.create({ name: "Something else" }), /already used for different details/);
});

test("one customer cannot have two projects with the same name; another customer can", async () => {
  await f.create();
  await assert.rejects(f.create({ request_id: pid(5001), name: "  lodha altamount tower b " }), /already has a project with that name/);
  assert.equal((await f.create({ request_id: pid(5002), customer_id: pids.mehta })).project_code, "PRJ-0002");
});

test("field rules: name length, PIN code, Indian mobile, active same-company customer", async () => {
  await assert.rejects(f.create({ name: "X" }), /project name of 2 to 120/);
  await assert.rejects(f.create({ pincode: "012345" }), /6-digit PIN/);
  await assert.rejects(f.create({ contact_phone: "12345" }), /Indian mobile/);
  await assert.rejects(f.create({ contact_phone: "+1 415 555 0100" }), /Indian mobile/);
  await assert.rejects(f.create({ site_name: "x".repeat(121) }), /Check the site name field/);
  await assert.rejects(f.create({ customer_id: pids.inactiveCustomer }), /active customer/);
  await assert.rejects(f.create({ customer_id: pids.foreignCustomer }), /active customer/);
});

test("updates require the current version and keep name uniqueness", async () => {
  await f.create();
  await f.create({ request_id: pid(5001), name: "Tower C" });
  const base = { project_id: pid(5000), name: "Lodha Altamount Tower B", status: "on_hold", expected_version: 1 };
  assert.deepEqual(await f.command("project.update", base), { id: pid(5000), version: 2 });
  await assert.rejects(f.command("project.update", base), /changed since you opened it/);
  await assert.rejects(f.command("project.update", { ...base, name: "Tower C", expected_version: 2 }), /already has a project with that name/);
  await assert.rejects(f.command("project.update", { ...base, status: "archived", expected_version: 2 }), /valid project status/);
});

// ---------- Linking ----------

test("linking an order with related records also groups its quotation and dispatches, reporting each outcome", async () => {
  await f.create();
  const { results } = await f.link("order", pids.order, { include_related: true });
  const outcome = Object.fromEntries(results.map((r) => [r.entity_id, r.outcome]));
  assert.deepEqual(outcome, { [pids.order]: "linked", [pids.quote]: "linked", [pids.dispatch]: "linked", [pids.dispatch2]: "linked", [pids.returned]: "linked" });
  const again = await f.link("order", pids.order, { include_related: true });
  assert.ok(again.results.every((r) => r.outcome === "already_linked"), "relinking is a no-op");
});

test("records of another customer or company can never be linked", async () => {
  await f.create();
  await assert.rejects(f.link("quote", pids.mehtaQuote), /this project's customer/);
  await assert.rejects(f.link("dispatch", pids.mehtaDispatch), /this project's customer/);
  await assert.rejects(f.link("order", pids.foreignOrder), /selected record is unavailable/);
  await assert.rejects(f.link("quote", pids.deletedQuote), /selected record is unavailable/);
  await assert.rejects(f.link("invoice", pids.order), /quotation, order or dispatch/);
});

test("a record belongs to at most one project; related records already elsewhere are skipped, not moved", async () => {
  await f.create();
  await f.create({ request_id: pid(5001), name: "Tower C" });
  await f.command("project.link", { project_id: pid(5001), entity_type: "dispatch", entity_id: pids.dispatch2 });
  const { results } = await f.link("order", pids.order, { include_related: true });
  assert.equal(results.find((r) => r.entity_id === pids.dispatch2).outcome, "other_project");
  await assert.rejects(f.link("dispatch", pids.dispatch2), /already grouped under another project/);
  const owner = (await f.db.query("select project_id from customer_project_links where entity_id=$1", [pids.dispatch2])).rows[0].project_id;
  assert.equal(owner, pid(5001));
});

test("an order whose source quotation belongs to another customer skips that quotation", async () => {
  await f.create({ customer_id: pids.mehta, name: "Mehta showroom" });
  const { results } = await f.link("order", pids.mehtaOrder, { include_related: true });
  assert.deepEqual(results.map((r) => [r.entity_type, r.outcome]).sort(), [["dispatch", "linked"], ["order", "linked"], ["quote", "other_customer"]]);
});

test("completed or cancelled projects accept no new links until reopened", async () => {
  await f.create();
  await f.command("project.update", { project_id: pid(5000), name: "Lodha Altamount Tower B", status: "completed", expected_version: 1 });
  await assert.rejects(f.link("order", pids.order2), /Reopen the project/);
});

test("unlinking needs a reason, is recorded, and frees the record for another project", async () => {
  await f.create();
  await f.link("order", pids.order2);
  await assert.rejects(f.command("project.unlink", { project_id: pid(5000), entity_type: "order", entity_id: pids.order2, reason: " " }), /Record why/);
  await f.command("project.unlink", { project_id: pid(5000), entity_type: "order", entity_id: pids.order2, reason: "Linked to the wrong tower" });
  await assert.rejects(f.command("project.unlink", { project_id: pid(5000), entity_type: "order", entity_id: pids.order2, reason: "again" }), /not linked to this project/);
  const history = (await load()).history;
  assert.deepEqual(history.map((h) => [h.action, h.reason]), [["unlinked", "Linked to the wrong tower"], ["linked", null]]);
});

// ---------- Project view and totals ----------

test("project totals use the stated definitions: non-cancelled orders, dispatches that left and were not returned", async () => {
  await f.create();
  await f.link("order", pids.order, { include_related: true });
  await f.link("order", pids.order2);
  await f.link("order", pids.cancelledOrder);
  await f.link("quote", pids.quote2);
  const data = await load();
  assert.equal(data.orders.length, 3, "cancelled orders stay listed for traceability");
  assert.deepEqual({ ...data.totals, ordered_kg: n(data.totals.ordered_kg), order_value: n(data.totals.order_value), dispatched_kg: n(data.totals.dispatched_kg), delivered_kg: n(data.totals.delivered_kg) },
    { order_count: 2, ordered_kg: 2000, order_value: 188000, dispatched_kg: 600, delivered_kg: 600, open_quote_count: 1 });
  assert.equal(data.project.customer_name, "Kumar Facades");
  assert.equal(data.project.company_id, undefined, "internal tenancy fields are not returned");
});

test("roles without commercial visibility see quantities but no values", async () => {
  await f.create();
  await f.link("order", pids.order, { include_related: true });
  const viewer = await load(pids.viewer);
  assert.equal(viewer.can_see_values, false);
  assert.equal(viewer.totals.order_value, null);
  assert.ok(viewer.orders.every((o) => o.value === null) && viewer.quotes.every((q) => q.value === null));
  assert.equal(n(viewer.totals.ordered_kg), 1200);
  const accounts = await load(pids.accountsUser);
  assert.equal(n(accounts.totals.order_value), 118000);
});

// ---------- Search and candidates ----------

test("search matches code, name, site, city and customer literally; a similar site under another customer is not linked work", async () => {
  await f.create();
  await f.create({ request_id: pid(5001), customer_id: pids.mehta, name: "Altamount Road showroom", site_name: "Altamount Road" });
  await f.link("order", pids.order);
  const all = await f.command("project.list", { search: "altamount" });
  assert.equal(all.total_count, 2);
  const kumarOnly = await f.command("project.list", { search: "kumar" });
  assert.deepEqual(kumarOnly.rows.map((r) => [r.project_code, Number(r.order_count)]), [["PRJ-0001", 1]]);
  const mehta = (await f.command("project.load", { project_id: pid(5001) })).orders;
  assert.deepEqual(mehta, [], "a similar site name never pulls in another customer's orders");
  assert.equal((await f.command("project.list", { search: "%" })).total_count, 0, "pattern characters are literal");
  assert.equal((await f.command("project.list", { search: "prj-0002" })).rows[0].name, "Altamount Road showroom");
  await assert.rejects(f.command("project.list", { search: "x".repeat(81) }), /Invalid project search/);
});

test("list filters by status and customer, and pages at 10 rows", async () => {
  for (let i = 0; i < 12; i++) await f.create({ request_id: pid(6000 + i), name: `Site ${i}` });
  await f.command("project.update", { project_id: pid(6000), name: "Site 0", status: "completed", expected_version: 1 });
  assert.equal((await f.command("project.list", { page: 1 })).rows.length, 10);
  assert.equal((await f.command("project.list", { page: 2 })).rows.length, 2);
  assert.equal((await f.command("project.list", { status: "completed" })).total_count, 1);
  assert.equal((await f.command("project.list", { customer_id: pids.mehta })).total_count, 0);
});

test("link candidates list only unlinked records of the project's customer", async () => {
  await f.create();
  await f.link("order", pids.order);
  const orders = (await f.command("project.candidates", { project_id: pid(5000), entity_type: "order" })).rows.map((r) => r.number);
  assert.deepEqual(orders.sort(), ["SO-0002", "SO-0004"]);
  const quotes = (await f.command("project.candidates", { project_id: pid(5000), entity_type: "quote", search: "0002" })).rows.map((r) => r.number);
  assert.deepEqual(quotes, ["QT-0002"]);
  const dispatches = (await f.command("project.candidates", { project_id: pid(5000), entity_type: "dispatch" })).rows.map((r) => r.number).sort();
  assert.deepEqual(dispatches, ["DSP-0001", "DSP-0002", "DSP-0004"], "Mehta's dispatch is never offered");
});

// ---------- Roles and tenancy ----------

test("read-only roles can view; dealers, quality, press staff and other companies cannot", async () => {
  await f.create();
  for (const actor of [pids.viewer, pids.accountsUser]) {
    assert.equal((await f.command("project.list", {}, actor)).total_count, 1);
    await assert.rejects(f.link("order", pids.order2, {}, actor), /not permitted/);
    await assert.rejects(f.create({ request_id: pid(5009) }, actor), /not permitted/);
  }
  for (const actor of [pids.dealer, pids.quality, pids.production]) await assert.rejects(f.command("project.list", {}, actor), /not permitted/);
  assert.equal((await f.command("project.list", {}, pids.foreign)).total_count, 0);
  await assert.rejects(load(pids.foreign), /Project is unavailable/);
  await assert.rejects(f.link("order", pids.foreignOrder, {}, pids.foreign), /Project is unavailable/);
  for (const actor of [pids.dealer, pids.foreign]) assert.deepEqual(await f.asUser("select id from customer_projects", [], actor), []);
});

test("direct writes and anonymous calls are refused", async () => {
  await f.create();
  await assert.rejects(f.asUser(`insert into customer_project_links(company_id,project_id,entity_type,entity_id,linked_by,linked_by_name) values('${pids.company}','${pid(5000)}','order','${pids.mehtaOrder}','${pids.owner}','x')`), /permission denied/);
  await assert.rejects(f.asUser(`update customer_projects set customer_id='${pids.mehta}'`), /permission denied/);
  await assert.rejects(f.asUser("select public.customer_project_command('project.list','{}'::jsonb)", [], ""), /Authentication required/);
  await assert.rejects(f.asUser("select private.project_entity_customer($1,'order',$2)", [pids.otherCompany, pids.foreignOrder]), /permission denied/);
});
