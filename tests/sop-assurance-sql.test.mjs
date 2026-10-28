import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGuidedFixture,eids} from '../scripts/lib/guided-sop-fixture.mjs';
let f;
test.before(async()=>{f=await createGuidedFixture();await f.db.exec(readFileSync('supabase/migrations/20261028020000_sop_recovery_and_observation.sql','utf8'));});
test.beforeEach(async()=>{await f.db.exec('truncate sop_observed_trials,sop_recovery_notes,sop_continuity_policies cascade');await f.reset();});
test.after(async()=>f?.close());
const cmd=async(name,p,actor=eids.operator)=>(await f.asUser('select public.sop_assurance_command($1,$2) data',[name,p],actor))[0].data;
async function setup(){await f.plan();const x=await f.start();await cmd('policy.save',{task_kind:'type:die_change',permitted_work:'Isolate press and record measured observations on numbered paper',prohibited_work:'Do not issue stock, approve quality or create dispatches offline',reconcile_role:'quality'},eids.owner);return x;}
test('78: numbered observations retain time and policy, retry exactly, reject ambiguous duplicates',async()=>{
 const {task}=await setup();const p={id:f.nextId(),task_id:task,reference:'OUT-2026-001',observation:'Measured hardness 15 Webster during outage',observed_at:new Date().toISOString()};
 const first=await cmd('recovery.record',p);assert.deepEqual(await cmd('recovery.record',p),first);
 await assert.rejects(cmd('recovery.record',{...p,id:f.nextId()}),/temporary reference already exists/);
 await assert.rejects(cmd('recovery.record',{...p,observation:'Changed physical measurement'}),/temporary reference already exists/);
 await assert.rejects(cmd('recovery.record',{...p,id:f.nextId(),reference:'OUT-002',observed_at:'2099-01-01T00:00:00Z'}),/actual observation time/);
 const rows=await cmd('recovery.list',{task_id:task});assert.equal(rows.total_count,1);assert.match(rows.rows[0].policy_snapshot.prohibited_work,/issue stock/);
 await assert.rejects(f.db.query("update sop_recovery_notes set observation='Replaced' where id=$1",[first.id]),/cannot be rewritten/);
});
test('78: recovery needs a distinct designated reviewer and a real related confirmed transaction',async()=>{
 const {task,job}=await setup();const payload={id:f.nextId(),task_id:task,reference:'OUT-003',observation:'Offline job completion noted',observed_at:new Date().toISOString()};await cmd('recovery.record',payload);
 const decision={id:payload.id,decision:'reconcile',note:'Matched recorded completion',source_type:'production_job',source_id:job};
 await assert.rejects(cmd('recovery.decide',decision),/independent reconciler/);
 await f.db.query("update production_jobs set status='in_progress' where id=$1",[job]);await assert.rejects(cmd('recovery.decide',decision,eids.sopBackup),/confirmed transaction/);
 await f.db.query("update production_jobs set status='completed' where id=$1",[job]);assert.equal((await cmd('recovery.decide',decision,eids.sopBackup)).status,'reconciled');
 const second={...payload,id:f.nextId(),reference:'OUT-004'};await cmd('recovery.record',second);
 await assert.rejects(cmd('recovery.decide',{...decision,id:second.id},eids.sopBackup),/already reconciled another temporary/);
 assert.equal((await f.db.query('select count(*)::int n from production_jobs')).rows[0].n,1,'continuity never posts stock or creates a second transaction');
});

test('78: reconciliation rechecks the source after acquiring its lock',async()=>{
 const {task,job}=await setup();const note={id:f.nextId(),task_id:task,reference:'OUT-LOCK',observation:'Offline job completion noted',observed_at:new Date().toISOString()};
 await cmd('recovery.record',note);
 const original=(await f.db.query("select pg_get_functiondef('private.lock_sop_source(uuid,text,uuid)'::regprocedure) source")).rows[0].source;
 // Model a reversal winning before the lock; PGlite cannot run two sessions.
 const interleaved=original.replace(/\bbegin\r?\n/,"begin\n  update public.production_jobs set status='in_progress' where id=p_id and company_id=p_company;\n");
 assert.notEqual(interleaved,original,'the fixture must reverse the source at the lock boundary');
 await f.db.exec(interleaved);
 try {
  await assert.rejects(cmd('recovery.decide',{id:note.id,decision:'reconcile',note:'Matched recorded completion',source_type:'production_job',source_id:job},eids.sopBackup),/confirmed transaction/);
  assert.equal((await f.db.query('select status from sop_recovery_notes where id=$1',[note.id])).rows[0].status,'pending');
 } finally {
  await f.db.exec(original);
 }
});
test('78: no continuity policy means no authorized offline work; policy edits are version checked',async()=>{
 await f.plan();const {task}=await f.start();const p={id:f.nextId(),task_id:task,reference:'TMP-001',observation:'Trial observation',observed_at:new Date().toISOString()};
 await assert.rejects(cmd('recovery.record',p),/No approved continuity/);
 await assert.rejects(cmd('policy.save',{task_kind:'type:die_change',permitted_work:'Observe',prohibited_work:'Never post',reconcile_role:'quality'}),/Only administrators/);
});
test('79: supervised observed work follows exact version, captures each step and requires independent owner review',async()=>{
 const {task}=await setup();const trial=await cmd('trial.start',{id:f.nextId(),task_id:task},eids.sopOwner);
 assert.equal(trial.employee_id,eids.operator);assert.equal(trial.version_id,(await f.db.query('select version_id from sop_execution_plans')).rows[0].version_id);
 await assert.rejects(cmd('trial.submit',{id:trial.id,expected_revision:1,findings:[],employee_feedback:'The order is clear'},eids.sopOwner),/each step exactly once/);
 const findings=[1,2,3].map(step_no=>({step_no,result:step_no===2?'unclear':'followed',note:'Observed employee at the press'}));
 const submitted=await cmd('trial.submit',{id:trial.id,expected_revision:1,findings,employee_feedback:'State the hardness sample location'},eids.sopOwner);
 assert.equal(submitted.status,'submitted');
 await assert.rejects(cmd('trial.review',{id:trial.id,expected_revision:2,decision:'revise',note:'Add sample location'},eids.sopOwner),/independent process owner/);
 const reviewed=await cmd('trial.review',{id:trial.id,expected_revision:2,decision:'revise',note:'Add the sample location to a new reviewed revision'},eids.owner);
 assert.equal(reviewed.decision,'revise');assert.equal(reviewed.reviewer_id,eids.owner);
 assert.ok(reviewed.improvement_id,'a revise decision opens a traced controlled improvement');
 assert.equal((await f.db.query('select baseline_version_id from procedure_improvements where id=$1',[reviewed.improvement_id])).rows[0].baseline_version_id,trial.version_id);
 await assert.rejects(f.db.query("update sop_observed_trials set employee_feedback='Replaced' where id=$1",[trial.id]),/cannot be rewritten/);
});
test('79: employees cannot self-observe, omit steps, use stale reviews or cross company boundaries',async()=>{
 const {task}=await setup();await assert.rejects(cmd('trial.start',{id:f.nextId(),task_id:task}),/supervisor/);
 await assert.rejects(cmd('trial.start',{id:f.nextId(),task_id:task},eids.foreign),/Task is unavailable/);
 const trial=await cmd('trial.start',{id:f.nextId(),task_id:task},eids.sopBackup);
 const p={id:trial.id,expected_revision:1,findings:[1,1,3].map(step_no=>({step_no,result:'followed',note:'Employee demonstrated'})),employee_feedback:'No concerns'};
 await assert.rejects(cmd('trial.submit',p,eids.sopBackup),/exactly once/);
 await assert.rejects(cmd('trial.submit',{...p,expected_revision:9},eids.sopBackup),/changed/);
 await assert.rejects(f.asUser('select * from sop_observed_trials'),/permission denied/);
 await assert.rejects(cmd('trial.list',{},eids.dealer),/not permitted/);
});
test('79: a process owner outside the factory supervisor roles can find and review their observed trial',async()=>{
 const {task}=await setup();const trial=await cmd('trial.start',{id:f.nextId(),task_id:task},eids.sopBackup);
 const findings=[1,2,3].map(step_no=>({step_no,result:'followed',note:'Employee demonstrated the written instruction'}));
 await cmd('trial.submit',{id:trial.id,expected_revision:1,findings,employee_feedback:'The method is understandable'},eids.sopBackup);
 await f.db.query("update app_users set role='sales_manager' where id=$1",[eids.sopOwner]);
 const listed=await cmd('trial.list',{task_id:task},eids.sopOwner);assert.equal(listed.rows.length,1);assert.equal(listed.rows[0].can_review,true);
 assert.equal((await cmd('trial.review',{id:trial.id,expected_revision:2,decision:'retain',note:'Observed method remains effective'},eids.sopOwner)).status,'reviewed');
});
