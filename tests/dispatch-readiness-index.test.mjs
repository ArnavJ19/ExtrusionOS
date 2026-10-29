import test from 'node:test';import assert from 'node:assert/strict';
import {indexDispatchReadiness} from '../lib/dispatches/readiness-index.ts';
test('40: indexed readiness preserves released QC and packaging with actually issued material',()=>{
  const result=indexDispatchReadiness([
    {production_job_id:'a',status:'approved',quantity_checked_kg:10},
    {production_job_id:'a',status:'approved',quantity_checked_kg:'20'},
    {production_job_id:'a',finishing_job_id:'f',status:'approved',quantity_checked_kg:90},
    {production_job_id:'a',status:'pending',quantity_checked_kg:80},
  ],[{id:'p',production_job_id:'a',status:'completed',profile_weight_kg:25},{id:'q',production_job_id:'a',status:'completed',profile_weight_kg:100}],
    [{job_id:'p',quantity_required:1},{job_id:'p',quantity_required:2},{job_id:'q',quantity_required:0}]);
  assert.equal(result.approvedByJobKg.get('a'),30);assert.equal(result.packagedByJobKg.get('a'),25);
});
test('40: missing records remain zero, while corrupt recorded quantities stop readiness',()=>{
  assert.equal(indexDispatchReadiness([],[],[]).approvedByJobKg.size,0);
  for(const quantity of [NaN,Infinity,-1,'bad'])assert.throws(()=>indexDispatchReadiness([{production_job_id:'a',status:'approved',quantity_checked_kg:quantity}],[],[]),/invalid observation/);
  assert.equal(indexDispatchReadiness([{production_job_id:'a',status:'approved',quantity_checked_kg:null}],[],[]).approvedByJobKg.get('a'),0);
});
test('40: large interleaved data agrees with the original per-job calculation',()=>{
  const jobs=Array.from({length:100},(_,i)=>String(i));
  const inspections=Array.from({length:2000},(_,i)=>({production_job_id:String(i%100),finishing_job_id:i%13===0?'f':null,status:i%3?'approved':'pending',quantity_checked_kg:i%10}));
  const packaging=Array.from({length:1000},(_,i)=>({id:String(i),production_job_id:String(i%100),status:i%3?'completed':'pending',profile_weight_kg:i%7}));
  const materials=Array.from({length:2000},(_,i)=>({job_id:String(i%1000),quantity_required:i%5}));
  const indexed=indexDispatchReadiness(inspections,packaging,materials);
  for(const id of jobs){
    assert.equal(indexed.approvedByJobKg.get(id)??0,inspections.filter(r=>r.production_job_id===id&&r.status==='approved'&&!r.finishing_job_id).reduce((s,r)=>s+r.quantity_checked_kg,0));
    assert.equal(indexed.packagedByJobKg.get(id)??0,packaging.filter(r=>r.production_job_id===id&&r.status==='completed'&&materials.some(m=>m.job_id===r.id&&m.quantity_required>0)).reduce((s,r)=>s+r.profile_weight_kg,0));
  }
});
