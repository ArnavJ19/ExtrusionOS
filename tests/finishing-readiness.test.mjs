import assert from "node:assert/strict";
import test from "node:test";
import {createClient} from "@supabase/supabase-js";
import {loadFinishedProductionReadiness} from "../lib/dispatches/finishing-readiness.ts";
import {isAcceptedFinishingReceiptForJob} from "../lib/workflow/finishing-receipts.ts";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);require('tsx/cjs');const {qualityInspectionSchema}=require('../lib/validations/schemas.ts');

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,company=id(1),order=id(2),job=id(3);
const jobs=[{id:job,actual_quantity_kg:95}],response=()=>({company_id:company,order_id:order,total_count:1,rows:[{production_job_id:job,ready_weight_kg:90}]});

test("finished readiness consumes one authenticated order-scoped RPC and validates exact identities/quantities",async()=>{
  const requests=[],client=createClient("http://127.0.0.1:54321","synthetic-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
    requests.push({url:String(url),method:options.method,body:JSON.parse(options.body)});return new Response(JSON.stringify(response()),{status:200,headers:{"Content-Type":"application/json"}});
  }}});
  assert.deepEqual([...await loadFinishedProductionReadiness(client,company,order,jobs)],[[job,90]]);
  assert.deepEqual(requests,[{url:"http://127.0.0.1:54321/rest/v1/rpc/get_finished_production_readiness",method:"POST",body:{p_order_id:order}}]);
});

for(const kind of ["foreign-company","foreign-order","foreign-job","duplicate-job","missing-job","missing-count","wrong-count","null-rows","negative","boolean","nonfinite","extra-precision","above-output","unsafe"]){
  test(`finished readiness rejects ${kind} before exposing an availability`,async()=>{
    const data=response();
    if(kind==="foreign-company")data.company_id=id(9);if(kind==="foreign-order")data.order_id=id(9);if(kind==="foreign-job")data.rows[0].production_job_id=id(9);
    if(kind==="duplicate-job"){data.rows.push({...data.rows[0]});data.total_count=2;}
    if(kind==="missing-job")data.rows=[];if(kind==="missing-count")delete data.total_count;if(kind==="wrong-count")data.total_count=2;if(kind==="null-rows")data.rows=null;
    if(kind==="negative")data.rows[0].ready_weight_kg=-1;if(kind==="boolean")data.rows[0].ready_weight_kg=true;if(kind==="nonfinite")data.rows[0].ready_weight_kg=Infinity;
    if(kind==="extra-precision")data.rows[0].ready_weight_kg=0.0001;if(kind==="above-output")data.rows[0].ready_weight_kg=96;if(kind==="unsafe")data.rows[0].ready_weight_kg=Number.MAX_SAFE_INTEGER;
    await assert.rejects(loadFinishedProductionReadiness({rpc:async()=>({data,error:null})},company,order,jobs),/verified|identities|quantities/);
  });
}

test("zero verified release remains zero and no finishing jobs cause no RPC",async()=>{
  const data=response();data.rows[0].ready_weight_kg="0.000";const client={rpc:async()=>({data,error:null})};
  assert.equal((await loadFinishedProductionReadiness(client,company,order,jobs)).get(job),0);
  assert.deepEqual([...await loadFinishedProductionReadiness({rpc:()=>assert.fail("No finishing jobs need no finishing read")},company,order,[])],[]);
});

test("unavailable or malformed readiness never falls back to job snapshots",async()=>{
  for(const result of [{data:null,error:{message:"unavailable"}},{data:null,error:null},{data:[],error:null}])await assert.rejects(loadFinishedProductionReadiness({rpc:async()=>result},company,order,jobs),/verified/);
});

test("receipt eligibility includes only final accepted output for the selected production job",()=>{
  const receipt={production_job_id:job,status:"rejected",output_weight_kg:"40.000",received_date:"2026-10-19"};
  assert.equal(isAcceptedFinishingReceiptForJob(receipt,job),true);assert.equal(isAcceptedFinishingReceiptForJob({...receipt,status:"completed"},job),true);
  for(const change of [{production_job_id:id(9)},{status:"received"},{status:"planned"},{status:"not_required"},{output_weight_kg:0},{output_weight_kg:-1},{output_weight_kg:Infinity},{received_date:null}])assert.equal(isAcceptedFinishingReceiptForJob({...receipt,...change},job),false);
});

test("QC leaves blank optional measurements unknown and retains valid measured values",()=>{
  const input={production_job_id:job,profile_id:id(4),finishing_job_id:id(5),inspection_date:'2026-10-19',quantity_checked_kg:40,status:'approved',inspector_name:'Synthetic inspector',surface_finish_ok:true};
  const blank=qualityInspectionSchema.parse({...input,hardness_webster:'',weight_per_meter_actual:''});assert.equal(blank.hardness_webster,null);assert.equal(blank.weight_per_meter_actual,null);
  const measured=qualityInspectionSchema.parse({...input,hardness_webster:'12.5',weight_per_meter_actual:'1.234'});assert.equal(measured.hardness_webster,12.5);assert.equal(measured.weight_per_meter_actual,1.234);
  for(const value of [0,-1,'invalid'])for(const field of ['hardness_webster','weight_per_meter_actual'])assert.equal(qualityInspectionSchema.safeParse({...input,[field]:value}).success,false);
});
