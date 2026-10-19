import assert from "node:assert/strict";
import test from "node:test";
import {createDieReadinessActionFixture,dieFixture as f,dieFixtureId as id} from "../scripts/lib/die-readiness-action-fixture.mjs";

const fixture=createDieReadinessActionFixture(),{state}=fixture;
for(const status of [...fixture.statuses,"",null,"unknown","ACTIVE"," approved "]){
  test(`die status ${String(status)} has one queue/scheduling/handoff decision`,async()=>{
    fixture.reset(status);const expected=["active","approved"].includes(status);
    assert.equal(/>Ready</.test(fixture.renderQueue()),expected,"Queue must not overstate die readiness");
    assert.equal((await fixture.schedule()).success,expected);
    const saved=await fixture.production.saveProductionJobAction({order_id:f.order,profile_id:f.profile,die_id:f.die,machine_id:f.machine,
      planned_quantity_kg:10,source_line_id:id(16),status:"planned"});
    assert.equal(saved.success,expected,"Production creation must freshly enforce the same die status");
    const result=await fixture.handoffAttempt();assert.equal(result.calls.length,expected?1:0,"Handoff must not select an unusable die");
    assert.match(result.error,expected?/fixture-redirect:\/production/:/usable die/);
    for(const owner of [false,true])assert.equal(fixture.gate(status,owner).allowed,expected,"A dormant gate must not promise an unsupported override");
  });
}

test("the queue cannot mark missing or wrong-profile die evidence ready",()=>{
  for(const evidence of [{queueDieNumber:""},{queueProfile:null},{queueDieProfile:null},{queueDieProfile:id(99)}]){
    fixture.reset();Object.assign(state,evidence);assert.equal(/>Ready</.test(fixture.renderQueue()),false,JSON.stringify(evidence));
  }
});

test("handoff selects an approved alternative rather than an earlier correction die",async()=>{
  fixture.reset("under_correction");state.dieRows=[
    {id:f.die,company_id:f.company,profile_id:f.profile,die_status:"under_correction"},
    {id:id(11),company_id:f.company,profile_id:f.profile,die_status:"approved"}];
  const result=await fixture.handoffAttempt();assert.equal(result.calls.length,1);assert.equal(result.calls[0].args.p_jobs[0].die_id,id(11));
});

test("handoff rejects a stale current die status before the atomic writer",async()=>{
  fixture.reset();assert.equal((await fixture.handoffAttempt()).calls.length,1);
  state.dieStatus="nitriding";state.calls=[];state.paths=[];const result=await fixture.handoffAttempt();
  assert.equal(result.calls.length,0);assert.match(result.error,/usable die/);assert.deepEqual(state.paths,[]);
});

test("handoff and scheduling preserve company/profile rejection",async()=>{
  for(const change of [{dieCompany:id(99)},{dieProfile:id(99)}]){
    fixture.reset();Object.assign(state,change);assert.equal((await fixture.schedule()).success,false);
    assert.equal((await fixture.handoffAttempt()).calls.length,0);assert.deepEqual(state.calls,[]);
  }
});

test("unavailable die reads never fall back to unverified handoff",async()=>{
  fixture.reset();state.errors.dies=new Error("Synthetic die catalogue unavailable");
  const result=await fixture.handoffAttempt();assert.match(result.error,/catalogue unavailable/);assert.deepEqual(state.calls,[]);assert.deepEqual(state.paths,[]);
});

test("denied roles do not inspect or schedule production sources",async()=>{
  fixture.reset();state.role="viewer";assert.equal((await fixture.schedule()).success,false);
  const result=await fixture.handoffAttempt();assert.match(result.error,/fixture-redirect:\/dashboard/);assert.deepEqual(state.queries,[]);assert.deepEqual(state.calls,[]);
});

test("an approved die cannot reopen a closed order for scheduling",async()=>{
  for(const stage of ["closed","cancelled","delivered","payment_pending"]){
    fixture.reset("approved");state.orderStage=stage;assert.equal((await fixture.schedule()).success,false);assert.deepEqual(state.calls,[]);
  }
});
