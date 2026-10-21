import test from "node:test";
import assert from "node:assert/strict";
import { createOperatorWorkflowFixture, workflowIds as ids, workflowId as id } from "../scripts/lib/operator-workflow-fixture.mjs";
import { canUseOperatorCommand, operatorCommandSchema, parseOperatorData } from "../lib/operations/operator-workflows.ts";

let f;
test.before(async () => { f = await createOperatorWorkflowFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });
const alias = extra => ({ customer_id: ids.customer, profile_code: "AL-101", alias: "Sliding 45", request_id: id(100), ...extra });
const commitment = extra => ({ customer_id: ids.customer, title: "Send the revised sample", due_date: "2026-10-23", request_id: id(200), ...extra });

test("the full additive migration installs pinned RPC, RLS, bounded reads and denied direct writes", async () => {
  const policies = (await f.db.query("select tablename from pg_policies where tablename in ('customer_profile_aliases','operator_location_history','production_exceptions','customer_commitments','customer_commitment_events')")).rows;
  assert.equal(policies.length, 5);
  await assert.rejects(f.asUser("insert into customer_commitments(id) values($1)", [id(200)]), /permission denied/);
  await assert.rejects(f.command("aliases.list", { customer_id: ids.customer }, { sqlRole: "anon" }), /permission denied/);
  const fn = (await f.db.query("select prosecdef,proconfig from pg_proc where oid='public.operator_workflow_command(text,jsonb)'::regprocedure")).rows[0];
  assert.equal(fn.prosecdef, true); assert.ok(fn.proconfig.includes("search_path=public, private"));
});

test("customer aliases resolve exact names in customer scope and preserve ambiguity for explicit choice", async () => {
  await f.command("aliases.create", alias());
  await f.command("aliases.create", alias({ profile_code: "AL-202", request_id: id(101) }));
  const result = parseOperatorData(await f.command("aliases.search", { customer_id: ids.customer, search: "sliding 45" }));
  assert.equal(result.profiles.length, 2); assert.deepEqual(result.profiles.map(row => row.profile_code), ["AL-101", "AL-202"]);
  assert.deepEqual((await f.command("aliases.search", { customer_id: ids.customer, search: "Sliding" })).profiles, []);
  assert.deepEqual((await f.command("aliases.search", { customer_id: ids.otherCustomer, search: "Sliding 45" }, { actor: ids.otherActor })).profiles, []);
  await assert.rejects(f.command("aliases.search", { customer_id: ids.otherCustomer, search: "Sliding 45" }), /unavailable/);
});

test("alias retries create one mapping, reject changed identity, and deactivation preserves history", async () => {
  assert.deepEqual(await f.command("aliases.create", alias()), await f.command("aliases.create", alias()));
  assert.equal((await f.db.query("select count(*)::int n from customer_profile_aliases")).rows[0].n, 1);
  await assert.rejects(f.command("aliases.create", alias({ alias: "Different" })), /identity/);
  await f.command("aliases.deactivate", { customer_id: ids.customer, alias_id: id(100) });
  assert.deepEqual((await f.command("aliases.search", { customer_id: ids.customer, search: "Sliding 45" })).profiles, []);
  const history = await f.command("aliases.list", { customer_id: ids.customer, page: 1 });
  assert.equal(history.rows[0].is_active, false); assert.ok(history.rows[0].deactivated_at);
});

test("unapproved company references, inactive sources, tenant injection and ineligible roles fail closed", async () => {
  await assert.rejects(f.command("aliases.create", alias({ profile_code: "FOREIGN" })), /canonical profile/);
  await f.db.query("update aluminium_profiles set is_active=false where id=$1", [ids.profile]);
  await assert.rejects(f.command("aliases.create", alias()), /canonical profile/);
  for (const role of ["production", "dispatch", "dealer_admin", "dealer_staff", "accounts", "viewer"]) await assert.rejects(f.command("aliases.create", alias(), { role }), /not permitted/);
  assert.equal(operatorCommandSchema.safeParse({ command: "aliases.create", ...alias(), company_id: ids.otherCompany }).success, false);
  assert.equal(operatorCommandSchema.safeParse({ command: "commitments.create", ...commitment({ due_date: "2026-02-30" }) }).success, false);
});

test("location moves retain old locations, source stock, request identity and subsequent picking guidance", async () => {
  const move = { entity_type: "inventory_item", entity_id: ids.item, expected_location: "Shed B / Rack 4", location: "Shed C / Rack 2 / Level 1", reason: "Moved for dispatch picking", request_id: id(300) };
  await f.command("locations.move", move); await f.command("locations.move", move);
  const result = await f.command("locations.load", { entity_type: "inventory_item", entity_id: ids.item });
  assert.equal(result.current_location, move.location); assert.equal(result.total_count, 1); assert.equal(result.rows[0].previous_location, move.expected_location);
  assert.equal((await f.db.query("select current_stock from inventory_items where id=$1", [ids.item])).rows[0].current_stock, "420");
  await assert.rejects(f.command("locations.move", { ...move, location: "Other rack", request_id: id(301) }), /location changed/);
  const dieMove = { entity_type: "die", entity_id: ids.die, expected_location: "Shed A / Rack 1", location: "Die room / Rack 7", reason: "Returned from press", request_id: id(302) };
  await f.command("locations.move", dieMove, { role: "production_manager" });
  assert.equal((await f.db.query("select rack_location from dies where id=$1", [ids.die])).rows[0].rack_location, dieMove.location);
  await assert.rejects(f.command("locations.move", dieMove, { role: "production" }), /not permitted/);
});

test("ordinary location edits are also recorded and an unknown new location stays unknown", async () => {
  await f.db.query("update inventory_items set location=null where id=$1", [ids.item]);
  const result = await f.command("locations.load", { entity_type: "inventory_item", entity_id: ids.item });
  assert.equal(result.current_location, null); assert.equal(result.rows[0].previous_location, "Shed B / Rack 4"); assert.equal(result.rows[0].location, null);
  await assert.rejects(f.asUser("update operator_location_history set reason='Erased'"), /permission denied/);
});

test("production exception capture derives context and reporter without inventing a measurement or changing job state", async () => {
  const report = { job_id: ids.job, reason: "material_shortage", note: "Required source was not at the rack", request_id: id(400) };
  await f.command("exceptions.report", report, { role: "production" }); await f.command("exceptions.report", report, { role: "production" });
  const row = (await f.db.query("select * from production_exceptions")).rows[0];
  assert.equal(row.company_id, ids.company); assert.equal(row.recorded_by, ids.actor); assert.equal(row.machine_id, ids.machine); assert.equal(row.order_id, ids.order); assert.equal(row.operator_name, "Recorded operator");
  assert.equal(row.reporter_name, "Mira Sales"); assert.ok(row.recorded_at);
  assert.equal((await f.db.query("select status from production_jobs where id=$1", [ids.job])).rows[0].status, "in_progress");
  await assert.rejects(f.command("exceptions.report", { ...report, job_id: ids.otherJob, request_id: id(401) }), /unavailable/);
  await assert.rejects(f.command("exceptions.report", { ...report, reason: "other", note: "", request_id: id(402) }), /explain/);
  await assert.rejects(f.command("exceptions.report", report, { role: "viewer" }), /not permitted/);
});

test("commitment rescheduling preserves original deadline, accountable actor and event reason", async () => {
  await f.command("commitments.create", commitment()); await f.command("commitments.create", commitment());
  const request = { customer_id: ids.customer, commitment_id: id(200), expected_due_date: "2026-10-23", due_date: "2026-10-25", reason: "Customer requested a site trial first", request_id: id(201) };
  await f.command("commitments.reschedule", request); await f.command("commitments.reschedule", request);
  const list = await f.command("commitments.list", { customer_id: ids.customer });
  assert.equal(list.total_count, 1); assert.equal(list.rows[0].original_due_date, "2026-10-23"); assert.equal(list.rows[0].due_date, "2026-10-25"); assert.equal(list.rows[0].responsible_name, "Mira Sales");
  const history = await f.command("commitments.history", { customer_id: ids.customer, commitment_id: id(200) });
  assert.equal(history.total_count, 1); assert.equal(history.rows[0].note, request.reason);
  await assert.rejects(f.command("commitments.reschedule", { ...request, request_id: id(202) }), /due date changed/);
  await assert.rejects(f.command("commitments.reschedule", { ...request, reason: "", request_id: id(202) }), /reason or outcome/);
});

test("closing commitments requires an outcome, removes them from open work and preserves closure history", async () => {
  await f.command("commitments.create", commitment());
  const close = { customer_id: ids.customer, commitment_id: id(200), status: "completed", outcome: "Revised sample handed to customer", request_id: id(203) };
  await f.command("commitments.close", close); await f.command("commitments.close", close);
  assert.equal((await f.command("commitments.list", { customer_id: ids.customer })).total_count, 0);
  const closed = await f.command("commitments.list", { customer_id: ids.customer, status: "completed" });
  assert.equal(closed.rows[0].outcome, close.outcome); assert.ok(closed.rows[0].closed_at);
  await assert.rejects(f.command("commitments.reschedule", { customer_id: ids.customer, commitment_id: id(200), due_date: "2026-10-25", expected_due_date: "2026-10-23", reason: "Later", request_id: id(204) }), /already closed/);
});

test("workflow tables enforce actual authenticated RLS and retain immutable history", async () => {
  await f.command("aliases.create", alias()); await f.command("commitments.create", commitment());
  for (const table of ["customer_profile_aliases", "customer_commitments", "customer_commitment_events", "production_exceptions", "operator_location_history"]) {
    assert.deepEqual(await f.asUser(`select * from ${table}`, [], { actor: ids.otherActor }), []);
    await assert.rejects(f.asUser(`delete from ${table}`), /permission denied/);
  }
  assert.deepEqual(await f.asUser("select * from customer_commitments", [], { role: "dealer_admin" }), []);
  await f.db.query("update app_users set is_active=false where id=$1", [ids.actor]);
  await assert.rejects(f.command("commitments.list", { customer_id: ids.customer }), /Authentication required/);
});

test("every role in the server permission map agrees with SQL command eligibility", async () => {
  const roles = ["owner", "admin", "sales", "sales_manager", "factory_manager", "production_manager", "production", "inventory_manager", "dispatch_manager", "dispatch", "dealer_admin", "dealer_staff", "accounts", "quality", "viewer"];
  for (const role of roles) for (const command of ["aliases.list", "aliases.create", "exceptions.list", "exceptions.report", "commitments.list", "commitments.queue", "commitments.create", "locations.load", "locations.move"]) for (const entity of command.startsWith("locations") ? ["die", "inventory_item"] : [null]) {
    const sql = (await f.db.query("select private.operator_workflow_allowed($1,$2,$3) allowed", [role, command, entity])).rows[0].allowed;
    assert.equal(sql, canUseOperatorCommand(role, command, entity), `${role} ${command} ${entity}`);
  }
});

test("read commands work inside a read-only transaction without locking source rows", async () => {
  await f.db.exec("begin;set transaction read only");
  try {
    await f.db.query("select set_config('test.actor',$1,true)", [ids.actor]); await f.db.exec("set local role authenticated");
    for (const [command, payload] of [["aliases.list", { customer_id: ids.customer }], ["commitments.list", { customer_id: ids.customer }], ["commitments.queue", {}], ["exceptions.list", { job_id: ids.job }], ["locations.load", { entity_type: "die", entity_id: ids.die }]]) {
      const result = (await f.db.query("select operator_workflow_command($1,$2) data", [command, payload])).rows[0].data;
      assert.doesNotThrow(() => parseOperatorData(result, command));
    }
  } finally { await f.db.exec("rollback"); }
});

test("dealer-linked identities remain excluded even if an internal role was incorrectly assigned", async () => {
  await f.command("commitments.create", commitment());
  await f.db.query("update app_users set dealer_id=$1 where id=$2", [id(900), ids.actor]);
  assert.deepEqual(await f.asUser("select * from customer_commitments"), []);
  await assert.rejects(f.command("commitments.list", { customer_id: ids.customer }), /not permitted/);
});

test("alias and commitment pagination reaches later records with ten rows and complete counts", async () => {
  for (let n = 0; n < 23; n++) {
    await f.command("aliases.create", alias({ alias: `Local ${n}`, request_id: id(1000 + n) }));
    await f.command("commitments.create", commitment({ title: `Promise ${n}`, request_id: id(2000 + n) }));
  }
  for (const command of ["aliases.list", "commitments.list"]) {
    const identities = [];
    for (let page = 1; page <= 3; page++) { const result = parseOperatorData(await f.command(command, { customer_id: ids.customer, page }), command); assert.equal(result.total_count, 23); assert.equal(result.rows.length, page === 3 ? 3 : 10); identities.push(...result.rows.map(row => row.id)); }
    assert.equal(new Set(identities).size, 23);
  }
});

test("response validation rejects missing counts, hidden payloads, duplicate rows and absent confirmations", () => {
  assert.throws(() => parseOperatorData({}, "commitments.list"));
  assert.throws(() => parseOperatorData({ rows: [{ id: id(1) }] }, "aliases.list"));
  assert.throws(() => parseOperatorData({ rows: [{ id: id(1), company_id: ids.otherCompany }], total_count: 1 }, "aliases.list"));
  assert.throws(() => parseOperatorData({ rows: [{ id: id(1) }, { id: id(1) }], total_count: 2 }, "exceptions.list"));
  assert.throws(() => parseOperatorData({}, "exceptions.report"));
});

test("the commitment queue defaults to the current employee and keeps search and deep links in company scope", async () => {
  await f.command("commitments.create", commitment());
  await f.command("commitments.create", commitment({ title: "Colleague sample", request_id: id(201) }), { actor: ids.colleague, role: "sales" });
  const mine = parseOperatorData(await f.command("commitments.queue", {}), "commitments.queue");
  assert.equal(mine.total_count, 1); assert.equal(mine.rows[0].responsible_name, "Mira Sales");
  const all = await f.command("commitments.queue", { scope: "all", search: "Colleague" });
  assert.equal(all.total_count, 1); assert.equal(all.rows[0].customer_id, ids.customer);
  const focused = await f.command("commitments.list", { customer_id: ids.customer, status: "all", commitment_id: id(201) });
  assert.equal(focused.total_count, 1); assert.equal(focused.rows[0].title, "Colleague sample");
  assert.equal((await f.command("commitments.queue", { scope: "all" }, { actor: ids.otherActor })).total_count, 0);
  await assert.rejects(f.command("commitments.queue", { scope: "foreign" }), /Invalid commitment queue/);
});

test("inactivating a customer retains existing promises and permits a recorded closure without new promises", async () => {
  await f.command("commitments.create", commitment());
  await f.db.query("update customers set is_active=false,deleted_at=now() where id=$1", [ids.customer]);
  const queue = await f.command("commitments.queue", {}); assert.equal(queue.total_count, 1); assert.equal(queue.rows[0].customer_available, false);
  await assert.rejects(f.command("commitments.create", commitment({ request_id: id(209) })), /inactive/);
  await f.command("commitments.close", { customer_id: ids.customer, commitment_id: id(200), status: "cancelled", outcome: "Customer record retired; promise cancelled with customer", request_id: id(210) });
  assert.equal((await f.command("commitments.queue", {})).total_count, 0);
  assert.equal((await f.command("commitments.queue", { status: "cancelled" })).total_count, 1);
});

test("a permitted employee cannot inspect or move another company's actual die or stock location", async () => {
  for (const [entity_type, entity_id, previous] of [["die", ids.otherDie, "FOREIGN DIE RACK"], ["inventory_item", ids.otherItem, "FOREIGN STOCK RACK"]]) {
    await assert.rejects(f.command("locations.load", { entity_type, entity_id }), /unavailable for this company/);
    await assert.rejects(f.command("locations.move", { entity_type, entity_id, expected_location: previous, location: "Attacker rack", reason: "Forbidden change", request_id: id(entity_type === "die" ? 3000 : 3001) }), /unavailable for this company/);
  }
  assert.equal((await f.db.query("select rack_location from dies where id=$1", [ids.otherDie])).rows[0].rack_location, "FOREIGN DIE RACK");
  assert.equal((await f.db.query("select location from inventory_items where id=$1", [ids.otherItem])).rows[0].location, "FOREIGN STOCK RACK");
  assert.equal((await f.db.query("select count(*)::int n from operator_location_history")).rows[0].n, 0);
});
