import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createDispatchFormBrowserFixture,dispatchFormIds as f,dispatchFixtureId as id} from "./lib/dispatch-form-browser-fixture.mjs";
import {createDispatchActionBoundaryFixture} from "./lib/dispatch-action-boundary-fixture.mjs";

const output=resolve(process.argv[2]??"test-results/dispatch-packing-history");mkdirSync(output,{recursive:true});
const ui=await createDispatchFormBrowserFixture({styled:true}),page=ui.page,boundary=createDispatchActionBoundaryFixture(),checks=[];
function history(family){
  const {tables,state}=boundary;state.role="dispatch_manager";state.readOverride=null;state.apiCaps={dispatches:1000,packing_list_items:1000};state.reads=[];
  tables.profile_stock_reservations=[];
  tables.dispatches=Array.from({length:1501},(_,n)=>({id:id(8000+n),company_id:f.company,order_id:f.b}));
  tables.packing_list_items=Array.from({length:1501},(_,n)=>({id:id(20000+n),company_id:f.company,dispatch_id:id(8000+n),source_line_id:f.sourceB,
    net_weight_kg:1,net_length_m:0.5,number_of_pieces:1}));
  tables.order_dealer_stock_fulfillments_authorized=family==="dealer_stock"?[{id:f.sourceB,company_id:f.company,order_id:f.b,profile_id:f.profile,
    profile_stock_batch_id:f.batch,fulfilled_weight_kg:2000,fulfilled_length_m:1000,fulfilled_pieces:2000,credited_at:null}]:[];
  tables.production_jobs_authorized=family==="production"?[{id:f.sourceB,company_id:f.company,order_id:f.b,profile_id:f.profile,
    status:"completed",finishing_type:"mill_finish",actual_quantity_kg:2000,actual_meters:1000,actual_pieces:2000}]:[];
  tables.quality_inspections=[{company_id:f.company,production_job_id:f.sourceB,finishing_job_id:null,status:"approved",quantity_checked_kg:2000}];
  tables.packaging_jobs=[{id:id(7000),company_id:f.company,order_id:f.b,production_job_id:f.sourceB,status:"completed"}];
  tables.packaging_job_materials=[{company_id:f.company,job_id:id(7000),quantity_required:1}];
}
async function ready(index=0){
  const sources=await boundary.actions.getDispatchSourcesAction(f.b);assert.equal(sources.success,true,JSON.stringify(sources));
  await ui.resolveSource(index,sources);return sources;
}
async function fill(){
  await ui.source().click();await page.getByRole("button",{name:/499\.000 kg/}).click();
  for(const [name,value] of [["Scan / Bundle ID *","COMPLETE-HISTORY"],["Actual pieces *","499"],["Actual metres *","249.5"],["Gross kg *","500"],["Tare kg *","1"]])
    await page.getByText(name,{exact:true}).locator("..").locator("input").fill(value);
}
async function bounded(label){
  await page.evaluate(()=>document.fonts.ready);assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: viewport overflow`);
}
const writerCount=()=>boundary.state.calls.filter(call=>call.name==="save_ready_dispatch_atomic").length;
try{
  for(const family of ["dealer_stock","production"]){
    for(const [label,width,height] of [["desktop",1440,1000],["tablet",820,1180],["mobile",390,844],["compact-mobile",320,720]]){
      history(family);await page.setViewportSize({width,height});await ui.reset();await ui.chooseOrder("B");
      const sources=await ready();assert.equal(sources.sources[0].availableWeightKg,499);assert.equal(sources.sources[0].availablePieces,499);assert.equal(sources.sources[0].availableLengthM,249.5);
      assert.equal(boundary.state.reads.filter(read=>read.table==="packing_list_items").reduce((sum,read)=>sum+read.returned,0),1501);
      await fill();await bounded(`${family}-${label}`);await page.screenshot({path:resolve(output,`${family}-${label}.png`),fullPage:true});
      await ui.save().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
      const input=await page.evaluate(()=>window.__dispatch.saveRequests[0].input),before=writerCount();
      const result=await boundary.actions.saveDispatchAction(input);assert.equal(result.success,true,JSON.stringify(result));assert.equal(writerCount(),before+1);
      const args=boundary.state.calls.filter(call=>call.name==="save_ready_dispatch_atomic").at(-1).args;
      assert.equal(args.p_items[0].source_kind,family);assert.equal(args.p_items[0].source_line_id,f.sourceB);assert.equal(args.p_items[0].source_record_id,f.b);
      assert.equal(args.p_items[0].net_weight_kg,499);assert.equal(args.p_items[0].net_length_m,249.5);assert.equal(args.p_items[0].number_of_pieces,499);
      await page.evaluate(result=>window.__dispatch.saveRequests[0].resolve(result),result);await ui.flush();assert.ok(await ui.save().isDisabled());
      assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[`/dispatches/${f.dispatch}`]);assert.deepEqual(ui.errors,[]);
      checks.push(`${family}/${label}: all 1,501 packing rows across 1,501 dispatches yield 499 kg / 249.5 m / 499 pieces, displayed and freshly validated by the actual form/save action`);
    }
  }
  history("dealer_stock");await page.setViewportSize({width:390,height:844});await ui.reset();await ui.chooseOrder("B");
  boundary.state.readOverride=(query,result)=>query.table==="packing_list_items"&&query.range?.[0]>0?{data:null,count:null,error:new Error("Later packing page unavailable")}:result;
  const failed=await boundary.actions.getDispatchSourcesAction(f.b);assert.equal(failed.success,false);await ui.resolveSource(0,failed);
  assert.match(await page.getByRole("alert").innerText(),/packing page unavailable/);assert.ok(await ui.save().isDisabled());
  assert.equal(await page.evaluate(()=>window.__dispatch.saveRequests.length),0);await bounded("failed history");
  await page.screenshot({path:resolve(output,"mobile-incomplete-history.png"),fullPage:true});
  boundary.state.readOverride=null;await page.getByRole("button",{name:"Retry source check",exact:true}).click();
  await page.waitForFunction(()=>window.__dispatch.sourceRequests.length===2);await ready(1);await fill();
  boundary.tables.packing_list_items.push({...boundary.tables.packing_list_items[0],id:id(21501)});
  const before=writerCount();await ui.save().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
  const input=await page.evaluate(()=>window.__dispatch.saveRequests[0].input),stale=await boundary.actions.saveDispatchAction(input);
  assert.equal(stale.success,false);assert.match(stale.error,/Only 498\.000 kg/);assert.equal(writerCount(),before);
  await page.evaluate(result=>window.__dispatch.saveRequests[0].resolve(result),stale);await ui.flush();
  assert.match(await page.getByRole("alert").innerText(),/498\.000 kg/);assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[]);
  await bounded("stale manifest");await page.screenshot({path:resolve(output,"mobile-fresh-save-rejection.png"),fullPage:true});
  await page.getByRole("button",{name:"Refresh sources",exact:true}).click();await page.waitForFunction(()=>window.__dispatch.sourceRequests.length===3);
  const fresh=await ready(2);assert.equal(fresh.sources[0].availableWeightKg,498);await ui.source().click();await page.getByRole("button",{name:/498\.000 kg/}).waitFor();
  await bounded("refreshed source");await page.screenshot({path:resolve(output,"mobile-refreshed-source.png"),fullPage:true});assert.deepEqual(ui.errors,[]);
  checks.push("A failed later packing page exposes an unavailable state and no write; retry restores complete sources; a subsequent shipment reduces save-time availability to 498 kg and rejects the stale 499-kg manifest before the writer; source refresh shows 498 kg");
  const report={localReadAndFormCandidateVerified:true,proof:"Actual dispatch read/form/save action with synthetic company-scoped history and controlled transport; built CSS/fonts; loopback browser assets only",
    checks,screenshots:11,pageErrors:ui.errors,atomicWriter:"Captured only; no database stock writer executed",boundary:"No Supabase migration, hosted request, persisted dispatch, physical-stock result, real JWT/RLS or independent-session concurrency is proved"};
  writeFileSync(resolve(output,"results.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
}finally{await ui.close();}
