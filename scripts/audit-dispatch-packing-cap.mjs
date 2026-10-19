import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createDispatchActionBoundaryFixture} from "./lib/dispatch-action-boundary-fixture.mjs";
import {dispatchFormIds as f,dispatchFixtureId as id} from "./lib/dispatch-form-browser-fixture.mjs";

// Positive read regression. The original failing diagnostic remains in R13's evidence directory.
const fixture=createDispatchActionBoundaryFixture();fixture.tables.profile_stock_reservations=[];
fixture.tables.dispatches=[{id:id(8001),company_id:f.company,order_id:f.b}];
fixture.tables.packing_list_items=Array.from({length:1501},(_,n)=>({id:id(9000+n),company_id:f.company,dispatch_id:id(8001),
  source_line_id:f.sourceB,net_weight_kg:1,net_length_m:0.5,number_of_pieces:1}));
fixture.state.apiCaps.packing_list_items=1000;
const cases=[];
for(const family of ["dealer_stock","production"]){
  fixture.state.reads.length=0;
  fixture.tables.order_dealer_stock_fulfillments_authorized=family==="dealer_stock"?[{id:f.sourceB,company_id:f.company,order_id:f.b,profile_id:f.profile,
    profile_stock_batch_id:f.batch,fulfilled_weight_kg:2000,fulfilled_length_m:1000,fulfilled_pieces:2000,credited_at:null}]:[];
  fixture.tables.production_jobs_authorized=family==="production"?[{id:f.sourceB,company_id:f.company,order_id:f.b,profile_id:f.profile,
    status:"completed",finishing_type:"mill_finish",actual_quantity_kg:2000,actual_meters:1000,actual_pieces:2000}]:[];
  fixture.tables.quality_inspections=[{company_id:f.company,production_job_id:f.sourceB,finishing_job_id:null,status:"approved",quantity_checked_kg:2000}];
  fixture.tables.packaging_jobs=[{id:id(8002),company_id:f.company,order_id:f.b,production_job_id:f.sourceB,status:"completed"}];
  fixture.tables.packaging_job_materials=[{company_id:f.company,job_id:id(8002),quantity_required:1}];
  const result=await fixture.actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));
  const source=result.sources[0];assert.equal(source.id,f.sourceB);assert.equal(source.sourceKind,family);
  const expected={weightKg:499,lengthM:249.5,pieces:499},observed={weightKg:source.availableWeightKg,lengthM:source.availableLengthM,pieces:source.availablePieces};
  assert.deepEqual(observed,expected);
  const reads=fixture.state.reads.filter(read=>read.table==="packing_list_items");assert.equal(reads.reduce((sum,read)=>sum+read.returned,0),1501);assert.ok(reads.length>1);
  cases.push({family,packingRows:1501,reads,expectedRemaining:expected,observedRemaining:observed});
}
assert.ok(!fixture.state.calls.some(call=>call.name==="save_ready_dispatch_atomic"));
const report={finding:"R14",localReadCandidateVerified:true,proof:"Actual getDispatchSourcesAction with company-scoped synthetic dealer-stock/production packing history and a capped read transport",
  originalFulfillmentOrOutput:{weightKg:2000,lengthM:1000,pieces:2000},cases,
  conclusion:"The source action subtracts all packing history and reports the exact remaining dealer-stock and production quantities.",
  boundary:"Read-action reproduction only; no real Supabase project or SQL writer was invoked. This does not prove the database accepts an overshipment.",stockWritingCalls:0};
if(process.argv[2]){const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});writeFileSync(resolve(output,"packing-history-regression.json"),JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify(report,null,2));
