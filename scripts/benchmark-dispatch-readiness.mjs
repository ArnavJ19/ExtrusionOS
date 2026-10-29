import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {indexDispatchReadiness} from '../lib/dispatches/readiness-index.ts';
const jobs=Array.from({length:1000},(_,i)=>String(i));
const inspections=Array.from({length:10000},(_,i)=>({production_job_id:String(i%1000),status:i%3?'approved':'pending',quantity_checked_kg:i%11}));
const packaging=Array.from({length:5000},(_,i)=>({id:String(i),production_job_id:String(i%1000),status:i%3?'completed':'pending',profile_weight_kg:i%7}));
const materials=Array.from({length:10000},(_,i)=>({job_id:String(i%5000),quantity_required:i%5}));
function before(){return jobs.map(id=>[
  inspections.filter(r=>r.production_job_id===id&&r.status==='approved'&&!r.finishing_job_id).reduce((s,r)=>s+r.quantity_checked_kg,0),
  packaging.filter(r=>r.production_job_id===id&&r.status==='completed'&&materials.some(m=>m.job_id===r.id&&m.quantity_required>0)).reduce((s,r)=>s+r.profile_weight_kg,0)]);}
function after(){const index=indexDispatchReadiness(inspections,packaging,materials);return jobs.map(id=>[index.approvedByJobKg.get(id)??0,index.packagedByJobKg.get(id)??0]);}
assert.deepEqual(after(),before());
const measure=fn=>{const start=performance.now();fn();return Number((performance.now()-start).toFixed(3));};
const baseline=Array.from({length:5},()=>measure(before)),candidate=Array.from({length:5},()=>measure(after));
console.log(JSON.stringify({context:'Local synthetic dispatch-readiness computation; excludes network and hosted query latency',jobs:jobs.length,inspections:inspections.length,packaging:packaging.length,materials:materials.length,baseline_ms:baseline,candidate_ms:candidate,equivalent:true},null,2));
