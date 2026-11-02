import { createRequire } from "node:module";

export const nov2Id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const nov2Evaluation = () => ({ plan_id: nov2Id(50), plan_version: 1, plan_scope: "profile", sampling_instruction: "3 pieces per lot", state: "incomplete", total: 2, missing: 2, failed: 0, inspection_status: "pending", items: [
  { item_id: nov2Id(51), seq: 1, characteristic: "Wall thickness", unit: "mm", method: "Micrometer at 3 points", nominal: 1.6, lower_limit: 1.5, upper_limit: 1.7, critical: true, observed: null, visual_ok: null, outcome: "missing", recorded_by_name: null, recorded_at: null },
  { item_id: nov2Id(52), seq: 2, characteristic: "Surface finish", unit: "visual", method: "Inspect in daylight", nominal: null, lower_limit: null, upper_limit: null, critical: true, observed: null, visual_ok: null, outcome: "missing", recorded_by_name: null, recorded_at: null }
] });

export function createNov2ActionsFixture() {
  const state = {};
  function reset() {
    Object.assign(state, { authenticated: true, context: { companyId: nov2Id(1), userId: nov2Id(3), role: "owner", dealerId: null }, flags: { quality_compliance: true, mobile_floor_app: true }, calls: [], tableErrors: {}, rpcError: null, rpcThrow: false, malformedResult: false, evaluation: nov2Evaluation(), rows: {
      orders: [{ id: nov2Id(10), company_id: nov2Id(1), current_stage: "production_planned", quote_id: null }],
      aluminium_profiles: [{ id: nov2Id(20), company_id: nov2Id(1), is_active: true, section_weight_kg_per_m: .8 }],
      dies: [{ id: nov2Id(30), company_id: nov2Id(1), profile_id: nov2Id(20), die_status: "active" }],
      order_items_authorized: [{ id: nov2Id(11), company_id: nov2Id(1), order_id: nov2Id(10), profile_id: nov2Id(20), section_weight_kg_per_m: .8, length_per_piece_m: 6, quantity_pieces: 100, quantity_kg: 480 }],
      tasks: [{ id: nov2Id(60), company_id: nov2Id(1), assigned_to: nov2Id(3), title: "Review job", status: "open", priority: "normal", due_date: "2026-11-02", related_entity_type: null, related_entity_id: null }],
      quality_inspections: [{ id: nov2Id(70), company_id: nov2Id(1), batch_number: "QC-070", inspector_name: "Fixture inspector", status: "pending" }]
    } });
  }
  reset();
  const client = {
    from(table) {
      const call = { table, filters: [], select: "", limit: null, single: false };
      const chain = {
        select(value) { call.select = value; return chain; }, eq(key, value) { call.filters.push(["eq", key, value]); return chain; }, is(key, value) { call.filters.push(["eq", key, value]); return chain; },
        in(key, value) { call.filters.push(["in", key, value]); return chain; }, gt(key, value) { call.filters.push(["gt", key, value]); return chain; }, lte(key, value) { call.filters.push(["lte", key, value]); return chain; },
        order() { return chain; }, or() { return chain; }, limit(value) { call.limit = value; return chain; }, maybeSingle() { call.single = true; return chain; },
        then(resolve, reject) {
          state.calls.push(structuredClone(call));
          if (state.tableErrors[table]) return Promise.resolve({ data: null, error: state.tableErrors[table] }).then(resolve, reject);
          let rows = (state.rows[table] ?? []).filter(row => call.filters.every(([kind, key, expected]) => kind === "in" ? expected.includes(row[key]) : kind === "gt" ? row[key] > expected : kind === "lte" ? row[key] <= expected : (row[key] ?? null) === expected));
          if (call.limit) rows = rows.slice(0, call.limit);
          return Promise.resolve({ data: call.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        }
      };
      return chain;
    },
    async rpc(name, payload) {
      state.calls.push({ rpc: name, payload: structuredClone(payload) });
      if (state.rpcThrow) throw Error("Lost connection after request");
      if (state.rpcError) return { data: null, error: state.rpcError };
      if (name === "save_production_job_atomic") return { data: nov2Id(40), error: null };
      return { data: state.malformedResult ? { unexpected: true } : state.evaluation, error: null };
    }
  };
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const Module = require("node:module"), original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "@/lib/auth") return { getSessionContext: async () => { if (!state.authenticated) throw Error("Session unavailable"); return state.context; } };
    if (request === "@/lib/supabase/server") return { createClient: async () => client };
    if (request === "next/cache") return { revalidatePath() {} };
    if (request === "next/navigation") return { redirect(href) { const error = Error("Redirect"); error.href = href; throw error; }, notFound() { throw Error("Not found"); } };
    if (request === "@/lib/enterprise/features") return { ...original(request, parent, isMain), getFeatureFlagsForCompany: async () => state.flags };
    return original(request, parent, isMain);
  };
  let actions, mobileInspectionPage;
  try {
    actions = Object.assign({}, ...["production", "inspection-plans", "my-work"].map(name => { const path = require.resolve(`../../lib/actions/${name}.ts`); delete require.cache[path]; return require(path); }));
    const path = require.resolve("../../app/(dashboard)/mobile/quality/[id]/page.tsx"); delete require.cache[path]; mobileInspectionPage = require(path).default;
  }
  finally { Module._load = original; }
  return { state, reset, mobileInspectionPage, ...actions };
}
