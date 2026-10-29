import test from 'node:test';import assert from 'node:assert/strict';
import {createCommercialFixture,cid} from '../scripts/lib/commercial-upgrade-fixture.mjs';
import {downstreamContextSchema} from '../lib/workflow/downstream-context.ts';
let f,order;test.before(async()=>{f=await createCommercialFixture();order=cid(701);
  await f.db.query("insert into orders(id,company_id,customer_id,order_number,order_date,order_value) values($1,$2,$3,'DOWNSTREAM-1','2026-10-29',1000)",[order,f.ids.company,f.ids.customer]);
});test.after(async()=>f?.close());
const load=async(dispatch=null)=>downstreamContextSchema.parse((await f.db.query('select downstream_dispatch_context($1,$2) data',[order,dispatch])).rows[0].data);
test('7: a new downstream draft reads current master details with explicit provenance',async()=>{
  await f.actor();const first=await load();assert.equal(first.party.delivery_address,'Factory gate');assert.equal(first.immutable,false);
  await f.db.query("update customers set shipping_address='Changed gate' where id=$1",[f.ids.customer]);assert.equal((await load()).party.delivery_address,'Changed gate');
});
test('7: dispatch captures history which cannot drift with later master changes',async()=>{
  await f.actor();const dispatch=cid(702);await f.db.query("insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,number_of_bundles,total_weight_kg) values($1,$2,$3,'DOWNSTREAM-D1','2026-10-29',1,1)",[dispatch,f.ids.company,order]);
  await f.db.query("update customers set shipping_address='Newest gate' where id=$1",[f.ids.customer]);
  const snapshot=await load(dispatch);assert.equal(snapshot.party.delivery_address,'Changed gate');assert.equal(snapshot.immutable,true);
  await assert.rejects(f.db.query("update dispatch_party_snapshots set basis='forged' where dispatch_id=$1",[dispatch]),/history/);
});
test('7: database rejects foreign order, dealer, inactive actor and missing historical snapshot',async()=>{
  await f.actor();await assert.rejects(f.db.query('select downstream_dispatch_context($1,null)',[cid(999)]),/unavailable/);
  await assert.rejects(load(cid(999)),/unavailable/);
  for(const key of ['dealer','production']){await f.actor(f.ids[key]);await assert.rejects(load(),/not permitted/);}
  await f.actor();assert.equal((await f.db.query("select has_table_privilege('authenticated','dispatch_party_snapshots','SELECT') ok")).rows[0].ok,false);
  assert.equal((await f.db.query("select has_function_privilege('anon','downstream_dispatch_context(uuid,uuid)','EXECUTE') ok")).rows[0].ok,false);
});
test('7: accepted party wins over later master edits through the real quote conversion',async()=>{
  await f.actor();const quote=await f.newQuote();
  for(const status of ['internal_review','approved_for_sending','sent','customer_approved'])await f.db.query("update quotes set status=$2,approved_by=$3,approved_at=now() where id=$1",[quote,status,f.ids.owner]);
  const review=await f.command('commercial_review_command','quote.review',{quote_id:quote});
  const conversion=await f.command('commercial_review_command','quote.convert',{quote_id:quote,fingerprint:review.fingerprint,request_id:cid(703)});
  const before=(await f.db.query('select downstream_dispatch_context($1,null) data',[conversion.order_id])).rows[0].data;
  await f.db.query("update customers set shipping_address='Master changed after acceptance' where id=$1",[f.ids.customer]);
  const after=(await f.db.query('select downstream_dispatch_context($1,null) data',[conversion.order_id])).rows[0].data;
  assert.deepEqual(after.party,before.party);assert.equal(after.basis,'Accepted order party snapshot');
  assert.equal('payment_terms' in after.party,false);
});
