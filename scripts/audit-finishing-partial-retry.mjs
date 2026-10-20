import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createFinishingEvidenceFixture,finishingFixture as f} from "./lib/finishing-evidence-fixture.mjs";
import {createHistoricalTables,sqlDefinition} from "./lib/historical-schema-fixture.mjs";
import {createPartialFinishingFixture} from "./lib/finishing-partial-retry-fixture.mjs";

// Original-state diagnostic: R17 objects protect evidence, without changing disposition/handoff rules.
if(process.argv.includes('--verify-candidate'))await verifyCandidate();
else{
const fixture=await createFinishingEvidenceFixture({candidate:true}),{db}=fixture;
try{
  await createHistoricalTables(db,["quality_rework_resolutions"],"20261019010000");
  await db.exec(sqlDefinition("20261008020000_factory_workflow_integrity.sql","public.validate_quality_production_link"));
  await db.exec(`create trigger validate_quality_production_link before insert or update of company_id,production_job_id,finishing_job_id,
    profile_id,status,quantity_checked_kg,inspector_name,surface_finish_ok,resolution_id on quality_inspections
    for each row execute function public.validate_quality_production_link();`);
  await fixture.reset();const original=fixture.jobId;
  await fixture.move("sent_to_vendor",{vendor:f.vendor,sent:"2026-10-16"});
  await fixture.move("received",{received:"2026-10-18",output:40,rejected:55,remarks:"40 kg accepted; 55 kg requires corrective processing"});
  await fixture.move("rejected",{received:"2026-10-18",output:40,rejected:55,remarks:"40 kg accepted; 55 kg requires corrective processing"});
  const afterPartial=await fixture.snapshot();assert.equal(afterPartial.packaging.length,0);
  const retry=(await fixture.retry()).rows[0].id;
  await fixture.move("in_process",{},retry);await fixture.move("completed",{received:"2026-10-19",output:50,rejected:5,remarks:"Corrective finish: 50 kg accepted; 5 kg rejected"},retry);
  const afterRetry=await fixture.snapshot();
  assert.equal(afterRetry.packaging.length,1);assert.equal(Number(afterRetry.packaging[0].profile_weight_kg),50);
  assert.equal(Number(afterRetry.jobs.find(job=>job.id===retry).input_weight_kg),55);
  const qc=(job,weight)=>fixture.attempt(()=>db.query(`insert into quality_inspections(company_id,production_job_id,finishing_job_id,profile_id,
    inspection_date,quantity_checked_kg,status,inspector_name,surface_finish_ok) values($1,$2,$3,$4,now(),$5,'approved','Synthetic QC inspector',true) returning id`,
    [f.company,f.job,job,f.profile,weight]));
  let originalQcError;try{await qc(original,40);}catch(error){originalQcError=error.message;}
  assert.match(originalQcError,/QC finishing job must be completed/i);await qc(retry,50);
  const recordedAccepted=afterRetry.jobs.reduce((total,job)=>total+Number(job.output_weight_kg??0),0);
  const queuedPackaging=afterRetry.packaging.reduce((total,job)=>total+Number(job.profile_weight_kg??0),0);
  const approved=(await db.query("select coalesce(sum(quantity_checked_kg),0) weight from quality_inspections where company_id=$1 and production_job_id=$2 and status='approved'",[f.company,f.job])).rows[0].weight;
  assert.equal(recordedAccepted,90);assert.equal(queuedPackaging,50);assert.equal(Number(approved),50);
  assert.equal(95,recordedAccepted+5);assert.deepEqual(afterRetry.jobs.find(job=>job.id===original),afterPartial.jobs[0]);
  const report={finding:"R18",findingConfirmed:true,original,retry,afterPartial,afterRetry,
    recorded:{productionOutputKg:95,originalAcceptedKg:40,recoverableRetryInputKg:55,retryAcceptedKg:50,retryRejectedKg:5,totalAcceptedKg:recordedAccepted},
    observed:{queuedPackagingKg:queuedPackaging,approvedQcKg:Number(approved),originalQcError},
    conclusion:"The original 40 kg accepted portion becomes permanently ineligible for post-finishing QC and packaging after partial rejection. Completing the 55 kg corrective retry releases only its 50 kg output, despite 90 kg total recorded accepted output.",
    proof:"Actual production completion, finishing transition/retry, current QC source guard and finishing-to-packaging handoff SQL, with extracted R17 evidence guard; disposable persisted data",
    boundary:"Synthetic SQL identity and historical table setup; no Supabase migration, hosted write, full packaging/dispatch operator journey, JWT/RLS, independent-session or physical-inventory conclusion."};
  const output=resolve(process.argv[2]??"test-results/finishing-partial-retry");mkdirSync(output,{recursive:true});writeFileSync(resolve(output,"finishing-partial-retry-diagnostic.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({finding:report.finding,findingConfirmed:true,recorded:report.recorded,observed:report.observed,boundary:report.boundary},null,2));
}finally{await fixture.close();}
}

async function verifyCandidate(){
  const fixture=await createPartialFinishingFixture(),{db}=fixture;
  try{
    await fixture.reset();const original=await fixture.partial(),partial=await fixture.snapshot();assert.equal(partial.packaging.length,1);
    await fixture.qc(original,40);await fixture.pack(partial.packaging[0].id);
    await db.query("select set_config('test.role','dispatch_manager',false)");const first=await fixture.ready();assert.equal(Number(first.rows[0].ready_weight_kg),40);
    await db.query("select set_config('test.role','production_manager',false)");const retry=await fixture.retryComplete(),afterRetry=await fixture.snapshot();
    assert.deepEqual(afterRetry.jobs.find(row=>row.id===original),partial.jobs.find(row=>row.id===original));
    assert.equal(Number(afterRetry.jobs.find(row=>row.id===retry).input_weight_kg),55);assert.equal(afterRetry.packaging.length,2);
    await fixture.qc(retry,50);await fixture.pack(afterRetry.packaging.find(row=>row.finishing_job_id===retry).id);
    await db.query("select set_config('test.role','dispatch_manager',false)");const final=await fixture.ready();assert.equal(Number(final.rows[0].ready_weight_kg),90);
    await assert.rejects(fixture.assertDispatch(90.02),/exceeds/);await fixture.assertDispatch(90);const state=await fixture.snapshot();
    assert.equal(state.materialStock,98);assert.equal(state.movements.length,2);await db.exec('commit;begin;');assert.equal(Number((await fixture.ready()).rows[0].ready_weight_kg),90);
    const report={finding:'R18',candidateVerifiedInFixture:true,appliedToSupabase:false,
      original,correctiveRetry:retry,recorded:{productionOutputKg:95,originalAcceptedKg:40,retryInputKg:55,retryAcceptedKg:50,remainingRejectedKg:5,totalAcceptedKg:90},
      release:{beforeRetryKg:Number(first.rows[0].ready_weight_kg),afterRetryKg:Number(final.rows[0].ready_weight_kg),packagingMaterialStock:state.materialStock,packagingMaterialMovements:state.movements.length},state,
      proof:'Extracted candidate function, view, trigger and column objects with actual production/finishing/retry/QC/packaging/material/dispatch-readiness functions; explicit disposable transaction commit',
      boundary:'Not migration replay or hosted JWT/RLS/Storage proof. Synthetic identity and table fixture; actual physical dispatch posting, inventory reconciliation, independent-session concurrency and signed-in operator acceptance remain separate.'};
    const output=resolve(process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'test-results/finishing-partial-retry');mkdirSync(output,{recursive:true});
    writeFileSync(resolve(output,'finishing-partial-retry-regression.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,state:undefined},null,2));
  }finally{await fixture.close();}
}
