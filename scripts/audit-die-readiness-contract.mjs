import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

const require=createRequire(import.meta.url);require("tsx/cjs");const Module=require("node:module"),original=Module._load;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=id(1),profile=id(2),order=id(3),die=id(4),machine=id(5),job=id(6),configuration=id(7);
let status="active";const calls=[],queries=[];
const client={from(table){
  const filters=[];queries.push({table,filters});const query={select(){return query;},eq(key,value){filters.push([key,value]);return query;},
    in(){return query;},order(){return query;},ilike(){return query;},async maybeSingle(){return {data:rows()[0]??null,error:null};},
    async single(){return {data:rows()[0]??null,error:null};},then(yes,no){return Promise.resolve({data:rows(),error:null}).then(yes,no);}};
  function rows(){
    assert.ok(filters.some(([key,value])=>key==="company_id"&&value===company),`${table} must remain company-scoped`);
    if(table==="machines")return [{id:machine,machine_type:"extrusion_press",status:"active",is_active:true}];
    if(table==="production_jobs")return filters.some(([key])=>key==="id")?[{id:job,company_id:company,profile_id:profile,die_id:die,status:"planned",
      planned_quantity_kg:10,order:{current_stage:"extrusion_planned"},die:{profile_id:profile,die_status:status}}]:[];
    if(table==="system_configurations_authorized")return [{id:configuration,company_id:company,configuration_number:"SC-R15",customer_id:id(8),order_id:order,quote_id:null,status:"approved"}];
    if(table==="system_profile_cuts")return [{profile_id:profile,profile_code:"R15",profile_name:"Synthetic section",total_weight_kg:10,total_length_m:5}];
    if(table==="system_beading_cuts")return [];
    if(table==="dies")return [{id:die,company_id:company,profile_id:profile,die_status:status}];
    throw new Error(`Unexpected table ${table}`);
  }
  return query;
},async rpc(name,args){assert.ok(["save_production_schedule_slot_atomic","handoff_system_configuration_to_production_atomic"].includes(name));
  calls.push({name,args});return {data:id(9),error:null};}};

Module._load=function(request,parent,isMain){
  if(request==="next/link")return function Link({children,...props}){return React.createElement("a",props,children);};
  if(request==="next/navigation")return {redirect:path=>{throw new Error(`fixture-redirect:${path}`);}};
  if(request==="next/cache")return {revalidatePath(){}};
  if(request==="@/lib/auth")return {getSessionContext:async()=>({companyId:company,role:"owner",userId:id(10),dealerId:null})};
  if(request==="@/lib/supabase/server")return {createClient:async()=>client};
  return original(request,parent,isMain);
};
let Queue,actions,handoff,dieSchema,canUseDieForProduction;
try{
  Queue=require("../components/modules/production-planning/production-readiness-queue.tsx").ProductionReadinessQueue;
  actions=require("../lib/actions/production.ts");handoff=require("../lib/systems-configurator/actions.ts").handoffSystemConfigurationToProduction;
  dieSchema=require("../lib/validations/schemas.ts").dieSchema;
  canUseDieForProduction=require("../lib/workflow/pcda/gates.ts").canUseDieForProduction;
}finally{Module._load=original;}
const cases=[];
const dieStatusSchema=(dieSchema.shape?dieSchema:dieSchema.innerType()).shape.die_status;
for(const candidate of [...dieStatusSchema.options,"",null,"unknown"]){
  status=candidate;calls.length=0;
  const html=renderToStaticMarkup(React.createElement(Queue,{orders:[{id:order,order_number:"ORDER-R15",production_profile_id:profile,production_die:{die_number:"D-R15",die_status:status,profile_id:profile},billet_allocation_status:"pending"}],todayJobs:[]}));
  const queueReady=/>Ready</.test(html),expectedReady=["active","approved"].includes(status);
  const scheduled=await actions.saveProductionScheduleSlotAction({production_job_id:job,machine_id:machine,
    planned_start_at:"2026-10-20T09:00:00Z",planned_end_at:"2026-10-20T10:00:00Z",sequence_number:0,status:"scheduled"});
  assert.equal(scheduled.success,expectedReady,`Scheduling must enforce active/approved for ${String(status)}`);
  const before=calls.length;let handoffError=null;
  try{await handoff(configuration);}catch(error){handoffError=error.message;}
  const handoffSelected=calls.slice(before).some(call=>call.name==="handoff_system_configuration_to_production_atomic");
  if(handoffSelected)assert.equal(handoffError,"fixture-redirect:/production");
  cases.push({status,expectedReady,queueReady,scheduleAllowed:scheduled.success,handoffSelected,
    dormantGateAllowed:canUseDieForProduction(status).allowed,dormantOwnerGateAllowed:canUseDieForProduction(status,true).allowed});
}
const mismatches=cases.filter(row=>row.queueReady!==row.expectedReady||row.handoffSelected!==row.expectedReady||row.dormantGateAllowed!==row.expectedReady||row.dormantOwnerGateAllowed!==row.expectedReady);
assert.deepEqual(mismatches,[]);
const report={finding:"R15",localContractCandidateVerified:true,proof:"Actual rendered readiness queue and actual scheduling/configurator server actions, controlled tenant-scoped synthetic reads; any write RPC is captured only",
  cases,mismatches:mismatches.length,conclusion:"Production readiness, scheduling, configurator die selection and the compatibility gate share the active/approved contract.",
  boundary:"No Supabase request/migration, database writer, actual schedule or production job, hosted JWT/RLS or independent-session result is proved."};
if(process.argv[2]){const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});writeFileSync(resolve(output,"die-readiness-regression.json"),JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify(report,null,2));
