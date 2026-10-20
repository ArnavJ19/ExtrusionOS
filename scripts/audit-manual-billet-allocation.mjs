import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createManualBilletAllocationFixture,manualBilletIds as f} from './lib/manual-billet-allocation-fixture.mjs';

const verify=process.argv.includes('--verify-candidate'),output=resolve(process.argv[2]??'test-results/manual-billet-allocation');
const sql=await createManualBilletAllocationFixture({candidate:verify});
try{
  await sql.reset();await sql.insertBillet({temper:'T6'});const before=await sql.snapshot();const observed=[];
  assert.equal((await sql.db.query("select count(*)::integer count from information_schema.columns where table_schema='public' and table_name='foundry_billets' and column_name='profile_id'")).rows[0].count,0);
  if(verify){const first=await sql.allocate();observed.push({operation:'allocate',requirementId:first.rows[0].id,billet:await sql.billet()});
    const second=await sql.reallocate(f.freeBillet,sql.sourceOrderId);observed.push({operation:'reallocate',requirementId:second.rows[0].id,billet:await sql.billet()});
    assert.equal((await sql.billet()).order_id,sql.sourceOrderId);assert.equal((await sql.snapshot()).billets.length,1);assert.equal((await sql.billet()).weight_kg,before.billets[0].weight_kg);
  }else{
    for(const [operation,call]of [['allocate',()=>sql.allocate()],['reallocate',()=>sql.reallocate()]]){
      let error;try{await call();}catch(cause){error=cause.message;}assert.match(error??'',/record "v_billet" has no field "profile_id"/);observed.push({operation,error});assert.deepEqual(await sql.snapshot(),before);
    }
  }
  const report={finding:'R22',candidateVerified:verify,appliedToSupabase:false,foundryBilletHasProfileColumn:false,observed,
    proof:'Historical-column fixture, actual direct-order writer/material snapshot, actual authenticated public allocation/reallocation wrappers and prepared private definitions, with requirement refresh and lineage guard attached',
    boundary:'Extracted candidate objects and synthetic local identity only. No Supabase migration, hosted request/JWT/RLS, physical stock attestation, independent sessions or full signed-in operator acceptance.'};
  mkdirSync(output,{recursive:true});writeFileSync(resolve(output,verify?'candidate-regression.json':'original-diagnostic.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await sql.close();}
