import test from 'node:test';import assert from 'node:assert/strict';import {measuredEnergy,machineUsageCommandSchema} from '../lib/workflow/machine-usage.ts';
const id='bc000000-0000-4000-8000-000000000001';
test('99: recorded energy cannot be negative or fabricated across an unverified reset',()=>{
  assert.deepEqual(measuredEnergy(100,120,null),{ok:true,kwh:20});assert.deepEqual(measuredEnergy(990,10,1000,1),{ok:true,kwh:20});
  for(const args of [[100,90,null],[990,10,null,1],[100,120,1000,1],[NaN,1,null],[1,Infinity,null],[1,2,1000,2]])assert.equal(measuredEnergy(...args).ok,false);
});
test('99: event requests reject client timestamps, ownership, costs and nonfinite observations',()=>{
  const value={command:'usage.start',id,meter_id:id,opening_reading:0};assert.equal(machineUsageCommandSchema.safeParse(value).success,true);
  for(const extra of [{company_id:id},{operator_id:id},{cost:1},{started_at:'2026-10-29'},{opening_reading:NaN},{opening_reading:-1}])assert.equal(machineUsageCommandSchema.safeParse({...value,...extra}).success,false);
  assert.equal(machineUsageCommandSchema.safeParse({command:'usage.resolve',id,run_id:id,closing_reading:20,rollovers:2,reason:'Verified evidence'}).success,false);
});
