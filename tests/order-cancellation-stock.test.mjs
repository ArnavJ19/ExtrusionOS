import assert from "node:assert/strict";
import test from "node:test";
import {createOrderCancellationStockFixture,cancellationIds as f} from "../scripts/lib/order-cancellation-stock-fixture.mjs";
import {fixtureId as id} from "../scripts/lib/direct-order-fixture.mjs";
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
