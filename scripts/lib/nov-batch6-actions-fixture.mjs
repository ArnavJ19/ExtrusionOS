import { createRequire } from "node:module";
import { nids, nid } from "./nov-batch6-fixture.mjs";

export const nov6Outcome = (patch = {}) => ({ request_id: nid(1000), state: "prepared", fingerprint: "a".repeat(32), expires_at: new Date(Date.now() + 900000).toISOString(), action: "journey.open",
  review: { title: "Start a journey review", effect: "Reconstructs the recorded journey of this order for review.", warnings: [], facts: { Order: "SO-NOV6-C" } }, result: null, ...patch });

// The real server actions with synthetic session, Supabase and cache boundaries.
export function createNov6ActionsFixture() {
  const state = {};
  function reset() { Object.assign(state, { context: { companyId: nids.company, userId: nids.owner, role: "owner", dealerId: null }, authenticated: true, calls: [], error: null, throws: false, malformed: false, revalidateThrows: false, response: nov6Outcome(), rpcHandler: null }); }
  reset();
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const Module = require("node:module"), original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "@/lib/auth") return { getSessionContext: async () => { if (!state.authenticated) throw Error("No session"); return state.context; } };
    if (request === "@/lib/supabase/server") return { createClient: async () => ({ rpc: async (name, payload) => {
      state.calls.push({ name, payload });
      if (state.throws) throw Error("Transport interrupted");
      if (state.rpcHandler) return state.rpcHandler(name, payload);
      return { data: state.malformed ? { unexpected: true } : state.response, error: state.error };
    } }) };
    if (request === "next/cache") return { revalidatePath() { if (state.revalidateThrows) throw Error("Cache unavailable"); } };
    return original(request, parent, isMain);
  };
  let loaded;
  try { const file = require.resolve("../../lib/actions/lifecycle.ts"); delete require.cache[file]; loaded = require(file); }
  finally { Module._load = original; }
  return { state, reset, action: loaded.lifecycleAction };
}
