import test from 'node:test';import assert from 'node:assert/strict';import {workstationCommandSchema,workstationExpired,stationPreferenceKey} from '../lib/workflow/workstation.ts';
const id='bc000000-0000-4000-8000-000000000001';
test('53: station identity requests reject operator/tenant injection and unbounded queues',()=>{
  assert.equal(workstationCommandSchema.safeParse({command:'station.open',id,machine_id:id}).success,true);
  for(const extra of [{operator_id:id},{company_id:id},{role:'owner'}])assert.equal(workstationCommandSchema.safeParse({command:'station.open',id,machine_id:id,...extra}).success,false);
  assert.equal(workstationCommandSchema.safeParse({command:'stations.list',page:0}).success,false);
});
test('53: expiry is inclusive and station preference retains no operator or lease privilege',()=>{
  assert.equal(workstationExpired('2026-10-29T00:00:00Z',Date.parse('2026-10-29T00:00:00Z')),true);assert.equal(workstationExpired('bad'),true);
  assert.equal(stationPreferenceKey(id),`eos:workstation:${id}`);assert.throws(()=>stationPreferenceKey('other'));
});
