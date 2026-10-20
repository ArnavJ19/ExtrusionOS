import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
let fixture;

function query(table) {
  const call = { table, filters: [], head: false };
  fixture.calls.push(call);
  return {
    select(columns, options = {}) { call.columns = columns; call.head = Boolean(options.head); return this; },
    eq(column, value) { call.filters.push([column, value]); return this; },
    in(column, values) { call.inFilter = [column, values]; return this; },
    order(column, options) { call.sort = [column, options]; return this; },
    limit(value) { call.limit = value; return this; },
    then(resolve, reject) {
      let error = fixture.errors[table];
      if (["quotes", "orders"].includes(table)) error = { message: `permission denied for table ${table}` };
      let rows = fixture.tables[table] ?? [];
      rows = rows.filter(row => call.filters.every(([column, value]) => row[column] === value));
      if (call.inFilter) rows = rows.filter(row => call.inFilter[1].includes(row[call.inFilter[0]]));
      const count = rows.length;
      if (call.limit) rows = rows.slice(0, call.limit);
      return Promise.resolve({ data: error || call.head ? null : rows, count: error ? null : count, error }).then(resolve, reject);
    }
  };
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "react" && parent?.filename.replaceAll("\\", "/").endsWith("/module-overview-client.tsx")) {
    return {
      useMemo: make => make(),
      useState(initial) {
        const index = fixture.state.length;
        fixture.state.push(initial);
        return [initial, value => { fixture.state[index] = value; }];
      },
      useEffect: run => { fixture.effects.push(run); }
    };
  }
  if (request === "@/lib/supabase/browser") return { createClient: () => ({ from: query }) };
  if (request === "sonner") return { toast: { error: message => fixture.toasts.push(message) } };
  return originalLoad(request, parent, isMain);
};
let ModuleOverviewClient;
try {
  ({ ModuleOverviewClient } = require("../components/modules/operations/module-overview-client.tsx"));
} finally {
  Module._load = originalLoad;
}

test.beforeEach(() => {
  fixture = {
    calls: [], state: [], effects: [], toasts: [], errors: {},
    tables: {
      quotes_authorized: [
        { id: "quote-a", company_id: "company-a", customer_id: "customer-a", status: "draft", quote_number: "Q-001", grand_total: 12500 },
        { id: "quote-b", company_id: "company-a", customer_id: "customer-b", status: "sent", quote_number: "Q-002", grand_total: null },
        { id: "foreign-quote", company_id: "company-b", customer_id: "foreign-customer", status: "draft", quote_number: "FOREIGN", grand_total: 90000 }
      ],
      customers: [
        { id: "customer-a", company_id: "company-a", customer_name: "First customer", company_name: "First company" },
        { id: "customer-b", company_id: "company-a", customer_name: "Second customer", company_name: "Second company" },
        { id: "foreign-customer", company_id: "company-b", customer_name: "Foreign customer", company_name: "Foreign company" }
      ],
      orders_authorized: [
        { id: "order-a", company_id: "company-a", current_stage: "order_confirmed", order_value: null }
      ]
    }
  };
});

async function mount(moduleKey = "quotes") {
  ModuleOverviewClient({ moduleKey, context: { companyId: "company-a", role: "owner" }, canCreate: true });
  for (const effect of fixture.effects) effect();
  await setImmediate();
  return { groups: fixture.state[0], count: fixture.state[1], loading: fixture.state[2], error: fixture.state[3] };
}

test("opening Quotes loads its board and count while direct quote-table reads are denied", async () => {
  const result = await mount();
  assert.equal(result.error, null);
  assert.equal(result.loading, false);
  assert.equal(result.count, 2);
  assert.deepEqual(fixture.toasts, []);
  assert.ok(fixture.calls.some(call => call.table === "quotes_authorized" && call.head));
  assert.ok(fixture.calls.every(call => call.table !== "quotes"));
  assert.deepEqual(result.groups.flatMap(group => group.rows.map(row => row.id)).sort(), ["quote-a", "quote-b"]);
  for (const call of fixture.calls) assert.ok(call.filters.some(([key, value]) => key === "company_id" && value === "company-a"));
});

test("quote cards retain customer names and masked values without requesting internal costing fields", async () => {
  const { groups } = await mount();
  const rows = groups.flatMap(group => group.rows);
  assert.equal(rows.find(row => row.id === "quote-a")?.customers?.company_name, "First company");
  assert.equal(rows.find(row => row.id === "quote-b")?.grand_total, null);
  const customerReads = fixture.calls.filter(call => call.table === "customers");
  assert.equal(customerReads.length, 1);
  assert.deepEqual(customerReads[0].inFilter, ["id", ["customer-a", "customer-b"]]);
  for (const call of fixture.calls.filter(call => call.table === "quotes_authorized")) {
    assert.doesNotMatch(call.columns, /\*|margin|profit|approval_notes|customers\(/);
  }
});

test("an empty quote board succeeds without an empty or unbounded customer lookup", async () => {
  fixture.tables.quotes_authorized = [];
  const result = await mount();
  assert.equal(result.error, null);
  assert.equal(result.count, 0);
  assert.equal(result.loading, false);
  assert.ok(result.groups.every(group => group.count === 0 && group.rows.length === 0));
  assert.ok(fixture.calls.every(call => call.table !== "customers"));
});

test("a quote whose customer is no longer visible retains its card with a blank customer", async () => {
  fixture.tables.customers = [];
  const result = await mount();
  assert.equal(result.error, null);
  assert.equal(result.count, 2);
  assert.ok(result.groups.flatMap(group => group.rows).every(row => row.customers === null));
});

test("authorized-view and customer lookup failures remain visible and do not fall back to raw quotes", async () => {
  fixture.errors.quotes_authorized = { message: "permission denied for view quotes_authorized" };
  const result = await mount();
  assert.equal(result.error, "You do not have permission to perform this action for this company.");
  assert.equal(result.loading, false);
  assert.deepEqual(result.groups, []);
  assert.ok(fixture.calls.every(call => call.table !== "quotes" && call.table !== "customers"));
});

test("customer lookup errors do not silently replace a failed load with successful quote cards", async () => {
  fixture.errors.customers = { message: "permission denied for table customers" };
  const result = await mount();
  assert.equal(result.error, "You do not have permission to perform this action for this company.");
  assert.equal(result.loading, false);
  assert.deepEqual(result.groups, []);
});

test("the shared overview also respects the existing authorized Orders read source", async () => {
  const result = await mount("orders");
  assert.equal(result.error, null);
  assert.equal(result.count, 1);
  assert.ok(fixture.calls.every(call => call.table === "orders_authorized"));
  assert.equal(result.groups.flatMap(group => group.rows)[0].order_value, null);
});

test("modules without an authorized-view override retain their ordinary scoped read source", async () => {
  const result = await mount("inventory");
  assert.equal(result.error, null);
  assert.equal(result.count, 0);
  assert.ok(fixture.calls.every(call => call.table === "inventory_items"));
});
