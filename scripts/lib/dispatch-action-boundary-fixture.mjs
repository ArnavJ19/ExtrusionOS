import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {dispatchFormIds as f,dispatchFixtureId as id} from "./dispatch-form-browser-fixture.mjs";

export function createDispatchActionBoundaryFixture(){
  const state={role:"dispatch_manager",queries:[],calls:[],paths:[],consumed:0,apiCaps:{},reads:[],readOverride:null};
  const tables={orders:[f.a,f.b].map(order=>({id:order,company_id:f.company})),
    profile_stock_reservations:[f.a,f.b].map((order,index)=>({id:index?f.sourceB:f.sourceA,company_id:f.company,order_id:order,profile_id:f.profile,
      profile_stock_batch_id:f.batch,status:"active",reserved_weight_kg:10,reserved_length_m:5,reserved_pieces:2})),
    aluminium_profiles:[{id:f.profile,company_id:f.company,profile_code:"SYNTHETIC",profile_name:"Fixture section"}],
    profile_stock_batches:[{id:f.batch,company_id:f.company,quantity_pieces:4,total_weight_kg:20,bundle_number:"SYNTHETIC-STOCK"}]};
  const client={from(table){
    const filters=[],call={table,filters,columns:"",range:null,sort:null,count:null};state.queries.push(call);
    const query={select(columns,options){call.columns=columns;call.count=options?.count??null;return query;},
      eq(column,value){filters.push(["eq",column,value]);return query;},is(column,value){filters.push(["eq",column,value]);return query;},
      neq(column,value){filters.push(["neq",column,value]);return query;},in(column,values){filters.push(["in",column,values]);return query;},
      order(column,options){call.sort={column,ascending:options?.ascending??true};return query;},
      range(start,end){call.range=[start,end];return query;},
      async maybeSingle(){const result=read();return {...result,data:result.data[0]??null};},then(resolve,reject){return Promise.resolve(read()).then(resolve,reject);}};
    function read(){assert.ok(filters.some(([,column,value])=>column==="company_id"&&value===f.company));
      let rows=tables[table]??[];
      if(call.columns.includes("dispatches!inner"))rows=rows.map(row=>({...row,dispatches:(tables.dispatches??[]).find(dispatch=>dispatch.id===row.dispatch_id)}));
      rows=rows.filter(row=>filters.every(([kind,column,value])=>{const actual=column.split(".").reduce((item,key)=>item?.[key],row);
        return kind==="in"?value.includes(actual):kind==="neq"?actual!==value:actual===value;}));
      if(call.sort)rows=[...rows].sort((left,right)=>(left[call.sort.column]<right[call.sort.column]?-1:left[call.sort.column]>right[call.sort.column]?1:0)*(call.sort.ascending?1:-1));
      const start=call.range?.[0]??0,end=call.range?.[1]??rows.length-1;
      const data=rows.slice(start,Math.min(end+1,start+(state.apiCaps[table]??rows.length)));
      state.reads.push({table,total:rows.length,returned:data.length});
      const result={data,error:null,...(call.count?{count:rows.length}:{})};
      return state.readOverride?state.readOverride(call,result):result;}
    return query;
  },async rpc(name,args){
    state.calls.push({name,args});
    if(state.rpcOverride){const result=await state.rpcOverride(name,args);if(result!==undefined)return result;}
    if(name==="get_profile_stock_consumption_totals")return {data:args.p_reservation_ids.map(reservation=>({reservation_id:reservation,
      consumed_weight_kg:state.consumed,consumed_length_m:state.consumed/2,consumed_pieces:state.consumed?1:0})),error:null};
    assert.equal(name,"save_ready_dispatch_atomic");return {data:f.dispatch,error:null};
  }};
  const require=createRequire(import.meta.url);require("tsx/cjs");const Module=require("node:module"),original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="@/lib/auth")return {getSessionContext:async()=>({companyId:f.company,userId:state.userId??id(3),role:state.role,dealerId:null})};
    if(request==="@/lib/supabase/server")return {createClient:async()=>client};
    if(request==="next/cache")return {revalidatePath:path=>state.paths.push(path)};
    return original(request,parent,isMain);
  };
  let actions;try{actions=require("../../lib/actions/dispatches.ts");}finally{Module._load=original;}
  return {state,tables,actions};
}
