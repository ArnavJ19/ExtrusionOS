import { createRequire } from "node:module";

export const n7 = n => `be700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { company: n7(1), otherCompany: n7(2), owner: n7(10), production: n7(11), dealer: n7(12) };

const like = pattern => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*").replace(/_/g, ".")}$`, "i");
function matches(row, [kind, field, value]) {
  if (kind === "eq") return String(row[field] ?? "") === String(value ?? "") && row[field] !== undefined;
  if (kind === "neq") return row[field] !== value;
  if (kind === "is") return (row[field] ?? null) === value;
  if (kind === "ilike") return typeof row[field] === "string" && like(value).test(row[field]);
  if (kind === "in") return value.includes(row[field]);
  return true;
}
/** Evaluates a PostgREST or-filter made of field.ilike.pattern clauses. */
function orMatches(row, expression) {
  return expression.split(",").some(clause => { const [field, op, ...rest] = clause.split("."); return op === "ilike" && typeof row[field] === "string" && like(rest.join(".")).test(row[field]); });
}

// The real server actions with synthetic session, Supabase and cache boundaries. Tables are plain
// arrays; every filter the action applies is evaluated, so tenant scoping is actually exercised.
export function createNov7ActionsFixture(modulePath) {
  const state = {};
  function reset() {
    Object.assign(state, { context: { companyId: ids.company, userId: ids.owner, role: "owner", dealerId: null }, authenticated: true, calls: [], tables: {}, failTables: new Set(), insertError: null,
      rpcHandler: null, revalidated: [] });
  }
  reset();
  function client() {
    return {
      from(table) {
        const call = { table, columns: "", filters: [], or: null, limit: null, insert: null, update: null, single: false };
        state.calls.push(call);
        const run = () => {
          if (state.failTables.has(table)) return { data: null, error: { code: "PGRST000", message: "Synthetic failure" } };
          const rows = (state.tables[table] ??= []);
          if (call.insert) {
            if (state.insertError) return { data: null, error: { code: state.insertError, message: "Synthetic insert rejection" } };
            const inserted = (Array.isArray(call.insert) ? call.insert : [call.insert]).map(row => ({ ...row }));
            rows.push(...inserted);
            return { data: call.single ? inserted[0] : inserted, error: null };
          }
          let found = rows.filter(row => call.filters.every(filter => matches(row, filter)) && (!call.or || orMatches(row, call.or)));
          if (call.update) { for (const row of found) Object.assign(row, call.update); return { data: found, error: null }; }
          if (call.limit !== null) found = found.slice(0, call.limit);
          if (call.single) return found.length === 1 ? { data: found[0], error: null } : found.length ? { data: null, error: { message: "Multiple rows" } } : { data: null, error: null };
          return { data: found, error: null };
        };
        const builder = {
          select(columns = "*") { call.columns = columns; return builder; }, eq(field, value) { call.filters.push(["eq", field, value]); return builder; },
          neq(field, value) { call.filters.push(["neq", field, value]); return builder; }, is(field, value) { call.filters.push(["is", field, value]); return builder; },
          ilike(field, value) { call.filters.push(["ilike", field, value]); return builder; }, in(field, value) { call.filters.push(["in", field, value]); return builder; },
          or(value) { call.or = value; return builder; }, order() { return builder; }, limit(value) { call.limit = value; return builder; },
          maybeSingle() { call.single = true; return builder; }, single() { call.single = true; return builder; },
          insert(value) { call.insert = value; return builder; }, update(value) { call.update = value; return builder; },
          then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); }
        };
        return builder;
      },
      rpc: async (name, payload) => { state.calls.push({ rpc: name, payload }); return state.rpcHandler ? state.rpcHandler(name, payload) : { data: null, error: { code: "PGRST202", message: "missing" } }; }
    };
  }
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const Module = require("node:module"), original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "@/lib/auth") return { getSessionContext: async () => { if (!state.authenticated) throw Error("No session"); return state.context; } };
    if (request === "@/lib/supabase/server") return { createClient: async () => client() };
    if (request === "next/cache") return { revalidatePath(path) { state.revalidated.push(path); } };
    return original(request, parent, isMain);
  };
  let loaded;
  try { const file = require.resolve(modulePath); delete require.cache[file]; loaded = require(file); }
  finally { Module._load = original; }
  return { state, reset, actions: loaded };
}
