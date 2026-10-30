import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommercialFixture,cid } from '../scripts/lib/commercial-upgrade-fixture.mjs';
let f;const source=cid(4000),target=cid(4001),proposal=cid(4002);
test.before(async()=>{
  f=await createCommercialFixture();
  for(const [id,name,company] of [[source,'Window customer duplicate',f.ids.company],[target,'Window customer canonical',f.ids.company],[cid(4003),'Foreign customer',f.ids.foreign]])await f.db.query("insert into customers(id,company_id,customer_name,customer_type,gst_number) values($1,$2,$3,'fabricator','07AAACX1234A1Z1')",[id,company,name]);
});
test.after(async()=>f?.close());
const call=(command,payload)=>f.command('master_cleanup_command',command,payload);
test('59: reviewed consolidation requires compatible identity, another administrator and an unchanged comparison',async()=>{
  const candidates=await call('duplicates.list',{entity_type:'customers',page:1,search:'Window'});assert.ok(candidates.items.some(r=>r.source_id===source&&r.target_id===target));assert.ok(candidates.items.length<=10);
  const preview=await call('review.preview',{entity_type:'customers',source_id:source,target_id:target});
  assert.match(preview.fingerprint,/^[a-f0-9]{32}$/);
  await assert.rejects(call('review.propose',{id:proposal,entity_type:'customers',source_id:source,target_id:target,reason:'Duplicate supplier identity',fingerprint:'0'.repeat(32)}),/current comparison/);
  await call('review.propose',{id:proposal,entity_type:'customers',source_id:source,target_id:target,reason:'Duplicate customer identity verified',fingerprint:preview.fingerprint});
  await assert.rejects(call('review.approve',{id:proposal,entity_type:'customers'}),/Another administrator/);
  await f.db.query("update customers set phone='1234567890' where id=$1",[target]);
  await f.actor(f.ids.admin);
  await assert.rejects(call('review.approve',{id:proposal,entity_type:'customers'}),/changed after proposal/);
  await f.actor();
});
test('59: consolidation retires a duplicate without rewriting its historical order reference and rejects reactivation/cycles',async()=>{
  const order=(await f.db.query('select create_direct_order_atomic($1,$2,$3) id',[{customer_id:source,order_date:'2026-10-29',priority:'normal'},[{profile_id:f.ids.profile,quantity_pieces:2,length_per_piece_m:6,expected_section_weight_kg_per_m:0.8,net_rate:250,gst_percent:18,hsn_code:'760421',finishing_type:'mill_finish'}],cid(4006)])).rows[0].id;
  const preview=await call('review.preview',{entity_type:'customers',source_id:source,target_id:target});
  await call('review.propose',{id:cid(4005),entity_type:'customers',source_id:source,target_id:target,reason:'The same GST registration was verified',fingerprint:preview.fingerprint});
  await f.actor(f.ids.admin);await call('review.approve',{id:cid(4005),entity_type:'customers'});
  assert.equal((await f.db.query('select customer_id from orders where id=$1',[order])).rows[0].customer_id,source);
  assert.equal((await f.db.query('select is_active from customers where id=$1',[source])).rows[0].is_active,false);
  await assert.rejects(f.db.query('update customers set is_active=true where id=$1',[source]),/canonical master/);
  await assert.rejects(f.db.query('delete from customers where id=$1',[target]),/Reviewed master identities/);
  assert.equal((await call('reviews.list',{})).items.filter(r=>r.status==='consolidated').length,1);
  await f.actor();
});
test('59: foreign masters, incompatible specifications and direct client table access are refused',async()=>{
  await assert.rejects(call('review.preview',{entity_type:'customers',source_id:target,target_id:cid(4003)}),/incompatible/);
  await assert.rejects(call('review.preview',{entity_type:'customers',source_id:target,target_id:f.ids.customer}),/incompatible/);
  await f.actor(f.ids.sales);await assert.rejects(call('reviews.list',{}),/not permitted/);await f.actor();
  const acl=(await f.db.query("select relrowsecurity rls,has_table_privilege('authenticated','master_consolidation_reviews','SELECT') reads,has_table_privilege('authenticated','master_consolidation_reviews','UPDATE') writes from pg_class where oid='master_consolidation_reviews'::regclass")).rows[0];assert.equal(acl.rls,true);assert.equal(acl.reads,false);assert.equal(acl.writes,false);
});

test('59: retiring a profile with unfinished source work is refused without deactivating it or changing the proposal',async()=>{
  await f.db.query("insert into aluminium_profiles select (jsonb_populate_record(null::aluminium_profiles,to_jsonb(p)||jsonb_build_object('id',$1::uuid,'profile_code','AL-CANONICAL','profile_name','Canonical section'))).* from aluminium_profiles p where p.id=$2",[cid(4010),f.ids.profile]);
  const preview=await call('review.preview',{entity_type:'aluminium_profiles',source_id:f.ids.profile,target_id:cid(4010)});
  assert.ok(preview.dependencies.unfinished_orders>0);
  await call('review.propose',{id:cid(4011),entity_type:'aluminium_profiles',source_id:f.ids.profile,target_id:cid(4010),reason:'Equivalent section with preserved source history',fingerprint:preview.fingerprint});
  await f.actor(f.ids.admin);await assert.rejects(call('review.approve',{id:cid(4011),entity_type:'aluminium_profiles'}),/unfinished orders/);
  assert.equal((await f.db.query('select is_active from aluminium_profiles where id=$1',[f.ids.profile])).rows[0].is_active,true);
  assert.equal((await f.db.query('select status from master_consolidation_reviews where id=$1',[cid(4011)])).rows[0].status,'proposed');await f.actor();
});
