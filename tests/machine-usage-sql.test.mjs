import test from 'node:test';import assert from 'node:assert/strict';import {createFactoryUpgradeFixture,cid} from '../scripts/lib/factory-upgrade-fixture.mjs';import {machineUsageResultSchema} from '../lib/workflow/machine-usage.ts';
let f;test.before(async()=>{f=await createFactoryUpgradeFixture();await f.db.query("insert into machines(id,company_id,machine_name,machine_type,is_active,status) values($1,$2,'Usage press','extrusion_press',true,'active')",[cid(1100),f.ids.company]);});test.after(async()=>f?.close());
const run=async(c,p)=>machineUsageResultSchema.parse(await f.command('machine_usage_command',c,p));
test('99: meter and dated tariff need independent approval before actual start',async()=>{
  await run('meter.create',{id:cid(1101),machine_id:cid(1100),name:'Press main meter',counter_modulus:1000});
  await assert.rejects(run('usage.start',{id:cid(1103),meter_id:cid(1101),opening_reading:100}),/approved applicable tariff/);
  await run('tariff.create',{id:cid(1102),meter_id:cid(1101),effective_from:'2026-01-01',rate_per_kwh:8.5});await assert.rejects(run('tariff.approve',{id:cid(1102)}),/Another authorized reviewer/);
  await f.actor(f.ids.admin);await run('tariff.approve',{id:cid(1102)});await f.actor();
});
test('99: missing stop leaves totals unavailable; exact start retries and simultaneous open runs do not duplicate',async()=>{
  const started=await run('usage.start',{id:cid(1103),meter_id:cid(1101),opening_reading:100});assert.equal(started.run.status,'running');assert.equal(started.run.runtime_seconds,null);assert.equal(started.run.energy_used,null);assert.equal(started.run.cost,null);
  assert.equal((await run('usage.start',{id:cid(1103),meter_id:cid(1101),opening_reading:100})).run.id,cid(1103));
  await assert.rejects(run('usage.start',{id:cid(1104),meter_id:cid(1101),opening_reading:100}),/unique|duplicate/);
  await assert.rejects(run('usage.start',{id:cid(1103),meter_id:cid(1101),opening_reading:101}),/different observations/);
});
test('99: server events reconcile observed runtime and downtime and freeze the start tariff',async()=>{
  await run('usage.pause',{id:cid(1105),run_id:cid(1103)});await run('usage.resume',{id:cid(1106),run_id:cid(1103)});
  const stopped=await run('usage.stop',{id:cid(1107),run_id:cid(1103),closing_reading:120});assert.equal(stopped.run.energy_used,20);assert.equal(stopped.run.cost,170);assert.ok(stopped.run.runtime_seconds>=0);assert.ok(stopped.run.downtime_seconds>=0);assert.equal(stopped.run.allocation_basis,'Machine total; no job allocation');
  assert.ok(Math.abs(stopped.run.runtime_seconds+stopped.run.downtime_seconds-(Date.parse(stopped.run.stopped_at)-Date.parse(stopped.run.started_at))/1000)<0.003);
  assert.equal((await run('usage.stop',{id:cid(1107),run_id:cid(1103),closing_reading:120})).run.energy_used,20);
  await f.actor(f.ids.production);const safe=await run('usage.load',{meter_id:cid(1101)});assert.equal('cost' in safe.run,false);assert.equal('tariffs' in await run('meters.list',{}),false);await f.actor();
});
test('99: decreased reading needs another reviewer and retains original stop evidence',async()=>{
  await run('usage.start',{id:cid(1110),meter_id:cid(1101),opening_reading:990});const stopped=await run('usage.stop',{id:cid(1111),run_id:cid(1110),closing_reading:10});assert.equal(stopped.run.status,'requires_review');assert.equal(stopped.run.energy_used,null);assert.equal(stopped.run.cost,null);
  const payload={id:cid(1112),run_id:cid(1110),closing_reading:10,rollovers:1,reason:'Counter rollover verified against the physical meter photo'};
  await assert.rejects(run('usage.resolve',payload),/Independent meter resolution/);await f.actor(f.ids.admin);const resolved=await run('usage.resolve',payload);assert.equal(resolved.run.energy_used,20);assert.equal(resolved.run.status,'closed');assert.equal(resolved.run.cost,170);
  assert.ok(resolved.run.events.some(e=>e.command==='usage.stop'&&e.reading===10));assert.ok(resolved.run.events.some(e=>e.command==='usage.resolve'));await f.actor();
});
test('99: role, tenant, actor, tariff validity and event immutability are enforced at database boundary',async()=>{
  await f.actor(f.ids.dealer);await assert.rejects(run('meters.list',{}),/not permitted/);await f.actor();await assert.rejects(run('usage.load',{meter_id:cid(999)}),/unavailable/);
  await assert.rejects(run('usage.start',{id:cid(1113),meter_id:cid(1101),opening_reading:100,operator_id:f.ids.admin}),/not permitted/);
  await assert.rejects(f.db.query("delete from machine_usage_events where id=$1",[cid(1111)]),/history/);
  assert.equal((await f.db.query("select has_table_privilege('authenticated','machine_usage_runs','UPDATE') ok")).rows[0].ok,false);
});
