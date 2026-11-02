import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { coordinationCommandSchema, coordinationMutationSchema, compareOperationalWork, parseRecoveryMarker, actionRecoveryKey } from "../lib/workflow/coordination.ts";
import { createNov3ActionsFixture, nov3Outcome } from "../scripts/lib/nov-batch3-actions-fixture.mjs";
import { nids as i, nid } from "../scripts/lib/nov-batch3-fixture.mjs";

const f = createNov3ActionsFixture();
test.beforeEach(() => f.reset());
const mutation = () => ({ action: "priority.set", order_id: i.order, priority: "urgent", note: "Reviewed customer commitment" });
const preview = () => ({ command: "preview", request_id: nid(1000), mutation: mutation() });

test("NOV-097: input contracts reject injected identity, unknown actions, impossible dates and ambiguous units", () => {
  assert.equal(coordinationCommandSchema.safeParse({ ...preview(), company_id: i.foreignCompany }).success, false);
  assert.equal(coordinationCommandSchema.safeParse({ ...preview(), mutation: { ...mutation(), actor_id: i.foreign } }).success, false);
  for (const amount of [NaN, Infinity, -1, .001]) assert.equal(coordinationMutationSchema.safeParse({ action: "collection.create", invoice_id: i.invoice, employee_id: i.accounts, amount, due_date: "2026-11-03", note: "Reviewed promise" }).success, false);
  for (const due_date of ["2026-02-29", "2026-04-31", "2026-13-01", "03/11/2026"]) assert.equal(coordinationMutationSchema.safeParse({ action: "collection.create", invoice_id: i.invoice, employee_id: i.accounts, amount: 100, due_date, note: "Reviewed promise" }).success, false);
  assert.equal(coordinationMutationSchema.safeParse({ action: "collection.create", invoice_id: i.invoice, employee_id: i.accounts, amount: 100, due_date: "2028-02-29", note: "Reviewed promise" }).success, true);
  assert.equal(coordinationMutationSchema.safeParse({ action: "coverage.propose", primary_id: i.production, backup_id: i.backup, starts_at: "2026-11-03T10:00", ends_at: "2026-11-04T10:00", responsibility: "Work cover", note: "Reviewed coverage" }).success, false);
});

test("NOV-043: shared operational comparator is deterministic and transitive for varied priorities and dates", () => {
  fc.assert(fc.property(fc.array(fc.record({ id: fc.uuid(), priority: fc.constantFrom("urgent", "high", "normal", "low", null), due_date: fc.constantFrom(null, "2026-11-01", "2026-11-02", "2026-12-31") }), { maxLength: 60 }), rows => {
    const sorted = [...rows].sort(compareOperationalWork);
    assert.deepEqual([...rows].reverse().sort(compareOperationalWork), sorted);
    for (let n = 1; n < sorted.length; n++) assert.ok(compareOperationalWork(sorted[n-1], sorted[n]) <= 0);
  }), { numRuns: 150 });
});

test("NOV-098: recovery markers are scoped to actor/company, validated and retained beyond review expiry", () => {
  assert.notEqual(actionRecoveryKey(i.company, i.owner), actionRecoveryKey(i.company, i.accounts));
  assert.notEqual(actionRecoveryKey(i.company, i.owner), actionRecoveryKey(i.foreignCompany, i.owner));
  for (const raw of ["{", "null", "{}", JSON.stringify({ request_id: "bad", created_at: Date.now() }), JSON.stringify({ request_id: nid(1), created_at: Date.now(), mutation: mutation() })]) assert.equal(parseRecoveryMarker(raw), null);
  assert.equal(parseRecoveryMarker(JSON.stringify({ request_id: nid(1), created_at: 1 })).request_id, nid(1));
  assert.equal(parseRecoveryMarker(JSON.stringify({ request_id: nid(1), created_at: Date.now()+120000 })), null);
});

test("real server action rejects denied roles, dealer sessions and malformed payload before the RPC", async () => {
  for (const role of ["production", "sales", "viewer", "dealer_admin", "dealer_staff"]) { f.reset();f.state.context.role=role;assert.equal((await f.action(preview())).success,false);assert.equal(f.state.calls.length,0); }
  f.reset();f.state.context.dealerId=nid(90);assert.equal((await f.action(preview())).success,false);assert.equal(f.state.calls.length,0);
  f.reset();f.state.authenticated=false;assert.equal((await f.action(preview())).success,false);assert.equal(f.state.calls.length,0);
  f.reset();assert.equal((await f.action({ ...preview(), company_id: i.company })).success,false);assert.equal(f.state.calls.length,0);
  f.state.context.role="sales";assert.equal((await f.action({ command:"list",view:"collections" })).success,false);assert.equal(f.state.calls.length,0);
});

test("NOV-097/098: real server action preserves confirmed outcome, strips identity input and tolerates cache failure", async () => {
  f.state.response=nov3Outcome({ state:"confirmed",result:{label:"SO-NOV3-01",href:"/orders/"+i.order,message:"Priority recorded"} });f.state.revalidateThrows=true;
  const result=await f.action({command:"commit",request_id:nid(1000),fingerprint:"a".repeat(32)});
  assert.equal(result.success,true);assert.equal(result.data.state,"confirmed");
  assert.equal(f.state.calls[0].name,"coordination_command");assert.equal("company_id" in f.state.calls[0].payload.p_payload,false);assert.equal("actor_id" in f.state.calls[0].payload.p_payload,false);
});

test("NOV-098: lost response, malformed post-write response and generic errors remain uncertain", async () => {
  for(const setup of [()=>{f.state.throws=true;},()=>{f.state.malformed=true;},()=>{f.state.error={code:"",message:"transport failure containing secret table names"};}]){
    f.reset();setup();const result=await f.action(preview());assert.equal(result.success,false);assert.equal(result.uncertain,true);assert.doesNotMatch(result.error,/secret table/);
  }
  f.reset();f.state.error={code:"42501",message:"internal policy details"};assert.equal((await f.action(preview())).uncertain,undefined);
  f.reset();f.state.error={code:"P0001",message:"NOV: The profile changed. Review again."};assert.equal((await f.action(preview())).error,"The profile changed. Review again.");
  f.reset();f.state.error={code:"P0001",message:"internal private source data"};assert.doesNotMatch((await f.action(preview())).error,/private source/);
});

test("missing database and denied outcome reads never manufacture a successful result", async () => {
  f.state.error={code:"PGRST202",message:"function missing"};const result=await f.action({command:"list",view:"orders"});assert.equal(result.unavailable,true);assert.equal(result.success,false);
  f.reset();f.state.error={code:"42501",message:"secret tenant"};const denied=await f.action({command:"outcome",request_id:nid(1000)});assert.equal(denied.success,false);assert.doesNotMatch(denied.error,/secret tenant/);
});
