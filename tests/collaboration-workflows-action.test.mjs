import test from "node:test";
import assert from "node:assert/strict";
import { createCollaborationActionFixture } from "../scripts/lib/collaboration-action-fixture.mjs";
import { ids, id, procedureInput } from "../scripts/lib/collaboration-workflow-fixture.mjs";
let f;
const request = extra => ({ command: "discussions.post", entity_type: "order", entity_id: ids.order, body: "Confirm drawing revision B", reference: "Approved drawing", mentions: [ids.colleague], reply_to: null, request_id: id(1100), ...extra });
test.before(async () => { f = await createCollaborationActionFixture(); });
test.beforeEach(async () => { await f.reset(); Object.assign(f.state, { role: "owner", actor: ids.actor, companyId: ids.company, dealerId: null, authenticated: true, calls: [], paths: [], loseConfirmation: false, unavailable: false, cacheError: false, rpcError: null, malformed: false }); });
test.after(async () => { await f?.close(); });

test("the real collaboration action rejects forged context, disallowed roles and malformed payloads before RPC", async () => {
  f.state.authenticated = false; assert.equal((await f.action(request())).success, false); f.state.authenticated = true;
  for (const role of ["viewer", "dealer_admin", "unknown"]) { f.state.role = role; assert.equal((await f.action(request())).success, false); }
  f.state.role = "owner"; f.state.dealerId = id(500); assert.equal((await f.action(request())).success, false); f.state.dealerId = null;
  for (const extra of [{ company_id: ids.otherCompany }, { recorded_by: ids.otherActor }, { request_id: "bad" }, { body: "\u0007" }, { mentions: [id(1), id(2), id(3), id(4)] }]) assert.equal((await f.action(request(extra))).success, false);
  assert.equal(f.state.calls.length, 0);
});
test("a confirmed discussion derives company and author server-side and invalidates the exact source", async () => {
  assert.deepEqual(await f.action(request()), { success: true, data: { id: id(1100) } });
  assert.equal(f.state.calls[0].name, "collaboration_workflow_command"); assert.equal("company_id" in f.state.calls[0].args.p_payload, false);
  assert.deepEqual((await f.db.query("select company_id,recorded_by from record_discussions")).rows[0], { company_id: ids.company, recorded_by: ids.actor });
  assert.ok(f.state.paths.includes(`/orders/${ids.order}`));
});
test("lost acknowledgements remain uncertain and exact retries create one discussion and one mention", async () => {
  f.state.loseConfirmation = true; assert.equal((await f.action(request())).uncertain, true);
  assert.equal((await f.action(request())).success, true);
  assert.equal((await f.db.query("select count(*)::int n from record_discussions")).rows[0].n, 1);
  assert.equal((await f.db.query("select count(*)::int n from notifications")).rows[0].n, 1);
  assert.equal((await f.action(request({ body: "Different request" }))).success, false);
});
test("missing migrations are explicit and cache failures preserve confirmed ownership writes", async () => {
  f.state.unavailable = true; assert.equal((await f.action(request())).unavailable, true); f.state.unavailable = false; f.state.cacheError = true;
  assert.equal((await f.action({ command: "procedures.create", ...procedureInput() })).success, true);
});
test("malformed confirmations and unexpected database failures never leak content or pretend success", async () => {
  f.state.malformed = true; assert.equal((await f.action(request())).uncertain, true); f.state.malformed = false;
  assert.equal((await f.action(request())).success, true);
  for (const message of ["SECRET DATABASE CONTENT", "WORKFLOW: SECRET DATABASE CONTENT"]) { f.state.rpcError = { code: "P0001", message }; const result = await f.action(request()); assert.equal(result.success, false); assert.doesNotMatch(JSON.stringify(result), /SECRET|CONTENT/); }
});
test("the actual HTTP endpoint rejects foreign origins, non-JSON and broken JSON before RPC", async () => {
  const url = "https://extrusionos.invalid/api/collaboration-workflows";
  assert.equal((await f.post(new Request(url, { method: "POST", body: "{}" }))).status, 415);
  assert.equal((await f.post(new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://foreign.invalid" }, body: "{}" }))).status, 403);
  assert.equal((await f.post(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status, 400);
  assert.equal(f.state.calls.length, 0);
  const good = await f.post(new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://extrusionos.invalid" }, body: JSON.stringify(request()) }));
  assert.equal((await good.json()).success, true);
});
