import assert from 'node:assert/strict';
import test from 'node:test';
import {createFinishingWorkloadFixture,workloadIds as f} from '../scripts/lib/finishing-workload-fixture.mjs';
import {createFinishingBoardPageFixture,finishingMetric} from '../scripts/lib/finishing-board-page-fixture.mjs';

test('actual finishing pages consume complete SQL workload and suppress unverified controls',async context=>{
  const sql=await createFinishingWorkloadFixture(),page=createFinishingBoardPageFixture();let override=null;
  page.state.rpcOverride=async(name,args)=>{assert.equal(name,'get_finishing_workload');if(override)return override;
    const result=await sql.db.query('select public.get_finishing_workload($1,$2,$3,$4,$5,$6,$7,$8) data',[args.p_order_id,args.p_production_job_id,args.p_finishing_job_id,args.p_status,args.p_search,args.p_sort,args.p_direction,args.p_page]);
    return {data:JSON.parse(JSON.stringify(result.rows[0].data)),error:null};};
  try{
    await context.test('original and completed corrective receipt show five remaining rejected and ninety accepted kilograms',async()=>{
      await sql.reset();await sql.partial();await sql.retryComplete();const html=await page.render({production_job_id:f.job});
      assert.equal(finishingMetric(html,'Remaining rejected'),'5.000 kg');assert.equal(finishingMetric(html,'Accepted receipts'),'90.000 kg');assert.equal(finishingMetric(html,'Active movements'),'0');
      assert.match(html,/A retry already exists with status Completed/);assert.doesNotMatch(html,/Plan One Retry/);assert.equal(page.state.queries.length,0);assert.match(html,/View Finishing Database/);assert.doesNotMatch(html,/<table/);
    });
    await context.test('the database preserves recorded rejection separately from remaining rejected material',async()=>{
      const html=await page.database({production_job_id:f.job,status:'rejected'});assert.match(html,/55.000 kg/);assert.match(html,/0.000 kg/);assert.match(html,/Recorded rejected/);assert.match(html,/Remaining rejected/);assert.match(html,/Corrective retry/);
    });
    await context.test('a completed receipt has an actual detail page and a link to its original rejected source',async()=>{
      const state=await sql.snapshot(),retry=state.jobs.find(row=>row.retry_of_finishing_job_id);const html=await page.receipt(retry.id);
      assert.match(html,/50.000 kg/);assert.match(html,/5.000 kg/);assert.match(html,/Open rejected source/);assert.match(html,/This terminal receipt is retained as evidence/);assert.doesNotMatch(html,/Plan One Retry/);
    });
    for(const label of ['RPC error','missing response','false integrity','malformed response'])await context.test(`${label} shows unavailable, without zero metrics or movement/retry controls`,async()=>{
      const data=await sql.workload();override=label==='RPC error'?{data:null,error:{message:'Synthetic read unavailable'}}:label==='missing response'?{data:null,error:null}:label==='false integrity'?{data:{...data,integrity_ok:false},error:null}:{data:{...data,summary:null},error:null};
      for(const render of [()=>page.render(),()=>page.database(),()=>page.receipt(data.rows[0].id)]){const html=await render();assert.match(html,/unavailable/i);assert.doesNotMatch(html,/Plan One Retry|Start Processing|No finishing receipts match|>Active movements<|>Remaining rejected<|matching receipts/);}
      override=null;
    });
    await context.test('invalid source filters do not broaden the request to the whole company',async()=>{
      const before=page.state.calls.length,html=await page.render({order_id:'bad-id'});assert.match(html,/unavailable/);assert.equal(page.state.calls.length,before);
    });
    for(const role of ['sales','sales_manager','accounts','dispatch','dispatch_manager','inventory_manager','dealer_admin','dealer_staff'])await context.test(`${role} cannot load the finishing pages`,async()=>{
      page.state.role=role;await assert.rejects(page.render(),/redirect:\/dashboard/);await assert.rejects(page.database(),/redirect:\/dashboard/);await assert.rejects(page.receipt(f.job),/redirect:\/dashboard/);
    });
    page.state.role='production_manager';
  }finally{await sql.close();}
});
