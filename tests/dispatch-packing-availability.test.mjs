import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {createClient} from "@supabase/supabase-js";
import {createRequire} from "node:module";
import {createDispatchActionBoundaryFixture} from "../scripts/lib/dispatch-action-boundary-fixture.mjs";
import {dispatchFormIds as f,dispatchFixtureId as id} from "../scripts/lib/dispatch-form-browser-fixture.mjs";

const fixture=createDispatchActionBoundaryFixture(),{state,tables,actions}=fixture;
const {loadDispatchPackingTotals}=createRequire(import.meta.url)("../lib/dispatches/packing-history.ts");
function reset(family="dealer_stock",{packingRows=1501,dispatchRows=1,cap=1000}={}){
  Object.assign(state,{role:"dispatch_manager",queries:[],calls:[],paths:[],consumed:0,apiCaps:{packing_list_items:cap,dispatches:cap},reads:[],readOverride:null,rpcOverride:null});
  for(const key of Object.keys(tables))delete tables[key];
  Object.assign(tables,{orders:[{id:f.b,company_id:f.company}],profile_stock_reservations:[],
    aluminium_profiles:[{id:f.profile,company_id:f.company,profile_code:"SYNTHETIC",profile_name:"Fixture section"}],
    profile_stock_batches:[{id:f.batch,company_id:f.company,quantity_pieces:2000,total_weight_kg:2000,bundle_number:"FIXTURE-STOCK"}],
    dispatches:Array.from({length:dispatchRows},(_,n)=>({id:id(8000+n),company_id:f.company,order_id:f.b})),
    packing_list_items:Array.from({length:packingRows},(_,n)=>({id:id(20000+n),company_id:f.company,dispatch_id:id(8000+n%dispatchRows),
      source_line_id:f.sourceB,net_weight_kg:1,net_length_m:0.5,number_of_pieces:1})),
    order_dealer_stock_fulfillments_authorized:family==="dealer_stock"?[{id:f.sourceB,company_id:f.company,order_id:f.b,profile_id:f.profile,
      profile_stock_batch_id:f.batch,fulfilled_weight_kg:2000,fulfilled_length_m:1000,fulfilled_pieces:2000,credited_at:null}]:[],
    production_jobs_authorized:family==="production"?[{id:f.sourceB,company_id:f.company,order_id:f.b,profile_id:f.profile,
      status:"completed",finishing_type:"mill_finish",actual_quantity_kg:2000,actual_meters:1000,actual_pieces:2000}]:[],
    quality_inspections:[{company_id:f.company,production_job_id:f.sourceB,finishing_job_id:null,status:"approved",quantity_checked_kg:2000}],
    packaging_jobs:[{id:id(7000),company_id:f.company,order_id:f.b,production_job_id:f.sourceB,status:"completed",profile_weight_kg:2000}],
    packaging_job_materials:[{company_id:f.company,job_id:id(7000),quantity_required:1}]});
}
const remaining=source=>({weightKg:source.availableWeightKg,lengthM:source.availableLengthM,pieces:source.availablePieces});
const input=(weight=499,pieces=499,length=249.5)=>({order_id:f.b,dispatch_date:"2026-10-19",delivery_status:"dispatched",
  bundles:[{bundle_number:"R14-MANIFEST",source_line_id:f.sourceB,number_of_pieces:pieces,net_length_m:length,gross_weight_kg:weight+1,tare_weight_kg:1}]});
const writes=()=>state.calls.filter(call=>call.name==="save_ready_dispatch_atomic");
const packingQueries=()=>state.queries.filter(query=>query.table==="packing_list_items");

for(const family of ["dealer_stock","production"]){
  test(`${family}: all 1,501 packing rows are subtracted despite the API cap`,async()=>{
    reset(family);const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));
    assert.equal(result.sources.length,1);assert.equal(result.sources[0].sourceKind,family);
    assert.deepEqual(remaining(result.sources[0]),{weightKg:499,lengthM:249.5,pieces:499});
    assert.ok(packingQueries().length>1);assert.equal(writes().length,0);
    for(const query of packingQueries()){
      assert.equal(query.count,"exact");assert.deepEqual(query.sort,{column:"id",ascending:true});
      assert.ok(query.filters.some(([,column,value])=>column==="dispatches.company_id"&&value===f.company));
      assert.ok(query.filters.some(([,column,value])=>column==="dispatches.order_id"&&value===f.b));
    }
  });
  test(`${family}: shipments after the 1,000th dispatch remain included`,async()=>{
    reset(family,{dispatchRows:1501});const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));
    assert.deepEqual(remaining(result.sources[0]),{weightKg:499,lengthM:249.5,pieces:499});
  });
  test(`${family}: exact remaining manifest reaches only the captured atomic writer`,async()=>{
    reset(family);const result=await actions.saveDispatchAction(input());assert.deepEqual(result,{success:true,dispatchId:f.dispatch});
    assert.equal(writes().length,1);const [item]=writes()[0].args.p_items;
    assert.equal(item.source_line_id,f.sourceB);assert.equal(item.source_kind,family);assert.equal(item.company_id,f.company);
    assert.equal(item.net_weight_kg,499);assert.equal(item.net_length_m,249.5);assert.equal(item.number_of_pieces,499);
  });
  test(`${family}: save rechecks a stale source preview before any writer`,async()=>{
    reset(family,{packingRows:1000});const preview=await actions.getDispatchSourcesAction(f.b);assert.equal(preview.sources[0].availableWeightKg,1000);
    const first=tables.packing_list_items[0];for(let n=1000;n<1501;n++)tables.packing_list_items.push({...first,id:id(20000+n)});
    const result=await actions.saveDispatchAction(input(500,500,250));assert.equal(result.success,false);assert.match(result.error,/499|available/);
    assert.equal(writes().length,0);assert.deepEqual(state.paths,[]);
  });
}

test("a lower API cap still yields complete contiguous packing pages",async()=>{
  reset("dealer_stock",{packingRows:47,cap:7});const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));
  assert.deepEqual(remaining(result.sources[0]),{weightKg:1953,lengthM:976.5,pieces:1953});
  assert.ok(packingQueries().length>1);assert.deepEqual(packingQueries().map(query=>query.range[0]),[0,7,14,21,28,35,42]);
});

test("foreign-company and sibling-order packing never change current availability",async()=>{
  reset("dealer_stock",{packingRows:1});
  tables.dispatches.push({id:id(6001),company_id:f.otherCompany,order_id:f.b},{id:id(6002),company_id:f.company,order_id:f.a});
  for(const [dispatchId,company] of [[id(6001),f.company],[id(6002),f.company],[id(8000),f.otherCompany]])
    tables.packing_list_items.push({...tables.packing_list_items[0],id:id(30000+tables.packing_list_items.length),dispatch_id:dispatchId,company_id:company,net_weight_kg:1999});
  const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));
  assert.deepEqual(remaining(result.sources[0]),{weightKg:1999,lengthM:999.5,pieces:1999});assert.equal(writes().length,0);
});

test("editing excludes exactly its own manifest while retaining later shipments",async()=>{
  reset("dealer_stock",{packingRows:1501,dispatchRows:1501});const result=await actions.getDispatchSourcesAction(f.b,id(9500));
  assert.equal(result.success,true,JSON.stringify(result));assert.deepEqual(remaining(result.sources[0]),{weightKg:500,lengthM:250,pieces:500});
});

test("fully shipped sources cannot reappear from a capped history",async()=>{
  reset("production",{packingRows:2000});const result=await actions.getDispatchSourcesAction(f.b);
  assert.equal(result.success,true,JSON.stringify(result));assert.deepEqual(result.sources,[]);assert.equal(writes().length,0);
});

test("a repeated profile retains distinct physical source balances",async()=>{
  reset("dealer_stock",{packingRows:1501});tables.order_dealer_stock_fulfillments_authorized.push({...tables.order_dealer_stock_fulfillments_authorized[0],id:f.sourceA});
  tables.packing_list_items.push({...tables.packing_list_items[0],id:id(40000),source_line_id:f.sourceA,net_weight_kg:100,net_length_m:50,number_of_pieces:100});
  const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));
  assert.deepEqual(remaining(result.sources.find(source=>source.id===f.sourceB)),{weightKg:499,lengthM:249.5,pieces:499});
  assert.deepEqual(remaining(result.sources.find(source=>source.id===f.sourceA)),{weightKg:1900,lengthM:950,pieces:1900});
});

for(const kind of ["returned-error","thrown-transport","empty-later-page","changed-count","missing-count","duplicate-row","unsorted-ids"]){
  test(`incomplete packing history (${kind}) exposes no sources or stock writer`,async()=>{
    reset();state.readOverride=(query,result)=>{
      if(query.table!=="packing_list_items")return result;
      if(kind==="missing-count")return {...result,count:null};
      if(!query.range||query.range[0]===0)return result;
      if(kind==="returned-error")return {data:null,count:null,error:new Error("Later packing page unavailable")};
      if(kind==="thrown-transport")throw new Error("Later packing transport failed");
      if(kind==="empty-later-page")return {...result,data:[]};
      if(kind==="changed-count")return {...result,count:result.count+1};
      if(kind==="duplicate-row")return {...result,data:result.data.map((row,index)=>index?row:{...row,id:tables.packing_list_items[0].id})};
      return {...result,data:[...result.data].reverse()};
    };
    const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,false,JSON.stringify(result));assert.equal(result.sources,undefined);
    const saved=await actions.saveDispatchAction(input(1,1,0.5));assert.equal(saved.success,false);assert.equal(writes().length,0);assert.deepEqual(state.paths,[]);
  });
}

for(const [field,value] of [["net_weight_kg",null],["net_weight_kg",-1],["net_weight_kg",Infinity],["net_length_m","bad"],["net_length_m",-1],["number_of_pieces",1.5],["source_line_id",null]]){
  test(`invalid historical ${field}=${String(value)} cannot increase availability`,async()=>{
    reset();tables.packing_list_items[1500][field]=value;const result=await actions.getDispatchSourcesAction(f.b);
    assert.equal(result.success,false,JSON.stringify(result));assert.equal(result.sources,undefined);assert.equal(writes().length,0);
  });
}

test("cumulative bundle pieces and metres use the complete source balance",async()=>{
  for(const [pieces,length] of [[500,249.5],[499,250]]){
    reset();const result=await actions.saveDispatchAction(input(499,pieces,length));assert.equal(result.success,false);assert.match(result.error,/pieces| m from/);assert.equal(writes().length,0);
  }
  reset();const request=input(250,250,125);request.bundles.push({...request.bundles[0],bundle_number:"R14-SECOND"});
  assert.equal((await actions.saveDispatchAction(request)).success,false);assert.equal(writes().length,0);
});

test("denied roles and invalid orders never inspect packing history",async()=>{
  reset();state.role="viewer";assert.equal((await actions.getDispatchSourcesAction(f.b)).success,false);assert.deepEqual(state.queries,[]);
  state.role="dispatch_manager";assert.equal((await actions.getDispatchSourcesAction("not-a-uuid")).success,false);assert.deepEqual(state.queries,[]);
});

test("quality, finishing, issued packaging material and credited-stock eligibility are preserved",async()=>{
  for(const missing of ["quality","finishing","material"]){
    reset("production");if(missing==="quality")tables.quality_inspections=[];
    if(missing==="finishing"){
      tables.production_jobs_authorized[0].finishing_type="anodized";
      state.rpcOverride=(name)=>name==="get_finished_production_readiness"?{data:{company_id:f.company,order_id:f.b,total_count:1,rows:[{production_job_id:f.sourceB,ready_weight_kg:0}]},error:null}:undefined;
    }
    if(missing==="material")tables.packaging_job_materials=[];
    const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));assert.deepEqual(result.sources,[]);
  }
  reset();tables.order_dealer_stock_fulfillments_authorized[0].credited_at="2026-10-19T00:00:00Z";
  assert.deepEqual((await actions.getDispatchSourcesAction(f.b)).sources,[]);
});

test("complete decimal totals remain stable across page boundaries and source identities",async()=>{
  await fc.assert(fc.asyncProperty(fc.integer({min:20,max:280}),fc.integer({min:1,max:17}),fc.integer({min:1,max:1000}),async(count,cap,thousandths)=>{
    reset("dealer_stock",{packingRows:count,cap});for(const row of tables.packing_list_items){row.net_weight_kg=String(thousandths/1000);row.net_length_m=String(thousandths/1000);row.number_of_pieces=1;}
    const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,true,JSON.stringify(result));
    assert.deepEqual(remaining(result.sources[0]),{weightKg:2000-count*thousandths/1000,lengthM:1000-count*thousandths/1000,pieces:2000-count});
  }),{numRuns:40,seed:1419});
});

test("the installed Supabase client sends exact counts, stable ranges and both tenant filters",async()=>{
  const requests=[],rows=Array.from({length:47},(_,n)=>({id:id(20000+n),company_id:f.company,dispatch_id:id(8000),source_line_id:f.sourceB,
    net_weight_kg:"1.001",net_length_m:"0.501",number_of_pieces:1,dispatches:{company_id:f.company,order_id:f.b}}));
  const client=createClient("https://synthetic-dispatch.invalid","fixture-public-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
    const parsed=new URL(url),offset=Number(parsed.searchParams.get("offset")),data=rows.slice(offset,offset+7);
    requests.push({url:parsed,headers:new Headers(options.headers),method:options.method});
    return new Response(JSON.stringify(data),{status:206,headers:{"Content-Type":"application/json","Content-Range":`${offset}-${offset+data.length-1}/${rows.length}`}});
  }}});
  const result=await loadDispatchPackingTotals(client,f.company,f.b,id(9999));
  assert.deepEqual(result.get(f.sourceB),{weightKg:47.047,lengthM:23.547,pieces:47});
  assert.deepEqual(requests.map(request=>Number(request.url.searchParams.get("offset"))),[0,7,14,21,28,35,42]);
  for(const {url,headers,method} of requests){
    assert.equal(method,"GET");assert.equal(url.pathname,"/rest/v1/packing_list_items");
    assert.equal(headers.get("Prefer"),"count=exact");assert.equal(url.searchParams.get("limit"),"200");assert.equal(url.searchParams.get("order"),"id.asc");
    assert.equal(url.searchParams.get("company_id"),`eq.${f.company}`);assert.equal(url.searchParams.get("dispatches.company_id"),`eq.${f.company}`);
    assert.equal(url.searchParams.get("dispatches.order_id"),`eq.${f.b}`);assert.equal(url.searchParams.get("dispatch_id"),`neq.${id(9999)}`);
    assert.ok(url.searchParams.get("select").includes("dispatches!inner(company_id,order_id)"));
  }
});

test("an unavailable packing/dispatch relationship stops preparation without a fallback preview",async()=>{
  reset();state.readOverride=(query,result)=>query.table==="packing_list_items"?{data:null,count:null,error:{message:"Packing dispatch relationship unavailable"}}:result;
  const result=await actions.getDispatchSourcesAction(f.b);assert.equal(result.success,false);assert.match(result.error,/relationship unavailable/);
  assert.equal(result.sources,undefined);assert.equal(writes().length,0);
});

for(const invalid of ["foreign-packing","foreign-dispatch","sibling-order","missing-relation","invalid-row-id","excess-count","unsafe-sum"]){
  test(`untrusted read evidence (${invalid}) fails closed`,async()=>{
    reset("dealer_stock",{packingRows:2});state.readOverride=(query,result)=>{
      if(query.table!=="packing_list_items")return result;
      if(invalid==="excess-count")return {...result,count:100001};
      const data=result.data.map(row=>({...row}));
      if(invalid==="foreign-packing")data[0].company_id=f.otherCompany;
      if(invalid==="foreign-dispatch")data[0].dispatches={company_id:f.otherCompany,order_id:f.b};
      if(invalid==="sibling-order")data[0].dispatches={company_id:f.company,order_id:f.a};
      if(invalid==="missing-relation")data[0].dispatches=null;
      if(invalid==="invalid-row-id")data[0].id="not-a-uuid";
      if(invalid==="unsafe-sum")for(const row of data)row.net_weight_kg=8000000000000;
      return {...result,data};
    };
    assert.equal((await actions.getDispatchSourcesAction(f.b)).success,false);assert.equal((await actions.saveDispatchAction(input(1,1,0.5))).success,false);
    assert.equal(writes().length,0);assert.deepEqual(state.paths,[]);
  });
}
