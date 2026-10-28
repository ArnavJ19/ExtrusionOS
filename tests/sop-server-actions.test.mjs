import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const id='00000000-0000-4000-8000-000000000001';
const state={role:'owner',dealerId:null,authenticated:true,calls:[],paths:[],cacheError:false,rpcError:null};
const require=createRequire(import.meta.url);require('tsx/cjs');
const Module=require('node:module'),original=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='@/lib/auth')return {getSessionContext:async()=>{if(!state.authenticated)throw Error('Authentication required');return {role:state.role,dealerId:state.dealerId,userId:id,companyId:id};}};
 if(request==='@/lib/supabase/server')return {createClient:async()=>({rpc:async(name,args)=>{state.calls.push({name,args});return {data:{confirmed:true},error:state.rpcError};}})};
 if(request==='next/cache')return {revalidatePath:path=>{state.paths.push(path);if(state.cacheError)throw Error('Cache refresh failed');}};
 return original.call(this,request,parent,isMain);
};
let guided,assurance,requirements,effectiveness;
try {
 ({guidedSopAction:guided,sopAssuranceAction:assurance}=require('../lib/actions/guided-sop.ts'));
 ({customerRequirementAction:requirements}=require('../lib/actions/customer-step-requirements.ts'));
 ({procedureEffectivenessAction:effectiveness}=require('../lib/actions/procedure-effectiveness.ts'));
}finally{Module._load=original;}
test.beforeEach(()=>{Object.assign(state,{role:'owner',dealerId:null,authenticated:true,calls:[],paths:[],cacheError:false,rpcError:null});});

test('SOP server actions refuse unauthenticated and dealership-less dealer sessions before any RPC',async()=>{
 const requests=[[guided,{command:'run.load',task_id:id}],[assurance,{command:'policy.load',task_id:id}],[effectiveness,{command:'outcomes',procedure_id:id}],[requirements,{command:'customer.list',customer_id:id}]];
 for(const role of ['dealer_admin','dealer_staff']){state.role=role;for(const [action,payload]of requests)assert.equal((await action(payload)).success,false);}
 state.role='owner';state.authenticated=false;for(const [action,payload]of requests)assert.equal((await action(payload)).success,false);
 assert.equal(state.calls.length,0);
});
test('SOP server actions reject injected company identity and invalid versions before any write',async()=>{
 const p={command:'step.record',task_id:id,id,step_no:1,expected_revision:1,note:'Switch isolated'};
 assert.equal((await guided({...p,company_id:id})).success,false);
 assert.equal((await guided({...p,expected_revision:0})).success,false);
 assert.equal((await assurance({command:'recovery.record',id,task_id:id,reference:'TMP-001',observed_at:'tomorrow',observation:'Actual sample'})).success,false);
 assert.equal((await requirements({command:'acknowledge',order_id:id,stage:'quality',requirement_id:id,expected_revision:1,note:'Checked',company_id:id})).success,false);
 assert.equal(state.calls.length,0);
});
test('SOP server actions send only validated payloads and preserve a confirmed write across cache failure',async()=>{
 state.cacheError=true;
 const calls=[[guided,{command:'run.return',task_id:id,expected_revision:2,step_no:1,note:'Repeat the incorrect observation'},'guided_sop_command'],
 [assurance,{command:'trial.review',id,expected_revision:1,decision:'retain',note:'Observed work followed the method'},'sop_assurance_command'],
 [requirements,{command:'acknowledge',order_id:id,stage:'quality',requirement_id:id,expected_revision:1,note:'Batch certificate checked'},'customer_requirement_command'],
 [effectiveness,{command:'flag.dismiss',flag_id:id,reason:'Covered by the new instruction'},'procedure_effectiveness_command']];
 for(const [action,payload,rpc]of calls){const result=await action(payload);assert.equal(result.success,true);const call=state.calls.at(-1);assert.equal(call.name,rpc);assert.equal(call.args.p_command,payload.command);assert.ok(!('command'in call.args.p_payload));assert.ok(!('company_id'in call.args.p_payload));}
 assert.ok(state.paths.includes('/tasks'));assert.ok(state.paths.includes('/customers'));
});
test('read-only and wrong-stage sessions cannot approve or acknowledge work',async()=>{
 state.role='viewer';assert.equal((await guided({command:'run.verify',task_id:id,expected_revision:1,note:'Self approval'})).success,false);
 assert.equal((await effectiveness({command:'improvement.trial',improvement_id:id,trial_plan:'Run a trial'})).success,false);
 state.role='production';assert.equal((await requirements({command:'acknowledge',order_id:id,stage:'dispatch',requirement_id:id,expected_revision:1,note:'Unsupported stage'})).success,false);
 assert.equal(state.calls.length,0);
});
test('current business refusals reach the caller and unexpected database failures are bounded',async()=>{
 const payload={command:'run.complete',task_id:id,expected_revision:3};
 state.rpcError={code:'23514',message:'Required transaction evidence changed. Review the guided procedure'};
 assert.equal((await guided(payload)).error,state.rpcError.message);
 state.rpcError={code:'XX000',message:'internal failure: secret row detail'};assert.doesNotMatch((await guided(payload)).error,/secret row|internal failure/);
 state.rpcError={code:'PGRST202',message:'Missing RPC'};assert.match((await guided(payload)).error,/unavailable/);
});
