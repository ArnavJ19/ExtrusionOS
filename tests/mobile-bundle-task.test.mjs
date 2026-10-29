import test from 'node:test';import assert from 'node:assert/strict';
import {canRecordMobileBundle,parseBundleObservationText,mobileBundleQueueSchema} from '../lib/workflow/mobile-bundle-task.ts';
test('17: mobile task uses the same recording roles and rejects dealership sessions',()=>{
  for(const role of ['owner','admin','factory_manager','dispatch_manager','dispatch','inventory_manager']){assert.equal(canRecordMobileBundle(role,null),true);assert.equal(canRecordMobileBundle(role,'dealer'),false);}
  for(const role of ['sales','accounts','viewer','dealer_admin','dealer_staff','production'])assert.equal(canRecordMobileBundle(role,null),false);
});
test('17: touch entry distinguishes blank measurements from an observed zero tare',()=>{
  assert.equal(parseBundleObservationText('0'),0);assert.equal(parseBundleObservationText('12.345'),12.345);assert.equal(parseBundleObservationText('1.001'),1.001);
  for(const text of ['',' ','-1','1,000','Infinity','1e3','0.0001','1000001'])assert.ok(Number.isNaN(parseBundleObservationText(text)));
  assert.ok(Number.isNaN(parseBundleObservationText('1.5',true)));assert.equal(parseBundleObservationText('12',true),12);
});
test('17: order queues use bounded server page requests',()=>{
  assert.deepEqual(mobileBundleQueueSchema.parse({}),{page:1,search:''});
  for(const value of [{page:0},{page:'NaN'},{search:'x'.repeat(81)},{company_id:'forged'}])assert.equal(mobileBundleQueueSchema.safeParse(value).success,false);
});
