import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createFinishingWorkloadFixture,workloadIds as f} from '../scripts/lib/finishing-workload-fixture.mjs';

test('finishing workload follows original material through corrective retries',async context=>{
  const fixture=await createFinishingWorkloadFixture();
  try{
    await context.test('the final retry leaves five rejected kilograms and ninety accepted kilograms',async()=>{
      await fixture.reset();await fixture.partial();await fixture.retryComplete();const before=await fixture.snapshot(),data=await fixture.workload({production:f.job});
      assert.equal(data.integrity_ok,true);assert.equal(Number(data.summary.original_input_kg),95);assert.equal(Number(data.summary.accepted_output_kg),90);
      assert.equal(Number(data.summary.remaining_rejected_kg),5);assert.equal(Number(data.summary.pending_input_kg),0);assert.equal(Number(data.summary.recorded_difference_kg),0);
      assert.equal(data.summary.active_count,0);assert.equal(data.scope_count,2);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('a planned retry transfers fifty-five kilograms out of rejected stock into pending work',async()=>{
      await fixture.reset();await fixture.partial();await fixture.retry();const data=await fixture.workload();assert.equal(data.integrity_ok,true);
      assert.equal(Number(data.summary.remaining_rejected_kg),0);assert.equal(Number(data.summary.pending_input_kg),55);assert.equal(Number(data.summary.accepted_output_kg),40);assert.equal(data.summary.active_count,1);
    });
    await context.test('terminal retry metadata survives the bounded queue preview',async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=await fixture.retryComplete(),data=await fixture.workload();
      const row=data.queues.rejected.find(row=>row.id===original);assert.equal(row.corrective_retry.id,retry);assert.equal(row.corrective_retry.status,'completed');assert.equal(row.can_retry,false);
      assert.equal(Number(row.rejection_weight_kg),55);assert.equal(Number(row.remaining_rejected_kg),0);assert.equal(data.status_counts.completed,1);
    });
    await context.test('a rejected source without a retry retains its fifty-five kilograms as remaining rejection',async()=>{
      await fixture.reset();await fixture.partial();const data=await fixture.workload();assert.equal(Number(data.summary.remaining_rejected_kg),55);assert.equal(data.summary.retry_eligible_count,1);assert.equal(data.queues.rejected[0].can_retry,true);
    });
    await context.test('three generations reconcile accepted and unresolved material without counting transferred input twice',async()=>{
      await fixture.reset();const original=await fixture.partial(),first=(await fixture.retry(original)).rows[0].id;await fixture.move('in_process',{},first);
      await fixture.move('rejected',{received:'2026-10-19',output:30,rejected:25,remarks:'Second corrective processing'},first);const last=(await fixture.retry(first)).rows[0].id;
      await fixture.move('in_process',{},last);await fixture.move('completed',{received:'2026-10-19',output:20,rejected:5},last);
      const data=await fixture.workload();assert.equal(data.integrity_ok,true);assert.equal(Number(data.summary.original_input_kg),95);assert.equal(Number(data.summary.accepted_output_kg),90);assert.equal(Number(data.summary.remaining_rejected_kg),5);assert.equal(Number(data.summary.recorded_difference_kg),0);
    });
    await context.test('provisional receipt output remains pending until the disposition is final',async()=>{
      await fixture.reset();await fixture.move('in_process');await fixture.move('received',{received:'2026-10-19',output:40,rejected:55});const data=await fixture.workload();
      assert.equal(data.integrity_ok,true);assert.equal(Number(data.summary.pending_input_kg),95);assert.equal(Number(data.summary.accepted_output_kg),0);assert.equal(Number(data.summary.remaining_rejected_kg),0);assert.equal(Number(data.summary.recorded_difference_kg),0);
    });
    await context.test('a recorded process difference stays distinct from both rejection and accepted output',async()=>{
      await fixture.reset();await fixture.move('in_process');await fixture.move('completed',{received:'2026-10-19',output:88,rejected:5});const data=await fixture.workload();
      assert.equal(data.integrity_ok,true);assert.equal(Number(data.summary.original_input_kg),95);assert.equal(Number(data.summary.accepted_output_kg),88);assert.equal(Number(data.summary.remaining_rejected_kg),5);assert.equal(Number(data.summary.recorded_difference_kg),2);
    });
    await context.test('three-decimal receipts retain exact mass-balance totals across retries',async()=>{
      await fixture.reset();await fixture.move('in_process');await fixture.move('rejected',{received:'2026-10-19',output:32.125,rejected:62.875,remarks:'Measured corrective portion'});
      const retry=(await fixture.retry()).rows[0].id;await fixture.move('in_process',{},retry);await fixture.move('completed',{received:'2026-10-19',output:61.875,rejected:1},retry);
      const data=await fixture.workload();assert.equal(Number(data.summary.accepted_output_kg),94);assert.equal(Number(data.summary.remaining_rejected_kg),1);assert.equal(Number(data.summary.recorded_difference_kg),0);
    });
    await context.test('all 401 queued records contribute to totals while preview and database pages stay bounded',async()=>{
      await fixture.reset();await fixture.seedQueue(400);const before=await fixture.snapshot(),data=await fixture.workload();
      assert.equal(data.integrity_ok,true);assert.equal(data.scope_count,401);assert.equal(data.summary.active_count,401);assert.equal(Number(data.summary.pending_input_kg),38095);assert.equal(data.queues.planned.length,10);assert.equal(data.rows.length,10);assert.equal(data.total_count,401);
      const page2=await fixture.workload({page:2});assert.equal(page2.rows.length,10);assert.equal(new Set([...data.rows,...page2.rows].map(row=>row.id)).size,20);
      const last=await fixture.workload({page:100000});assert.equal(last.page,41);assert.equal(last.rows.length,1);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('search metacharacters are literal and status filtering does not discard retry accounting',async()=>{
      await fixture.reset();await fixture.partial();await fixture.retryComplete();
      await fixture.db.query('update orders set order_number=$1 where id=$2',["ORDER O'Reilly %_()",f.order]);
      const match=await fixture.workload({search:"O'Reilly %_()",status:'completed'});assert.equal(match.total_count,1);assert.equal(Number(match.summary.accepted_output_kg),90);assert.equal(Number(match.summary.remaining_rejected_kg),5);
      assert.equal((await fixture.workload({search:'NOT-THERE_%'})).total_count,0);assert.equal((await fixture.workload({search:"' OR TRUE --"})).total_count,0);
    });
    for(const sort of ['planned_date','created_at','order_number','status','input_weight_kg','output_weight_kg','rejection_weight_kg'])await context.test(`sorting by ${sort} remains stable in both directions`,async()=>{
      await fixture.reset();await fixture.partial();await fixture.retryComplete();for(const direction of ['asc','desc']){
        const a=await fixture.workload({sort,direction}),b=await fixture.workload({sort,direction});assert.deepEqual(a.rows,b.rows);assert.equal(a.rows.length,2);
      }
    });
    for(const role of ['owner','admin','factory_manager','production_manager','production','quality','viewer'])await context.test(`${role} can read finishing workload through authenticated execution`,async()=>{
      await fixture.reset();await fixture.db.query("select set_config('test.role',$1,false)",[role]);await fixture.db.exec('set role authenticated;');
      try{const data=await fixture.workload();assert.equal(data.company_id,f.company);assert.equal(data.integrity_ok,true);}finally{await fixture.db.exec('reset role;');}
    });
    for(const role of ['sales','accounts','dispatch','dispatch_manager','inventory_manager','dealer_admin','dealer_staff',''])await context.test(`${role||'inactive identity'} cannot access finishing workload`,async()=>{
      await fixture.reset();await fixture.db.query("select set_config('test.role',$1,false)",[role]);await assert.rejects(fixture.workload(),/Permission denied/);
    });
    await context.test('missing authentication and anonymous execution are denied',async()=>{
      await fixture.reset();await fixture.db.query("select set_config('test.actor','',false)");await assert.rejects(fixture.workload(),/Authentication required/);
      assert.equal((await fixture.db.query("select has_function_privilege('anon','public.get_finishing_workload(uuid,uuid,uuid,text,text,text,text,integer)','execute') allowed")).rows[0].allowed,false);
    });
    await context.test('another company sees no source records and cannot discover a foreign receipt by id',async()=>{
      await fixture.reset();const original=await fixture.partial();await fixture.db.query("select set_config('test.company',$1,false)",[f.otherVendor]);
      const data=await fixture.workload({production:f.job});assert.equal(data.scope_count,0);assert.equal(data.total_count,0);assert.equal(data.vendors.length,0);await assert.rejects(fixture.workload({record:original}),/not found/);
    });
    for(const [name,options] of Object.entries({pageZero:{page:0},pageNull:{page:null},status:{status:'unknown'},sort:{sort:'1;drop table'},direction:{direction:'UP'},search:{search:'a'.repeat(101)}}))await context.test(`invalid ${name} is rejected before exposing a result`,async()=>{
      await fixture.reset();await assert.rejects(fixture.workload(options),/Invalid/);
    });
    const badHistory={foreignSource:"production_job_id='00000000-0000-4000-8000-000000000099'",wrongOrder:"order_id='00000000-0000-4000-8000-000000000099'",wrongRoute:"finishing_type='anodizing'",
      invalidInput:'input_weight_kg=0',invalidOutput:"output_weight_kg='NaN'",excessOutput:'output_weight_kg=1000',unknownStatus:"status='unknown'",missingReceipt:'received_date=null',futureReceipt:"received_date='2099-01-01'",reversedReceipt:"received_date='2026-10-15'",foreignVendor:"vendor_id='00000000-0000-4000-8000-000000000099'"};
    for(const [label,change]of Object.entries(badHistory))await context.test(`deliberately injected historical ${label} does not establish verified totals`,async()=>{
      await fixture.reset();const original=await fixture.partial();
      // This disposable legacy-data injection is separate from writer acceptance; live guards remain required.
      await fixture.db.exec('alter table finishing_jobs disable trigger user;');await fixture.db.query(`update finishing_jobs set ${change} where id=$1`,[original]);await fixture.db.exec('alter table finishing_jobs enable trigger user;');
      const before=await fixture.snapshot(),data=await fixture.workload();assert.equal(data.integrity_ok,false);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('an inconsistent historical retry input is rejected by the complete-chain review',async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=(await fixture.retry(original)).rows[0].id;
      await fixture.db.exec('alter table finishing_jobs disable trigger user;');await fixture.db.query('update finishing_jobs set input_weight_kg=56 where id=$1',[retry]);await fixture.db.exec('alter table finishing_jobs enable trigger user;');assert.equal((await fixture.workload()).integrity_ok,false);
    });
    for(const [scope,column,options]of [
      ['production','production_job_id',{production:f.job}],['order','order_id',{order:f.order}],['company','company_id',{production:f.job}]
    ])await context.test(`a historical retry outside the selected ${scope} cannot establish a verified retry offer`,async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=(await fixture.retry(original)).rows[0].id;
      await fixture.db.exec('alter table finishing_jobs disable trigger user;');await fixture.db.query(`update finishing_jobs set ${column}=$1 where id=$2`,[f.otherVendor,retry]);await fixture.db.exec('alter table finishing_jobs enable trigger user;');
      const before=await fixture.snapshot(),data=await fixture.workload(options);assert.equal(data.integrity_ok,false);
      assert.equal(JSON.stringify(data).includes(retry),false);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('a historical retry cycle cannot hide outside the bounded preview',async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=(await fixture.retry(original)).rows[0].id;
      await fixture.db.exec('alter table finishing_jobs disable trigger user;');await fixture.db.query('update finishing_jobs set retry_of_finishing_job_id=$1 where id=$2',[retry,original]);await fixture.db.exec('alter table finishing_jobs enable trigger user;');assert.equal((await fixture.workload()).integrity_ok,false);
    });
    await context.test('duplicate historical original input is flagged before summaries can be used',async()=>{
      await fixture.reset();await fixture.db.exec('alter table finishing_jobs disable trigger user;');
      await fixture.db.query("insert into finishing_jobs(company_id,order_id,production_job_id,finishing_type,status,input_weight_kg)values($1,$2,$3,'powder_coating','planned',95)",[f.company,f.order,f.job]);await fixture.db.exec('alter table finishing_jobs enable trigger user;');assert.equal((await fixture.workload()).integrity_ok,false);
    });
    await context.test('a small recorded negative balance is retained as a difference rather than called physical gain',async()=>{
      await fixture.reset();await fixture.db.query('update finishing_jobs set input_weight_kg=80 where id=$1',[fixture.jobId]);await fixture.move('in_process');await fixture.move('completed',{received:'2026-10-19',output:80.005,rejected:0});
      const data=await fixture.workload();assert.equal(data.integrity_ok,true);assert.equal(Number(data.summary.recorded_difference_kg),-0.005);assert.equal(Number(data.summary.remaining_rejected_kg),0);
    });
    await context.test('new internal source columns do not enter the public operational projection',async()=>{
      await fixture.db.exec('alter table finishing_jobs add column fixture_internal_cost numeric default 999;');await fixture.reset();await fixture.partial();
      const data=await fixture.workload();assert.doesNotMatch(JSON.stringify(data),/fixture_internal_cost|internal_cost|supplier_rate|margin|profit/);
    });
    await context.test('catalog preflight requires a stable security-definer reader with anonymous execution closed',async()=>{
      await fixture.reset();const source=readFileSync(new URL('../sql/audit-deployment-preflight.sql',import.meta.url),'utf8'),start=source.indexOf('-- R20 finishing workload');assert.ok(start>=0);
      const row=(await fixture.db.query(source.slice(start,source.indexOf(';',start)+1))).rows[0];assert.equal(row.present,true);assert.equal(row.security_definer,true);assert.equal(row.volatility,'s');assert.equal(row.authenticated_execute,true);assert.equal(row.anonymous_execute,false);assert.match(row.definition_md5,/^[a-f0-9]{32}$/);
    });
  }finally{await fixture.close();}
});
