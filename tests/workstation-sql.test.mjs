import test from 'node:test';import assert from 'node:assert/strict';import {createFactoryUpgradeFixture,cid} from '../scripts/lib/factory-upgrade-fixture.mjs';
import {workstationResultSchema} from '../lib/workflow/workstation.ts';let f;test.before(async()=>{f=await createFactoryUpgradeFixture();
  await f.db.query("insert into machines(id,company_id,machine_name,machine_type,is_active,status) values($1,$2,'Press workstation','extrusion_press',true,'active')",[cid(901),f.ids.company]);
});test.after(async()=>f?.close());
const run=async(command,payload)=>workstationResultSchema.parse(await f.command('workstation_command',command,payload));
test('53: operator identity and lease are checked for every station queue',async()=>{
  const stations=await run('stations.list',{page:1});assert.equal(stations.items.length,1);
  const lease=await run('station.open',{id:cid(902),machine_id:cid(901)});assert.equal(lease.operator_id,f.ids.owner);assert.equal((await run('station.queue',{id:lease.id})).items.length,0);
  await f.actor(f.ids.admin);await assert.rejects(run('station.queue',{id:lease.id}),/unavailable or expired/);await f.actor();
  await f.db.query("update workstation_sessions set expires_at=now()-interval '1 second' where id=$1",[lease.id]);await assert.rejects(run('station.queue',{id:lease.id}),/unavailable or expired/);
});
test('53: changed machine, ended lease, dealership and forged scope cannot reuse privileges',async()=>{
  const lease=await run('station.open',{id:cid(903),machine_id:cid(901)});await run('station.end',{id:lease.id});await assert.rejects(run('station.queue',{id:lease.id}),/expired/);
  await assert.rejects(run('station.open',{id:cid(904),machine_id:cid(999)}),/active company press/);
  await assert.rejects(run('station.open',{id:cid(904),machine_id:cid(901),operator_id:f.ids.admin}),/Invalid/);
  await f.actor(f.ids.dealer);await assert.rejects(run('stations.list',{}),/not permitted/);await f.actor();
  assert.equal((await f.db.query("select has_table_privilege('authenticated','workstation_sessions','SELECT') ok")).rows[0].ok,false);
});
