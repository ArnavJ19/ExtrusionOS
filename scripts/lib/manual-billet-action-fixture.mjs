import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {manualBilletIds as f} from './manual-billet-allocation-fixture.mjs';

export function createManualBilletActionFixture(sql){
  const state={role:'owner',calls:[],paths:[],error:null,throwAfterWrite:false};
  const client={async rpc(name,args){
    state.calls.push({name,args});if(state.error)return {data:null,error:{message:state.error}};
    assert.ok(['allocate_billet_to_order','reallocate_billet_to_order'].includes(name));
    await sql.db.query('update app_users set role=$1 where id=$2',[state.role,f.actor]);
    try{const result=await (name==='allocate_billet_to_order'?sql.allocate(args.p_billet_id,args.p_order_id):sql.reallocate(args.p_billet_id,args.p_order_id));
      if(state.throwAfterWrite)throw new Error('Synthetic response lost after the write');return {data:result.rows[0].id,error:null};
    }catch(error){if(state.throwAfterWrite)throw error;return {data:null,error:{message:error.message}};}
  }};
  const require=createRequire(import.meta.url);require('tsx/cjs');const Module=require('node:module'),original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==='@/lib/auth')return {getSessionContext:async()=>{if(state.role===null)throw new Error('Authentication required');return {companyId:f.company,userId:f.actor,role:state.role,dealerId:null};}};
    if(request==='@/lib/supabase/server')return {createClient:async()=>client};
    if(request==='next/cache')return {revalidatePath:(...args)=>state.paths.push(args)};
    return original(request,parent,isMain);
  };
  const file=require.resolve('../../lib/actions/production.ts');delete require.cache[file];let actions;try{actions=require(file);}finally{Module._load=original;}
  return {state,allocate:(input={billet_id:f.freeBillet,order_id:sql.orderId})=>actions.allocateBilletToOrderAction(input),
    reallocate:(input={billet_id:f.freeBillet,order_id:sql.orderId})=>actions.reallocateBilletToOrderAction(input)};
}
