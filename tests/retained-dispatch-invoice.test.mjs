import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createRetainedInvoiceFixture,installRetainedInvoiceObjects,installRetainedInvoiceSettlementObjects,invoiceFixtureIds as f} from "../scripts/lib/retained-invoice-fixture.mjs";
import {fixtureId as id} from "../scripts/lib/direct-order-fixture.mjs";
import {buildInvoiceItems} from "../lib/pcda/invoice.ts";

let db;
test.before(async()=>{db=await createRetainedInvoiceFixture();});
test.after(async()=>{if(db)await db.close();});
test.beforeEach(async()=>{await db.exec(`reset role;begin;set test.actor='${f.actor}';set role authenticated;`);});
test.afterEach(async()=>{await db.exec("rollback;reset role;");});
async function attempt(callback){
  await db.exec("savepoint retained_attempt;");
  try{const result=await callback();await db.exec("release savepoint retained_attempt;");return result;}
  catch(error){await db.exec("rollback to savepoint retained_attempt;release savepoint retained_attempt;");throw error;}
}
async function observe(callback){await db.exec("reset role;");try{return await attempt(callback);}finally{await db.exec("set role authenticated;");}}
const cancel=()=>attempt(()=>db.query("update orders set current_stage='cancelled' where id=$1",[f.order]));
async function items(){return buildInvoiceItems((await observe(()=>db.query("select * from packing_list_items where dispatch_id=$1 order by id",[f.dispatch]))).rows,"00000000-0000-4000-8000-000000000999",f.company);}
async function save(patch={},lines=null,invoiceId=null){
  const payload={customer_id:"00000000-0000-4000-8000-000000000010",order_id:f.order,dispatch_id:f.dispatch,
    invoice_date:"2026-10-19",place_of_supply_state_code:"24",status:"draft",...patch};
  return attempt(async()=>{
    const result=await db.query("select public.save_invoice_atomic($1,$2,$3,true) id",[invoiceId,payload,lines??await items()]);
    await db.exec("set constraints all immediate;set constraints all deferred;");return result.rows[0].id;
  });
}
const snapshot=()=>observe(async()=>({stock:(await db.query("select * from profile_stock_batches order by id")).rows,
  consumption:(await db.query("select * from profile_stock_consumptions order by id")).rows,
  movements:(await db.query("select * from inventory_transactions order by id")).rows,
  fulfillment:(await db.query("select * from order_dealer_stock_fulfillments order by id")).rows}));

test("a retained delivered dispatch remains invoiceable after cancellation without changing physical stock or posted fulfillment",async()=>{
  const before=await snapshot();await cancel();const invoice=await save();
  assert.deepEqual(await snapshot(),before);
  const row=(await db.query("select subtotal,tax_total,grand_total,amount_paid,order_id,dispatch_id from invoices where id=$1",[invoice])).rows[0];
  assert.deepEqual(row,{subtotal:"1000.00",tax_total:"180.00",grand_total:"1180.00",amount_paid:"0.00",order_id:f.order,dispatch_id:f.dispatch});
  assert.equal((await db.query("select count(*) n from invoice_items where invoice_id=$1",[invoice])).rows[0].n,1);
});

test("open-order invoicing already preserves exact packing prices, GST and full source identities",async()=>{
  const invoice=await save();const row=(await db.query("select quantity,unit_rate,line_total,source_line_id,hsn_code,gst_percent from invoice_items where invoice_id=$1",[invoice])).rows[0];
  assert.deepEqual(row,{quantity:"10.000",unit_rate:"100.00",line_total:"1000.00",source_line_id:f.packing,hsn_code:"760421",gst_percent:"18.00"});
});

test("returned or damaged dispatches remain excluded even when their order is open",async()=>{
  for(const status of ["returned","damaged"]){
    await observe(()=>db.query("update dispatches set delivery_status=$1 where id=$2",[status,f.dispatch]));
    await assert.rejects(save(),/Returned or damaged/);
  }
});

test("retained-shipment invoicing still rejects repricing, duplicate packing sources and duplicate active invoices",async()=>{
  await cancel();const invoice=await save();await assert.rejects(save(),/active invoice/);
  const valid=await items();
  await assert.rejects(save({},[{...valid[0],unit_rate:999}],invoice),/immutable packing row/);
  await assert.rejects(save({},[valid[0],valid[0]],invoice),/only once|every packing row/);
  assert.equal((await db.query("select grand_total from invoices where id=$1",[invoice])).rows[0].grand_total,"1180.00");
});

const options=(kind="order",search="",orderId=null,invoiceId=null,selectedId=null)=>attempt(async()=>(await db.query(
  "select public.get_invoice_source_options($1,$2,$3,$4,$5) data",[kind,search,orderId,invoiceId,selectedId])).rows[0].data);
async function corruptPacking(set){
  // Simulate pre-existing bad history in the disposable fixture, then restore all guards.
  await observe(()=>db.exec(`alter table packing_list_items disable trigger user;update packing_list_items set ${set} where id='${f.packing}';alter table packing_list_items enable trigger user;`));
}

for(const status of ["dispatched","in_transit","delivered"]){
  test(`cancelled order can invoice its retained ${status} shipment with exact quantities`,async()=>{
    await observe(()=>db.query("update dispatches set delivery_status=$1 where id=$2",[status,f.dispatch]));
    await cancel();assert.equal((await options()).rows[0].id,f.order);await save();
  });
}
for(const status of ["pending","returned","damaged",null]){
  test(`cancelled ${status??"unknown"} dispatch is excluded from both source selection and direct writer`,async()=>{
    await observe(()=>db.query("update dispatches set delivery_status=$1 where id=$2",[status,f.dispatch]));
    await cancel();assert.deepEqual((await options()).rows,[]);await assert.rejects(save(),/before cancellation|Returned or damaged/);
  });
}

for(const [name,sql] of [
  ["missing cancellation history",`delete from order_stage_history where order_id='${f.order}'`],
  ["foreign cancellation history",`update order_stage_history set company_id='${f.sibling}' where order_id='${f.order}'`],
  ["future cancellation history",`update order_stage_history set changed_at=now()+interval '1 hour' where order_id='${f.order}'`],
  ["missing activation",`update dispatches set actual_dispatched_at=null where id='${f.dispatch}'`],
  ["activation after cancellation",`update dispatches set actual_dispatched_at=now()+interval '1 second' where id='${f.dispatch}'`],
  ["nonfinite dispatch creation",`update dispatches set created_at='-infinity' where id='${f.dispatch}'`],
  ["dispatch created after activation",`update dispatches set created_at=now()-interval '10 minutes' where id='${f.dispatch}'`],
  ["missing consumption",`delete from profile_stock_consumptions where dispatch_id='${f.dispatch}'`],
  ["late consumption",`update profile_stock_consumptions set created_at=now()+interval '1 hour' where dispatch_id='${f.dispatch}'`],
  ["wrong posted quantity",`update profile_stock_consumptions set consumed_pieces=2 where dispatch_id='${f.dispatch}'`],
  ["dispatch total disagrees with manifest",`update dispatches set total_weight_kg=20 where id='${f.dispatch}'`]
]){
  test(`${name} fails closed without creating financial records`,async()=>{
    await cancel();await observe(()=>db.exec(sql));const before=await snapshot();
    assert.deepEqual((await options()).rows,[]);await assert.rejects(save(),/before cancellation/);
    assert.equal((await db.query("select count(*) n from invoices")).rows[0].n,0);assert.deepEqual(await snapshot(),before);
  });
}
for(const [name,set] of [
  ["unverified manifest","operator_verified_at=null"],
  ["verification after activation","operator_verified_at=now()"],
  ["verification from another company",`operator_verified_by='${f.siblingActor}'`],
  ["invalid source lineage",`source_line_id='${f.otherReservation}'`],
  ["zero shipped metres","net_length_m=0"],
  ["nonfinite net rate","net_rate='NaN'"],
  ["unknown source kind","source_kind='unknown'"]
]){
  test(`${name} cannot invoice a cancelled remainder`,async()=>{
    await cancel();await corruptPacking(set);assert.deepEqual((await options()).rows,[]);
    await assert.rejects(save(),/before cancellation/);
  });
}

async function dealerSource(){
  // Replace the unused reservation seed when constructing the alternative source family.
  await observe(()=>db.exec(`delete from profile_stock_consumptions where dispatch_id='${f.dispatch}';
    update order_dealer_stock_fulfillments set created_at=now()-interval '2 hours' where id='${f.fulfillment}';
    update packing_list_items set source_kind='dealer_stock',source_line_id='${f.fulfillment}',reservation_id=null where id='${f.packing}';
    delete from profile_stock_reservations where id='${f.reservation}';`));
}
async function productionSource(){
  await observe(()=>db.exec(`delete from profile_stock_consumptions where dispatch_id='${f.dispatch}';
    insert into production_jobs(id,company_id,order_id,profile_id,source_record_id,source_line_id,planned_quantity_kg,actual_quantity_kg,actual_meters,actual_pieces,status,created_at,completed_at)
      values('${id(420)}','${f.company}','${f.order}','${f.profile}','${f.order}','${f.orderLine}',30,10,5,1,'completed',now()-interval '3 hours',now()-interval '2 hours');
    update packing_list_items set source_kind='production',source_record_id='${f.order}',source_line_id='${id(420)}',reservation_id=null,profile_stock_batch_id=null where id='${f.packing}';
    delete from profile_stock_reservations where id='${f.reservation}';`));
}
for(const [kind,prepare] of [["dealer_stock",dealerSource],["production",productionSource]]){
  test(`retained ${kind} shipment uses its posted source without crediting physical stock`,async()=>{
    await prepare();const before=await snapshot();await cancel();const invoice=await save();assert.deepEqual(await snapshot(),before);
    assert.equal((await db.query("select grand_total from invoices where id=$1",[invoice])).rows[0].grand_total,"1180.00");
  });
  test(`retained ${kind} source cannot be posted twice across dispatches`,async()=>{
    await prepare();await observe(()=>db.exec(`insert into dispatches(id,company_id,order_id,delivery_status,total_weight_kg,created_at,actual_dispatched_at)
      values('${id(421)}','${f.company}','${f.order}','delivered',20,now()-interval '2 hours',now()-interval '1 hour');
      insert into packing_list_items select (jsonb_populate_record(null::packing_list_items,to_jsonb(item)||jsonb_build_object('id','${id(422)}','dispatch_id','${id(421)}','net_weight_kg',20,'net_length_m',10,'number_of_pieces',2))).*
        from packing_list_items item where id='${f.packing}';`));
    await cancel();assert.deepEqual((await options()).rows,[]);await assert.rejects(save(),/before cancellation/);
  });
}

test("dealer fulfillment already returned to stock cannot support a retained invoice",async()=>{
  await dealerSource();await observe(()=>db.exec(`update order_dealer_stock_fulfillments set credited_at=now() where id='${f.fulfillment}'`));
  await cancel();await assert.rejects(save(),/before cancellation/);
});
test("production completed after dispatch cannot support a retained invoice",async()=>{
  await productionSource();await observe(()=>db.exec(`update production_jobs set completed_at=now() where id='${id(420)}'`));
  await cancel();await assert.rejects(save(),/before cancellation/);
});

test("unexplained extra posted consumption makes a retained manifest unavailable",async()=>{
  await cancel();await observe(()=>db.query(`insert into profile_stock_consumptions(company_id,dispatch_id,reservation_id,order_id,profile_id,profile_stock_batch_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
    values($1,$2,$3,$4,$5,$6,1,0.5,1)`,[f.company,f.dispatch,f.otherReservation,f.otherOrder,f.profile,f.batch]));
  const before=await snapshot();assert.deepEqual((await options()).rows,[]);await assert.rejects(save(),/before cancellation/);
  assert.deepEqual(await snapshot(),before);
});

test("financial roles can read retained sources; other roles, suspended and missing identities cannot",async()=>{
  await cancel();
  for(const role of ["owner","admin","accounts"]){await observe(()=>db.query("update app_users set role=$1 where id=$2",[role,f.actor]));assert.equal((await options()).rows.length,1);}
  for(const role of ["sales","sales_manager","viewer","production","production_manager","factory_manager","dispatch","dispatch_manager","inventory_manager","dealer_admin","dealer_staff","quality",null]){
    await observe(()=>db.query("update app_users set role=$1 where id=$2",[role,f.actor]));
    await assert.rejects(options(),/Permission denied/);await assert.rejects(save(),/Permission denied/);
  }
  await observe(()=>db.exec(`update app_users set role='owner',is_active=false where id='${f.actor}'`));
  await assert.rejects(options(),/Authentication required/);await assert.rejects(save(),/Authentication required/);
  await db.exec("set test.actor='';");await assert.rejects(options(),/Authentication required/);
});
test("another company cannot discover or invoice the retained shipment even by exact UUID",async()=>{
  await cancel();await db.exec(`set test.actor='${f.siblingActor}';`);
  assert.deepEqual((await options("order","",null,null,f.order)).rows,[]);
  await assert.rejects(options("dispatch","",f.order,null,f.dispatch),/unavailable/);
  await assert.rejects(save(),/Order not found/);
});
test("read-only financial RLS prevents direct invoice writes and private implementations remain uncallable",async()=>{
  await assert.rejects(attempt(()=>db.exec(`insert into invoices(id,company_id,customer_id,order_id,dispatch_id,status,invoice_date,place_of_supply_state_code,subtotal,tax_total,grand_total)
    values('${id(450)}','${f.company}','${id(10)}','${f.order}','${f.dispatch}','draft',current_date,'24',0,0,0)`)),/row-level security/);
  await assert.rejects(attempt(()=>db.query("select private.invoice_dispatch_is_billable($1,$2,$3)",[f.company,f.order,f.dispatch])),/permission denied/);
  const objects=await observe(()=>installRetainedInvoiceObjects(db));assert.deepEqual(objects,{functions:7,triggers:1});
  const permissions=(await observe(()=>db.query(`select has_function_privilege('anon','public.get_invoice_source_options(text,text,uuid,uuid,uuid)','EXECUTE') anon,
    has_function_privilege('authenticated','public.get_invoice_source_options(text,text,uuid,uuid,uuid)','EXECUTE') reader,
    has_function_privilege('authenticated','private.save_invoice_atomic(uuid,jsonb,jsonb,boolean)','EXECUTE') writer,
    has_function_privilege('authenticated','public.validate_invoice_dispatch_billable()','EXECUTE') trigger`))).rows[0];
  assert.deepEqual(permissions,{anon:false,reader:true,writer:false,trigger:false});
  const preflight=readFileSync(new URL("../sql/audit-deployment-preflight.sql",import.meta.url),"utf8")
    .split("-- Retained-shipment invoicing requires revised bodies and its attached header guard.")[1]
    .split("-- Order cancellation guards")[0];
  const catalog=(await observe(()=>db.query(preflight))).rows;assert.equal(catalog.length,4);
  assert.ok(catalog.every(row=>row.present&&row.security_definer&&!row.authenticated_execute&&!row.anonymous_execute));
  assert.equal(catalog.find(row=>row.signature==="public.validate_invoice_dispatch_billable()").attached,true);
});

test("source search finds old orders beyond 500 records, limits to 25 and treats wildcard characters literally",async()=>{
  await observe(()=>db.exec(`insert into orders(id,company_id,customer_id,current_stage,order_number,order_date)
      select (lpad(to_hex(n),8,'0')||'-1000-4000-8000-000000000000')::uuid,'${f.company}','${id(10)}','order_confirmed','NEW-'||n,current_date from generate_series(1,601) n;
    insert into dispatches(id,company_id,order_id,delivery_status,total_weight_kg,dispatch_number,dispatch_date)
      select (lpad(to_hex(n),8,'0')||'-2000-4000-8000-000000000000')::uuid,'${f.company}',(lpad(to_hex(n),8,'0')||'-1000-4000-8000-000000000000')::uuid,'pending',10,'DISPATCH-'||n,current_date from generate_series(1,601) n;
    insert into profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status)
      values('${id(470)}','${f.company}','${f.profile}',10000,5000,1000,'reserved');
    insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,status,reserved_weight_kg,reserved_length_m,reserved_pieces)
      select (lpad(to_hex(n),8,'0')||'-4000-4000-8000-000000000000')::uuid,'${f.company}',(lpad(to_hex(n),8,'0')||'-1000-4000-8000-000000000000')::uuid,'${f.profile}','${id(470)}','active',10,5,1 from generate_series(1,601) n;
    insert into packing_list_items select (jsonb_populate_record(null::packing_list_items,to_jsonb(item)||jsonb_build_object('id',(lpad(to_hex(n),8,'0')||'-3000-4000-8000-000000000000'),'dispatch_id',(lpad(to_hex(n),8,'0')||'-2000-4000-8000-000000000000'),
      'source_record_id',(lpad(to_hex(n),8,'0')||'-1000-4000-8000-000000000000'),'source_line_id',(lpad(to_hex(n),8,'0')||'-4000-4000-8000-000000000000'),'reservation_id',(lpad(to_hex(n),8,'0')||'-4000-4000-8000-000000000000'),'profile_stock_batch_id','${id(470)}','order_item_id',null,'quote_item_id',null))).*
      from packing_list_items item cross join generate_series(1,601) n where item.id='${f.packing}';`));
  await cancel();const page=await options();assert.equal(page.rows.length,25);assert.equal(page.has_more,true);
  assert.equal((await options("order","cancel-001")).rows[0].id,f.order);
  assert.equal((await options("order","",null,null,f.order)).rows[0].id,f.order);
  for(const search of ["%","_","' OR true --"]){assert.deepEqual((await options("order",search)).rows,[]);}
  const invoice=await save();assert.deepEqual((await options("order","cancel-001")).rows,[]);
  assert.equal((await options("order","",null,invoice,f.order)).rows[0].id,f.order);
});

test("late manifest failure rolls back header, items, totals and audit; issued invoices retain their lock",async()=>{
  await cancel();const invoice=await save();const before=(await db.query("select * from invoices where id=$1",[invoice])).rows[0];
  const valid=await items();await assert.rejects(save({notes:"must roll back"},[{...valid[0],line_total:1}],invoice),/immutable packing row/);
  assert.deepEqual((await db.query("select * from invoices where id=$1",[invoice])).rows[0],before);
  await save({status:"sent"},null,invoice);
  await assert.rejects(save({},null,invoice),/Only unpaid/);
  await assert.rejects(options("order","",null,invoice,f.order),/financially locked/);
  await assert.rejects(attempt(()=>db.query("select public.replace_invoice_items_atomic($1,$2)",[invoice,valid])),/Only unpaid/);
});

test("coverage guard rejects a partial manifest even through the authenticated SQL writer",async()=>{
  await observe(()=>db.exec(`insert into packing_list_items select (jsonb_populate_record(null::packing_list_items,to_jsonb(item)||jsonb_build_object('id','${id(460)}'))).*
    from packing_list_items item where id='${f.packing}';`));
  await assert.rejects(save({},(await items()).slice(0,1)),/every packing row/);
  assert.equal((await db.query("select count(*) n from invoices")).rows[0].n,0);
});

test("a retained receivable still accepts cash, return credits, refunds and credit reversal after the dispatch is returned",async()=>{
  await observe(()=>installRetainedInvoiceSettlementObjects(db));await cancel();const before=await snapshot();const invoice=await save({status:"generated"});
  const cash=await attempt(()=>db.query("select public.record_payment_atomic($1,$2) data",[invoice,{amount:1180,payment_method:"cash",payment_date:"2026-10-19",idempotency_key:id(480)}]));
  assert.equal(cash.rows[0].data.idempotent_replay,false);
  await observe(()=>db.query("update dispatches set delivery_status='returned' where id=$1",[f.dispatch]));
  const note=(await attempt(()=>db.query("select public.issue_dispatch_return_credit_note_atomic($1,$2,$3) id",[f.dispatch,"Verified full shipment return",id(481)]))).rows[0].id;
  let balance=(await db.query("select grand_total,amount_paid,credited_amount,balance_due,customer_credit_due,status from invoices where id=$1",[invoice])).rows[0];
  assert.deepEqual(balance,{grand_total:"1180.00",amount_paid:"1180.00",credited_amount:"1180.00",balance_due:"0.00",customer_credit_due:"1180.00",status:"credited"});
  await observe(()=>db.query(`insert into payments(company_id,invoice_id,amount,payment_method,payment_type,payment_status,payment_date)
    values($1,$2,180,'cash','REFUND','PAID',current_date)`,[f.company,invoice]));
  await observe(()=>db.query("select private.recalculate_invoice_collection_state($1,$2)",[invoice,f.company]));
  balance=(await db.query("select amount_paid,customer_credit_due from invoices where id=$1",[invoice])).rows[0];
  assert.deepEqual(balance,{amount_paid:"1000.00",customer_credit_due:"1000.00"});
  await attempt(()=>db.query("select public.reverse_credit_note_atomic($1,$2)",[note,"Correction of the return document"]));
  assert.equal((await db.query("select balance_due from invoices where id=$1",[invoice])).rows[0].balance_due,"180.00");
  await assert.rejects(save(),/Returned or damaged/);assert.deepEqual(await snapshot(),before);
});
