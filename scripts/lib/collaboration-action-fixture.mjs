import { createRequire } from "node:module";
import { createCollaborationFixture, ids } from "./collaboration-workflow-fixture.mjs";

export async function createCollaborationActionFixture() {
  const f = await createCollaborationFixture();
  const state = { role: "owner", actor: ids.actor, companyId: ids.company, dealerId: null, authenticated: true, calls: [], paths: [], loseConfirmation: false, unavailable: false, cacheError: false, rpcError: null, malformed: false };
  const client = { async rpc(name, args) {
    state.calls.push({ name, args: structuredClone(args) });
    if (name !== "collaboration_workflow_command") throw new Error("Unexpected RPC");
    if (state.rpcError) return { data: null, error: state.rpcError };
    if (state.unavailable) return { data: null, error: { code: "PGRST202", message: "Missing function" } };
    let data;
    try { data = await f.command(args.p_command, args.p_payload, { role: state.role, actor: state.actor }); }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    if (state.loseConfirmation) { state.loseConfirmation = false; throw new Error("Synthetic lost acknowledgement after commit"); }
    return { data: state.malformed ? { id: "unverified" } : data, error: null };
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
    const actionPath = require.resolve("../../lib/actions/collaboration-workflows.ts"); delete require.cache[actionPath];
    action = require(actionPath).collaborationWorkflowAction;
    const routePath = require.resolve("../../app/api/collaboration-workflows/route.ts"); delete require.cache[routePath];
    post = require(routePath).POST;
  } finally { Module._load = original; }
  return { ...f, state, action, post };
}
