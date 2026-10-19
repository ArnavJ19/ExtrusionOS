import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createBilletLinkRepairFixture,billetLinkIds as f} from './lib/billet-link-repair-fixture.mjs';

const output=resolve(process.argv[2]??'test-results/billet-link-repair'),verify=process.argv.includes('--verify-candidate');
const fixture=await createBilletLinkRepairFixture({candidate:verify});
try{
  await fixture.reset();await fixture.insertBillet();const before=await fixture.snapshot(),observed=[];
  for(const [name,call]of [['repair',fixture.repair],['refresh',fixture.refresh],['priority allocation',fixture.priority]]){
    try{await call();observed.push({name,success:true});}catch(error){observed.push({name,success:false,error:error.message});}
  }
  const after=await fixture.snapshot();
  if(verify){assert.ok(observed.every(row=>row.success));assert.equal(after.orders[0].billet_allocation_status,'complete');
    assert.equal(after.billets.find(row=>row.id===f.legacyBillet).allocation_requirement_id,after.requirements.find(row=>row.temper==='T6').id);
  }else{assert.ok(observed.every(row=>!row.success&&/alloy, temper, and diameter/.test(row.error)),JSON.stringify(observed));assert.deepEqual(after,before);}
  await fixture.reset({legacy:false});await fixture.insertBillet();
  const inventedProfileColumn=(await fixture.db.query("select count(*)::integer count from information_schema.columns where table_schema='public' and table_name='foundry_billets' and column_name='profile_id'")).rows[0].count;
  assert.equal(inventedProfileColumn,0);
  let manualError;try{await fixture.allocate();}catch(error){manualError=error.message;}
  assert.match(manualError??'',/record "v_billet" has no field "profile_id"/);
  const report={finding:'R21',candidateVerified:verify,appliedToSupabase:false,observed,before,after,
    separateManualAllocationFailure:manualError,foundryBilletHasProfileColumn:false,
    proof:'Actual prepared direct-order writer and material snapshot, current requirement refresh/repair, priority allocator and attached lineage guard in disposable PostgreSQL-compatible fixture. The actual public manual wrapper separately reproduces an unsupported-field error; this candidate does not fix it.',
    boundary:'Extracted objects and synthetic identities only. No Supabase migration, hosted query/write, real JWT/RLS, physical stock attestation, independent sessions or signed-in operator journey.'};
  mkdirSync(output,{recursive:true});writeFileSync(resolve(output,verify?'candidate-regression.json':'original-diagnostic.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({finding:report.finding,candidateVerified:verify,observed,boundary:report.boundary},null,2));
}finally{await fixture.close();}
