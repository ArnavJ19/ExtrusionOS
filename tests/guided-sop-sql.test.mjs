import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuidedFixture,eids} from '../scripts/lib/guided-sop-fixture.mjs';
let f;
test.before(async()=>{f=await createGuidedFixture()});
test.beforeEach(async()=>f.reset());
test.after(async()=>f?.close());
const call=(name,task,rev,extra={},actor=eids.operator)=>f.cmd(name,{task_id:task,expected_revision:rev,...extra},actor);
async function doneSteps(task,job){await f.record(task,1,1);await f.record(task,2,2,{value:15});return f.record(task,3,3,{source_id:job});}

test('65: reviewed plan, ordered work, durable resume and database completion guard',async()=>{
 await f.plan(); const {task,job}=await f.start();
 await assert.rejects(f.db.query("update tasks set status='completed' where id=$1",[task]),/guided procedure/);
 await assert.rejects(f.record(task,1,2,{value:15}),/current step/);
 const v=await doneSteps(task,job);assert.equal(v.next_step,null);
 assert.equal((await f.cmd('run.load',{task_id:task})).run.revision,4);
 await call('run.complete',task,4);assert.equal((await f.cmd('run.load',{task_id:task})).run.status,'completed');
 await f.db.query("update tasks set status='open',completed_at=null where id=$1",[task]);
 assert.equal((await f.cmd('run.load',{task_id:task})).run.attempt,2);
 await assert.rejects(call('run.complete',task,1),/Start or resume/);
 await f.cmd('run.start',{task_id:task});
 await assert.rejects(call('run.complete',task,1),/every step/);
});
test('65: another employee and stale browser cannot replace an observation',async()=>{
 await f.plan();const {task}=await f.start();await assert.rejects(f.record(task,1,1,{},eids.operator2),/assigned performer/);
 const id=f.nextId();const p={task_id:task,expected_revision:1,id,step_no:1,note:'Isolated at switchboard'};
 await f.cmd('step.record',p);assert.equal((await f.cmd('step.record',p)).run.revision,2);
 await assert.rejects(f.cmd('step.record',{...p,note:'Changed note'}),/different details/);
 await assert.rejects(f.record(task,1,2,{value:15}),/execution changed/);
 await assert.rejects(f.db.query("delete from sop_step_events where id=$1",[id]),/retained as history/);
});
test('65: a task cannot be inserted already completed to bypass required execution',async()=>{
 await f.plan();await assert.rejects(f.db.query("insert into tasks(company_id,task_type,status) values($1,'die_change','completed')",[eids.company]),/guided procedure/);
});
test('65/77: a release taking effect at start chooses its matching execution rules',async()=>{
 await f.plan();const task=await f.task();
 await f.db.exec("create or replace function private.ist_today() returns date language sql stable as $$select coalesce(nullif(current_setting('test.today',true),'' )::date,(now() at time zone 'Asia/Kolkata')::date)$$");
 const date=(await f.db.query('select (private.ist_today()+1)::text d')).rows[0].d;
 const draft=await f.versions('draft.save',{procedure_id:eids.sop,version_id:f.nextId(),steps:[{text:'Use the newly approved method'}],change_summary:'Scheduled revision',expected_hash:null},eids.sopOwner);
 await f.versions('draft.submit',{version_id:draft.id,expected_hash:draft.content_hash},eids.sopOwner);
 await f.versions('review.release',{version_id:draft.id,expected_hash:draft.content_hash,effective_from:date,in_flight_policy:'move_unstarted'},eids.sopBackup);
 const plan=await f.cmd('plan.save',{id:f.nextId(),version_id:draft.id,steps:[{step_no:1,kind:'check'}],normal_role:null,elevated_role:'quality'},eids.sopOwner);
 await f.cmd('plan.release',{version_id:draft.id,expected_revision:plan.revision},eids.sopBackup);
 await f.db.query("select set_config('test.today',$1,false)",[date]);
 try {
  const view=await f.cmd('run.start',{task_id:task});assert.equal(view.steps.length,1);
  assert.equal((await f.db.query('select version_id from task_procedure_bindings where task_id=$1',[task])).rows[0].version_id,draft.id);
  await f.record(task,1,1);await call('run.complete',task,2);
  assert.equal((await f.cmd('run.load',{task_id:task})).run.status,'completed');
 } finally {await f.db.query("select set_config('test.today','',false)");}
});
test('65: reassigned work starts a new attempt without losing the first employee evidence',async()=>{
 await f.plan();const {task}=await f.start();await f.record(task,1,1);
 await f.db.query('update tasks set assigned_to=$2 where id=$1',[task,eids.operator2]);
 await assert.rejects(f.record(task,2,2,{value:15}),/assigned performer/);
 const next=await f.cmd('run.start',{task_id:task},eids.operator2);assert.equal(next.run.attempt,2);assert.equal(next.next_step,1);
 const history=(await f.db.query("select r.status,e.actor_id from sop_runs r join sop_step_events e on e.run_id=r.id where r.task_id=$1",[task])).rows;
 assert.deepEqual(history,[{status:'superseded',actor_id:eids.operator}]);
});
test('65/70: a procedure task cannot change dealership to escape its completion guards',async()=>{
 await f.plan();const {task}=await f.start();
 await assert.rejects(f.db.query('update tasks set dealership_id=$2 where id=$1',[task,f.nextId()]),/cannot move to another company or dealership/);
});
test('66: out-of-range result follows review then independent rework and retains each measurement',async()=>{
 await f.plan();const {task}=await f.start();await f.record(task,1,1);
 const held=await f.record(task,2,2,{value:22});assert.equal(held.steps[1].evidence.outcome,'review');assert.equal(held.next_step,2);
 await assert.rejects(f.record(task,3,2,{value:15}),/outside the approved range/);
 await assert.rejects(call('step.retry',task,3,{id:f.nextId(),step_no:2,note:'Rework and measure again'}),/independent authorized/);
 await call('step.retry',task,3,{id:f.nextId(),step_no:2,note:'Rework and measure again'},eids.sopBackup);
 const good=await f.record(task,4,2,{value:10});assert.equal(good.next_step,3);assert.equal(good.run.required_role,'quality');
 assert.equal((await f.db.query('select count(*)::int n from sop_step_events where step_no=2')).rows[0].n,3);
});
test('66: inclusive limits, finite numbers and unreviewed rules',async()=>{
 await f.plan();const {task}=await f.start();await f.record(task,1,1);
 await assert.rejects(f.record(task,2,2,{value:'NaN'}),/finite measurement/);
 await assert.rejects(f.record(task,2,2,{value:null}),/finite measurement/);
 assert.equal((await f.record(task,2,2,{value:20})).steps[1].valid,true);
 const version=await f.release();await f.cmd('plan.save',{id:f.nextId(),version_id:version.id,steps:f.config,normal_role:null,elevated_role:'quality'},eids.sopOwner);
 await assert.rejects(f.cmd('run.start',{task_id:await f.task()}),/no reviewed execution plan/);
});
test('68: evidence must be same-company, related and currently eligible; reversal invalidates completion',async()=>{
 await f.plan();const {task,job}=await f.start();await f.record(task,1,1);await f.record(task,2,2,{value:15});
 const unrelated=f.nextId();await f.db.query("insert into production_jobs values($1,$2,'completed')",[unrelated,eids.company]);
 await assert.rejects(f.record(task,3,3,{source_id:unrelated}),/unavailable, unrelated/);
 await f.record(task,3,3,{source_id:job});await f.db.query("update production_jobs set status='on_hold' where id=$1",[job]);
 assert.equal((await f.cmd('run.load',{task_id:task})).next_step,3);
 await assert.rejects(call('run.complete',task,4),/current evidence/);
 await f.db.query("update production_jobs set company_id=$2 where id=$1",[job,eids.otherCompany]);
 await assert.rejects(f.record(task,4,3,{source_id:job}),/unavailable, unrelated/);
});
test('70: elevated task requires authorized independent verification and rechecks changed risk',async()=>{
 await f.plan();const {task,job}=await f.start('urgent');await doneSteps(task,job);
 await assert.rejects(call('run.complete',task,4),/Independent verification/);
 await call('run.submit',task,4);
 await assert.rejects(call('run.verify',task,5,{note:'Checked the sample'}),/different employee/);
 await call('run.verify',task,5,{note:'Hardness and job evidence checked'},eids.sopBackup);
 await call('run.complete',task,6);assert.equal((await f.cmd('run.load',{task_id:task})).run.verified_by,eids.sopBackup);
});
test('68: ten old ineligible inspections cannot hide the related approved evidence',async()=>{
 await f.plan([f.config[0],f.config[1],{step_no:3,kind:'transaction',source_type:'quality_inspection',states:['approved']}]);
 const {task,job}=await f.start();let approved;
 for(let n=0;n<12;n++){const id=f.nextId();await f.db.query('insert into quality_inspections(id,company_id,production_job_id,status) values($1,$2,$3,$4)',[id,eids.company,job,n===11?'approved':'pending']);if(n===11)approved=id;}
 const view=await f.cmd('run.load',{task_id:task});assert.deepEqual(view.steps[2].options.map(o=>o.id),[approved]);
});
test('70: a late risk increase and changed evidence cannot use an earlier clearance',async()=>{
 await f.plan();const {task,job}=await f.start();await doneSteps(task,job);
 await f.db.query("update tasks set priority='high' where id=$1",[task]);
 await assert.rejects(call('run.complete',task,4),/Independent verification/);
 await call('run.submit',task,4);await call('run.verify',task,5,{note:'All checked'},eids.sopBackup);
 await f.db.query("update production_jobs set status='on_hold' where id=$1",[job]);
 await assert.rejects(call('run.complete',task,6),/current evidence/);
 await f.db.query("update production_jobs set status='completed' where id=$1",[job]);
 await f.record(task,6,3,{source_id:job}).catch(e=>assert.match(e.message,/current step/));
});
test('70: the verification queue and UI reflect a changed risk and retain returned findings',async()=>{
 await f.plan(f.config,'production_manager');const {task,job}=await f.start();await doneSteps(task,job);
 await call('run.submit',task,4);
 assert.equal((await f.cmd('review.queue',{},eids.sopOwner)).total_count,1);
 await f.db.query("update tasks set priority='urgent' where id=$1",[task]);
 assert.equal((await f.cmd('review.queue',{},eids.sopOwner)).total_count,0);
 assert.equal((await f.cmd('review.queue',{},eids.sopBackup)).total_count,1);
 const changed=await f.cmd('run.load',{task_id:task},eids.sopBackup);assert.equal(changed.run.required_role,'quality');
 await f.db.query("update production_jobs set status='on_hold' where id=$1",[job]);
 await call('run.return',task,5,{note:'Source completion was reversed; review the job'},eids.sopBackup);
 await f.db.query("update production_jobs set status='completed' where id=$1",[job]);
 const result=await f.cmd('run.load',{task_id:task});assert.equal(result.run.status,'active');
 assert.equal(result.verification_history[0].decision,'returned');
 assert.equal(result.next_step,3);await f.record(task,6,3,{source_id:job});
 await call('run.submit',task,7);await call('run.verify',task,8,{note:'Job completion independently rechecked'},eids.sopBackup);
 const verified=await f.cmd('run.load',{task_id:task});assert.equal(verified.verification_history.length,2);assert.equal(verified.run.verification_current,true);
 await assert.rejects(f.db.query('delete from sop_verification_events where run_id=$1',[verified.run.id]),/retained as history/);
});
test('70: returning a valid-looking measurement requires new downstream evidence',async()=>{
 await f.plan(f.config,'quality');const {task,job}=await f.start();await doneSteps(task,job);await call('run.submit',task,4);
 const returned=await call('run.return',task,5,{note:'The sample location was wrong; repeat from hardness measurement',step_no:2},eids.sopBackup);
 assert.equal(returned.next_step,2);assert.equal(returned.steps[0].valid,true);assert.equal(returned.steps[2].valid,false);
 await f.record(task,6,2,{value:16});await f.record(task,7,3,{source_id:job});
 assert.equal((await f.cmd('run.load',{task_id:task})).next_step,null);
 assert.equal((await f.db.query("select count(*)::int n from sop_step_events where event='measurement'")).rows[0].n,2,'both actual measurements are retained');
});
test('70: normal verification cannot masquerade as elevated verification after a priority change',async()=>{
 await f.plan(f.config,'production_manager');const {task,job}=await f.start();await doneSteps(task,job);
 await call('run.submit',task,4);await call('run.verify',task,5,{note:'Normal task verified'},eids.sopOwner);
 await f.db.query("update tasks set priority='high' where id=$1",[task]);
 const changed=await f.cmd('run.load',{task_id:task});assert.equal(changed.run.verification_current,false);assert.equal(changed.run.required_role,'quality');
 await assert.rejects(call('run.complete',task,6),/Independent verification/);
});
test('plan review refuses self approval, stale changes, incomplete configuration and cross-company use',async()=>{
 const v=await f.release();const save={id:f.nextId(),version_id:v.id,steps:f.config,normal_role:null,elevated_role:'quality'};
 await assert.rejects(f.cmd('plan.save',{...save,steps:[f.config[0]]},eids.sopOwner),/every instruction/);
 await assert.rejects(f.cmd('plan.save',{...save,elevated_role:'viewer'},eids.sopOwner),/verification role/);
 await assert.rejects(f.cmd('plan.save',{...save,steps:[f.config[0],f.config[1],{...f.config[2],states:[null]}]},eids.sopOwner),/valid accepted transaction states/);
 await assert.rejects(f.cmd('plan.save',{...save,steps:[f.config[0],{...f.config[1],min:'10'},f.config[2]]},eids.sopOwner),/valid limits and a unit/);
 await assert.rejects(f.cmd('plan.save',{...save,steps:[{step_no:1,kind:'check',bypass:true},f.config[1],f.config[2]]},eids.sopOwner),/valid step and evidence kind/);
 await f.cmd('plan.save',save,eids.sopOwner);
 await assert.rejects(f.cmd('plan.release',{version_id:v.id,expected_revision:1},eids.sopOwner),/different reviewer/);
 await assert.rejects(f.cmd('plan.release',{version_id:v.id,expected_revision:9},eids.sopBackup),/plan changed/);
 await f.cmd('plan.release',{version_id:v.id,expected_revision:1},eids.sopBackup);
 await assert.rejects(f.cmd('plan.save',save,eids.sopOwner),/kept unchanged/);
 await assert.rejects(f.cmd('plan.load',{version_id:v.id},eids.foreign),/unavailable/);
 await assert.rejects(f.asUser('select * from sop_runs',[],eids.operator),/permission denied/);
 await assert.rejects(f.cmd('plan.load',{version_id:v.id},eids.dealer),/not permitted/);
});
test('70: the server pages and searches the verification queue before returning rows',async()=>{
 await f.plan(f.config,'quality');
 for(let n=0;n<12;n++){const {task,job}=await f.start(n===11?'urgent':'normal');await f.db.query('update tasks set title=$2 where id=$1',[task,`Sample ${String(n).padStart(2,'0')}`]);await doneSteps(task,job);await call('run.submit',task,4);}
 const first=await f.cmd('review.queue',{},eids.sopBackup);const second=await f.cmd('review.queue',{page:2},eids.sopBackup);
 assert.equal(first.rows.length,10);assert.equal(second.rows.length,2);assert.equal(second.total_count,12);
 const elevated=await f.cmd('review.queue',{risk:'elevated',search:'Sample 11',sort:'newest'},eids.sopBackup);assert.equal(elevated.total_count,1);
 assert.equal((await f.cmd('review.queue',{search:'%'},eids.sopBackup)).total_count,0,'search is literal, not a SQL wildcard');
});
