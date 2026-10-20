import assert from "node:assert/strict";
import test from "node:test";
import {createPartialFinishingFixture,installPartialFinishingCandidateObjects,partialFinishingIds as f} from "../scripts/lib/finishing-partial-retry-fixture.mjs";
import {createDispatchActionBoundaryFixture} from "../scripts/lib/dispatch-action-boundary-fixture.mjs";
import {sqlDefinition} from "../scripts/lib/historical-schema-fixture.mjs";
import {readFileSync} from "node:fs";
const historicalReview=readFileSync(new URL('../sql/audit-finishing-accepted-dispositions.sql',import.meta.url),'utf8');

test("partial finishing dispositions preserve independently released accepted portions",async context=>{
  const fixture=await createPartialFinishingFixture();
  const readyWeight=async()=>{await fixture.db.query("select set_config('test.role','dispatch_manager',false)");const data=await fixture.ready();await fixture.db.query("select set_config('test.role','production_manager',false)");return Number(data.rows[0]?.ready_weight_kg??0);};
  try{
    await context.test("the original accepted portion queues its own packaging handoff",async()=>{
      await fixture.reset();const original=await fixture.partial(),state=await fixture.snapshot();
      assert.equal(state.packaging.length,1);assert.equal(state.packaging[0].finishing_job_id,original);assert.equal(Number(state.packaging[0].profile_weight_kg),40);
    });
    await context.test("QC can approve exactly the original accepted portion before its retry completes",async()=>{
      await fixture.reset();const original=await fixture.partial();await fixture.qc(original,40);
      await assert.rejects(fixture.qc(original,0.02),/exceeds|available/i);
    });
    await context.test("the retry creates an independent package while the terminal original stays unchanged",async()=>{
      await fixture.reset();const original=await fixture.partial(),before=await fixture.snapshot(),retry=await fixture.retryComplete(),state=await fixture.snapshot();
      assert.deepEqual(state.jobs.find(row=>row.id===original),before.jobs.find(row=>row.id===original));assert.equal(state.packaging.length,2);
      assert.equal(Number(state.packaging.find(row=>row.finishing_job_id===retry).profile_weight_kg),50);
      assert.equal(state.packaging.reduce((total,row)=>total+Number(row.profile_weight_kg),0),90);
    });
    await context.test("only independently QC-approved and packaged portions contribute to dispatch readiness",async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=await fixture.retryComplete();
      const state=await fixture.snapshot();await fixture.qc(original,40);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===original).id);
      await fixture.db.query("select set_config('test.role','dispatch_manager',false)");
      const first=await fixture.ready();assert.equal(first.company_id,f.company);assert.equal(first.order_id,f.order);assert.equal(first.rows.length,1);
      assert.equal(Number(first.rows[0].ready_weight_kg),40);
      await fixture.db.query("select set_config('test.role','production_manager',false)");await fixture.qc(retry,50);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===retry).id);
      await fixture.db.query("select set_config('test.role','dispatch_manager',false)");const final=await fixture.ready();assert.equal(Number(final.rows[0].ready_weight_kg),90);
      assert.equal((await fixture.snapshot()).materialStock,98);
    });
    await context.test("actual dispatch preview and save validation consume the SQL readiness and complete shipment history",async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=await fixture.retryComplete(),state=await fixture.snapshot();
      for(const [finish,weight] of [[original,40],[retry,50]]){await fixture.qc(finish,weight);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===finish).id);}
      await fixture.db.query("select set_config('test.role','dispatch_manager',false)");
      const action=createDispatchActionBoundaryFixture();action.state.userId=f.actor;
      for(const table of Object.keys(action.tables))delete action.tables[table];
      Object.assign(action.tables,{orders:[{id:f.order,company_id:f.company}],profile_stock_reservations:[],packing_list_items:[],dispatches:[],
        production_jobs_authorized:(await fixture.db.query("select * from production_jobs where id=$1",[f.job])).rows,
        aluminium_profiles:[{id:f.profile,company_id:f.company,profile_code:"R18",profile_name:"Synthetic section"}]});
      action.state.rpcOverride=async(name,args)=>{if(name!=="get_finished_production_readiness")return undefined;assert.deepEqual(args,{p_order_id:f.order});return {data:await fixture.ready(),error:null};};
      const preview=await action.actions.getDispatchSourcesAction(f.order);assert.equal(preview.success,true,JSON.stringify(preview));assert.equal(preview.sources.length,1);assert.equal(preview.sources[0].availableWeightKg,90);
      const shipped="00000000-0000-4000-8000-000000000701";
      action.tables.dispatches.push({id:shipped,company_id:f.company,order_id:f.order});
      action.tables.packing_list_items.push({id:"00000000-0000-4000-8000-000000000702",company_id:f.company,dispatch_id:shipped,source_line_id:f.job,net_weight_kg:40,net_length_m:20,number_of_pieces:4});
      assert.equal((await action.actions.getDispatchSourcesAction(f.order)).sources[0].availableWeightKg,50);
      const input=weight=>({order_id:f.order,dispatch_date:"2026-10-19",delivery_status:"dispatched",bundles:[{bundle_number:"R18-BUNDLE",source_line_id:f.job,number_of_pieces:5,net_length_m:25,gross_weight_kg:weight+1,tare_weight_kg:1}]});
      const denied=await action.actions.saveDispatchAction(input(51));assert.equal(denied.success,false);assert.equal(action.state.calls.filter(call=>call.name==="save_ready_dispatch_atomic").length,0);
      const saved=await action.actions.saveDispatchAction(input(50));assert.equal(saved.success,true,JSON.stringify(saved));
      const calls=action.state.calls.filter(call=>call.name==="save_ready_dispatch_atomic");assert.equal(calls.length,1);
      assert.equal(calls[0].args.p_items[0].source_line_id,f.job);assert.equal(calls[0].args.p_items[0].net_weight_kg,50);
    });
    await context.test("SQL dispatch authority accepts the combined 90 kg and rejects material above that release",async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=await fixture.retryComplete(),state=await fixture.snapshot();
      for(const [finish,weight] of [[original,40],[retry,50]]){await fixture.qc(finish,weight);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===finish).id);}
      await fixture.assertDispatch(90);await assert.rejects(fixture.assertDispatch(0.02),/exceeds QC-released output/i);
    });
    await context.test("the original 55 kg retry input is never counted as newly accepted output",async()=>{
      await fixture.reset();const original=await fixture.partial();await fixture.retry();await fixture.qc(original,40);
      const state=await fixture.snapshot();await fixture.pack(state.packaging[0].id);assert.equal(await readyWeight(),40);
      await assert.rejects(fixture.qc(original,55),/exceeds/);assert.equal(await readyWeight(),40);
    });
    await context.test("QC approval for one portion cannot release another portion's packaging",async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=await fixture.retryComplete(),state=await fixture.snapshot();
      await fixture.qc(original,40);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===retry).id);assert.equal(await readyWeight(),0);
    });
    await context.test("the existing quality feature flag skips QC only and retains independent packaging caps",async()=>{
      await fixture.reset();await fixture.partial();await fixture.retryComplete();const state=await fixture.snapshot();
      await fixture.pack(state.packaging[0].id);const expected=Number(state.packaging[0].profile_weight_kg);
      await fixture.db.query("update feature_flags set is_enabled=false where company_id=$1",[f.company]);assert.equal(await readyWeight(),expected);
    });
    await context.test("duplicate root finishing cannot claim a second full production input",async()=>{
      await fixture.reset();const before=await fixture.snapshot();
      await assert.rejects(fixture.attempt(()=>fixture.db.query("insert into finishing_jobs(company_id,order_id,production_job_id,finishing_type,status,input_weight_kg)values($1,$2,$3,'powder_coating','planned',95)",[f.company,f.order,f.job])),/exceeds captured production/);
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("a final accepted portion requires a real, chronological receipt date",async()=>{
      for(const received of [null,"2026-10-15","2099-01-01"]){
        await fixture.reset();await fixture.move("sent_to_vendor",{vendor:f.vendor,sent:"2026-10-16"});const before=await fixture.snapshot();
        await assert.rejects(fixture.move("rejected",{received,output:40,rejected:55,remarks:"Partial accepted material"}),/receipt|evidence/i);
        assert.deepEqual(await fixture.snapshot(),before);
      }
    });
    await context.test("a rejected row cannot use a tiny rejection to bypass its accepted-output cap",async()=>{
      await fixture.reset();const before=await fixture.snapshot();await assert.rejects(fixture.move("rejected",{received:"2026-10-19",output:1000,rejected:0.001,remarks:"Invalid excess output"}),/quantity evidence|exceeds|rejection/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("positive accepted output stays excluded until the finishing disposition is final",async()=>{
      await fixture.reset();await fixture.move("in_process");await fixture.move("received",{received:"2026-10-19",output:40,rejected:55});
      const state=await fixture.snapshot();assert.equal(state.packaging.length,0);assert.equal(await readyWeight(),0);
      await assert.rejects(fixture.qc(fixture.jobId,40),/completed|final accepted/);
    });
    await context.test("package source identity and total packaged kilograms cannot be forged",async()=>{
      await fixture.reset();const original=await fixture.partial(),state=await fixture.snapshot(),packageId=state.packaging[0].id;
      await assert.rejects(fixture.createPackage(original,1),/exceeds/);
      await assert.rejects(fixture.attempt(()=>fixture.db.query("update packaging_jobs set finishing_job_id=$1 where id=$2",[f.otherVendor,packageId])),/source cannot be changed|receipt/i);
      await assert.rejects(fixture.pack(packageId,41),/exceeds/);
      assert.deepEqual(await fixture.snapshot(),state);
    });
    await context.test("separate partial packages can share a receipt only within its accepted capacity",async()=>{
      await fixture.reset();const original=await fixture.partial(),state=await fixture.snapshot();await fixture.qc(original,40);
      await fixture.pack(state.packaging[0].id,15);const extra=(await fixture.createPackage(original,25)).rows[0].id;await fixture.pack(extra);
      assert.equal(await readyWeight(),40);assert.equal((await fixture.snapshot()).materialStock,98);await assert.rejects(fixture.createPackage(original,0.002),/exceeds/);
    });
    await context.test("repeated finishing transitions do not duplicate handoffs or material charges",async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=await fixture.retryComplete(),state=await fixture.snapshot();
      for(const [finish,weight] of [[original,40],[retry,50]]){await fixture.qc(finish,weight);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===finish).id);}
      const before=await fixture.snapshot();await fixture.move("rejected",{},original);await fixture.move("completed",{},retry);assert.deepEqual(await fixture.snapshot(),before);
      await assert.rejects(fixture.pack(before.packaging[0].id),/cannot be edited/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("a missing packaging material aborts completion without a stock or history change",async()=>{
      await fixture.reset();await fixture.partial();const before=await fixture.snapshot(),p=before.packaging[0];
      await assert.rejects(fixture.attempt(()=>fixture.db.query("select public.save_packaging_job_atomic($1,$2,$3)",[p.id,{order_id:f.order,production_job_id:f.job,finishing_job_id:p.finishing_job_id,status:"completed",pieces:1,profile_weight_kg:40,profile_length_m:5},[]])),/at least one packaging material/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("late material stock failure rolls back packaging and issued material rows",async()=>{
      await fixture.reset();await fixture.partial();await fixture.db.exec("update packaging_materials set current_stock=0;");const before=await fixture.snapshot();
      await assert.rejects(fixture.pack(before.packaging[0].id),/Not enough packaging material stock/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("failure to queue the accepted portion rolls back the finishing disposition and history",async()=>{
      await fixture.reset();await fixture.move("in_process");const before=await fixture.snapshot();
      await fixture.db.exec("create function public.fixture_r18_handoff_failure() returns trigger language plpgsql as $$begin raise exception 'injected accepted handoff failure';end;$$;create trigger fixture_r18_handoff_failure before insert on packaging_jobs for each row execute function public.fixture_r18_handoff_failure();");
      await assert.rejects(fixture.move("rejected",{received:"2026-10-19",output:40,rejected:55,remarks:"Partial finishing"}),/injected accepted handoff failure/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("fully rejected material queues no accepted package and only its corrective output can release",async()=>{
      await fixture.reset();await fixture.move("rejected",{output:0,rejected:95,remarks:"All input needs corrective finishing"});assert.equal((await fixture.snapshot()).packaging.length,0);
      const retry=(await fixture.retry()).rows[0].id;await fixture.move("in_process",{},retry);await fixture.move("completed",{received:"2026-10-19",output:90,rejected:5},retry);
      const state=await fixture.snapshot();assert.equal(state.packaging.length,1);assert.equal(state.packaging[0].finishing_job_id,retry);await fixture.qc(retry,90);await fixture.pack(state.packaging[0].id);assert.equal(await readyWeight(),90);
    });
    await context.test("the scoped receipt view exposes both final accepted portions and excludes pending, foreign and rejected remainder",async()=>{
      await fixture.reset();await fixture.partial();await fixture.retryComplete();await fixture.db.exec("set role authenticated;");
      const rows=(await fixture.db.query("select * from finishing_accepted_outputs order by output_weight_kg")).rows;assert.deepEqual(rows.map(row=>Number(row.output_weight_kg)),[40,50]);assert.deepEqual(rows.map(row=>row.receipt_kind),["Original receipt","Corrective retry"]);
      await fixture.db.query("select set_config('test.company',$1,false)",[f.otherVendor]);assert.equal((await fixture.db.query("select * from finishing_accepted_outputs")).rows.length,0);
      await fixture.db.exec("reset role;");await fixture.db.query("select set_config('test.company',$1,false)",[f.company]);
    });
    await context.test("readiness rejects unauthorized roles, unauthenticated requests and another company's order",async()=>{
      await fixture.reset();await fixture.partial();
      for(const role of ['viewer','quality','production','production_manager','sales','dealer','customer','']){
        await fixture.db.query("select set_config('test.role',$1,false)",[role]);await assert.rejects(fixture.attempt(()=>fixture.ready()),/Permission denied/);
      }
      await fixture.db.query("select set_config('test.role','dispatch_manager',false),set_config('test.actor','',false)");await assert.rejects(fixture.attempt(()=>fixture.ready()),/Authentication required/);
      assert.equal((await fixture.db.query('select * from finishing_accepted_outputs')).rows.length,0);
      await fixture.db.query("select set_config('test.actor',$1,false),set_config('test.company',$2,false)",[f.actor,f.otherVendor]);await assert.rejects(fixture.attempt(()=>fixture.ready()),/Order not found/);
    });
    await context.test("anonymous roles cannot read receipts or execute the readiness RPC or private implementations",async()=>{
      await fixture.reset();const acl=(await fixture.db.query(`select has_function_privilege('anon','public.get_finished_production_readiness(uuid)','execute') anonymous_rpc,
        has_table_privilege('anon','public.finishing_accepted_outputs','select') anonymous_view,
        has_function_privilege('authenticated','private.finishing_dispatch_ready_kg(uuid,uuid,uuid,boolean)','execute') private_reader,
        has_function_privilege('authenticated','private.guard_packaging_finishing_source()','execute') private_guard,
        has_function_privilege('authenticated','public.validate_completed_packaging_materials()','execute') direct_constraint`)).rows[0];
      assert.deepEqual(acl,{anonymous_rpc:false,anonymous_view:false,private_reader:false,private_guard:false,direct_constraint:false});
    });
    await context.test("cross-company and wrong-order packaging attempts leave receipt, stock and history unchanged",async()=>{
      await fixture.reset();const original=await fixture.partial(),before=await fixture.snapshot();
      for(const [company,order] of [[f.otherVendor,f.order],[f.company,f.otherVendor]])await assert.rejects(fixture.attempt(()=>fixture.db.query(
        `insert into packaging_jobs(company_id,order_id,production_job_id,finishing_job_id,packaging_number,status,profile_weight_kg,profile_length_m)
          values($1,$2,$3,$4,'FORGED','scheduled',1,1)`,[company,order,f.job,original])),/this company and order/);
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("three generations of corrective finishing count accepted material once per generation",async()=>{
      await fixture.reset();const original=await fixture.partial(),first=(await fixture.retry(original)).rows[0].id;
      await fixture.move('in_process',{},first);await fixture.move('rejected',{received:'2026-10-19',output:30,rejected:25,remarks:'Second corrective portion'},first);
      const second=(await fixture.retry(first)).rows[0].id;await fixture.move('in_process',{},second);await fixture.move('completed',{received:'2026-10-19',output:20,rejected:5},second);
      const state=await fixture.snapshot();assert.deepEqual(state.jobs.map(row=>Number(row.input_weight_kg)).sort((a,b)=>a-b),[25,55,95]);
      for(const [finish,weight] of [[original,40],[first,30],[second,20]]){await fixture.qc(finish,weight);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===finish).id);}
      assert.equal(await readyWeight(),90);assert.equal((await fixture.snapshot()).materialStock,97);await assert.rejects(fixture.retry(original),/already|retry/i);
    });
    await context.test("three-decimal accepted portions reconcile without rounding rejection into shippable material",async()=>{
      await fixture.reset();const original=fixture.jobId;await fixture.move('in_process');await fixture.move('rejected',{received:'2026-10-19',output:32.125,rejected:62.875,remarks:'Measured partial receipt'});
      const retry=(await fixture.retry()).rows[0].id;await fixture.move('in_process',{},retry);await fixture.move('completed',{received:'2026-10-19',output:61.875,rejected:1},retry);
      const state=await fixture.snapshot();for(const [finish,weight] of [[original,32.125],[retry,61.875]]){await fixture.qc(finish,weight);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===finish).id);}
      assert.equal(await readyWeight(),94);await assert.rejects(fixture.assertDispatch(94.02),/exceeds/);
    });
    await context.test("SQL dispatch validates the current receipt release again after an earlier availability preview",async()=>{
      await fixture.reset();const original=await fixture.partial(),retry=await fixture.retryComplete(),state=await fixture.snapshot();
      await fixture.qc(original,40);await fixture.pack(state.packaging.find(row=>row.finishing_job_id===original).id);assert.equal(await readyWeight(),40);
      await fixture.pack(state.packaging.find(row=>row.finishing_job_id===retry).id);await assert.rejects(fixture.assertDispatch(90),/exceeds/);
      await fixture.qc(retry,50);await fixture.assertDispatch(90);
    });
    await context.test("deferred header and material checks pass at transaction commit for both accepted portions",async()=>{
      const committed=await createPartialFinishingFixture();try{
        await committed.reset();const original=await committed.partial(),retry=await committed.retryComplete(),state=await committed.snapshot();
        for(const [finish,weight] of [[original,40],[retry,50]]){await committed.qc(finish,weight);await committed.pack(state.packaging.find(row=>row.finishing_job_id===finish).id);}
        await committed.db.exec('commit;begin;');await committed.db.query("select set_config('test.role','dispatch_manager',false)");assert.equal(Number((await committed.ready()).rows[0].ready_weight_kg),90);assert.equal((await committed.snapshot()).materialStock,98);
      }finally{await committed.close();}
    });
    await context.test("the deferred packaging check rejects raw completion without issued material",async()=>{
      await fixture.reset();await fixture.partial();const before=await fixture.snapshot();await assert.rejects(fixture.attempt(async()=>{
        await fixture.db.query("update packaging_jobs set status='completed' where id=$1",[before.packaging[0].id]);await fixture.db.exec('set constraints all immediate;');
      }),/requires at least one issued material/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("read-only historical review accepts valid partial and retry evidence without altering it",async()=>{
      await fixture.reset();await fixture.partial();await fixture.retryComplete();const before=await fixture.snapshot();
      assert.deepEqual((await fixture.db.query(historicalReview)).rows,[]);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("catalog preflight identifies all revised R18 bodies and their restricted execution grants",async()=>{
      await fixture.reset();const source=readFileSync(new URL('../sql/audit-deployment-preflight.sql',import.meta.url),'utf8');
      const start=source.indexOf('-- R18 authoritative');assert.ok(start>=0);const query=source.slice(start,source.indexOf(';',start)+1),rows=(await fixture.db.query(query)).rows;
      assert.equal(rows.length,9);for(const row of rows){assert.equal(row.present,true);assert.equal(row.anonymous_execute,false);assert.equal(row.authenticated_execute,row.signature==='public.get_finished_production_readiness(uuid)');assert.match(row.definition_md5,/^[a-f0-9]{32}$/);}
    });
    await context.test("the later multi-material schema preserves a partial package's entered weight when deriving missing length",async()=>{
      const modern=await createPartialFinishingFixture();try{
        await modern.db.exec('alter table packaging_jobs drop column if exists material_id;alter table packaging_jobs drop column if exists material_quantity_required;');
        await modern.reset();await modern.partial();const initial=await modern.snapshot(),pkg=initial.packaging[0];
        await modern.db.query('update packaging_jobs set profile_length_m=0,profile_weight_kg=15,pieces=2 where id=$1',[pkg.id]);
        const changed=(await modern.snapshot()).packaging[0];assert.equal(Number(changed.profile_weight_kg),15);assert.equal(Number(changed.profile_length_m),7.895);assert.equal(changed.pieces,2);
        await modern.qc(modern.jobId,40);await modern.pack(pkg.id);await modern.db.exec('commit;begin;');await modern.db.query("select set_config('test.role','dispatch_manager',false)");assert.equal(Number((await modern.ready()).rows[0].ready_weight_kg),15);
      }finally{await modern.close();}
    });
    await context.test("mill-finish QC, packaging and SQL dispatch retain their existing captured-production limit",async()=>{
      const mill=await createPartialFinishingFixture({finishingType:'mill_finish'});try{
        await mill.reset();const state=await mill.snapshot();assert.equal(state.jobs.length,0);assert.equal(state.packaging.length,1);assert.equal(state.packaging[0].finishing_job_id,null);
        await mill.qc(null,95);await mill.pack(state.packaging[0].id);await mill.assertDispatch(95);await assert.rejects(mill.assertDispatch(0.02),/exceeds/);await mill.db.exec('commit;begin;');
      }finally{await mill.close();}
    });
    await context.test("a single unambiguous legacy completed package retains its existing readiness without rewriting history",async()=>{
      const legacy=await createPartialFinishingFixture({candidate:false});try{
        await legacy.reset();await legacy.complete();let state=await legacy.snapshot();await legacy.qc(legacy.jobId,90);await legacy.pack(state.packaging[0].id);state=await legacy.snapshot();
        const review=(await legacy.db.query(historicalReview)).rows;assert.equal(review.length,1);assert.match(review[0].review_reason,/no recorded finishing receipt link/);assert.deepEqual(await legacy.snapshot(),state);
        await legacy.db.exec(sqlDefinition("20261019020000_finishing_accepted_dispositions.sql","public.validate_completed_packaging_materials"));
        await legacy.db.exec("commit;begin;");await installPartialFinishingCandidateObjects(legacy.db);await legacy.db.query("select set_config('test.role','dispatch_manager',false)");assert.equal(Number((await legacy.ready()).rows[0].ready_weight_kg),90);
        const after=await legacy.snapshot();assert.equal(after.materialStock,state.materialStock);assert.deepEqual(after.movements,state.movements);assert.deepEqual(after.history,state.history);assert.equal(after.packaging[0].finishing_job_id,null);
      }finally{await legacy.close();}
    });
    await context.test("ambiguous legacy packaging is rejected without assigning a fabricated receipt link",async()=>{
      const legacy=await createPartialFinishingFixture({candidate:false});try{
        await legacy.reset();await legacy.partial();const retry=await legacy.retryComplete(),state=await legacy.snapshot();await legacy.qc(retry,50);await legacy.pack(state.packaging[0].id);
        await legacy.db.exec(sqlDefinition("20261019020000_finishing_accepted_dispositions.sql","public.validate_completed_packaging_materials"));
        await legacy.db.exec("commit;begin;");await installPartialFinishingCandidateObjects(legacy.db);await legacy.db.query("select set_config('test.role','dispatch_manager',false)");await assert.rejects(legacy.attempt(()=>legacy.ready()),/ambiguous finishing receipt provenance/);assert.equal((await legacy.snapshot()).packaging[0].finishing_job_id,null);
      }finally{await legacy.close();}
    });
  }finally{await fixture.close();}
});
