import test from "node:test";
import assert from "node:assert/strict";
import { createOperatorActionFixture } from "../scripts/lib/operator-action-fixture.mjs";
import { workflowIds as ids, workflowId as id } from "../scripts/lib/operator-workflow-fixture.mjs";
let f;
const request = extra => ({ command: "exceptions.report", job_id: ids.job, reason: "material_shortage", note: "Source was not at the rack", request_id: id(100), ...extra });
test.before(async () => { f = await createOperatorActionFixture(); });
test.beforeEach(async () => { await f.reset(); Object.assign(f.state, { role: "owner", actor: ids.actor, companyId: ids.company, dealerId: null, authenticated: true, calls: [], paths: [], loseConfirmation: false, unavailable: false, cacheError: false, rpcError: null }); });
test.after(async () => { await f?.close(); });

test("the real server action validates roles, session and strict input before querying", async () => {
  f.state.role = "viewer"; assert.equal((await f.action(request())).success, false);
  f.state.role = "owner"; f.state.dealerId = id(500); assert.equal((await f.action(request())).success, false);
  f.state.dealerId = null; f.state.authenticated = false; assert.equal((await f.action(request())).success, false);
  f.state.authenticated = true;
  for (const extra of [{ company_id: ids.otherCompany }, { recorded_by: ids.otherActor }, { reason: "invented" }, { request_id: "bad" }, { recorded_at: "2026-10-10" }]) assert.equal((await f.action(request(extra))).success, false);
  assert.equal(f.state.calls.length, 0);
});

test("the real server action reaches SQL and returns minimal derived confirmation", async () => {
  const result = await f.action(request()); assert.equal(result.success, true); assert.deepEqual(result.data, { id: id(100) });
  assert.equal(f.state.calls[0].name, "operator_workflow_command"); assert.equal("company_id" in f.state.calls[0].args.p_payload, false);
  const row = (await f.db.query("select company_id,recorded_by from production_exceptions")).rows[0];
  assert.deepEqual(row, { company_id: ids.company, recorded_by: ids.actor });
});

test("a lost acknowledgement is uncertain and retrying the same request creates no duplicate", async () => {
  f.state.loseConfirmation = true; const lost = await f.action(request()); assert.equal(lost.success, false); assert.equal(lost.uncertain, true);
  const confirmed = await f.action(request()); assert.equal(confirmed.success, true);
  assert.equal((await f.db.query("select count(*)::int n from production_exceptions")).rows[0].n, 1);
  assert.equal((await f.action(request({ note: "Different report" }))).success, false);
});

test("a missing migration is explicit, and cache failure cannot turn a confirmed write into uncertainty", async () => {
  f.state.unavailable = true; const missing = await f.action(request()); assert.equal(missing.success, false); assert.equal(missing.unavailable, true); assert.notEqual(missing.uncertain, true);
  f.state.unavailable = false; f.state.cacheError = true; assert.equal((await f.action(request())).success, true);
});

test("the actual HTTP route rejects non-JSON and foreign-origin writes before invoking the action", async () => {
  const badType = await f.post(new Request("https://extrusionos.invalid/api/operator-workflows", { method: "POST", body: JSON.stringify(request()) }));
  assert.equal(badType.status, 415);
  const foreign = await f.post(new Request("https://extrusionos.invalid/api/operator-workflows", { method: "POST", headers: { "content-type": "application/json", origin: "https://untrusted.invalid" }, body: JSON.stringify(request()) }));
  assert.equal(foreign.status, 403); assert.equal(f.state.calls.length, 0);
  const good = await f.post(new Request("https://extrusionos.invalid/api/operator-workflows", { method: "POST", headers: { "content-type": "application/json", origin: "https://extrusionos.invalid" }, body: JSON.stringify(request()) }));
  assert.equal(good.status, 200); assert.equal((await good.json()).success, true);
});

test("unexpected trigger errors cannot return raw database details to the browser", async () => {
  f.state.rpcError = { code: "P0001", message: "SECRET DATABASE CONTENT FROM A DIFFERENT TRIGGER" };
  const result = await f.action(request()); assert.equal(result.success, false); assert.doesNotMatch(JSON.stringify(result), /SECRET|TRIGGER/);
  assert.notEqual(result.uncertain, true);
});
