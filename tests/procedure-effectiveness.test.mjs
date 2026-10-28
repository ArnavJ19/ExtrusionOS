import test from 'node:test';
import assert from 'node:assert/strict';
import {effectivenessCommandSchema,outcomesSchema,improvementsSchema,improvementSchema,flagsSchema,percent} from '../lib/workflow/procedure-effectiveness.ts';
import {createProcedureEffectivenessFixture,eids} from '../scripts/lib/procedure-effectiveness-fixture.mjs';
test('80: ratios retain their denominator and missing evidence is not zero',()=>{assert.equal(percent(0,0),'Not captured');assert.equal(percent(2,3),'66.7% (2/3)');});
test('80: mutation schemas reject unexpected company fields, malformed steps and duplicate flags',()=>{
 const p={command:'flag.raise',id:eids.sop,task_id:eids.sop,step_no:2,kind:'unclear',note:'Sample location unclear'};
 assert.equal(effectivenessCommandSchema.safeParse(p).success,true);assert.equal(effectivenessCommandSchema.safeParse({...p,step_no:0}).success,false);assert.equal(effectivenessCommandSchema.safeParse({...p,company_id:eids.otherCompany}).success,false);
 assert.equal(effectivenessCommandSchema.safeParse({command:'improvement.propose',id:eids.sop,procedure_id:eids.sop,title:'Clarify',problem_summary:'Same flag twice',flag_ids:[eids.sop,eids.sop]}).success,false);
});
test('80: actual database responses match app contracts, and nullable backup never grants permission',async()=>{
 const f=await createProcedureEffectivenessFixture();try{await f.reset();await f.release();const task=await f.task();await f.command('flag.raise',{id:f.nextId(),task_id:task,step_no:1,kind:'unclear',note:'Which switch?'},eids.operator);
 assert.equal(outcomesSchema.parse(await f.command('outcomes',{procedure_id:eids.sop})).versions.length,1);assert.equal(flagsSchema.parse(await f.command('flags.list',{procedure_id:eids.sop})).rows.length,1);
 const p=await f.command('improvement.propose',{id:f.nextId(),procedure_id:eids.sop,title:'Clarify switch',problem_summary:'Operators choose different switches',flag_ids:[]},eids.operator);
 assert.equal(improvementsSchema.parse(await f.command('improvements.list',{procedure_id:eids.sop})).total_count,1);assert.equal(improvementSchema.parse(await f.command('improvement.load',{improvement_id:p.id})).title,p.title);
 await f.db.query('update operating_procedures set backup_id=null,backup_name=null where id=$1',[eids.sop]);
 assert.equal(outcomesSchema.parse(await f.command('outcomes',{procedure_id:eids.sop},eids.operator)).can_review,false);
 await assert.rejects(f.command('improvement.trial',{improvement_id:p.id,trial_plan:'Try a labeled diagram'},eids.operator),/Only the procedure owner/);
 await f.db.query('update tasks set assigned_to=null where id=$1',[task]);
 await assert.rejects(f.command('flag.raise',{id:f.nextId(),task_id:task,step_no:2,kind:'unclear',note:'No owner'},eids.operator2),/Only someone who worked/);
 }finally{await f.close();}
});
