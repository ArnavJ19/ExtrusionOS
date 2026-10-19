import assert from "node:assert/strict";
import test from "node:test";
import {createRetainedInvoiceFixture,invoiceFixtureIds as f} from "../scripts/lib/retained-invoice-fixture.mjs";
import {createInvoiceActionFixture} from "../scripts/lib/retained-invoice-actions-fixture.mjs";
import {fixtureId as id} from "../scripts/lib/direct-order-fixture.mjs";

let db,fixture;
test.before(async()=>{db=await createRetainedInvoiceFixture();});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{
  await db.exec(`reset role;begin;set test.actor='${f.actor}';set role authenticated;`);
  fixture=createInvoiceActionFixture(db);
  // The fixture RPC transaction is a savepoint while the test owns the outer transaction.
  fixture.state.useSavepoint=true;
});
test.afterEach(async()=>{await db.exec("rollback;reset role;");});
const input={order_id:f.order,dispatch_id:f.dispatch,invoice_date:"2026-10-19",place_of_supply_state_code:"24",status:"draft"};
async function observe(callback){await db.exec("reset role;");try{return await callback();}finally{await db.exec("set role authenticated;");}}
const cancel=()=>db.query("update orders set current_stage='cancelled' where id=$1",[f.order]);

test("actual invoice action reaches the retained-shipment SQL writer, preserves stock and derives exact GST totals",async()=>{
  await cancel();const result=await fixture.invoke("saveInvoiceAction",input);
  assert.equal(result.success,true,JSON.stringify(result));
  assert.equal((await db.query("select grand_total from invoices where id=$1",[result.invoiceId])).rows[0].grand_total,"1180.00");
  const physical=await observe(()=>db.query("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[f.batch]));
  assert.deepEqual(physical.rows[0],{total_weight_kg:"40.000",length_m:"20.000",quantity_pieces:4});
  assert.equal(fixture.state.calls.filter(call=>call.rpc==="save_invoice_atomic").length,1);
  assert.ok(fixture.state.paths.includes(`/invoices/${result.invoiceId}`));
});

test("invoice action reads the entire manifest beyond the API cap in stable, company-scoped pages",async()=>{
  await observe(()=>db.exec(`insert into packing_list_items select (jsonb_populate_record(null::packing_list_items,to_jsonb(item)||jsonb_build_object('id',gen_random_uuid(),'bundle_number','MULTI-'||n))).*
    from packing_list_items item cross join generate_series(1,1200) n where item.id='${f.packing}';`));
  const result=await fixture.invoke("saveInvoiceAction",input);
  assert.equal(result.success,true,JSON.stringify(result));
  assert.equal((await db.query("select count(*) n,sum(quantity) quantity from invoice_items where invoice_id=$1",[result.invoiceId])).rows[0].n,1201);
  assert.deepEqual(fixture.state.calls.filter(call=>call.table==="packing_list_items_authorized").map(call=>call.range),
    [[0,199],[200,399],[400,599],[600,799],[800,999],[1000,1199],[1200,1399]]);
  assert.equal((await db.query("select grand_total from invoices where id=$1",[result.invoiceId])).rows[0].grand_total,"1417180.00");
});

for(const defect of ["missing-count","truncated","changing-count","duplicate-id","invalid-id","query-error","excessive-count"]){
  test(`incomplete manifest ${defect} fails before financial writes`,async()=>{
    fixture.state.readOverride=(call,result)=>{
      if(call.table!=="packing_list_items_authorized")return result;
      if(defect==="missing-count")result.count=null;
      if(defect==="truncated")result.count=2;
      if(defect==="excessive-count")result.count=100001;
      if(defect==="query-error")result.error=new Error("Synthetic manifest outage");
      if(defect==="invalid-id")result.data[0].id="broken";
      if(defect==="changing-count"||defect==="duplicate-id"){
        result.count=call.range[0]===0?201:(defect==="changing-count"?202:201);
        result.data=call.range[0]===0?Array.from({length:200},(_,n)=>({...result.data[0],id:id(1000+n)})):[{...result.data[0],id:id(1000)}];
      }
      return result;
    };
    const result=await fixture.invoke("saveInvoiceAction",input);assert.equal(result.success,false);
    assert.equal(fixture.state.calls.filter(call=>call.rpc).length,0);
    assert.equal((await db.query("select count(*) n from invoices")).rows[0].n,0);
  });
}

test("source search uses the real authorized SQL projection and exact selected identifiers",async()=>{
  await cancel();const orders=await fixture.invoke("searchInvoiceSourcesAction",{kind:"order",search:"cancel-001"});
  assert.equal(orders.success,true,JSON.stringify(orders));assert.equal(orders.options.rows[0].id,f.order);
  const dispatch=await fixture.invoke("searchInvoiceSourcesAction",{kind:"dispatch",orderId:f.order,selectedId:f.dispatch});
  assert.equal(dispatch.success,true);assert.equal(dispatch.options.rows[0].id,f.dispatch);
  assert.equal(fixture.state.calls.filter(call=>call.table).length,0);
});

for(const defect of ["wrong-kind","foreign-order","wrong-selected-id","duplicate-source","missing-has-more","truncated-page","too-many-rows"]){
  test(`malformed source projection ${defect} stays unavailable`,async()=>{
    fixture.state.rpcOverride=async()=>{
      const row={id:f.dispatch,order_id:f.order,dispatch_number:"SYNTHETIC",dispatch_date:"2026-10-19",delivery_status:"delivered",total_weight_kg:10};
      let data={kind:"dispatch",has_more:false,rows:[row]};
      if(defect==="wrong-kind")data={kind:"order",rows:[],has_more:false};
      if(defect==="foreign-order")row.order_id=f.otherOrder;
      if(defect==="wrong-selected-id")row.id=id(999);
      if(defect==="duplicate-source")data.rows=[row,row];
      if(defect==="missing-has-more")delete data.has_more;
      if(defect==="truncated-page")data.has_more=true;
      if(defect==="too-many-rows")data.rows=Array.from({length:26},(_,n)=>({...row,id:id(800+n)}));
      return {data,error:null};
    };
    const result=await fixture.invoke("searchInvoiceSourcesAction",{kind:"dispatch",orderId:f.order,selectedId:f.dispatch});
    assert.equal(result.success,false);assert.match(result.error,/unavailable/);assert.deepEqual(fixture.state.paths,[]);
  });
}

test("invalid requests and non-financial roles cannot reach source lookup or invoice writing",async()=>{
  for(const value of [{kind:"dispatch"},{kind:"order",search:"x".repeat(101)},{kind:"order",selectedId:"bad"}]){
    assert.equal((await fixture.invoke("searchInvoiceSourcesAction",value)).success,false);
  }
  fixture.state.context.role="sales";
  assert.equal((await fixture.invoke("searchInvoiceSourcesAction",{kind:"order"})).success,false);
  assert.equal((await fixture.invoke("saveInvoiceAction",input)).success,false);
  assert.equal(fixture.state.calls.length,0);
});

test("regeneration uses all exact source lines and the same retained-shipment eligibility",async()=>{
  await cancel();const saved=await fixture.invoke("saveInvoiceAction",input);assert.equal(saved.success,true);
  const regenerated=await fixture.invoke("regenerateInvoiceItemsAction",saved.invoiceId);assert.equal(regenerated.success,true,JSON.stringify(regenerated));
  assert.equal((await db.query("select grand_total from invoices where id=$1",[saved.invoiceId])).rows[0].grand_total,"1180.00");
});
