import test from 'node:test';import assert from 'node:assert/strict';import {createFactoryUpgradeFixture,cid} from '../scripts/lib/factory-upgrade-fixture.mjs';
let f;test.before(async()=>{f=await createFactoryUpgradeFixture();});test.after(async()=>f?.close());
const tables=['dispatch_party_snapshots','prepared_physical_bundles','workstation_sessions','order_stock_allocations','cutting_rule_versions','cutting_actual_runs','machine_usage_meters','machine_usage_tariffs','machine_usage_runs','machine_usage_events'];
test('batch 5: every new business table has RLS, company identity/index and no direct client grants',async()=>{
  for(const table of tables){
    const row=(await f.db.query(`select c.relrowsecurity rls,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') client,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anonymous from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1`,[table])).rows[0];
    assert.equal(row.rls,true,table);assert.equal(row.client,false,table);assert.equal(row.anonymous,false,table);
    assert.equal((await f.db.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='company_id' and is_nullable='NO') ok",[table])).rows[0].ok,true,table);
    assert.equal((await f.db.query("select exists(select 1 from pg_indexes where schemaname='public' and tablename=$1 and indexdef like '%(company_id,%') ok",[table])).rows[0].ok,true,table);
  }
});
test('batch 5: new RPCs pin search paths, private helpers remain inaccessible, and anonymous execution is refused',async()=>{
  for(const signature of ['downstream_dispatch_context(uuid,uuid)','physical_bundle_command(text,jsonb)','invoice_communication_preview(uuid)','workstation_command(text,jsonb)','stock_production_command(text,jsonb)','order_stock_coverage(uuid)','cutting_workspace_command(text,jsonb)','machine_usage_command(text,jsonb)']){
    const row=(await f.db.query("select p.prosecdef definer,p.proconfig config,has_function_privilege('authenticated',p.oid,'EXECUTE') client,has_function_privilege('anon',p.oid,'EXECUTE') anonymous from pg_proc p where p.oid=('public.'||$1)::regprocedure",[signature])).rows[0];
    assert.equal(row.definer,true,signature);assert.ok(row.config.some(value=>value.startsWith('search_path=')),signature);assert.equal(row.client,true,signature);assert.equal(row.anonymous,false,signature);
  }
  for(const signature of ['downstream_order_party(uuid,uuid)','stock_line_quantities(uuid,uuid)','machine_usage_view(uuid,uuid,boolean)','profile_stock_balance(uuid,uuid)','profile_stock_balance_before_cutting(uuid,uuid)'])assert.equal((await f.db.query("select has_function_privilege('authenticated',('private.'||$1)::regprocedure,'EXECUTE') ok",[signature])).rows[0].ok,false,signature);
});
test('batch 5: SQL NULL commands cannot fall through into a mutation branch',async()=>{
  for(const rpc of ['physical_bundle_command','workstation_command','stock_production_command','cutting_workspace_command','machine_usage_command'])await assert.rejects(f.command(rpc,null,{order_id:f.ids.order}),/Invalid/,rpc);
});
test('batch 5: actual authenticated SQL role cannot read or mutate the protected tables',async()=>{
  await f.db.exec('set role authenticated');
  try{for(const table of tables)await assert.rejects(f.db.query(`select * from public.${table} limit 1`),/permission denied/,table);
    const result=await f.command('physical_bundle_command','bundles.list',{order_id:f.ids.order,page:1});assert.deepEqual(result.items,[]);
  }finally{await f.db.exec('reset role');}
});
test('batch 5: active owner from another company cannot resolve scoped records through any new RPC',async()=>{
  await f.db.query("insert into machines(id,company_id,machine_name,machine_type,is_active,status) values($1,$2,'Scoped machine','extrusion_press',true,'active')",[cid(1201),f.ids.company]);
  await f.command('machine_usage_command','meter.create',{id:cid(1202),machine_id:cid(1201),name:'Scoped meter',counter_modulus:null});
  await f.db.query("insert into auth.users(id,email) values($1,'foreign@factory.invalid')",[cid(1200)]);
  await f.db.query("insert into app_users(id,company_id,full_name,email,role,is_active) values($1,$2,'Foreign owner','foreign@factory.invalid','owner',true)",[cid(1200),f.ids.foreign]);
  const line=(await f.db.query('select id from order_items where order_id=$1',[f.ids.order])).rows[0].id;
  await f.actor(cid(1200));
  await assert.rejects(f.db.query('select downstream_dispatch_context($1,null)',[f.ids.order]),/unavailable/);
  await assert.rejects(f.command('physical_bundle_command','bundles.list',{order_id:f.ids.order}),/unavailable/);
  await assert.rejects(f.db.query('select invoice_communication_preview($1)',[cid(999)]),/unavailable/);
  await assert.rejects(f.command('workstation_command','station.open',{id:cid(1203),machine_id:cid(1201)}),/active company press/);
  await assert.rejects(f.command('stock_production_command','line.plan',{order_item_id:line}),/unavailable/);
  await assert.rejects(f.db.query('select order_stock_coverage($1)',[f.ids.order]),/unavailable/);
  await assert.rejects(f.command('cutting_workspace_command','inputs.load',{order_item_id:line,rule_id:cid(999)}),/unavailable/);
  await assert.rejects(f.command('machine_usage_command','usage.load',{meter_id:cid(1202)}),/unavailable/);
  await f.actor();
});
