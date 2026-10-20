import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require=createRequire(import.meta.url);require("tsx/cjs");
const Module=require("node:module");
export const reservationFixtureId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const reservationFixtureDispatch=reservationFixtureId(9);
export const reservationFixtureOrder=reservationFixtureId(2);

export function reservationFixtureRow(n=10,status="active") {
  const consumed=status==="consumed"?10:4;
  return {id:reservationFixtureId(n),order_id:reservationFixtureOrder,profile_code:`P-${n}`,profile_name:"Synthetic profile",
    order_number:"O-001",customer_name:"Synthetic customer",bundle_number:`B-${n}`,location:"Rack A",status,
    created_at:"2026-10-15T00:00:00+00:00",released_at:status==="released"||status==="cancelled"?"2026-10-15T01:00:00+00:00":null,notes:null,
    reserved_weight_kg:10,reserved_length_m:5,reserved_pieces:10,consumed_weight_kg:consumed,consumed_length_m:consumed/2,consumed_pieces:consumed,
    open_weight_kg:status==="active"?10-consumed:0,open_length_m:status==="active"?(10-consumed)/2:0,open_pieces:status==="active"?10-consumed:0,
    released_weight_kg:["released","cancelled"].includes(status)?10-consumed:0,released_length_m:["released","cancelled"].includes(status)?(10-consumed)/2:0,
    released_pieces:["released","cancelled"].includes(status)?10-consumed:0};
}

export function dispatchReservationEnvelope(rows,page=1) {
  const summary={active_count:rows.filter(row=>row.status==="active"&&row.open_weight_kg>0).length,
    open_weight_kg:rows.reduce((sum,row)=>sum+row.open_weight_kg,0),consumed_weight_kg:rows.reduce((sum,row)=>sum+row.consumed_weight_kg,0),
    released_weight_kg:rows.reduce((sum,row)=>sum+row.released_weight_kg,0)};
  const bounded=Math.min(page,Math.max(1,Math.ceil(rows.length/10)));
  return {dispatch_id:reservationFixtureDispatch,order_id:reservationFixtureOrder,order_number:"O-001",
    ledger:{page:bounded,page_size:10,total_count:rows.length,integrity_ok:true,summary,rows:rows.slice((bounded-1)*10,bounded*10)}};
}

export function createDispatchReservationRenderFixture() {
  let state;
  function reset(){
    const rows=Array.from({length:601},(_,n)=>reservationFixtureRow(1000+n,["active","released","consumed","cancelled"][n%4]));
    rows[0]={...rows[0],reserved_weight_kg:2000,reserved_length_m:1000,reserved_pieces:2000,consumed_weight_kg:1501,consumed_length_m:750.5,consumed_pieces:1501,
      open_weight_kg:499,open_length_m:249.5,open_pieces:499};
    state={role:"inventory_manager",dispatchId:reservationFixtureDispatch,rpcOverride:null,calls:[],tables:[],rows,result:null,throwRpc:false,dispatchError:null,reservationError:null,
      sourceOrderId:reservationFixtureOrder,legacyRows:null};
    return state;
  }
  reset();
  const original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="@/lib/auth")return {getSessionContext:async()=>({companyId:reservationFixtureId(1),role:state.role})};
    if(request==="next/navigation")return {redirect:path=>{throw new Error(`redirect:${path}`);}};
    if(request==="next/link")return function FixtureLink({children,...props}){return React.createElement("a",props,children);};
    if(request==="@/components/modules/operations/record-detail-client")return {RecordDetailClient:()=>null};
    if(request==="@/components/modules/dispatch-delivery-workflow")return {DispatchDeliveryWorkflow:()=>null};
    if(request==="@/components/modules/dispatch-credit-note-client")return {DispatchCreditNoteClient:()=>null};
    if(request==="@/lib/supabase/server")return {createClient:async()=>({
      async rpc(name,args){state.calls.push({name,args});if(state.throwRpc)throw new Error("private transport detail");
        if(state.rpcOverride)return state.rpcOverride(name,args);
        return state.result??{data:dispatchReservationEnvelope(state.rows,args.p_page),error:null};},
      from(table){state.tables.push(table);const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},
        async single(){return {data:{order_id:state.sourceOrderId,total_weight_kg:1501,delivery_status:"delivered"},error:state.dispatchError};},
        then(resolve,reject){
          const legacy=state.legacyRows??state.rows.slice(0,300).map(row=>({...row,profile_id:reservationFixtureId(3),
            aluminium_profiles:{profile_code:row.profile_code,profile_name:row.profile_name},profile_stock_batches:{bundle_number:row.bundle_number},
            profile_stock_consumptions:[{consumed_weight_kg:row.reserved_weight_kg===2000?1000:row.consumed_weight_kg}]}));
          return Promise.resolve({data:state.reservationError?null:legacy,error:state.reservationError}).then(resolve,reject);
        }};return query;}
    })};
    return original(request,parent,isMain);
  };
  let Page;
  try{Page=require("../../app/(dashboard)/dispatches/[id]/page.tsx").default;}finally{Module._load=original;}
  async function panel(params={}){
    const root=await Page({params:Promise.resolve({id:state.dispatchId}),searchParams:Promise.resolve(params)});
    const entry=root.props.children.find(child=>child?.type?.name==="DispatchReservationPanel");
    if(!entry)throw new Error("Actual dispatch reservation panel is missing");
    return entry;
  }
  return {Page,reset,get state(){return state;},async render(params={}){const entry=await panel(params);return renderToStaticMarkup(await entry.type(entry.props));},panel};
}
