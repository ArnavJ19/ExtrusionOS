import { readFileSync } from 'node:fs';
import { createProcedureEffectivenessFixture, eids } from './procedure-effectiveness-fixture.mjs';
export { eids };
export async function createGuidedFixture() {
  const f = await createProcedureEffectivenessFixture();
  await f.db.exec(`alter table tasks add column priority text not null default 'normal';
    create table quality_inspections(id uuid primary key, company_id uuid, production_job_id uuid,status text);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid,delivery_status text);`);
  await f.db.exec(readFileSync('supabase/migrations/20261028010000_guided_sop_execution.sql','utf8'));
  const reset = async () => {
    await f.db.exec('truncate sop_verification_events,sop_step_events,sop_runs,sop_execution_plans,quality_inspections,dispatches cascade');
    await f.reset();
  };
  const cmd = async (name,payload,actor=eids.operator) => (await f.asUser('select public.guided_sop_command($1,$2) data',[name,payload],actor))[0].data;
  const config = [{step_no:1,kind:'check'},{step_no:2,kind:'measurement',min:10,max:20,unit:'Webster'},{step_no:3,kind:'transaction',source_type:'production_job',states:['completed']}];
  const plan = async (steps=config, normal_role=null) => {
    const version=await f.release();
    const p=await cmd('plan.save',{id:f.nextId(),version_id:version.id,steps,normal_role,elevated_role:'quality'},eids.sopOwner);
    await cmd('plan.release',{version_id:version.id,expected_revision:p.revision},eids.sopBackup);
    return version;
  };
  const start = async (priority='normal') => {
    const task=await f.task(); const job=f.nextId();
    await f.db.query("insert into production_jobs(id,company_id,status) values($1,$2,'completed')",[job,eids.company]);
    await f.db.query("update tasks set related_entity_type='production_job',related_entity_id=$2,priority=$3 where id=$1",[task,job,priority]);
    return {task,job,view:await cmd('run.start',{task_id:task})};
  };
  const record = (task,revision,step_no,extras={},actor=eids.operator) => cmd('step.record',{task_id:task,expected_revision:revision,id:f.nextId(),step_no,note:'Confirmed at the press',...extras},actor);
  return {...f,reset,cmd,plan,start,record,config};
}
