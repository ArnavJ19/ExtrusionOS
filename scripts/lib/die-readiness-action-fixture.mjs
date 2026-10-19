import assert from "node:assert/strict";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

export const dieFixtureId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const dieFixture={company:dieFixtureId(1),profile:dieFixtureId(2),order:dieFixtureId(3),die:dieFixtureId(4),machine:dieFixtureId(5),job:dieFixtureId(6),configuration:dieFixtureId(7)};

export function createDieReadinessActionFixture(){
  const f=dieFixture,state={};
  function reset(status="active"){
    Object.assign(state,{role:"owner",calls:[],queries:[],paths:[],errors:{},orderStage:"extrusion_planned",dieStatus:status,
      dieProfile:f.profile,dieCompany:f.company,dieRows:null,queueDieNumber:"D-R15",queueProfile:f.profile,queueDieProfile:f.profile});return state;
  }
  reset();
  const client={from(table){
    const filters=[],call={table,filters,sort:null};state.queries.push(call);
    const query={select(){return query;},eq(key,value){filters.push(["eq",key,value]);return query;},
      in(key,value){filters.push(["in",key,value]);return query;},order(key){call.sort=key;return query;},ilike(){return query;},
      async maybeSingle(){const result=read();return {...result,data:result.data?.[0]??null};},
      async single(){const result=read();return {...result,data:result.data?.[0]??null};},then(yes,no){return Promise.resolve(read()).then(yes,no);}};
    function read(){
      assert.ok(filters.some(([,key,value])=>key==="company_id"&&value===f.company),`${table} must remain company-scoped`);
      if(state.errors[table])return {data:null,error:state.errors[table]};
      const die={id:f.die,company_id:state.dieCompany,profile_id:state.dieProfile,die_status:state.dieStatus};
      const tables={machines:[{id:f.machine,company_id:f.company,machine_type:"extrusion_press",status:"active",is_active:true}],
        production_jobs:filters.some(([,key])=>key==="id")?[{id:f.job,company_id:f.company,order_id:f.order,profile_id:f.profile,die_id:f.die,status:"planned",
          planned_quantity_kg:10,order:{current_stage:state.orderStage},die:die.company_id===f.company?{profile_id:die.profile_id,die_status:die.die_status}:null}]:[],
        system_configurations_authorized:[{id:f.configuration,company_id:f.company,configuration_number:"SC-R15",customer_id:dieFixtureId(8),order_id:f.order,quote_id:null,status:"approved"}],
        system_profile_cuts:[{company_id:f.company,configuration_id:f.configuration,profile_id:f.profile,profile_code:"R15",profile_name:"Synthetic section",total_weight_kg:10,total_length_m:5}],
        system_beading_cuts:[],dies:state.dieRows??[die],
        orders:[{id:f.order,company_id:f.company,current_stage:state.orderStage}],
        aluminium_profiles:[{id:f.profile,company_id:f.company,is_active:true}],
        order_items_authorized:[{id:dieFixtureId(16),company_id:f.company,order_id:f.order,profile_id:f.profile,quantity_kg:10,length_per_piece_m:5}]};
      assert.ok(Object.hasOwn(tables,table),table);
      let data=tables[table].filter(row=>filters.every(([kind,key,value])=>kind==="in"?value.includes(row[key]):row[key]===value));
      if(call.sort)data=[...data].sort((a,b)=>String(a[call.sort]).localeCompare(String(b[call.sort])));
      return {data,error:null};
    }
    return query;
  },async rpc(name,args){assert.ok(["save_production_schedule_slot_atomic","handoff_system_configuration_to_production_atomic","save_production_job_atomic"].includes(name));
    state.calls.push({name,args});return {data:dieFixtureId(9),error:null};}};
  const require=createRequire(import.meta.url);require("tsx/cjs");const Module=require("node:module"),original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="next/link")return function Link({children,...props}){return React.createElement("a",props,children);};
    if(request==="next/navigation")return {redirect:path=>{throw new Error(`fixture-redirect:${path}`);}};
    if(request==="next/cache")return {revalidatePath:path=>state.paths.push(path)};
    if(request==="@/lib/auth")return {getSessionContext:async()=>({companyId:f.company,role:state.role,userId:dieFixtureId(10),dealerId:null})};
    if(request==="@/lib/supabase/server")return {createClient:async()=>client};
    return original(request,parent,isMain);
  };
  let Queue,production,handoff,dieSchema,gate;
  try{
    Queue=require("../../components/modules/production-planning/production-readiness-queue.tsx").ProductionReadinessQueue;
    production=require("../../lib/actions/production.ts");handoff=require("../../lib/systems-configurator/actions.ts").handoffSystemConfigurationToProduction;
    dieSchema=require("../../lib/validations/schemas.ts").dieSchema;gate=require("../../lib/workflow/pcda/gates.ts").canUseDieForProduction;
  }finally{Module._load=original;}
  const statuses=(dieSchema.shape?dieSchema:dieSchema.innerType()).shape.die_status.options;
  return {state,reset,statuses,gate,production,handoff,
    renderQueue(){return renderToStaticMarkup(React.createElement(Queue,{orders:[{id:f.order,order_number:"ORDER-R15",production_profile_id:state.queueProfile,
      production_die:{die_number:state.queueDieNumber,die_status:state.dieStatus,profile_id:state.queueDieProfile},billet_allocation_status:"pending"}],todayJobs:[]}));},
    schedule(){return production.saveProductionScheduleSlotAction({production_job_id:f.job,machine_id:f.machine,
      planned_start_at:"2026-10-20T09:00:00Z",planned_end_at:"2026-10-20T10:00:00Z",sequence_number:0,status:"scheduled"});},
    async handoffAttempt(){let error=null;try{await handoff(f.configuration);}catch(reason){error=reason.message;}
      return {error,calls:state.calls.filter(call=>call.name==="handoff_system_configuration_to_production_atomic")};}
  };
}
