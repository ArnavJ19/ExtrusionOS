import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {createHistoricalTables} from "../scripts/lib/historical-schema-fixture.mjs";
import {dispatchReservationCandidate,installDispatchReservationLedgerObjects} from "../scripts/lib/dispatch-reservation-ledger-fixture.mjs";
import {loadDispatchReservationLedgerPage,loadReservationLedgerPage,getReservationLedgerOptions} from "../lib/inventory/reservation-ledger.ts";
import {can} from "../lib/auth/permissions.ts";

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const company=id(1),order=id(2),otherOrder=id(3),sibling=id(4),actor=id(10),siblingActor=id(11),dispatch=id(100),otherDispatch=id(101),siblingDispatch=id(102);
let db;
async function attempt(callback){
  await db.exec("savepoint ledger_attempt;");
  try{const result=await callback();await db.exec("release savepoint ledger_attempt;");return result;}
  catch(error){await db.exec("rollback to savepoint ledger_attempt;release savepoint ledger_attempt;");throw error;}
}
async function inspect(callback){await db.exec("reset role;");try{return await attempt(callback);}finally{await db.exec("set role authenticated;");}}
const edit=(sql,args=[])=>inspect(()=>db.query(sql,args));
const raw=(dispatchId=dispatch,page=1)=>attempt(async()=>(await db.query("select public.get_dispatch_reservation_ledger_page($1,$2) data",[dispatchId,page])).rows[0].data);
const client={async rpc(name,args){
  try{assert.equal(name,"get_dispatch_reservation_ledger_page");return {data:await raw(args.p_dispatch_id,args.p_page),error:null};}
  catch(error){return {data:null,error};}
}};
const load=(dispatchId=dispatch,page=1)=>loadDispatchReservationLedgerPage(client,dispatchId,page);

test.before(async()=>{
  db=new PGlite();
  await db.exec(`create schema auth;create schema private;create role authenticated;create role anon;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;`);
  await createHistoricalTables(db,["app_users","customers","orders","dispatches","aluminium_profiles","profile_stock_batches","profile_stock_reservations","profile_stock_consumptions"],dispatchReservationCandidate);
  await db.exec(`create function private.get_current_user_company_id() returns uuid language sql security definer as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql security definer as $$select role::text from app_users where id=auth.uid() and is_active$$;
    insert into app_users(id,company_id,role,is_active) values('${actor}','${company}','inventory_manager',true),('${siblingActor}','${sibling}','owner',true);
    insert into customers(id,company_id,customer_name,company_name) values('${id(20)}','${company}','Synthetic customer',null),('${id(21)}','${sibling}','SIBLING SECRET CUSTOMER',null);
    insert into aluminium_profiles(id,company_id,profile_code,profile_name) values('${id(30)}','${company}','P-TARGET','Synthetic profile'),('${id(31)}','${sibling}','SIBLING SECRET PROFILE','SIBLING SECRET PROFILE');
    insert into profile_stock_batches(id,company_id,profile_id,bundle_number,location,total_weight_kg,length_m,quantity_pieces)
      values('${id(40)}','${company}','${id(30)}','B-TARGET','Rack A',9999,9999,9999),('${id(41)}','${sibling}','${id(31)}','SIBLING SECRET BUNDLE','SIBLING SECRET RACK',99999,99999,99999);
    insert into orders(id,company_id,customer_id,order_number,order_value) values('${order}','${company}','${id(20)}','O-TARGET',99999),
      ('${otherOrder}','${company}','${id(20)}','OTHER ORDER SECRET',99999),('${id(5)}','${sibling}','${id(21)}','SIBLING SECRET ORDER',99999);
    insert into dispatches(id,company_id,order_id) values('${dispatch}','${company}','${order}'),('${otherDispatch}','${company}','${otherOrder}'),
      ('${siblingDispatch}','${sibling}','${id(5)}'),('${id(103)}','${company}',null),('${id(104)}','${company}','${id(5)}'),('${id(105)}','${company}','${order}');`);
  const reservations=Array.from({length:601},(_,n)=>({id:id(1000+n),company_id:company,order_id:order,profile_id:id(30),profile_stock_batch_id:id(40),
    status:["active","released","consumed","cancelled"][n%4],created_at:"2026-10-15T00:00:00Z",released_at:n%4?"2026-10-15T01:00:00Z":null,
    reserved_weight_kg:n===0?2000:10,reserved_length_m:n===0?1000:5,reserved_pieces:n===0?2000:10}));
  await db.query(`insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,status,created_at,released_at,reserved_weight_kg,reserved_length_m,reserved_pieces)
    select * from jsonb_to_recordset($1::jsonb) as x(id uuid,company_id uuid,order_id uuid,profile_id uuid,profile_stock_batch_id uuid,status text,created_at timestamptz,released_at timestamptz,
      reserved_weight_kg numeric,reserved_length_m numeric,reserved_pieces integer)`,[JSON.stringify(reservations)]);
  await db.exec(`insert into profile_stock_consumptions(company_id,reservation_id,order_id,profile_id,profile_stock_batch_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
      select '${company}','${id(1000)}','${order}','${id(30)}','${id(40)}',1,.5,1 from generate_series(1,1501);
    insert into profile_stock_consumptions(company_id,reservation_id,order_id,profile_id,profile_stock_batch_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
      select company_id,id,order_id,profile_id,profile_stock_batch_id,case when status='consumed' then 10 else 4 end,case when status='consumed' then 5 else 2 end,case when status='consumed' then 10 else 4 end
      from profile_stock_reservations where id<>'${id(1000)}';
    update profile_stock_reservations set initial_reserved_weight_kg=10,initial_reserved_length_m=5,initial_reserved_pieces=10,
      reserved_weight_kg=4,reserved_length_m=2,reserved_pieces=4 where id='${id(1001)}';
    insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,status,created_at,reserved_weight_kg,reserved_length_m,reserved_pieces)
      values('${id(9000)}','${company}','${otherOrder}','${id(30)}','${id(40)}','active',now(),777,777,777),
        ('${id(9001)}','${sibling}','${id(5)}','${id(31)}','${id(41)}','active',now(),888,888,888);
    create index fixture_consumption_reservation on profile_stock_consumptions(company_id,reservation_id);
    analyze;
    grant usage on schema public,auth to authenticated,anon;`);
  await installDispatchReservationLedgerObjects(db);
});
test.after(async()=>{if(db)await db.close();});
test.beforeEach(async()=>{await db.exec(`reset role;begin;set test.actor='${actor}';set role authenticated;`);});
test.afterEach(async()=>{await db.exec("rollback;reset role;");});

test("a dispatch snapshot includes all 601 source-order records and complete 1501-entry consumption history",async()=>{
  const result=await load();assert.equal(result.dispatch_id,dispatch);assert.equal(result.order_id,order);assert.equal(result.order_number,"O-TARGET");
  assert.equal(result.ledger.total_count,601);assert.equal(result.ledger.rows.length,10);
  assert.deepEqual(result.ledger.summary,{active_count:151,open_weight_kg:1399,consumed_weight_kg:4801,released_weight_kg:1800});
  const first=result.ledger.rows[0];assert.equal(first.id,id(1000));assert.equal(first.open_weight_kg,499);assert.equal(first.open_length_m,249.5);assert.equal(first.open_pieces,499);
  const released=result.ledger.rows[1];assert.equal(released.status,"released");assert.equal(released.reserved_weight_kg,10);assert.equal(released.open_weight_kg,0);assert.equal(released.released_weight_kg,6);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|99999|order_value|supplier_rate|internal_cost|company_id/);
});

test("stable ten-row pages reach every order reservation and totals are invariant under pagination or dispatch choice",async()=>{
  const found=[];const summary=(await load()).ledger.summary;
  for(let page=1;page<=61;page++){
    const result=await load(dispatch,page);assert.equal(result.ledger.page,page);assert.deepEqual(result.ledger.summary,summary);found.push(...result.ledger.rows.map(row=>row.id));
  }
  assert.deepEqual(found,Array.from({length:601},(_,n)=>id(1000+n)));assert.equal(new Set(found).size,601);
  assert.equal((await load(dispatch,100000)).ledger.page,61);
  assert.deepEqual((await load(id(105))).ledger,(await load()).ledger);
});

test("released or cancelled remainders have zero open holds in every unit and do not rewrite physical stock",async()=>{
  const before=await edit("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[id(40)]);
  await edit("update profile_stock_reservations set status='released',released_at=now() where id=$1",[id(1000)]);
  const first=(await load()).ledger.rows[0];assert.equal(first.status,"released");assert.equal(first.open_weight_kg,0);assert.equal(first.open_length_m,0);assert.equal(first.open_pieces,0);
  assert.equal(first.released_weight_kg,499);assert.equal(first.released_length_m,249.5);assert.equal(first.released_pieces,499);
  assert.equal((await load()).ledger.summary.active_count,150);
  await edit("update profile_stock_reservations set status='cancelled' where id=$1",[id(1000)]);
  assert.equal((await load()).ledger.rows[0].released_weight_kg,499);
  assert.deepEqual((await edit("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[id(40)])).rows,before.rows);
  assert.equal((await edit("select count(*) count from profile_stock_consumptions where reservation_id=$1",[id(1000)])).rows[0].count,1501);
});

test("an unlinked dispatch never falls through to an unfiltered company ledger",async()=>{
  assert.deepEqual(await load(id(103)),{dispatch_id:id(103),order_id:null,order_number:null,ledger:null});
  await assert.rejects(load(id(104)),/source order is unavailable/);
  const other=await load(otherDispatch);assert.equal(other.ledger.total_count,1);assert.equal(other.ledger.summary.open_weight_kg,777);
});

test("dispatch identity and role gates precede lookup and reject foreign, unknown, absent and suspended callers",async()=>{
  for(const role of ["owner","admin","factory_manager","inventory_manager","dispatch_manager","dispatch","production_manager","production","viewer","accounts","sales","sales_manager","quality","dealer_admin","dealer_staff","unknown",null]){
    await edit("update app_users set role=$1 where id=$2",[role,actor]);
    const allowed=can(role,"read","dispatches")&&can(role,"read","inventory_reservations");
    if(allowed)assert.equal((await load()).ledger.total_count,601,role);
    else await assert.rejects(load(),/Permission denied/,role??"missing role");
  }
  await edit("update app_users set role='owner' where id=$1",[actor]);
  await assert.rejects(load(siblingDispatch),/unavailable for this account/);await assert.rejects(load(id(999)),/unavailable for this account/);
  await edit("update app_users set is_active=false where id=$1",[actor]);await assert.rejects(load(),/Authentication required/);
  await edit("select set_config('test.actor','',true)");await assert.rejects(load(),/Authentication required/);
});

test("company identity is derived and a sibling company receives only its own order reservations",async()=>{
  await edit("select set_config('test.actor',$1,true)",[siblingActor]);
  const other=await load(siblingDispatch);assert.equal(other.ledger.total_count,1);assert.equal(other.ledger.rows[0].id,id(9001));
  await assert.rejects(load(),/unavailable for this account/);
});

test("integrity problems outside the visible page are unavailable while unrelated orders cannot poison this order",async()=>{
  for(const [column,value] of [["reserved_weight_kg",-1],["reserved_weight_kg","NaN"],["reserved_length_m","NaN"],["status","consumed"],["status",null],["status","unknown"]]){
    await edit(`update profile_stock_reservations set ${column}=$1 where id=$2`,[value,id(1596)]);
    assert.equal((await raw()).ledger.integrity_ok,false);await assert.rejects(load(),/unavailable|incomplete/);
    await edit("update profile_stock_reservations set reserved_weight_kg=10,reserved_length_m=5,status='active' where id=$1",[id(1596)]);
  }
  await edit("update profile_stock_reservations set reserved_weight_kg=-1 where id=$1",[id(9000)]);
  assert.equal((await load()).ledger.integrity_ok,true);
});

test("altered consumption provenance or negative/nonfinite entries cannot be hidden by an aggregate sum",async()=>{
  for(const [column,value] of [["order_id",otherOrder],["profile_id",id(31)],["profile_stock_batch_id",id(41)],["consumed_weight_kg",-1],["consumed_weight_kg","NaN"],["consumed_length_m","NaN"]]){
    await edit(`update profile_stock_consumptions set ${column}=$1 where reservation_id=$2`,[value,id(1596)]);
    assert.equal((await raw()).ledger.integrity_ok,false);await assert.rejects(load(),/unavailable|incomplete/);
    await edit("update profile_stock_consumptions set order_id=$1,profile_id=$2,profile_stock_batch_id=$3,consumed_weight_kg=4,consumed_length_m=2 where reservation_id=$4",[order,id(30),id(40),id(1596)]);
  }
});

test("unrecorded legacy metres and pieces stay unknown, while a complete terminal record retains its status",async()=>{
  await edit("update profile_stock_reservations set reserved_length_m=null,reserved_pieces=null where id=$1",[id(1000)]);
  await edit("update profile_stock_consumptions set consumed_length_m=null,consumed_pieces=null where reservation_id=$1",[id(1000)]);
  const first=(await load()).ledger.rows[0];assert.equal(first.open_length_m,null);assert.equal(first.open_pieces,null);assert.equal(first.open_weight_kg,499);
  await edit("update profile_stock_reservations set status='released' where id=$1",[id(1002)]);
  assert.equal((await load()).ledger.rows[2].status,"released");assert.equal((await load()).ledger.rows[2].released_weight_kg,0);
});

test("the read-only snapshot and its shared calculation expose no anonymous or direct private execution",async()=>{
  await db.exec("set transaction read only;");assert.equal((await load()).ledger.total_count,601);
  const privileges=(await inspect(()=>db.query(`select has_function_privilege('anon','public.get_dispatch_reservation_ledger_page(uuid,integer)','EXECUTE') anonymous,
    has_function_privilege('authenticated','private.profile_stock_reservation_ledger_page(integer,text,text,text,text,uuid)','EXECUTE') private,
    has_function_privilege('authenticated','public.get_dispatch_reservation_ledger_page(uuid,integer)','EXECUTE') authenticated`))).rows[0];
  assert.deepEqual(privileges,{anonymous:false,private:false,authenticated:true});
  await assert.rejects(attempt(()=>db.query("select private.profile_stock_reservation_ledger_page(1,'','','created_at','desc',null)")),/permission denied/);
  await assert.rejects(raw(null,1),/Invalid dispatch reservation request/);await assert.rejects(raw(dispatch,0),/Invalid dispatch reservation request/);
});

test("the existing inventory endpoint delegates to the same quantities without losing global coverage or original roles",async()=>{
  await edit("update app_users set role='production' where id=$1",[actor]);
  await assert.rejects(load(),/Permission denied/);
  const inventoryClient={async rpc(name,args){assert.equal(name,"get_profile_stock_reservation_ledger_page");
    return {data:(await db.query("select public.get_profile_stock_reservation_ledger_page($1,$2,$3,$4,$5) data",[args.p_page,args.p_search,args.p_status,args.p_sort,args.p_direction])).rows[0].data,error:null};}};
  const all=await loadReservationLedgerPage(inventoryClient,getReservationLedgerOptions({}));assert.equal(all.total_count,602);
  const searched=await loadReservationLedgerPage(inventoryClient,getReservationLedgerOptions({q:"O-TARGET"}));assert.equal(searched.total_count,601);
  assert.deepEqual(searched.summary,{active_count:151,open_weight_kg:1399,consumed_weight_kg:4801,released_weight_kg:1800});
});
