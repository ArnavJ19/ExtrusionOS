import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guidedCommandSchema,assuranceCommandSchema,runViewSchema,planLoadSchema,queueSchema,recoveryListSchema,trialsListSchema} from '../lib/workflow/guided-sop.ts';
import {customerRequirementCommandSchema,canReviewRequirements,canManageCustomerRequirements} from '../lib/workflow/customer-step-requirements.ts';
import {createGuidedFixture,eids} from '../scripts/lib/guided-sop-fixture.mjs';
test('65: commands preserve revision checks and reject extra company identity',()=>{
 const x={command:'step.record',task_id:eids.sop,id:eids.sop,step_no:1,expected_revision:1,note:'Verified switch isolation'};
 assert.equal(guidedCommandSchema.safeParse(x).success,true);assert.equal(guidedCommandSchema.safeParse({...x,expected_revision:0}).success,false);assert.equal(guidedCommandSchema.safeParse({...x,company_id:eids.otherCompany}).success,false);
});
test('66: measurement boundaries are finite, ordered and unit-bearing',()=>{
 const x={command:'plan.save',id:eids.sop,version_id:eids.sop,normal_role:null,elevated_role:'quality',steps:[{step_no:1,kind:'measurement',min:0,max:1,unit:'mm'}]};
 assert.equal(guidedCommandSchema.safeParse(x).success,true);
 for(const step of [{step_no:1,kind:'measurement',min:2,max:1,unit:'mm'},{step_no:1,kind:'measurement',min:0,max:Infinity,unit:'mm'},{step_no:1,kind:'measurement',min:0,max:1,unit:''}])assert.equal(guidedCommandSchema.safeParse({...x,steps:[step]}).success,false);
});
test('68: transaction evidence names a supported source and allowed states',()=>{
 const x={command:'plan.save',id:eids.sop,version_id:eids.sop,normal_role:null,elevated_role:'quality',steps:[{step_no:1,kind:'transaction',source_type:'production_job',states:['completed']}]};
 assert.equal(guidedCommandSchema.safeParse(x).success,true);assert.equal(guidedCommandSchema.safeParse({...x,steps:[{...x.steps[0],source_type:'payroll'}]}).success,false);assert.equal(guidedCommandSchema.safeParse({...x,steps:[{...x.steps[0],states:[]}]}).success,false);
});
test('70: verification requires the saved revision and never accepts a browser supplied verifier',()=>{
 const x={command:'run.verify',task_id:eids.sop,expected_revision:2,note:'Reviewed observed hardness'};assert.equal(guidedCommandSchema.safeParse(x).success,true);assert.equal(guidedCommandSchema.safeParse({...x,verified_by:eids.operator}).success,false);
});
test('78: references are normalized and disconnected observations retain their real time',()=>{
 const x={command:'recovery.record',id:eids.sop,task_id:eids.sop,reference:' out-2026-01 ',observation:'Actual hardness 14 Webster',observed_at:'2026-10-28T12:10:00+05:30'};
 assert.equal(assuranceCommandSchema.parse(x).reference,'OUT-2026-01');assert.equal(assuranceCommandSchema.safeParse({...x,reference:'../../customer'}).success,false);assert.equal(assuranceCommandSchema.safeParse({...x,observed_at:'yesterday'}).success,false);
});
test('79: observed work must contain real findings and employee feedback',()=>{
 const x={command:'trial.submit',id:eids.sop,expected_revision:1,findings:[{step_no:1,result:'workaround',note:'Employee used a different sample location'}],employee_feedback:'The written location was unclear'};assert.equal(assuranceCommandSchema.safeParse(x).success,true);assert.equal(assuranceCommandSchema.safeParse({...x,findings:[]}).success,false);assert.equal(assuranceCommandSchema.safeParse({...x,employee_feedback:''}).success,false);
});
test('57: roles and revision-aware acknowledgement match work-stage boundaries',()=>{
 assert.ok(canReviewRequirements('quality','quality'));assert.ok(!canReviewRequirements('production','dispatch'));assert.ok(!canManageCustomerRequirements('dealer_admin'));
 const x={command:'acknowledge',order_id:eids.sop,requirement_id:eids.sop,stage:'quality',expected_revision:1,note:'Batch certificate reviewed'};assert.equal(customerRequirementCommandSchema.safeParse(x).success,true);assert.equal(customerRequirementCommandSchema.safeParse({...x,stage:'accounts'}).success,false);assert.equal(customerRequirementCommandSchema.safeParse({...x,expected_revision:0}).success,false);
});
test('65/70/78/79: real database responses parse against all screen contracts',async()=>{
 const f=await createGuidedFixture();try{await f.db.exec(readFileSync('supabase/migrations/20261028020000_sop_recovery_and_observation.sql','utf8'));await f.reset();const v=await f.plan();const {task}=await f.start();
 assert.equal(planLoadSchema.parse(await f.cmd('plan.load',{version_id:v.id})).plan.status,'released');assert.equal(runViewSchema.parse(await f.cmd('run.load',{task_id:task})).run.revision,1);assert.equal(queueSchema.parse(await f.cmd('review.queue',{},eids.sopBackup)).total_count,0);
 const cmd=async(name,p,actor=eids.owner)=>(await f.asUser('select public.sop_assurance_command($1,$2) data',[name,p],actor))[0].data;
 await cmd('policy.save',{task_kind:'type:die_change',permitted_work:'Isolate and observe',prohibited_work:'No stock transactions',reconcile_role:'quality'});
 await cmd('recovery.record',{id:f.nextId(),task_id:task,reference:'TMP-001',observation:'Temporary observation',observed_at:new Date().toISOString()},eids.operator);
 assert.equal(recoveryListSchema.parse(await cmd('recovery.list',{task_id:task})).total_count,1);
 await cmd('trial.start',{id:f.nextId(),task_id:task},eids.sopOwner);assert.equal(trialsListSchema.parse(await cmd('trial.list',{task_id:task})).rows[0].status,'observing');
 await f.db.query('update app_users set dealer_id=null where id=$1',[eids.dealer]);
 for(const [rpc,command,payload] of [
 ['procedure_version_command','versions.list',{procedure_id:eids.sop}],
 ['task_blueprint_command','blueprints.list',{}],
 ['procedure_effectiveness_command','outcomes',{procedure_id:eids.sop}],
 ['guided_sop_command','run.load',{task_id:task}],
 ['sop_assurance_command','policy.load',{task_id:task}]
 ])await assert.rejects(f.asUser(`select public.${rpc}($1,$2) data`,[command,payload],eids.dealer),/not permitted/i,'an unattached dealer role is still external');
 }finally{await f.close();}
});
