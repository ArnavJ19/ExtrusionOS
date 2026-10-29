import test from 'node:test';import assert from 'node:assert/strict';
import {physicalBundleObservationSchema,physicalBundleTag,physicalBundleListRequest} from '../lib/workflow/physical-bundles.ts';
const id='bc000000-0000-4000-8000-000000000001';
const observation={id,order_id:id,source_line_id:id,bundle_number:'B-1',number_of_pieces:2,net_length_m:12,gross_weight_kg:10,tare_weight_kg:1};
test('94: physical observations reject negative net, fractional pieces and unobserved or nonfinite data',()=>{
  assert.equal(physicalBundleObservationSchema.safeParse(observation).success,true);
  for(const patch of [{gross_weight_kg:0},{tare_weight_kg:11},{number_of_pieces:1.5},{net_length_m:0},{gross_weight_kg:NaN},{tare_weight_kg:Infinity},{gross_weight_kg:1.0001},{company_id:id},{source_kind:'forged'}])assert.equal(physicalBundleObservationSchema.safeParse({...observation,...patch}).success,false);
});
test('94: generated identities retain full UUID entropy and searches are bounded',()=>{
  assert.equal(physicalBundleTag('2026-10-29',id),`B-20261029-${id.toUpperCase()}`);
  assert.throws(()=>physicalBundleTag('bad',id));
  for(const patch of [{page:0},{page:10001},{search:'x'.repeat(81)},{company_id:id}])assert.equal(physicalBundleListRequest.safeParse({order_id:id,...patch}).success,false);
});
