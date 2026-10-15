import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createDirectOrderFixture, fixtureId as id } from "../scripts/lib/direct-order-fixture.mjs";

const require=createRequire(import.meta.url);require("tsx/cjs");
const Module=require("node:module");
let state;
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(request==="next/cache")return {revalidatePath:path=>state.paths.push(path)};
  if(request==="@/lib/auth")return {getSessionContext:async()=>{state.auth++;if(state.authError)throw state.authError;return state.context;}};
  if(request==="@/lib/supabase/server")return {createClient:async()=>{state.clients++;return state.client;}};
  return original(request,parent,isMain);
};
let actions;
try{actions=require("../lib/actions/direct-orders.ts");}finally{Module._load=original;}
const item=()=>({profile_id:id(20),die_id:null,quantity_pieces:10,length_per_piece_m:6,expected_section_weight_kg_per_m:.5,net_rate:250,gst_percent:18,hsn_code:"760421",finishing_type:"mill_finish"});
const input=()=>({idempotency_key:id(100),order:{customer_id:id(10),order_date:"2026-10-15",expected_dispatch_date:null,priority:"normal",notes:"Accepted price"},items:[item()]});
test.beforeEach(()=>{
  state={context:{companyId:id(1),userId:id(3),role:"sales",dealerId:null},auth:0,clients:0,paths:[],calls:[],result:{data:id(90),error:null}};
  state.client={rpc:async(name,args)=>{state.calls.push([name,args]);return state.result;},
    from:table=>{state.calls.push(["from",table]);const query={then:resolve=>resolve(state.result)};
      for(const method of ["select","eq","is","ilike","order","range"])query[method]=(...args)=>{state.calls.push([method,...args]);return query;};return query;}};
});

test("server action derives context, normalizes decimals and notes, and sends only explicit commercial inputs",async()=>{
  const data=input();data.order.notes="  Accepted price  ";data.items[0].net_rate=125.01+.02;
  assert.equal((await actions.createDirectOrderAction(data)).success,true);
  assert.equal(state.calls.length,1);assert.equal(state.calls[0][0],"create_direct_order_atomic");
  const args=state.calls[0][1];assert.equal(args.p_order.notes,"Accepted price");assert.equal(args.p_items[0].net_rate,125.03);
  assert.equal(args.p_idempotency_key,id(100));assert.equal("company_id" in args.p_order,false);assert.equal("order_value" in args.p_order,false);
  assert.ok(state.paths.includes(`/orders/${id(90)}`));assert.ok(state.paths.includes("/orders/database"));
  assert.ok(state.paths.includes("/production/consolidation"));
});

test("server action rejects denied roles, dealer-scoped accounts and missing sessions before opening a database client",async()=>{
  for(const role of ["production_manager","factory_manager","production","accounts","viewer","dealer_admin","dealer_staff","dispatch_manager"]){
    state.context.role=role;assert.equal((await actions.createDirectOrderAction(input())).success,false);
    assert.equal((await actions.searchDirectOrderOptionsAction("profile","")).success,false);
  }
  state.context.role="owner";state.context.dealerId=id(900);assert.equal((await actions.createDirectOrderAction(input())).success,false);
  state.authError=new Error("Authentication required");assert.equal((await actions.createDirectOrderAction(input())).success,false);
  assert.equal(state.clients,0);assert.deepEqual(state.calls,[]);assert.deepEqual(state.paths,[]);
});

test("forged company, quotation, total and malformed commercial inputs never reach the RPC",async()=>{
  for(const data of [{...input(),company_id:id(2)},{...input(),order:{...input().order,company_id:id(2)}},
    {...input(),order:{...input().order,quote_id:id(50)}},{...input(),order:{...input().order,order_value:1}},
    {...input(),items:[{...item(),net_rate:Infinity}]},{...input(),items:[{...item(),gst_percent:18.001}]},
    {...input(),items:[{...item(),quantity_pieces:1.5}]},{...input(),items:[]},
    {...input(),order:{...input().order,expected_dispatch_date:"2026-10-14"}}])assert.equal((await actions.createDirectOrderAction(data)).success,false);
  assert.equal(state.clients,0);assert.deepEqual(state.calls,[]);assert.deepEqual(state.paths,[]);
});

test("missing workflow setup and malformed confirmations fail visibly without navigation or revalidation",async()=>{
  for(const code of ["PGRST202","42883"]){state.result={data:null,error:{code,message:"missing implementation"}};
    assert.match((await actions.createDirectOrderAction(input())).error,/entry is unavailable/);}
  for(const data of [null,undefined,{},[],"------------------------------------","not-an-id"]){state.result={data,error:null};
    assert.match((await actions.createDirectOrderAction(input())).error,/confirmation is unavailable/);}
  assert.deepEqual(state.paths,[]);
});

test("RPC rejection or thrown transport errors preserve a retry with the same input and key",async()=>{
  const data=input();state.result={data:null,error:{message:"Retry key belongs to different details"}};
  assert.match((await actions.createDirectOrderAction(data)).error,/different details/);
  state.client.rpc=async(name,args)=>{state.calls.push([name,args]);throw new Error("synthetic lost connection");};
  assert.match((await actions.createDirectOrderAction(data)).error,/lost connection/);
  assert.deepEqual(state.calls[0],state.calls[1]);assert.deepEqual(state.paths,[]);
});

test("customer and profile search stay tenant-scoped, literal and deterministically bounded to 25 matches",async()=>{
  state.result={data:[],error:null};
  for(const kind of ["customer","profile"]){state.calls=[];const result=await actions.searchDirectOrderOptionsAction(kind,"A%_\\B");assert.equal(result.success,true);
    assert.ok(state.calls.some(call=>call[0]==="eq"&&call[1]==="company_id"&&call[2]===id(1)));
    assert.deepEqual(state.calls.find(call=>call[0]==="ilike"),["ilike",kind==="customer"?"customer_name":"profile_code","%A\\%\\_\\\\B%"]);
    assert.deepEqual(state.calls.find(call=>call[0]==="range"),["range",0,24]);
    assert.deepEqual(state.calls.find(call=>call[0]==="is"),["is","deleted_at",null]);
    assert.ok(state.calls.some(call=>call[0]==="order"&&call[1]==="id"));
    const select=state.calls.find(call=>call[0]==="select")[1];assert.doesNotMatch(select,/cost|margin|supplier|rate|internal/);
    if(kind==="profile")assert.ok(state.calls.some(call=>call[0]==="eq"&&call[1]==="is_active"&&call[2]===true));
  }
});

test("invalid searches and query failures cannot masquerade as an empty successful catalogue",async()=>{
  for(const [kind,search] of [["other",""],["customer","x".repeat(101)],["profile",null]])assert.equal((await actions.searchDirectOrderOptionsAction(kind,search)).success,false);
  assert.equal(state.clients,0);
  state.result={data:null,error:{message:"catalogue unavailable"}};assert.match((await actions.searchDirectOrderOptionsAction("profile","")).error,/catalogue unavailable/);
  state.client.from=()=>{throw new Error("transport unavailable");};assert.match((await actions.searchDirectOrderOptionsAction("customer","")).error,/transport unavailable/);
});

test("the actual action and SQL wrapper recover one committed order across separate sequential transactions",async(t)=>{
  const db=await createDirectOrderFixture();t.after(()=>db.close());
  state.client.rpc=async(name,args)=>{
    assert.equal(name,"create_direct_order_atomic");
    await db.exec(`begin;set test.actor='${id(3)}';set role authenticated;`);
    try{const result=await db.query("select public.create_direct_order_atomic($1,$2,$3) id",[args.p_order,args.p_items,args.p_idempotency_key]);
      await db.exec("commit;reset role;");return {data:result.rows[0].id,error:null};}
    catch(error){await db.exec("rollback;reset role;");return {data:null,error};}
  };
  const first=await actions.createDirectOrderAction(input());assert.equal(first.success,true);
  const retry=await actions.createDirectOrderAction(input());assert.deepEqual(retry,first);
  assert.deepEqual((await db.query(`select (select count(*) from orders) orders,(select count(*) from order_items) lines,
    (select count(*) from private.direct_order_requests where completed) requests,(select count(*) from audit_logs) audits`)).rows,[{orders:1,lines:1,requests:1,audits:1}]);
  const conflict=await actions.createDirectOrderAction({...input(),items:[{...item(),net_rate:251}]});assert.equal(conflict.success,false);assert.match(conflict.error,/different order details/);
});
