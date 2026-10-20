import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPartialFinishingFixture,partialFinishingIds as f} from './lib/finishing-partial-retry-fixture.mjs';
import {createFinishingBoardPageFixture,finishingMetric} from './lib/finishing-board-page-fixture.mjs';
import {createFinishingWorkloadFixture} from './lib/finishing-workload-fixture.mjs';

if(process.argv.includes('--verify-candidate'))await verifyCandidate();
else{
const sql=await createPartialFinishingFixture(),page=createFinishingBoardPageFixture({originalPage:true});
try{
  await sql.reset();const original=await sql.partial(),retry=await sql.retryComplete(),before=await sql.snapshot();
  page.state.rows=JSON.parse(JSON.stringify(before.jobs)).map(row=>({...row,orders:{order_number:'ORDER-R20',customers:{company_name:'Synthetic company'}},production_jobs:{job_number:'PROD-R20'},vendors:{vendor_name:'Synthetic vendor'}}));
  const html=await page.render({production_job_id:f.job}),rejected=finishingMetric(html,'Rejected');assert.equal(rejected,'55.000 kg');
  page.state.errors.retries={message:'Synthetic retry lookup unavailable'};const retryError=await page.render({production_job_id:f.job});
  assert.match(retryError,/Could not verify corrective finishing retries/);assert.match(retryError,/Plan One Retry/);
  page.state.errors={finishing_jobs:{message:'Synthetic queue read unavailable'}};const readError=await page.render();
  assert.equal(finishingMetric(readError,'Open Jobs'),'0');assert.equal(finishingMetric(readError,'Rejected'),'0.000 kg');
  page.state.errors={};const source=page.state.rows[0];page.state.rows=Array.from({length:401},(_,n)=>({...source,id:`00000000-0000-4000-8000-${String(1000+n).padStart(12,'0')}`,status:'planned',retry_of_finishing_job_id:null,output_weight_kg:0,rejection_weight_kg:0}));
  const large=await page.render();assert.equal(finishingMetric(large,'Active Queue'),'200');assert.deepEqual(await sql.snapshot(),before);
  const report={finding:'R20',findingConfirmed:true,original,retry,recorded:{originalInputKg:95,originalAcceptedKg:40,transferredToRetryKg:55,retryAcceptedKg:50,remainingRejectedKg:5},
    observed:{rejectedMetricAfterRetry:rejected,failedRetryLookupStillOffersRetry:true,failedReadDisplaysOpenJobs:finishingMetric(readError,'Open Jobs'),failedReadDisplaysRejected:finishingMetric(readError,'Rejected'),queueRecords:401,displayedActiveQueue:finishingMetric(large,'Active Queue')},
    proof:'Actual server finishing page and workflow board rendered from actual persisted finishing/retry rows; synthetic REST/session transport and separate synthetic 401-row queue',
    boundary:'Read-only diagnostic. No hosted request, Supabase migration, real JWT/RLS, actual physical loss/gain, browser interaction, independent session or complete operator journey is proved.'};
  const output=resolve(process.argv[2]??'test-results/finishing-board');mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'finishing-board-diagnostic.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(resolve(output,'original-finishing-board.html'),html);
  console.log(JSON.stringify(report,null,2));
}finally{await sql.close();}
}

async function verifyCandidate(){
  const sql=await createFinishingWorkloadFixture(),page=createFinishingBoardPageFixture();
  page.state.rpcOverride=async(name,args)=>{assert.equal(name,'get_finishing_workload');return {data:JSON.parse(JSON.stringify(await sql.workload({order:args.p_order_id,production:args.p_production_job_id,record:args.p_finishing_job_id,status:args.p_status,search:args.p_search,sort:args.p_sort,direction:args.p_direction,page:args.p_page}))),error:null};};
  try{
    await sql.reset();await sql.partial();await sql.retryComplete();const before=await sql.snapshot(),html=await page.render(),data=await sql.workload();
    assert.equal(finishingMetric(html,'Remaining rejected'),'5.000 kg');assert.equal(finishingMetric(html,'Accepted receipts'),'90.000 kg');assert.equal(finishingMetric(html,'Active movements'),'0');assert.doesNotMatch(html,/Plan One Retry/);assert.deepEqual(await sql.snapshot(),before);
    const report={finding:'R20',candidateVerifiedInFixture:true,appliedToSupabase:false,recorded:{originalInputKg:95,acceptedKg:Number(data.summary.accepted_output_kg),remainingRejectedKg:Number(data.summary.remaining_rejected_kg),pendingInputKg:Number(data.summary.pending_input_kg),differenceKg:Number(data.summary.recorded_difference_kg)},
      observed:{remainingRejected:finishingMetric(html,'Remaining rejected'),accepted:finishingMetric(html,'Accepted receipts'),active:finishingMetric(html,'Active movements'),duplicateRetryOffered:false},
      proof:'Actual production/finishing/retry functions, extracted read projection, actual payload validator and server page; source data snapshots unchanged',
      boundary:'Synthetic identity and loopback transport; no Supabase migration, hosted JWT/RLS, physical process loss/gain or inventory reconciliation, independent sessions or full signed-in operator acceptance'};
    const output=resolve(process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'test-results/finishing-board');mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'finishing-board-regression.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(resolve(output,'verified-finishing-board.html'),html);console.log(JSON.stringify(report,null,2));
  }finally{await sql.close();}
}
