import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfigurationReleaseFixture} from '../scripts/lib/configuration-release-fixture.mjs';
import {cid} from '../scripts/lib/commercial-upgrade-fixture.mjs';
import {configurationReleaseResultSchema} from '../lib/workflow/configuration-release.ts';
let f;
test.before(async()=>{f=await createConfigurationReleaseFixture();});
test.after(async()=>f?.close());
test.beforeEach(async()=>{await f.db.exec('begin');await f.actor();await f.createProject();await f.addSavedOutputs();});
test.afterEach(async()=>{await f.db.exec('rollback');});
async function attempt(fn){await f.db.exec('savepoint configuration_attempt');try{const r=await fn();await f.db.exec('release savepoint configuration_attempt');return r;}catch(e){await f.db.exec('rollback to savepoint configuration_attempt; release savepoint configuration_attempt');throw e;}}
const state=()=>f.release('release.load',{configuration_id:f.fixtureIds.project});
const approve=s=>f.release('release.approve',{snapshot_id:s.saved.id,output_fingerprint:s.saved.output_fingerprint,request_id:cid(6150),note:'Independent review of exact cut, glass, BOM and cost outputs'});

test('100: exact saved outputs require an independent approval and preserve immutable snapshots',async()=>{
  const s=await f.saveReadySnapshot();
  assert.equal(configurationReleaseResultSchema.parse(await state()).status,'pending_approval');
  await assert.rejects(attempt(()=>approve(s)),/cannot approve their own/);
  await assert.rejects(attempt(()=>f.db.query('select private.assert_configuration_output_release($1,$2)',[f.fixtureIds.project,f.ids.company])),/separate owner or admin/);
  await f.actor(f.ids.admin);await approve(s);assert.equal((await approve(s)).idempotent_replay,true);
  assert.equal(configurationReleaseResultSchema.parse(await state()).status,'approved');
  assert.equal((await f.db.query('select private.assert_configuration_output_release($1,$2) id',[f.fixtureIds.project,f.ids.company])).rows[0].id,s.saved.id);
  await assert.rejects(attempt(()=>f.db.query("update configuration_output_snapshots set readiness='blocked' where id=$1",[s.saved.id])),/immutable/);
});

test('100: rule, input and saved-output edits each invalidate a reviewed release without changing its captured evidence',async()=>{
  for(const mutate of [
    ()=>f.db.query('update system_configurations set width_mm=1100 where id=$1',[f.fixtureIds.project]),
    ()=>f.db.query('update system_templates set formula_version=formula_version+1 where id=$1',[f.fixtureIds.template]),
    ()=>f.db.query('update system_profile_cuts set total_weight_kg=total_weight_kg+1 where configuration_id=$1',[f.fixtureIds.project])
  ]){
    await f.db.exec('savepoint source_edit');
    const s=await f.saveReadySnapshot();await f.actor(f.ids.admin);await approve(s);await mutate();
    assert.equal(configurationReleaseResultSchema.parse(await state()).status,'stale');
    await assert.rejects(attempt(()=>f.db.query('select private.assert_configuration_output_release($1,$2)',[f.fixtureIds.project,f.ids.company])),/changed after review/);
    assert.equal((await f.db.query('select output_fingerprint from configuration_output_snapshots where id=$1',[s.saved.id])).rows[0].output_fingerprint,s.saved.output_fingerprint);
    await f.db.exec('rollback to savepoint source_edit; release savepoint source_edit');await f.actor();
  }
});

test('100: missing rules, stale source revisions, forged outputs, cross-company and direct client writes are refused',async()=>{
  const source=await f.capture();
  await f.db.query("update system_templates set formula_json='{}' where id=$1",[f.fixtureIds.template]);
  await assert.rejects(attempt(()=>f.saveReadySnapshot()),/rules.*incomplete/);
  await f.db.query('update system_templates set formula_json=$1 where id=$2',[f.formula,f.fixtureIds.template]);
  const s=await f.saveReadySnapshot();
  const p={configuration_id:f.fixtureIds.project,request_id:cid(6155),expected_input_fingerprint:source.input_fingerprint,expected_rules_fingerprint:source.rules_fingerprint,
    expected_rules_revision:source.rules_revision,expected_output_revision:source.output_revision,readiness:'ready',unresolved_reasons:[],estimated_fields:[],output_snapshot:s.outputSnapshot};
  await assert.rejects(attempt(()=>f.release('snapshot.create',p)),/changed during calculation/);
  const fresh=await f.capture();p.expected_rules_fingerprint=fresh.rules_fingerprint;p.expected_rules_revision=fresh.rules_revision;
  p.output_snapshot=structuredClone(s.outputSnapshot);p.output_snapshot.persisted_rows.system_profile_cuts[0].total_weight_kg=100;
  await assert.rejects(attempt(()=>f.release('snapshot.create',p)),/does not match/);
  await f.db.exec('set role authenticated');
  await assert.rejects(attempt(()=>f.db.query('select * from configuration_output_snapshots')),/permission denied/);
  await assert.rejects(attempt(()=>f.db.query('select private.assert_configuration_output_release($1,$2)',[f.fixtureIds.project,f.ids.company])),/permission denied/);
  await f.actor(f.ids.sales);await assert.rejects(attempt(()=>f.capture()),/not permitted/);
  await f.db.exec('reset role');
  assert.equal((await f.db.query("select has_function_privilege('anon','configuration_release_command(text,jsonb)','execute') ok")).rows[0].ok,false);
});

test('100: canonical handoff into an existing eligible order rolls back without approval and records its approved snapshot',async()=>{
  await f.db.query("insert into dies(id,company_id,profile_id,die_number,die_status,created_by) values($1,$2,$3,'B6-RELEASE-DIE','active',$4)",[cid(6160),f.ids.company,f.ids.profile,f.ids.owner]);
  const jobs=[{profile_id:f.ids.profile,die_id:cid(6160),planned_quantity_kg:3.808,planned_meters:4.76,finishing_type:'mill_finish',remarks:'Release project fabrication'}];
  const before=(await f.db.query('select count(*)::int n from orders where company_id=$1',[f.ids.company])).rows[0].n;
  const s=await f.saveReadySnapshot();
  const eligibleOrder=(await f.db.query('select create_direct_order_atomic($1,$2,$3) id',[
    {customer_id:f.ids.customer,order_date:'2026-10-29',priority:'normal'},
    [{profile_id:f.ids.profile,quantity_pieces:200,length_per_piece_m:6,expected_section_weight_kg_per_m:0.8,net_rate:250,gst_percent:18,hsn_code:'760421',finishing_type:'mill_finish'}],cid(6161)])).rows[0].id;
  await f.db.query('update system_configurations set order_id=$1 where id=$2',[eligibleOrder,f.fixtureIds.project]);
  await assert.rejects(attempt(()=>f.db.query('select handoff_system_configuration_to_production_atomic($1,$2,$3)',[f.fixtureIds.project,jobs,'Approved release fixture'])),/separate owner or admin/);
  assert.equal((await f.db.query('select count(*)::int n from orders where company_id=$1',[f.ids.company])).rows[0].n,before+1);
  await f.actor(f.ids.admin);await approve(s);
  const order=(await f.db.query('select handoff_system_configuration_to_production_atomic($1,$2,$3) id',[f.fixtureIds.project,jobs,'Approved release fixture'])).rows[0].id;
  assert.ok(order);assert.equal((await state()).status,'handed_off');
  assert.equal((await f.db.query('select snapshot_id from configuration_output_handoffs where configuration_id=$1',[f.fixtureIds.project])).rows[0].snapshot_id,s.saved.id);
  assert.equal((await f.db.query('select count(*)::int n from production_jobs where order_id=$1',[order])).rows[0].n,1);
});

test('100: an unrelated profile addition does not invalidate a quoted project or force a new commercial revision',async()=>{
  const s=await f.saveReadySnapshot();await f.actor(f.ids.admin);await approve(s);
  const quote=(await f.db.query('select generate_system_quote_atomic($1) id',[f.fixtureIds.project])).rows[0].id;
  assert.ok(quote);
  await f.db.query("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m) values($1,$2,'UNRELATED-PROFILE','Unrelated catalogue maintenance',1.2)",[cid(6170),f.ids.company]);
  const current=configurationReleaseResultSchema.parse(await state());assert.equal(current.status,'approved');
  assert.ok(current.current_rules_revision>s.source.rules_revision);
  assert.equal((await f.db.query('select private.assert_configuration_output_release($1,$2) id',[f.fixtureIds.project,f.ids.company])).rows[0].id,s.saved.id);
});
