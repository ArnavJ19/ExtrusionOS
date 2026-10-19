import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPackagingEvidenceFixture,packagingEvidenceIds as f} from './lib/packaging-evidence-fixture.mjs';

if(process.argv.includes('--verify-candidate'))await verifyCandidate();
else{
const fixture=await createPackagingEvidenceFixture({candidate:false}),{db}=fixture;
try{
  await fixture.reset();let before=await fixture.snapshot(),packageId=before.packaging[0].id;
  await fixture.qc(null,95);await fixture.pack(packageId);before=await fixture.snapshot();assert.equal(before.materialStock,99);assert.equal(before.movements.length,1);
  await db.query("select set_config('test.role','dispatch_manager',false)");await fixture.assertDispatch(40);
  const afterPacking=await fixture.snapshot();
  const directAuthenticated=await fixture.asAuthenticated(()=>db.query('delete from packaging_jobs where id=$1 returning id',[packageId]));assert.equal(directAuthenticated.rows.length,0);
  assert.deepEqual(await fixture.snapshot(),afterPacking);
  await assert.rejects(fixture.asAuthenticated(()=>db.query('delete from packaging_job_materials where job_id=$1',[packageId])),/immutable/);
  await db.query('delete from packaging_jobs where id=$1',[packageId]);await db.exec('commit;begin;');const after=await fixture.snapshot();
  assert.equal(after.packaging.length,0);assert.equal(after.materials.length,0);assert.equal(after.movements.length,0);assert.equal(after.materialStock,99);
  assert.equal((await db.query('select count(*)::int count from packing_list_items where source_line_id=$1',[f.job])).rows[0].count,1);
  const clientFixture=await createPackagingEvidenceFixture({candidate:false});let directLedgerForgery;
  try{
    await clientFixture.reset();const initial=await clientFixture.snapshot(),id=initial.packaging[0].id;await clientFixture.pack(id);
    const prior=await clientFixture.snapshot();await clientFixture.db.query("select set_config('test.role','viewer',false)");
    const forged=await clientFixture.asAuthenticated(()=>clientFixture.db.query(`insert into packaging_material_movements(company_id,packaging_job_id,material_id,movement_type,quantity,created_by)
      values($1,$2,$3,'restore',10,$4) returning id`,[f.company,id,prior.materials[0].material_id,f.actor]));
    const result=await clientFixture.snapshot();assert.equal(result.materialStock,99);assert.equal(result.movements.length,2);
    directLedgerForgery={role:'viewer',movementId:forged.rows[0].id,stockBefore:prior.materialStock,stockAfter:result.materialStock,recordedMovementCountBefore:prior.movements.length,recordedMovementCountAfter:result.movements.length,fabricatedRestoreQuantity:10};
  }finally{await clientFixture.close();}
  const report={investigation:'Packaging reversal and retained evidence',findingConfirmed:true,
    path:'Privileged SQL deletion of a completed packaging header, including its actual cascading material and movement relationships',
    authenticatedDirectHeaderDelete:'No row deleted under the installed historical RLS policies; a normal authenticated direct-delete exploit was not reproduced',
    directTerminalMaterialDelete:'Rejected by the existing terminal material guard',directLedgerForgery,before:afterPacking,after,
    observed:{stockBefore:before.materialStock,stockAfter:after.materialStock,issuedMaterialRowsBefore:before.materials.length,issuedMaterialRowsAfter:after.materials.length,
      movementRowsBefore:before.movements.length,movementRowsAfter:after.movements.length,packingManifestRetained:true},
    conclusion:'A same-company authenticated viewer can insert a fabricated restore movement without restoring stock. Privileged deletion also erases completed release and material audit evidence while its stock debit and production-linked packing manifest remain. Existing terminal package protection covers UPDATE, but not DELETE; cascading material deletion reads a parent that has already disappeared.',
    proof:'Actual public packaging save/material stock/status functions, terminal/deferred guards and historical cascade relationships over disposable persisted data; explicit commit',
    boundary:'Synthetic identity/policies and extracted prior candidate objects. No Supabase migration, hosted request, hosted JWT/RLS conclusion, physical shipment, physical material return or current authenticated header-delete exploit is proved.'};
  const output=resolve(process.argv[2]??'test-results/packaging-evidence');mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'packaging-evidence-diagnostic.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,before:undefined,after:undefined},null,2));
}finally{await fixture.close();}
}

async function verifyCandidate(){
  const fixture=await createPackagingEvidenceFixture(),{db}=fixture;let completed,cancelled;
  try{
    await fixture.reset();const key=(await fixture.snapshot()).packaging[0].id;await fixture.qc(null,95);await fixture.pack(key);await fixture.assertDispatch(40);
    const before=await fixture.snapshot();await db.query("select set_config('test.role','viewer',false)");
    await assert.rejects(fixture.asAuthenticated(()=>db.query("insert into packaging_material_movements(company_id,packaging_job_id,material_id,movement_type,quantity)values($1,$2,$3,'restore',10)",[f.company,key,before.materials[0].material_id])),/permission denied/i);
    await assert.rejects(fixture.attempt(()=>db.query('delete from packaging_jobs where id=$1',[key])),/cannot be deleted/);
    await assert.rejects(fixture.attempt(()=>db.exec('delete from packaging_material_movements')),/append-only/);assert.deepEqual(await fixture.snapshot(),before);
    await db.exec('commit;begin;');completed=await fixture.snapshot();assert.equal(completed.materialStock,99);assert.equal(completed.movements.length,1);
  }finally{await fixture.close();}
  const cancellation=await createPackagingEvidenceFixture();
  try{
    await cancellation.reset();const key=(await cancellation.snapshot()).packaging[0].id,materials=[{material_id:'00000000-0000-4000-8000-000000000090',quantity_required:1}];
    await cancellation.save(key,{materials});await cancellation.save(key,{status:'cancelled',materials});await cancellation.db.exec('commit;begin;');cancelled=await cancellation.snapshot();
    assert.equal(cancelled.materialStock,100);assert.equal(cancelled.movements.length,4);assert.equal(cancelled.movements.reduce((sum,row)=>sum+(row.movement_type==='issue'?1:-1)*Number(row.quantity),0),0);
  }finally{await cancellation.close();}
  const report={finding:'R19',candidateVerifiedInFixture:true,appliedToSupabase:false,
    completed:{stock:completed.materialStock,materialRows:completed.materials.length,movementRows:completed.movements.length,retainedManifest:true},
    cancelled:{stock:cancelled.materialStock,materialRows:cancelled.materials.length,movementRows:cancelled.movements.length,netIssued:0},
    completedState:completed,cancelledState:cancelled,
    proof:'Actual packaging/QC/stock/cancellation functions, historical RLS policies and cascade relationships with extracted R19 privilege/index/trigger objects; viewer forgery and privileged evidence deletion reject; legitimate completion and cancellation commit',
    boundary:'Synthetic identities and disposable data, not migration replay or hosted JWT/RLS proof. No physical stock return, historical attestation, independent sessions or full authenticated operator journey is established.'};
  const output=resolve(process.argv[2]&&!process.argv[2].startsWith('--')?process.argv[2]:'test-results/packaging-evidence');mkdirSync(output,{recursive:true});
  writeFileSync(resolve(output,'packaging-evidence-regression.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,completedState:undefined,cancelledState:undefined},null,2));
}
