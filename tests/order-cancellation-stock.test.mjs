import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createOrderCancellationStockFixture,installOrderCancellationStockObjects,cancellationIds as f} from "../scripts/lib/order-cancellation-stock-fixture.mjs";
import {fixtureId as id} from "../scripts/lib/direct-order-fixture.mjs";
import {sqlDefinition} from "../scripts/lib/historical-schema-fixture.mjs";
import {getBatchAvailableWeightKg,getBatchAvailableLengthM,getBatchAvailablePieces} from "../lib/systems-configurator/inventory-reservation.ts";

let db;
test.before(async()=>{db=await createOrderCancellationStockFixture();});
test.after(async()=>{if(db)await db.close();});
test.beforeEach(async()=>{await db.exec(`reset role;begin;set test.actor='${f.actor}';set role authenticated;`);});
test.afterEach(async()=>{await db.exec("rollback;reset role;");});
async function attempt(callback){
  await db.exec("savepoint cancellation_attempt;");
  try{const result=await callback();await db.exec("release savepoint cancellation_attempt;");return result;}
  catch(error){await db.exec("rollback to savepoint cancellation_attempt;release savepoint cancellation_attempt;");throw error;}
}
async function observe(callback){await db.exec("reset role;");try{return await attempt(callback);}finally{await db.exec("set role authenticated;");}}
const cancel=()=>attempt(()=>db.query("update orders set current_stage='cancelled' where id=$1 returning id",[f.order]));
const snapshot=()=>observe(async()=>({
  batch:(await db.query("select * from profile_stock_batches where id=$1",[f.batch])).rows[0],
  reservations:(await db.query("select * from profile_stock_reservations order by id")).rows,
  consumption:(await db.query("select * from profile_stock_consumptions order by id")).rows,
  fulfillment:(await db.query("select * from order_dealer_stock_fulfillments order by id")).rows,
  movements:(await db.query("select * from inventory_transactions order by id")).rows,
  history:(await db.query("select * from order_stage_history order by id")).rows,
  audits:(await db.query("select * from audit_logs order by id")).rows
}));

test("cancelling the unfulfilled remainder never manufactures a physical return of dealer-fulfilled stock",async()=>{
  const before=await snapshot();await cancel();const after=await snapshot();
  assert.deepEqual(after.batch,before.batch);
  assert.deepEqual(after.fulfillment,before.fulfillment);assert.deepEqual(after.movements,before.movements);
  assert.deepEqual(after.consumption,before.consumption);
});

test("order cancellation frees only the target order's unconsumed kg, metres and pieces",async()=>{
  const before=await snapshot();await cancel();const after=await snapshot();
  const released=after.reservations.find(row=>row.id===f.reservation);assert.equal(released.status,"cancelled");assert.ok(released.released_at);
  const original=before.reservations.find(row=>row.id===f.reservation);
  for(const column of ["reserved_weight_kg","reserved_length_m","reserved_pieces","initial_reserved_weight_kg","initial_reserved_length_m","initial_reserved_pieces"])
    assert.equal(released[column],original[column]);
  assert.deepEqual(after.reservations.find(row=>row.id===f.otherReservation),before.reservations.find(row=>row.id===f.otherReservation));
  const projected=after.reservations.map(row=>({...row,consumed_weight_kg:row.id===f.reservation?10:0,
    consumed_length_m:row.id===f.reservation?5:0,consumed_pieces:row.id===f.reservation?1:0}));
  assert.equal(getBatchAvailableWeightKg(after.batch,projected),20);assert.equal(getBatchAvailableLengthM(after.batch,projected),10);
  assert.equal(getBatchAvailablePieces(after.batch,projected),2);
});

test("a repeat cancellation preserves one release, its timestamp and one audit without another inventory credit",async()=>{
  await cancel();const first=await snapshot();await cancel();await cancel();assert.deepEqual(await snapshot(),first);
  const entries=first.audits.filter(row=>row.action==="order_cancelled_hold_release");assert.equal(entries.length,1);
  assert.equal(first.history.filter(row=>row.stage==="cancelled").length,1);
  assert.equal(entries[0].metadata_json.released_reservation_count,1);assert.equal(entries[0].metadata_json.released_weight_kg,20);
  assert.equal(entries[0].metadata_json.physical_stock_changed,false);
});

test("the cancellation history does not claim a dealer credit or physical receipt",async()=>{
  await cancel();const after=await snapshot();const history=after.history.find(row=>row.stage==="cancelled");
  assert.match(history.remarks,/unconsumed|hold/i);assert.doesNotMatch(history.remarks,/credited back automatically/i);
  assert.equal(after.fulfillment[0].credited_at,null);
});

test("an integrity failure in hidden consumption rolls back the order cancellation and every release",async()=>{
  await observe(()=>db.query("update profile_stock_consumptions set consumed_pieces=99 where reservation_id=$1",[f.reservation]));
  const before=await snapshot();await assert.rejects(cancel(),/integrity|unavailable|reconcil/i);
  assert.deepEqual(await snapshot(),before);
  assert.equal((await db.query("select current_stage from orders where id=$1",[f.order])).rows[0].current_stage,"dispatched");
});

test("failure in a later audit insert rolls back the order, released holds and history together",async()=>{
  await observe(()=>db.exec(`create function public.fixture_reject_cancellation_audit() returns trigger language plpgsql as $$begin
      if new.action='order_cancelled_hold_release' then raise exception 'synthetic late audit failure';end if;return new;end;$$;
    create trigger fixture_reject_cancellation_audit before insert on audit_logs for each row execute function public.fixture_reject_cancellation_audit();`));
  const before=await snapshot();await assert.rejects(cancel(),/synthetic late audit failure/);assert.deepEqual(await snapshot(),before);
});

test("a sibling-company identity cannot cancel this order or alter its stock and holds",async()=>{
  const before=await snapshot();await db.query("select set_config('test.actor',$1,true)",[f.siblingActor]);
  assert.equal((await cancel()).rows.length,0);assert.deepEqual(await snapshot(),before);
});

test("a cancelled order cannot acquire a new active reservation or reactivate its released hold",async()=>{
  await cancel();
  await assert.rejects(attempt(()=>db.query("update profile_stock_reservations set status='active' where id=$1",[f.reservation])),/cancelled|terminal/i);
  await assert.rejects(attempt(()=>db.query(`insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,status,
    reserved_weight_kg,reserved_length_m,reserved_pieces) values($1,$2,$3,$4,$5,'active',10,5,1)`,[id(320),f.company,f.order,f.profile,f.batch])),/cancelled order/i);
});

test("a cancelled order with ample untouched physical stock still rejects a brand-new active hold",async()=>{
  await observe(()=>db.exec(`insert into orders(id,company_id,customer_id,current_stage) values('${id(321)}','${f.company}','${id(10)}','cancelled');
    insert into profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status)
      values('${id(322)}','${f.company}','${f.profile}',100,50,10,'available');`));
  await assert.rejects(attempt(()=>db.query(`insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,status,
    reserved_weight_kg,reserved_length_m,reserved_pieces) values($1,$2,$3,$4,$5,'active',10,5,1)`,[id(323),f.company,id(321),f.profile,id(322)])),/cancelled order/i);
});

test("already released holds keep their original quantities and timestamps without another release",async()=>{
  await observe(()=>db.query("update profile_stock_reservations set status='released',released_at='2026-10-14T12:00:00Z' where id=$1",[f.reservation]));
  const before=await snapshot();await cancel();const after=await snapshot();
  assert.deepEqual(after.reservations,before.reservations);assert.deepEqual(after.batch,before.batch);
  assert.equal(after.audits.find(row=>row.action==="order_cancelled_hold_release").metadata_json.released_reservation_count,0);
});

test("cancellation releases every matching hold beyond the reader's ten-row page without touching another order",async()=>{
  await observe(()=>db.exec(`insert into profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status)
      values('${id(330)}','${f.company}','${f.profile}',601,300.5,601,'available');
    insert into profile_stock_reservations(company_id,order_id,profile_id,profile_stock_batch_id,status,reserved_weight_kg,reserved_length_m,reserved_pieces)
      select '${f.company}','${f.order}','${f.profile}','${id(330)}','active',1,.5,1 from generate_series(1,601);`));
  const before=(await observe(()=>db.query("select total_weight_kg,length_m,quantity_pieces,status from profile_stock_batches where id=$1",[id(330)]))).rows;
  await cancel();const after=await snapshot();
  assert.equal(after.reservations.filter(row=>row.order_id===f.order&&row.status==="cancelled").length,602);
  assert.equal(after.reservations.find(row=>row.id===f.otherReservation).status,"active");
  assert.equal(after.audits.find(row=>row.action==="order_cancelled_hold_release").metadata_json.released_weight_kg,621);
  assert.deepEqual((await observe(()=>db.query("select total_weight_kg,length_m,quantity_pieces,status from profile_stock_batches where id=$1",[id(330)]))).rows,before);
});

test("a 1501-entry posted history releases exactly its 499 kg remainder while preserving all physical units",async()=>{
  await observe(()=>db.exec(`insert into profile_stock_batches(id,company_id,profile_id,total_weight_kg,length_m,quantity_pieces,status)
      values('${id(340)}','${f.company}','${f.profile}',3000,1500,3000,'available');
    insert into profile_stock_reservations(id,company_id,order_id,profile_id,profile_stock_batch_id,status,reserved_weight_kg,reserved_length_m,reserved_pieces)
      values('${id(341)}','${f.company}','${f.order}','${f.profile}','${id(340)}','active',2000,1000,2000);
    insert into dispatches(id,company_id,order_id,delivery_status,total_weight_kg)
      select ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,'${f.company}','${f.order}','delivered',1 from generate_series(1,1501) n;
    insert into profile_stock_consumptions(company_id,reservation_id,order_id,profile_id,profile_stock_batch_id,dispatch_id,consumed_weight_kg,consumed_length_m,consumed_pieces)
      select '${f.company}','${id(341)}','${f.order}','${f.profile}','${id(340)}',('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,1,.5,1 from generate_series(1,1501) n;
    update profile_stock_batches set total_weight_kg=1499,length_m=749.5,quantity_pieces=1499 where id='${id(340)}';`));
  await cancel();const after=await snapshot();const entry=after.audits.find(row=>row.action==="order_cancelled_hold_release");
  assert.equal(entry.metadata_json.released_weight_kg,519);
  const quantities=(await observe(()=>db.query("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[id(340)]))).rows[0];
  assert.deepEqual(quantities,{total_weight_kg:"1499.000",length_m:"749.500",quantity_pieces:1499});
  assert.equal(after.consumption.length,1502);
});

test("cancellation checks active owner/admin authority even behind a privileged internal writer",async()=>{
  await observe(()=>db.exec(`create function public.fixture_cancel_order() returns void language sql security definer set search_path=public,private as
    $$update orders set current_stage='cancelled' where id='${f.order}'$$;
    revoke all on function public.fixture_cancel_order() from public,anon;grant execute on function public.fixture_cancel_order() to authenticated;`));
  for(const role of ["owner","admin","sales","sales_manager","factory_manager","inventory_manager","production_manager","production","dispatch","accounts","viewer","dealer_admin","dealer_staff",null]){
    await db.exec("savepoint cancellation_role;");
    try{
      await observe(()=>db.query("update app_users set role=$1 where id=$2",[role,f.actor]));const before=await snapshot();
      if(["owner","admin"].includes(role))await attempt(()=>db.query("select public.fixture_cancel_order()"));
      else{await assert.rejects(attempt(()=>db.query("select public.fixture_cancel_order()")),/Only active company owners and admins/);assert.deepEqual(await snapshot(),before);}
    }finally{await db.exec("rollback to savepoint cancellation_role;release savepoint cancellation_role;");}
  }
  for(const actor of [f.siblingActor,""]){
    await db.query("select set_config('test.actor',$1,true)",[actor]);
    await assert.rejects(attempt(()=>db.query("select public.fixture_cancel_order()")),/Only active company owners and admins/);
  }
  await db.query("select set_config('test.actor',$1,true)",[f.actor]);
  await observe(()=>db.query("update app_users set is_active=false where id=$1",[f.actor]));
  await assert.rejects(attempt(()=>db.query("select public.fixture_cancel_order()")),/Only active company owners and admins/);
});

test("reinstalling extracted objects is harmless and catalog preflight verifies both guarded attachments and private ACLs",async()=>{
  const before=await snapshot();await observe(()=>installOrderCancellationStockObjects(db));assert.deepEqual(await snapshot(),before);
  const source=readFileSync(new URL("../sql/audit-deployment-preflight.sql",import.meta.url),"utf8");
  const query=source.slice(source.indexOf("-- Order cancellation guards"),source.indexOf("-- Direct order request"));
  const result=await observe(()=>db.query(query));assert.equal(result.rows.length,2);
  for(const row of result.rows){assert.equal(row.attached,true);assert.equal(row.enabled,true);assert.equal(row.security_definer,true);
    assert.equal(row.authenticated_execute,false);assert.equal(row.anonymous_execute,false);}
  await assert.rejects(attempt(()=>db.query("select public.credit_dealer_stock_on_order_cancel()")),/permission denied/);
  await assert.rejects(attempt(()=>db.query("select private.guard_cancelled_order_reservations()")),/permission denied/);
});

test("the historical review is read-only, flags legacy active holds and credits, and leaves new cancellations clear",async()=>{
  const query=readFileSync(new URL("../sql/audit-order-cancellation-stock.sql",import.meta.url),"utf8");
  const legacy=await createOrderCancellationStockFixture({candidate:false});
  try{
    await legacy.exec(`set test.actor='${f.actor}';set role authenticated;update orders set current_stage='cancelled' where id='${f.order}';reset role;begin read only;`);
    const before=(await legacy.query("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[f.batch])).rows;
    const result=await legacy.query(query);
    assert.deepEqual(result.rows.map(row=>row.finding).sort(),["cancelled_order_active_hold","credited_dealer_fulfillment_receipt_review"]);
    assert.deepEqual((await legacy.query("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[f.batch])).rows,before);
    await legacy.exec("rollback;");
  }finally{await legacy.close();}
  await cancel();assert.deepEqual((await observe(()=>db.query(query))).rows,[]);
});

test("an exact posted dispatch retry remains harmless after actual order cancellation releases its hold",async()=>{
  await observe(()=>db.exec(sqlDefinition("20261015000000_reservation_release_replay_integrity.sql","private.consume_dispatch_reservations")));
  await observe(()=>db.query(`insert into packing_list_items(company_id,dispatch_id,reservation_id,profile_stock_batch_id,profile_id,source_kind,
    source_line_id,source_record_id,net_weight_kg,net_length_m,number_of_pieces) values($1,$2,$3,$4,$5,'reservation',$3,$6,10,5,1)`,[f.company,f.dispatch,f.reservation,f.batch,f.profile,f.order]));
  await cancel();const before=await snapshot();
  await observe(()=>db.query("select private.consume_dispatch_reservations($1)",[f.dispatch]));
  await observe(()=>db.query("select private.consume_dispatch_reservations($1)",[f.dispatch]));assert.deepEqual(await snapshot(),before);
});

test("a reported reservation lock conflict returns a retry and rolls back the cancellation",async()=>{
  await observe(()=>db.exec(`create function public.fixture_busy_reservation() returns trigger language plpgsql as $$begin
    raise exception 'synthetic lock conflict' using errcode='55P03';end;$$;
    create trigger fixture_busy_reservation before update on profile_stock_reservations for each row execute function public.fixture_busy_reservation();`));
  const before=await snapshot();await assert.rejects(cancel(),/being changed.*retry cancellation/);assert.deepEqual(await snapshot(),before);
});
