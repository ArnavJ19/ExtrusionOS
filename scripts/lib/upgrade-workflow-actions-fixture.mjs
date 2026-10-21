import { createRequire } from "node:module";

export const workflowId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const workflowIds = { company: workflowId(1), otherCompany: workflowId(2), user: workflowId(3), quote: workflowId(10), customer: workflowId(20), profile: workflowId(30), order: workflowId(40), source: workflowId(50) };
export const workflowLine = { profile_id: workflowIds.profile, quantity_pieces: 10, length_per_piece_m: 6, section_weight_kg_per_m: 0.75, scrap_allowance_percent: 0, expected_recovery_percent: 90, minimum_billing_weight_kg: 0, billet_rate_per_kg: 250, conversion_charge_per_kg: 30, finishing_type: "mill_finish", finishing_charge_type: "per_kg", finishing_charge: 0, die_charge: 1500, die_amortization_type: "full_die_charge", die_amortization_quantity_kg: 0, packing_charge: 20, transport_charge: 10, other_charges: 0, margin_percent: 20, sales_price_override: null, minimum_margin_percent: 8, gst_percent: null };

export function createWorkflowActionsFixture() {
  const state = { context: { companyId: workflowIds.company, userId: workflowIds.user, role: "owner", dealerId: null }, authenticated: true, rows: {}, calls: [], errorTables: new Set() };
  const client = { from(table) {
    const call = { table, columns: "", filters: [], orders: [], limit: null, range: null, single: false, or: "" };
    const chain = {
      select(columns) { call.columns = columns; return chain; }, eq(key, value) { call.filters.push(["eq", key, value]); return chain; },
      is(key, value) { call.filters.push(["eq", key, value]); return chain; }, in(key, value) { call.filters.push(["in", key, value]); return chain; },
      order(key, options) { call.orders.push([key, options?.ascending !== false]); return chain; }, limit(value) { call.limit = value; return chain; },
      range(start, end) { call.range = [start, end]; return chain; },
      maybeSingle() { call.single = true; return chain; }, or(value) { call.or = value; return chain; },
      then(resolve, reject) {
        state.calls.push(structuredClone(call));
        if (state.errorTables.has(table)) return Promise.resolve({ data: null, error: { message: "Synthetic read outage" } }).then(resolve, reject);
        let rows = (state.rows[table] ?? []).filter((row) => call.filters.every(([kind, key, value]) => { const actual = key.split(".").reduce((item, field) => item?.[field], row); return kind === "in" ? value.includes(actual) : (actual ?? null) === value; }));
        if (call.or) rows = rows.filter((row) => call.or.split(",").some((part) => { const [key, , ...tail] = part.split("."); return String(row[key] ?? "").toLowerCase().includes(tail.join(".").replace(/^\*|\*$/g, "").toLowerCase()); }));
        rows = [...rows].sort((a, b) => { for (const [key, ascending] of call.orders) { const order = String(a[key] ?? "").localeCompare(String(b[key] ?? "")); if (order) return ascending ? order : -order; } return 0; });
        const count = rows.length;
        if (call.limit != null) rows = rows.slice(0, call.limit);
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
        const columns = call.columns.replace(/dispatches!inner\([^)]*\)/g, "dispatches").split(",").map((column) => column.trim());
        rows = rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
        return Promise.resolve({ data: call.single ? rows[0] ?? null : rows, count, error: null }).then(resolve, reject);
      },
    };
    return chain;
  } };
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const Module = require("node:module"), original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "@/lib/auth") return { getSessionContext: async () => { if (!state.authenticated) throw new Error("Denied"); return state.context; } };
    if (request === "@/lib/supabase/server") return { createClient: async () => client };
    return original(request, parent, isMain);
  };
  let actions;
  try { actions = Object.assign({}, ...["instant-search", "repeat-quote", "order-stage-age", "dispatch-order-balance"].map((name) => { const file = require.resolve(`../../lib/actions/${name}.ts`); delete require.cache[file]; return require(file); })); }
  finally { Module._load = original; }
  return { state, ...actions, model: require("../../lib/workflow/stage-age.ts"), review: require("../../lib/dispatches/review.ts"), repeat: require("../../lib/forms/repeat-quote.ts"), async reset() {
    Object.assign(state, { context: { companyId: workflowIds.company, userId: workflowIds.user, role: "owner", dealerId: null }, authenticated: true, calls: [], errorTables: new Set(), rows: {} });
    const common = { company_id: workflowIds.company };
    state.rows.customers = [{ ...common, id: workflowIds.customer, customer_name: "Mira Shah", company_name: "Mira Windows", is_active: true, deleted_at: null, gst_number: null }];
    state.rows.quotes_authorized = [{ ...common, id: workflowIds.quote, quote_number: "QT-OLD", customer_id: workflowIds.customer, valid_until: "2020-01-01", gst_percent: 18, notes: "Preserve note", status: "sent" }];
    state.rows.quote_items_authorized = [{ ...common, ...workflowLine, id: workflowId(11), quote_id: workflowIds.quote, created_at: "2020-01-01T00:00:00Z" }];
    state.rows.aluminium_profiles = [{ ...common, id: workflowIds.profile, profile_code: "AL-101", profile_name: "Window profile", section_weight_kg_per_m: 0.8, section_perimeter_mm: 120, is_active: true }];
    state.rows.company_settings_authorized = [{ ...common, default_quote_validity_days: 15 }];
    state.rows.orders_authorized = [{ ...common, id: workflowIds.order, order_number: "ORD-100", current_stage: "packing", expected_dispatch_date: "2026-10-25", order_value: 999999 }];
    state.rows.order_items_authorized = [{ ...common, id: workflowId(200), order_id: workflowIds.order, quantity_pieces: 100, total_meters: 600 }];
    state.rows.packing_list_items = [{ ...common, id: workflowId(300), dispatch_id: workflowId(400), source_line_id: workflowIds.source, net_weight_kg: 20, number_of_pieces: 10, net_length_m: 60, dispatches: { company_id: workflowIds.company, order_id: workflowIds.order } }];
    state.rows.order_stage_history = [
      { ...common, id: workflowId(101), order_id: workflowIds.order, stage: "packing", changed_at: "2026-10-20T10:00:00Z", remarks: "Private note" },
      { ...common, id: workflowId(102), order_id: workflowIds.order, stage: "production_in_progress", changed_at: "2026-10-19T10:00:00Z" },
      { ...common, id: workflowId(103), order_id: workflowIds.order, stage: "packing", changed_at: "2026-10-18T10:00:00Z" },
    ];
  } };
}
