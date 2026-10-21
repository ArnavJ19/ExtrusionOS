import { createRequire } from "node:module";
import { createOperatorWorkflowFixture, workflowIds as ids } from "./operator-workflow-fixture.mjs";

export async function createOperatorActionFixture() {
  const fixture = await createOperatorWorkflowFixture();
  const state = { role: "owner", actor: ids.actor, companyId: ids.company, dealerId: null, authenticated: true, calls: [], paths: [], loseConfirmation: false, unavailable: false, cacheError: false, rpcError: null };
  const client = { async rpc(name, args) {
    state.calls.push({ name, args: structuredClone(args) });
    if (state.rpcError) return { data: null, error: state.rpcError };
    if (state.unavailable) return { data: null, error: { code: "PGRST202", message: "Missing function" } };
    let data;
    try { data = await fixture.command(args.p_command, args.p_payload, { role: state.role, actor: state.actor }); }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    if (state.loseConfirmation) { state.loseConfirmation = false; throw new Error("Synthetic acknowledgement lost after commit"); }
    return { data, error: null };
  } };
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const Module = require("node:module"), original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/auth") return { getSessionContext: async () => { if (!state.authenticated) throw new Error("Authentication required"); return { companyId: state.companyId, userId: state.actor, role: state.role, dealerId: state.dealerId, fullName: "Mira Sales" }; } };
    if (request === "@/lib/supabase/server") return { createClient: async () => client };
    if (request === "next/cache") return { revalidatePath: path => { state.paths.push(path); if (state.cacheError) throw new Error("Synthetic cache failure"); } };
    return original.call(this, request, parent, isMain);
  };
  let action, post;
  try {
    const actionPath = require.resolve("../../lib/actions/operator-workflows.ts"); delete require.cache[actionPath];
    action = require(actionPath).operatorWorkflowAction;
    const routePath = require.resolve("../../app/api/operator-workflows/route.ts"); delete require.cache[routePath];
    post = require(routePath).POST;
  } finally { Module._load = original; }
  return { ...fixture, state, action, post };
}
