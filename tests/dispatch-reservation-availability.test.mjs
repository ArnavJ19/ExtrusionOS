import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import fc from "fast-check";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = id(1), order = id(2), profile = id(3), batch = id(4), reservation = id(5);
let state;

function client() {
  return {
    from(table) {
      const query = { table, filters: [], columns: "" };
      state.queries.push(query);
      const result = () => {
        const error = state.queryErrors[table];
        let data = state.tables[table] ?? [];
        for (const [operator, column, value] of query.filters) {
          data = data.filter(row => operator === "in" ? value.includes(row[column]) : row[column] === value);
        }
        return { data, error: error ?? null };
      };
      return {
        select(columns) { query.columns = columns; return this; },
        eq(column, value) { query.filters.push(["eq", column, value]); return this; },
        is(column, value) { query.filters.push(["is", column, value]); return this; },
        in(column, values) { query.filters.push(["in", column, values]); return this; },
        order() { return this; },
        async maybeSingle() { const response = result(); return { ...response, data: response.data[0] ?? null }; },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); }
      };
    },
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (name === "save_ready_dispatch_atomic" && state.allowDispatchWrite) return { data: id(9), error: null };
      assert.equal(name, "get_profile_stock_consumption_totals", "Source reads must never mutate stock or dispatches");
      if (state.rpcResult) return state.rpcResult(state.calls.length, args.p_reservation_ids);
      return {
        data: args.p_reservation_ids.map(reservationId => {
          const rows = state.consumptions.filter(row => row.reservation_id === reservationId);
          return {
            reservation_id: reservationId,
            consumed_weight_kg: rows.reduce((sum, row) => sum + row.consumed_weight_kg, 0),
            consumed_length_m: rows.reduce((sum, row) => sum + row.consumed_length_m, 0),
            consumed_pieces: rows.reduce((sum, row) => sum + row.consumed_pieces, 0)
          };
        }),
        error: null
      };
    }
  };
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/cache") return { revalidatePath(path) { state.paths.push(path); } };
  if (request === "@/lib/auth") return { getSessionContext: async () => ({ companyId: company, role: state.role }) };
  if (request === "@/lib/supabase/server") return { createClient: async () => client() };
  return originalLoad(request, parent, isMain);
};
let actions;
try {
  actions = require("../lib/actions/dispatches.ts");
} finally {
  Module._load = originalLoad;
}

function reset({ held = 2000, consumed = 1501 } = {}) {
  const consumptions = Array.from({ length: consumed }, () => ({
    reservation_id: reservation, consumed_weight_kg: 1, consumed_length_m: 0.5, consumed_pieces: 1
  }));
  state = {
    role: "dispatch_manager", calls: [], queries: [], paths: [], queryErrors: {}, rpcResult: null, consumptions,
    allowDispatchWrite: false,
    tables: {
      orders: [{ id: order, company_id: company }],
      profile_stock_reservations: [{
        id: reservation, company_id: company, order_id: order, profile_id: profile,
        profile_stock_batch_id: batch, status: "active", reserved_weight_kg: held,
        reserved_length_m: held / 2, reserved_pieces: held,
        profile_stock_consumptions: consumptions.slice(0, 1000)
      }],
      aluminium_profiles: [{ id: profile, company_id: company, profile_code: "P-001", profile_name: "Track" }],
      profile_stock_batches: [{ id: batch, company_id: company, quantity_pieces: held - consumed, total_weight_kg: held - consumed }]
    }
  };
}

test("dispatch source action uses all 1,501 consumption rows despite a 1,000-row embedded preview", async () => {
  reset();
  const result = await actions.getDispatchSourcesAction(order);
  assert.equal(result.success, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].availableWeightKg, 499);
  assert.equal(result.sources[0].availableLengthM, 249.5);
  assert.equal(result.sources[0].availablePieces, 499);
  assert.deepEqual(state.calls, [{ name: "get_profile_stock_consumption_totals", args: { p_reservation_ids: [reservation] } }]);
  assert.deepEqual(state.paths, []);
  assert.ok(state.queries.filter(query => query.table === "profile_stock_reservations")
    .every(query => !query.columns.includes("profile_stock_consumptions")));
  assert.ok(state.queries.every(query => query.filters.some(([, column, value]) => column === "company_id" && value === company)));
});

test("dispatch source action rejects unavailable, partial, duplicate and malformed consumption totals", async () => {
  for (const data of [null, [], [null], [{}], [{ reservation_id: id(99), consumed_weight_kg: 0, consumed_length_m: 0, consumed_pieces: 0 }]]) {
    reset();
    state.rpcResult = () => ({ data, error: null });
    const result = await actions.getDispatchSourcesAction(order);
    assert.equal(result.success, false, JSON.stringify(data));
    assert.equal(result.sources, undefined);
  }
  reset();
  state.rpcResult = () => ({ data: null, error: new Error("Consumption service unavailable") });
  const failed = await actions.getDispatchSourcesAction(order);
  assert.equal(failed.success, false);
  assert.match(failed.error, /unavailable/);
});

test("fully consumed and released holds never reappear as dispatchable stock", async () => {
  reset({ held: 1501, consumed: 1501 });
  state.tables.profile_stock_reservations.push({
    ...state.tables.profile_stock_reservations[0], id: id(6), status: "released", reserved_weight_kg: 9999
  });
  const result = await actions.getDispatchSourcesAction(order);
  assert.equal(result.success, true);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(state.calls[0].args.p_reservation_ids, [reservation]);
});

test("reservation totals are bounded across multiple RPC requests and a failed second request exposes no partial result", async () => {
  reset({ held: 10, consumed: 0 });
  const first = state.tables.profile_stock_reservations[0];
  state.tables.profile_stock_reservations = Array.from({ length: 501 }, (_, n) => ({ ...first, id: id(100 + n) }));
  let result = await actions.getDispatchSourcesAction(order);
  assert.equal(result.success, true);
  assert.equal(result.sources.length, 501);
  assert.deepEqual(state.calls.map(call => call.args.p_reservation_ids.length), [500, 1]);
  state.calls = [];
  state.rpcResult = (number, ids) => number === 1 ? {
    data: ids.map(reservationId => ({ reservation_id: reservationId, consumed_weight_kg: 0, consumed_length_m: 0, consumed_pieces: 0 })), error: null
  } : { data: null, error: new Error("Second request unavailable") };
  result = await actions.getDispatchSourcesAction(order);
  assert.equal(result.success, false);
  assert.equal(result.sources, undefined);
});

test("missing, invalid, foreign and unauthorized orders never inspect consumption outside their scope", async () => {
  reset();
  assert.equal((await actions.getDispatchSourcesAction("invalid")).success, false);
  assert.equal(state.queries.length, 0);
  state.role = "viewer";
  assert.equal((await actions.getDispatchSourcesAction(order)).success, false);
  assert.equal(state.queries.length, 0);
  state.role = "dispatch_manager";
  assert.deepEqual((await actions.getDispatchSourcesAction(id(99))).sources, []);
  assert.equal(state.calls.length, 0);
  state.tables.profile_stock_reservations[0].company_id = id(99);
  assert.deepEqual((await actions.getDispatchSourcesAction(order)).sources, []);
  assert.equal(state.calls.length, 0);
});

test("source query failure does not fall back to apparently unused stock", async () => {
  reset();
  state.queryErrors.profile_stock_reservations = new Error("Reservation query unavailable");
  assert.equal((await actions.getDispatchSourcesAction(order)).success, false);
  assert.equal(state.calls.length, 0);
});

test("saving an oversize dispatch fails before a stock-writing RPC, using aggregate consumption", async () => {
  reset();
  const result = await actions.saveDispatchAction({
    order_id: order, dispatch_date: "2026-10-15", delivery_status: "dispatched",
    bundles: [{ bundle_number: "B-001", source_line_id: reservation, number_of_pieces: 500,
      gross_weight_kg: 500, tare_weight_kg: 0, net_length_m: 250 }]
  });
  assert.equal(result.success, false);
  assert.match(result.error, /Only 499\.000 kg is ready/);
  assert.deepEqual(state.calls.map(call => call.name), ["get_profile_stock_consumption_totals"]);
  assert.deepEqual(state.paths, []);
});

test("a valid remaining dispatch reaches the atomic save with exact source identity and measurements", async () => {
  reset();
  state.allowDispatchWrite = true;
  const result = await actions.saveDispatchAction({
    order_id: order, dispatch_date: "2026-10-15", delivery_status: "dispatched",
    bundles: [{ bundle_number: "B-001", source_line_id: reservation, number_of_pieces: 499,
      gross_weight_kg: 500, tare_weight_kg: 1, net_length_m: 249.5 }]
  });
  assert.deepEqual(result, { success: true, dispatchId: id(9) });
  assert.deepEqual(state.calls.map(call => call.name), ["get_profile_stock_consumption_totals", "save_ready_dispatch_atomic"]);
  const { p_items: items, p_dispatch: dispatch } = state.calls[1].args;
  assert.equal(items.length, 1);
  for (const [key, value] of Object.entries({ company_id: company, reservation_id: reservation,
    source_line_id: reservation, profile_stock_batch_id: batch, profile_id: profile,
    number_of_pieces: 499, net_weight_kg: 499, net_length_m: 249.5 })) assert.equal(items[0][key], value, key);
  assert.equal(dispatch.total_weight_kg, 499);
  assert.equal(dispatch.total_tare_weight_kg, 1);
  assert.ok(state.paths.includes(`/dispatches/${id(9)}`));
});

test("aggregate failure prevents dispatch submission and repeated source reads do not subtract consumed stock twice", async () => {
  reset();
  const first = await actions.getDispatchSourcesAction(order);
  assert.deepEqual((await actions.getDispatchSourcesAction(order)).sources, first.sources);
  assert.equal(state.consumptions.length, 1501);
  state.calls = [];
  state.rpcResult = () => ({ data: [], error: null });
  const result = await actions.saveDispatchAction({
    order_id: order, dispatch_date: "2026-10-15", delivery_status: "dispatched",
    bundles: [{ bundle_number: "B-001", source_line_id: reservation, number_of_pieces: 1,
      gross_weight_kg: 1, tare_weight_kg: 0, net_length_m: 0.5 }]
  });
  assert.equal(result.success, false);
  assert.match(result.error, /incomplete/);
  assert.deepEqual(state.calls.map(call => call.name), ["get_profile_stock_consumption_totals"]);
  assert.deepEqual(state.paths, []);
});

test("partial consumption conserves held kg, metres and whole pieces over randomized ledgers", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 3000 }), fc.integer({ min: 0, max: 3000 }), async (held, candidate) => {
    const consumed = Math.min(held, candidate);
    reset({ held, consumed });
    const result = await actions.getDispatchSourcesAction(order);
    assert.equal(result.success, true);
    const remaining = held - consumed;
    assert.equal(result.sources.length, remaining === 0 ? 0 : 1);
    if (remaining > 0) {
      assert.equal(result.sources[0].availableWeightKg + consumed, held);
      assert.equal(result.sources[0].availableLengthM + consumed / 2, held / 2);
      assert.equal(result.sources[0].availablePieces + consumed, held);
    }
  }), { numRuns: 100, seed: 20261015 });
});
