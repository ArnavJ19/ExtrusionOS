import assert from 'node:assert/strict';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {createRequire} from 'node:module';
import {createFinishingWorkloadFixture,workloadIds as f} from '../scripts/lib/finishing-workload-fixture.mjs';
const require=createRequire(import.meta.url);require('tsx/cjs');const {loadFinishingWorkload,getFinishingWorkloadOptions,finishingWorkloadHref}=require('../lib/workflow/finishing-workload.ts');

test('finishing workload reader validates complete scope, quantities, pages and retry identities',async context=>{
  const fixture=await createFinishingWorkloadFixture(),options=getFinishingWorkloadOptions({});
  try{
    await fixture.reset();await fixture.partial();await fixture.retryComplete();const valid=JSON.parse(JSON.stringify(await fixture.workload()));
    const read=data=>loadFinishingWorkload({rpc:async()=>({data,error:null})},f.company,options);
    await context.test('the actual SQL response is consumed by one real Supabase RPC request',async()=>{
      const calls=[],client=createClient('http://127.0.0.1:54321','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,request)=>{
        calls.push({url:String(url),body:JSON.parse(request.body),method:request.method});return new Response(JSON.stringify(valid),{status:200,headers:{'Content-Type':'application/json'}});}}});
      const result=await loadFinishingWorkload(client,f.company,options);assert.equal(result.summary.remaining_rejected_kg,5);
      assert.deepEqual(calls,[{url:'http://127.0.0.1:54321/rest/v1/rpc/get_finishing_workload',method:'POST',body:{p_order_id:null,p_production_job_id:null,p_finishing_job_id:null,p_status:'',p_search:'',p_sort:'planned_date',p_direction:'asc',p_page:1}}]);
    });
    const mutations={foreignCompany:d=>d.company_id=f.otherVendor,wrongOrderScope:d=>d.order_id=f.order,wrongProductionScope:d=>d.production_job_id=f.job,
      missingRecordScope:d=>delete d.finishing_job_id,integrityFalse:d=>d.integrity_ok=false,missingIntegrity:d=>delete d.integrity_ok,
      countMismatch:d=>d.scope_count++,totalMismatch:d=>d.total_count++,activeMismatch:d=>d.summary.active_count=1,wrongPage:d=>d.page=2,oversizedPage:d=>d.page_size=200,
      missingRows:d=>d.rows.pop(),duplicateRows:d=>d.rows[1]=d.rows[0],foreignRow:d=>d.rows[0].company_id=f.otherVendor,
      missingQueue:d=>delete d.queues.rejected,wrongQueueStatus:d=>d.queues.rejected[0].status='planned',truncatedQueue:d=>d.queues.rejected=[],duplicateQueue:d=>d.queues.rejected.push(d.queues.rejected[0]),
      negativeWeight:d=>d.summary.remaining_rejected_kg=-1,booleanWeight:d=>d.summary.pending_input_kg=false,nonfinite:d=>d.summary.pending_input_kg=Infinity,
      precision:d=>d.summary.remaining_rejected_kg=5.0001,unsafe:d=>d.summary.remaining_rejected_kg=Number.MAX_SAFE_INTEGER,
      wrongBalance:d=>d.summary.recorded_difference_kg=1,vendorOutsideCompany:d=>d.vendors[0].company_id=f.otherVendor,
      duplicateVendor:d=>d.vendors.push(d.vendors[0]),wrongRetryInput:d=>d.queues.rejected[0].corrective_retry.input_weight_kg=95,
      selfRetry:d=>d.queues.rejected[0].corrective_retry.id=d.queues.rejected[0].id,wrongRemaining:d=>d.queues.rejected[0].remaining_rejected_kg=55,
      duplicateRetryOffer:d=>d.queues.rejected[0].can_retry=true,invalidDate:d=>d.queues.rejected[0].received_date='2026-02-31',nullTerminalOutput:d=>d.queues.rejected[0].output_weight_kg=null};
    for(const [name,mutate]of Object.entries(mutations))await context.test(`${name} is unavailable rather than a usable workload`,async()=>{
      const data=structuredClone(valid);mutate(data);await assert.rejects(read(data),/could not be verified/);
    });
    await context.test('unavailable RPC results do not trigger a capped REST fallback',async()=>{
      for(const result of [{data:null,error:null},{data:null,error:{message:'Missing RPC'}},{data:[],error:null}])await assert.rejects(loadFinishingWorkload({rpc:async()=>result,from:()=>assert.fail('No fallback')},f.company,options),/could not be verified/);
    });
    await context.test('verified empty scope remains a valid zero workload',async()=>{
      const data=await fixture.workload({production:f.otherVendor});const result=await loadFinishingWorkload({rpc:async()=>({data,error:null})},f.company,getFinishingWorkloadOptions({production_job_id:f.otherVendor}));assert.equal(result.scope_count,0);assert.equal(result.summary.remaining_rejected_kg,0);
    });
    await context.test('query options and pagination preserve literal search and exact source scopes',()=>{
      const selected=getFinishingWorkloadOptions({order_id:f.order,production_job_id:f.job,status:'rejected',q:" O'Reilly %_ ",sort:'input_weight_kg',direction:'desc',page:'2'});
      assert.equal(selected.search,"O'Reilly %_");const href=finishingWorkloadHref('/production/finishing/database',selected,{page:3}),url=new URL(href,'http://127.0.0.1');
      assert.equal(url.searchParams.get('page'),'3');assert.equal(url.searchParams.get('order_id'),f.order);assert.equal(url.searchParams.get('production_job_id'),f.job);assert.equal(url.searchParams.get('q'),"O'Reilly %_");
    });
    for(const params of [{order_id:'not-uuid'},{production_job_id:'bad'},{page:'0'},{page:'2.1'},{page:'Infinity'},{status:'bad'},{sort:';sql'},{direction:'UP'},{q:'x'.repeat(101)}])await context.test(`invalid options ${JSON.stringify(params)} are not silently broadened`,()=>assert.throws(()=>getFinishingWorkloadOptions(params)));
  }finally{await fixture.close();}
});
