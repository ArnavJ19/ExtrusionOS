import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {invoiceFixtureIds as f} from "./retained-invoice-fixture.mjs";

let active;
const require=createRequire(import.meta.url);require("tsx/cjs");
const Module=require("node:module"),original=Module._load;
Module._load=function(request,parent,isMain){
  if(request==="@/lib/auth")return {getSessionContext:async()=>{if(active.authError)throw new Error("No session");return active.context;}};
  if(request==="@/lib/supabase/server")return {createClient:async()=>active.client};
  if(request==="next/cache")return {revalidatePath:path=>active.paths.push(path)};
  return original(request,parent,isMain);
};
let actions;try{actions=require("../../lib/actions/invoices.ts");}finally{Module._load=original;}

// Actual server actions and public SQL functions; only the session/HTTP transport is synthetic.
export function createInvoiceActionFixture(db){
  const state={context:{companyId:f.company,userId:f.actor,role:"owner",dealerId:null},calls:[],paths:[],readOverride:null,rpcOverride:null};
  const client={from(table){
    assert.ok(["orders","dispatches","invoices","packing_list_items_authorized"].includes(table),table);
    const call={table,filters:[],sort:[],range:null,count:false};
    const query={select(_columns,options){call.count=options?.count==="exact";return query;},
      eq(column,value){assert.match(column,/^[a-z_]+$/);call.filters.push([column,value]);return query;},
      order(column,{ascending=true}={}){assert.match(column,/^[a-z_]+$/);call.sort.push([column,ascending]);return query;},
      range(start,end){call.range=[start,end];return query;},maybeSingle(){return execute(true);},then(resolve,reject){return execute(false).then(resolve,reject);}};
    async function execute(single){
      state.calls.push(call);
      assert.ok(call.filters.some(([column,value])=>column==="company_id"&&value===state.context.companyId),"Source read must derive company from the session");
      const actual=table==="packing_list_items_authorized"?"packing_list_items":table;
      const where=call.filters.map(([column],i)=>`${column}=$${i+1}`).join(" and "),values=call.filters.map(([,value])=>value);
      const sort=call.sort.map(([column,ascending])=>`${column} ${ascending?"asc":"desc"}`).join(",");
      const [start,end]=call.range??[0,single?0:999];
      const result=await db.query(`select * from ${actual} where ${where}${sort?` order by ${sort}`:""} limit ${end-start+1} offset ${start}`,values);
      const count=call.count?Number((await db.query(`select count(*) count from ${actual} where ${where}`,values)).rows[0].count):null;
      const response={data:single?result.rows[0]??null:result.rows,error:null,count};
      return state.readOverride?await state.readOverride(call,response):response;
    }
    return query;
  },async rpc(name,args){
    state.calls.push({rpc:name,args});
    if(state.rpcOverride)return state.rpcOverride(name,args);
    try{
      const run=async tx=>{
        let result;
        if(name==="get_invoice_source_options")result=await tx.query("select public.get_invoice_source_options($1,$2,$3,$4,$5) data",[args.p_kind,args.p_search,args.p_order_id,args.p_invoice_id,args.p_selected_id]);
        else if(name==="save_invoice_atomic")result=await tx.query("select public.save_invoice_atomic($1,$2,$3,$4) data",[args.p_invoice_id,args.p_invoice,args.p_items,args.p_replace_items]);
        else if(name==="replace_invoice_items_atomic")result=await tx.query("select public.replace_invoice_items_atomic($1,$2) data",[args.p_invoice_id,args.p_items]);
        else throw new Error(`Unexpected invoice RPC ${name}`);
        await tx.exec("set constraints all immediate;set constraints all deferred;");return result.rows[0].data;
      };
      let data;
      if(state.useSavepoint){
        await db.exec("savepoint invoice_action;");
        try{data=await run(db);await db.exec("release savepoint invoice_action;");}
        catch(error){await db.exec("rollback to savepoint invoice_action;release savepoint invoice_action;");throw error;}
      }else data=await db.transaction(run);
      return {data,error:null};
    }catch(error){return {data:null,error};}
  }};
  state.client=client;
  return {state,client,async invoke(name,input){active=state;assert.ok(actions[name]);return actions[name](input);}};
}
