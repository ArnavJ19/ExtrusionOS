import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let state;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/auth") return { getSessionContext: async () => ({ companyId: id(1), role: state.role }) };
  if (request === "next/navigation") return { redirect(path) { throw new Error(`redirect:${path}`); } };
  if (request === "@/lib/enterprise/features") return { getFeatureFlagsForCompany: async () => ({}), isFeatureEnabled: () => true };
  if (request === "@/components/modules/operations/module-overview-client") return { ModuleOverviewClient: ({ children }) => children };
  if (request === "@/components/modules/dashboards/inventory-dashboard") return { InventoryDashboard: () => null };
  if (request === "@/components/modules/dealer-inventory-entry-client") return { DealerInventoryEntryClient: () => null };
  if (request === "@/lib/supabase/server") return { createClient: async () => ({
    async rpc(name, args) { state.calls.push({ name, args }); return state.result; },
    from(table) {
      state.tables.push(table);
      return { select() { return this; }, eq() { return this; }, order() { return this; }, or() { return this; }, limit() { return this; },
        then(resolve, reject) { return Promise.resolve({ data: table === "profile_stock_reservations" ? state.legacyRows : [],
          error: table === "profile_stock_reservations" ? state.homeError : null,
          count: table === "profile_stock_reservations" ? state.homeCount : 0 }).then(resolve, reject); } };
    }
  }) };
  return originalLoad(request, parent, isMain);
};
let Page, HomePage;
try {
  Page = require("../app/(dashboard)/inventory/reservations/page.tsx").default;
  HomePage = require("../app/(dashboard)/inventory/page.tsx").default;
} finally {
  Module._load = originalLoad;
}

function row(n = 10) {
  return {
    id: id(n), order_id: id(2), profile_code: "P-001", profile_name: "Track", order_number: "O-001",
    customer_name: "Customer", bundle_number: "B-001", location: "Rack A", status: "active",
    reserved_weight_kg: 2000, consumed_weight_kg: 1501, open_weight_kg: 499, released_weight_kg: 0,
    reserved_length_m: 1000, consumed_length_m: 750.5, open_length_m: 249.5, released_length_m: 0,
    reserved_pieces: 2000, consumed_pieces: 1501, open_pieces: 499, released_pieces: 0,
    created_at: "2026-10-15T00:00:00+00:00", released_at: null, notes: null
  };
}
function reset() {
  const rows = Array.from({ length: 10 }, (_, n) => row(n + 10));
  state = { role: "inventory_manager", calls: [], tables: [], homeCount: 151, homeError: null,
    result: { data: { page: 1, page_size: 10, total_count: 1001, integrity_ok: true,
      summary: { active_count: 1001, open_weight_kg: 499499, consumed_weight_kg: 1502501, released_weight_kg: 0 }, rows }, error: null },
    legacyRows: [{ id: id(10), order_id: id(2), reserved_weight_kg: 2000, reserved_length_m: 1000,
      status: "active", profile_stock_consumptions: [{ consumed_weight_kg: 1000 }] }]
  };
}
const html = async params => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params ?? {}) }));

test("reservation ledger uses complete server aggregates and ten-row pages instead of embedded consumption previews", async () => {
  reset();
  const rendered = await html();
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].name, "get_profile_stock_reservation_ledger_page");
  assert.deepEqual(state.tables, []);
  assert.match(rendered, /499/);
  assert.match(rendered, /Next/);
  assert.match(rendered, /1,001|1001/);
  assert.match(rendered, /Open hold/);
});

test("search, lifecycle filter and stable sort reach the server, with filter-preserving navigation", async () => {
  reset();
  state.result.data.page = 2;
  const rendered = await html({ page: "2", q: "  P%_001  ", status: "released", sort: "reserved_weight_kg", direction: "asc" });
  assert.deepEqual(state.calls[0].args, { p_page: 2, p_search: "P%_001", p_status: "released",
    p_sort: "reserved_weight_kg", p_direction: "asc" });
  assert.match(rendered, /Previous/);
  assert.match(rendered, /page=3/);
  assert.match(rendered, /status=released/);
  assert.match(rendered, /q=P%25_001/);
});

test("released lifecycle evidence is retained even when all units have already been posted", async () => {
  reset();
  state.result.data.total_count = 1;
  state.result.data.rows = [{ ...row(), status: "released", consumed_weight_kg: 2000,
    consumed_length_m: 1000, consumed_pieces: 2000, open_weight_kg: 0, open_length_m: 0, open_pieces: 0,
    released_at: "2026-10-15T01:00:00+00:00" }];
  state.result.data.summary = { active_count: 0, open_weight_kg: 0, consumed_weight_kg: 2000, released_weight_kg: 0 };
  state.legacyRows[0].status = "released";
  state.legacyRows[0].profile_stock_consumptions = [{ consumed_weight_kg: 2000 }];
  const rendered = await html();
  assert.match(rendered, />Released</);
  assert.doesNotMatch(rendered, />Consumed<\/span>/);
});

test("query or malformed-payload failure cannot expose raw errors, zero metrics or an empty-success ledger", async () => {
  for (const result of [{ data: null, error: new Error("internal-db-detail") }, { data: null, error: null },
    { data: { rows: [] }, error: null }]) {
    reset();
    state.result = result;
    state.legacyRows = [];
    const rendered = await html();
    assert.match(rendered, /unavailable|could not be loaded/i);
    assert.doesNotMatch(rendered, /internal-db-detail|No stock reservations found|No reservations match/);
    assert.doesNotMatch(rendered, />Active Reservations<|>Open holds<|>Matching reservations</);
  }
});

test("verified empty ledgers are distinct from unavailable data and do not offer a next page", async () => {
  reset();
  state.result.data.total_count = 0;
  state.result.data.rows = [];
  state.result.data.summary = { active_count: 0, open_weight_kg: 0, consumed_weight_kg: 0, released_weight_kg: 0 };
  state.legacyRows = [];
  const rendered = await html();
  assert.match(rendered, /No reservations match/);
  assert.doesNotMatch(rendered, />Next</);
});

test("reservation read capability matches the protected operational role boundary", async () => {
  for (const role of ["viewer", "sales", "sales_manager", "accounts", "quality", "dealer_admin", "dealer_staff"]) {
    reset();
    state.role = role;
    await assert.rejects(html(), /redirect:/, role);
    assert.deepEqual(state.tables, []);
    assert.deepEqual(state.calls, []);
  }
});

test("inventory navigation hides the reservation card and avoids its query for roles outside reservation read scope", async () => {
  reset();
  state.role = "viewer";
  const rendered = renderToStaticMarkup(await HomePage());
  assert.doesNotMatch(rendered, /Open Reservations|Reservation Ledger/);
  assert.ok(!state.tables.includes("profile_stock_reservations"));
});

test("the inventory reservation count is unavailable when its exact-count query fails or is missing", async () => {
  for (const error of [new Error("internal-db-detail"), null]) {
    reset();
    state.homeError = error;
    state.homeCount = null;
    const rendered = renderToStaticMarkup(await HomePage());
    assert.match(rendered, /active reservation count is unavailable/);
    assert.doesNotMatch(rendered, /0 active stock reservations|internal-db-detail/);
    assert.match(rendered, /Open Reservations/);
  }
});
