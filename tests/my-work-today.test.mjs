import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadMyWork, MY_WORK_LIMIT, workDateLabel } from "../lib/dashboard/my-work.ts";

const companyId = "10000000-0000-0000-0000-000000000001";
const userId = "20000000-0000-0000-0000-000000000001";
const id = (n) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const context = (role = "production") => ({ companyId, userId, role, dealerId: null, email: "fixture@example.invalid", fullName: "Fixture Operator", companyName: "Fixture factory", department: null, salesRegion: null });
const now = new Date("2026-10-20T20:00:00Z");

function client(reply = () => []) {
  const requests = [];
  const supabase = createClient("http://127.0.0.1:59999", "fixture-only", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      const request = { table: url.pathname.split("/").at(-1), params: url.searchParams };
      requests.push(request);
      const result = await reply(request);
      if (result instanceof Response) return result;
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    } },
  });
  return { supabase, requests };
}

const task = (n, extra = {}) => ({ id: id(n), title: `Task ${n}`, status: "open", priority: "normal", due_date: "2026-10-21", related_entity_type: null, related_entity_id: null, ...extra });

test("every role gets only its permitted department queues", async () => {
  const expected = {
    owner: ["production_jobs", "dispatches", "invoices"], admin: ["production_jobs", "dispatches", "invoices"],
    production_manager: ["production_jobs"], production: ["production_jobs"], factory_manager: ["production_jobs", "dispatches"],
    dispatch_manager: ["dispatches"], dispatch: ["dispatches"], accounts: ["invoices"], sales_manager: ["quotes"], sales: ["quotes"],
    quality: ["quality_inspections"], inventory_manager: ["inventory_items"], viewer: [],
  };
  for (const [role, tables] of Object.entries(expected)) {
    const fixture = client();
    const result = await loadMyWork(fixture.supabase, context(role), {}, now);
    assert.deepEqual(result.departments.map((queue) => queue.key), tables, role);
    assert.deepEqual(fixture.requests.filter((request) => request.table !== "tasks").map((request) => request.table), tables, role);
    for (const { params } of fixture.requests) {
      assert.equal(params.get("company_id"), `eq.${companyId}`);
      assert.equal(params.get("limit"), String(MY_WORK_LIMIT + 1));
      assert.doesNotMatch(params.get("select"), /\*|grand_total|balance_due|order_value|margin|cost|amount_paid/);
    }
  }
});

test("personal assignments include permitted dealership work while unassigned tasks remain factory-scoped", async () => {
  const fixture = client(({ table, params }) => table === "tasks" ? [task(params.get("assigned_to").startsWith("eq.") ? 1 : 2)] : []);
  const result = await loadMyWork(fixture.supabase, context(), {}, now);
  assert.equal(result.assigned.items[0].id, id(1));
  assert.equal(result.unassigned.items[0].id, id(2));
  const reads = fixture.requests.filter((request) => request.table === "tasks");
  assert.equal(reads[0].params.get("assigned_to"), `eq.${userId}`);
  assert.equal(reads[1].params.get("assigned_to"), "is.null");
  for (const { params } of reads) {
    assert.equal(params.get("status"), "in.(open,in_progress)");
    assert.equal(params.get("order"), "due_date.asc.nullslast,created_at.asc,id.asc");
  }
  assert.equal(reads[0].params.get("dealership_id"), null, "include every task assigned to this internal user");
  assert.equal(reads[1].params.get("dealership_id"), "is.null", "do not offer unassigned dealership tasks to the factory");
  assert.equal(reads[0].params.get("or"), null, "personal assignments must not disappear when a linked type is unknown or restricted");
  assert.match(reads[1].params.get("or"), /related_entity_type\.is\.null/);
  assert.doesNotMatch(reads[1].params.get("or"), /invoice|quote|quality|assigned_to/);
});

test("dealer roles and dealer identities cannot call the internal read model", async () => {
  for (const identity of [context("dealer_admin"), context("dealer_staff"), { ...context(), dealerId: id(999) }]) {
    const fixture = client();
    const result = await loadMyWork(fixture.supabase, identity, {}, now);
    assert.equal(fixture.requests.length, 0);
    assert.equal(result.assigned.items.length + result.unassigned.items.length + result.departments.length, 0);
  }
});

test("disabled modules prevent queue queries and exclude related tasks", async () => {
  const fixture = client();
  const result = await loadMyWork(fixture.supabase, context(), { production_planning: false, advanced_inventory: false }, now);
  assert.deepEqual(result.departments, []);
  assert.ok(fixture.requests.every(({ table }) => table === "tasks"));
  for (const { params } of fixture.requests) assert.doesNotMatch(params.get("or") ?? "", /production|inventory/);
});

test("task source links are checked in the current company and recorded holds are visible", async () => {
  const fixture = client(({ table, params }) => {
    if (table === "tasks" && params.get("assigned_to").startsWith("eq.")) return [task(1, { related_entity_type: "production_job", related_entity_id: id(10) })];
    if (table === "production_jobs" && params.has("id")) return [{ id: id(10), status: "on_hold" }];
    return [];
  });
  const result = await loadMyWork(fixture.supabase, context(), {}, now);
  assert.equal(result.assigned.items[0].href, `/production/${id(10)}`);
  assert.equal(result.assigned.items[0].actionLabel, "Open job workflow");
  assert.match(result.assigned.items[0].blocker, /On hold/);
  const sourceRead = fixture.requests.find(({ table, params }) => table === "production_jobs" && params.has("id"));
  assert.equal(sourceRead.params.get("company_id"), `eq.${companyId}`);
  assert.equal(sourceRead.params.get("id"), `in.(${id(10)})`);
  assert.equal(sourceRead.params.get("select"), "id,status");
});

test("a deleted or RLS-invisible source falls back only its own task", async () => {
  const fixture = client(({ table, params }) => {
    if (table === "tasks" && params.get("assigned_to").startsWith("eq.")) return [
      task(1, { related_entity_type: "production_job", related_entity_id: id(10) }),
      task(2, { related_entity_type: "production_job", related_entity_id: id(11) }),
    ];
    return table === "production_jobs" && params.has("id") ? [{ id: id(11), status: "ready" }] : [];
  });
  const { assigned } = await loadMyWork(fixture.supabase, context(), {}, now);
  assert.equal(assigned.items[0].href, `/tasks/${id(1)}`);
  assert.match(assigned.items[0].blocker, /Linked record unavailable/);
  assert.equal(assigned.items[1].href, `/production/${id(11)}`);
  assert.equal(assigned.items[1].blocker, null);
});

test("malformed source identifiers never become navigation paths or source queries", async () => {
  const fixture = client(({ table }) => table === "tasks" ? [task(1, { related_entity_type: "production_job", related_entity_id: "../../invoices/secret?x=1" })] : []);
  const { assigned } = await loadMyWork(fixture.supabase, context(), {}, now);
  assert.equal(assigned.items[0].href, `/tasks/${id(1)}`);
  assert.equal(fixture.requests.filter(({ params }) => params.has("id")).length, 0);
});

test("queue errors and null results remain unknown while other queues still load", async () => {
  for (const failure of [new Response(JSON.stringify({ message: "permission denied" }), { status: 403 }), null]) {
    const fixture = client(({ table, params }) => table === "production_jobs" ? failure : params.get("assigned_to").startsWith("eq.") ? [task(1)] : []);
    const result = await loadMyWork(fixture.supabase, context(), {}, now);
    assert.equal(result.assigned.items.length, 1);
    assert.match(result.departments[0].error, /workload is unknown/);
    assert.equal(result.departments[0].items.length, 0);
  }
});

test("source query failure preserves assigned work and offers the task for review", async () => {
  const fixture = client(({ table, params }) => {
    if (table === "tasks") return [task(1, { related_entity_type: "production_job", related_entity_id: id(10) })];
    if (params.has("id")) return new Response(JSON.stringify({ message: "source denied" }), { status: 403 });
    return [];
  });
  const { assigned } = await loadMyWork(fixture.supabase, context(), {}, now);
  assert.equal(assigned.error, null);
  assert.equal(assigned.items[0].href, `/tasks/${id(1)}`);
  assert.match(assigned.items[0].blocker, /unavailable/);
});

test("queues are bounded at ten without presenting a sample as the total workload", async () => {
  for (const size of [0, 10, 11]) {
    const fixture = client(({ table }) => table === "tasks" ? Array.from({ length: size }, (_, i) => task(i + 1)) : []);
    const { assigned } = await loadMyWork(fixture.supabase, context(), {}, now);
    assert.equal(assigned.items.length, Math.min(size, 10));
    assert.equal(assigned.hasMore, size > 10);
  }
});

test("department reads exclude inactive jobs, unissued invoices and inactive stock", async () => {
  const owner = client();
  await loadMyWork(owner.supabase, context("owner"), {}, now);
  const production = owner.requests.find(({ table }) => table === "production_jobs").params;
  assert.equal(production.get("is_active"), "eq.true");
  assert.equal(production.get("status"), "in.(planned,ready,in_progress,on_hold)");
  const invoice = owner.requests.find(({ table }) => table === "invoices").params;
  assert.equal(invoice.get("balance_due"), "gt.0");
  assert.equal(invoice.get("deleted_at"), "is.null");
  assert.equal(invoice.get("status"), "in.(generated,sent,partially_paid,overdue)");
  const stock = client();
  await loadMyWork(stock.supabase, context("inventory_manager"), {}, now);
  assert.equal(stock.requests.find(({ table }) => table === "inventory_items").params.get("current_stock"), "lte.0");
});

test("the business day follows India across the UTC date boundary", async () => {
  const fixture = client();
  const result = await loadMyWork(fixture.supabase, context(), {}, now);
  assert.equal(result.today, "2026-10-21");
  assert.equal(workDateLabel({ date: "2026-10-21", dateLabel: "Due" }, result.today), "Due today");
  assert.match(workDateLabel({ date: "2026-10-20", dateLabel: "Due" }, result.today), /^Overdue/);
  assert.match(workDateLabel({ date: "2026-10-22", dateLabel: "Due" }, result.today), /^Due /);
  assert.match(workDateLabel({ date: "2026-10-20", dateLabel: "Planned" }, result.today), /^Planned /);
});

test("missing and impossible dates are not turned into fabricated deadlines", () => {
  for (const date of [null, "", "bad-date", "2026-02-30", "2026-13-01", "2026-10-20T10:00:00Z"]) {
    assert.equal(workDateLabel({ date, dateLabel: "Due" }, "2026-10-21"), "Date not captured");
  }
  assert.equal(workDateLabel({ date: null, dateLabel: "" }, "2026-10-21"), null);
  assert.match(workDateLabel({ date: "2028-02-29", dateLabel: "Due" }, "2026-10-21"), /29 Feb 2028/);
});

test("fresh requests do not share assignments or stale source state across users", async () => {
  const fixture = client(({ table, params }) => table === "tasks" && params.get("assigned_to").startsWith("eq.") ? [task(params.get("assigned_to").endsWith(userId) ? 1 : 2)] : []);
  const first = await loadMyWork(fixture.supabase, context(), {}, now);
  const second = await loadMyWork(fixture.supabase, { ...context(), userId: id(777) }, {}, now);
  assert.equal(first.assigned.items[0].id, id(1));
  assert.equal(second.assigned.items[0].id, id(2));
  assert.notEqual(first.assigned, second.assigned);
});
