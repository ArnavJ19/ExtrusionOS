import test from 'node:test';import assert from 'node:assert/strict';
import {createFactoryUpgradeFixture,cid} from '../scripts/lib/factory-upgrade-fixture.mjs';
import {physicalBundleListSchema} from '../lib/workflow/physical-bundles.ts';
let f;test.before(async()=>{f=await createFactoryUpgradeFixture();});test.after(async()=>f?.close());
test('94: immutable measured observations replay exactly and do not consume stock',async()=>{
  const first=await f.recordBundle(810),second=await f.recordBundle(810);assert.equal(first.id,second.id);assert.equal(second.replayed,true);
  await assert.rejects(f.recordBundle(810,{gross_weight_kg:11}),/different observations/);
  const balance=(await f.db.query('select total_weight_kg from profile_stock_batches where id=$1',[f.ids.batch])).rows[0];assert.equal(Number(balance.total_weight_kg),960);
  const list=physicalBundleListSchema.parse(await f.command('physical_bundle_command','bundles.list',{order_id:f.ids.order,page:1,search:'MEASURED-810'}));assert.equal(list.items.length,1);assert.equal(list.items[0].net_weight_kg,9.6);
});
test('94: tenant, role, source and observation validation also applies directly at the RPC',async()=>{
  for(const patch of [{company_id:f.ids.foreign},{source_line_id:cid(999)},{tare_weight_kg:20},{number_of_pieces:1.5},{net_length_m:'NaN'},{gross_weight_kg:1.0001}])await assert.rejects(f.recordBundle(811,patch));
  await f.actor(f.ids.dealer);await assert.rejects(f.recordBundle(811),/not permitted/);await f.actor();
  assert.equal((await f.db.query("select has_table_privilege('authenticated','prepared_physical_bundles','UPDATE') ok")).rows[0].ok,false);
});
test('94: bundle tags are unique per company and server lists remain ten-row paginated',async()=>{
  await assert.rejects(f.recordBundle(812,{bundle_number:'measured-810'}),/unique|duplicate/);
  for(let n=820;n<831;n++)await f.recordBundle(n);
  const first=await f.command('physical_bundle_command','bundles.list',{order_id:f.ids.order,page:1}),second=await f.command('physical_bundle_command','bundles.list',{order_id:f.ids.order,page:2});
  assert.equal(first.items.length,10);assert.equal(second.items.length,2);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,12);
});
test('94: real atomic dispatch rejects changed observations and consumes a prepared tag exactly once',async()=>{
  const post=async(patch={})=>(await f.db.query('select save_ready_dispatch_atomic(null,$1,$2) id',[
    {order_id:f.ids.order,dispatch_date:'2026-10-29',total_weight_kg:9.6,total_tare_weight_kg:1},
    [{source_kind:'reservation',source_line_id:f.ids.reservation,reservation_id:f.ids.reservation,source_record_id:f.ids.order,profile_id:f.ids.profile,profile_stock_batch_id:f.ids.batch,bundle_number:'MEASURED-810',number_of_pieces:2,net_length_m:12,gross_weight_kg:10.6,tare_weight_kg:1,...patch}]
  ])).rows[0].id;
  await assert.rejects(post({gross_weight_kg:11}),/observations changed|exact whole-piece source ratio/);
  assert.equal((await f.db.query('select dispatch_id from prepared_physical_bundles where id=$1',[cid(810)])).rows[0].dispatch_id,null);
  const dispatch=await post();assert.equal((await f.db.query('select dispatch_id from prepared_physical_bundles where id=$1',[cid(810)])).rows[0].dispatch_id,dispatch);
  await assert.rejects(post(),/already dispatched|duplicate|unique/);
  assert.equal(Number((await f.db.query('select total_weight_kg from profile_stock_batches where id=$1',[f.ids.batch])).rows[0].total_weight_kg),950.4);
});
