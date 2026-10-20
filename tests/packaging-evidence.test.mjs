import assert from 'node:assert/strict';
import test from 'node:test';
import {createPackagingEvidenceFixture,installPackagingEvidenceCandidateObjects,packagingEvidenceIds as f} from '../scripts/lib/packaging-evidence-fixture.mjs';
import {readFileSync} from 'node:fs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const material=[{material_id:id(90),quantity_required:1}];
const historicalReview=readFileSync(new URL('../sql/audit-packaging-material-evidence.sql',import.meta.url),'utf8');

test('packaging material evidence remains linked, trusted and append-only through its lifecycle',async context=>{
  const fixture=await createPackagingEvidenceFixture(),{db}=fixture;
  const packageId=async()=>(await fixture.snapshot()).packaging[0].id;
  const issue=async()=>{const key=await packageId();await fixture.save(key,{materials:material});return key;};
  const complete=async()=>{const key=await packageId();await fixture.qc(null,95);await fixture.pack(key);return key;};
  const ledgerNet=state=>state.movements.reduce((sum,row)=>sum+(row.movement_type==='issue'?1:-1)*Number(row.quantity),0);
  try{
    for(const role of ['viewer','sales','accounts','quality','dealer_admin','dealer_staff','production','production_manager','dispatch','dispatch_manager','owner','admin'])await context.test(`${role} cannot fabricate a material movement through direct authenticated DML`,async()=>{
      await fixture.reset();const key=await complete(),before=await fixture.snapshot();await db.query("select set_config('test.role',$1,false)",[role]);
      await assert.rejects(fixture.asAuthenticated(()=>db.query(`insert into packaging_material_movements(company_id,packaging_job_id,material_id,movement_type,quantity,created_by)
        values($1,$2,$3,'restore',10,$4)`,[f.company,key,id(90),f.actor])),/permission denied|row-level security/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('authorized packaging RPC still issues stock and ledger rows under authenticated execution',async()=>{
      await fixture.reset();const key=await packageId();await fixture.asAuthenticated(()=>db.query('select public.save_packaging_job_atomic($1,$2,$3)',[key,
        {order_id:f.order,production_job_id:f.job,scheduled_date:'2026-10-19',status:'completed',pieces:10,profile_weight_kg:95,profile_length_m:50},material]));
      const state=await fixture.snapshot();assert.equal(state.materialStock,99);assert.equal(ledgerNet(state),1);assert.equal(state.packaging[0].status,'completed');
    });
    await context.test('authorized active material insertion, replacement and removal retain corrective ledger entries',async()=>{
      await fixture.reset();const key=await packageId();
      await fixture.asAuthenticated(()=>db.query('insert into packaging_job_materials(company_id,job_id,material_id,quantity_required)values($1,$2,$3,1.125)',[f.company,key,id(90)]));
      await fixture.asAuthenticated(()=>db.query('update packaging_job_materials set quantity_required=2.375 where job_id=$1',[key]));
      let state=await fixture.snapshot();assert.equal(state.materialStock,97.625);assert.equal(ledgerNet(state),2.375);assert.equal(state.movements.length,3);
      await fixture.asAuthenticated(()=>db.query('delete from packaging_job_materials where job_id=$1',[key]));
      state=await fixture.snapshot();assert.equal(state.materialStock,100);assert.equal(ledgerNet(state),0);assert.equal(state.movements.length,4);
    });
    await context.test('cancellation restores unused issued material exactly once and retains the full ledger',async()=>{
      await fixture.reset();const key=await issue();await fixture.save(key,{status:'cancelled',materials:material});const before=await fixture.snapshot();
      assert.equal(before.materialStock,100);assert.equal(ledgerNet(before),0);assert.equal(before.movements.length,4);assert.equal(before.packaging[0].status,'cancelled');
      await assert.rejects(fixture.save(key,{status:'cancelled',materials:material}),/cannot be edited/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('cancelling with no replacement materials restores the prior issue without a fabricated new issue',async()=>{
      await fixture.reset();const key=await issue();await fixture.save(key,{status:'cancelled',materials:[]});const state=await fixture.snapshot();
      assert.equal(state.materialStock,100);assert.equal(ledgerNet(state),0);assert.equal(state.materials.length,0);assert.equal(state.movements.length,2);
    });
    for(const state of ['completed','cancelled','issued-active'])await context.test(`privileged deletion preserves ${state} packaging, material rows, stock and movement history`,async()=>{
      await fixture.reset();const key=state==='completed'?await complete():await issue();if(state==='cancelled')await fixture.save(key,{status:'cancelled',materials:[]});
      const before=await fixture.snapshot();await assert.rejects(fixture.attempt(()=>db.query('delete from packaging_jobs where id=$1',[key])),/evidence|cannot be deleted|retain/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('a completed package cannot be erased after a production-linked packing manifest has been recorded',async()=>{
      await fixture.reset();const key=await complete();await fixture.assertDispatch(40);const before=await fixture.snapshot();
      await assert.rejects(fixture.attempt(()=>db.query('delete from packaging_jobs where id=$1',[key])),/evidence|cannot be deleted|retain/i);assert.deepEqual(await fixture.snapshot(),before);
      assert.equal((await db.query('select count(*)::int count from packing_list_items where source_line_id=$1',[f.job])).rows[0].count,1);
    });
    await context.test('an empty active package without any material history can still be removed through privileged maintenance',async()=>{
      await fixture.reset();const key=await packageId();assert.equal((await db.query('delete from packaging_jobs where id=$1 returning id',[key])).rows.length,1);assert.equal((await fixture.snapshot()).materialStock,100);
    });
    for(const [label,expression] of [['quantity','quantity=quantity+1'],['movement type',"movement_type='restore'"],['recorded time',"created_at=created_at+interval '1 day'"]])await context.test(`posted material ${label} cannot be rewritten by privileged DML`,async()=>{
      await fixture.reset();await issue();const before=await fixture.snapshot();await assert.rejects(fixture.attempt(()=>db.exec(`update packaging_material_movements set ${expression}`)),/append-only|immutable|cannot/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('posted material movements cannot be deleted directly',async()=>{
      await fixture.reset();await issue();const before=await fixture.snapshot();await assert.rejects(fixture.attempt(()=>db.exec('delete from packaging_material_movements')),/append-only|immutable|cannot/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('terminal package and child-material edit guards remain effective',async()=>{
      await fixture.reset();const key=await complete(),before=await fixture.snapshot();
      await assert.rejects(fixture.save(key,{status:'scheduled',materials:[]}),/cannot be edited/);
      await assert.rejects(fixture.asAuthenticated(()=>db.query('delete from packaging_job_materials where job_id=$1',[key])),/immutable/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('a late completion failure rolls back stock and inserted movements without an append-only conflict',async()=>{
      await fixture.reset();const key=await packageId(),before=await fixture.snapshot();
      await db.exec("create function public.fixture_r19_failure() returns trigger language plpgsql as $$begin if new.status='completed' then raise exception 'injected packaging finalization failure';end if;return new;end;$$;create trigger fixture_r19_failure after update of status on packaging_jobs for each row execute function public.fixture_r19_failure();");
      await assert.rejects(fixture.pack(key),/injected packaging finalization failure/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('authenticated reads remain available only for the current company while ledger writes stay closed',async()=>{
      await fixture.reset();await issue();await fixture.asAuthenticated(async()=>{
        assert.equal((await db.query('select * from packaging_material_movements')).rows.length,1);
        await db.query("select set_config('test.company',$1,false)",[f.otherVendor]);assert.equal((await db.query('select * from packaging_material_movements')).rows.length,0);
      });
      await db.query("select set_config('test.company',$1,false)",[f.company]);const acl=(await db.query(`select
        has_table_privilege('authenticated','public.packaging_material_movements','select') readable,
        has_table_privilege('authenticated','public.packaging_material_movements','insert') writable,
        has_any_column_privilege('authenticated','public.packaging_material_movements','insert') column_writable,
        has_table_privilege('authenticated','public.packaging_material_movements','update') editable,
        has_table_privilege('authenticated','public.packaging_material_movements','delete') deletable`)).rows[0];
      assert.deepEqual(acl,{readable:true,writable:false,column_writable:false,editable:false,deletable:false});
    });
    await context.test('legitimate issue and cancellation transactions still commit with append-only guards',async()=>{
      const committed=await createPackagingEvidenceFixture();try{
        await committed.reset();const key=(await committed.snapshot()).packaging[0].id;await committed.save(key,{materials:material});await committed.save(key,{status:'cancelled',materials:[]});await committed.db.exec('commit;begin;');
        const state=await committed.snapshot();assert.equal(state.materialStock,100);assert.equal(state.movements.length,2);assert.equal(ledgerNet(state),0);assert.equal(state.packaging[0].status,'cancelled');
      }finally{await committed.close();}
    });
    await context.test('a fully restored active package still retains its material movement history',async()=>{
      await fixture.reset();const key=await issue();await fixture.asAuthenticated(()=>db.query('delete from packaging_job_materials where job_id=$1',[key]));const before=await fixture.snapshot();
      assert.equal(before.materialStock,100);assert.equal(before.materials.length,0);assert.equal(before.movements.length,2);
      await assert.rejects(fixture.attempt(()=>db.query('delete from packaging_jobs where id=$1',[key])),/cannot be deleted/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('an empty cancelled package retains its terminal lifecycle evidence',async()=>{
      await fixture.reset();const key=await packageId();await fixture.save(key,{status:'cancelled',materials:[]});const before=await fixture.snapshot();assert.equal(before.movements.length,0);
      await assert.rejects(fixture.attempt(()=>db.query('delete from packaging_jobs where id=$1',[key])),/cannot be deleted/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('the existing authenticated package-header delete restriction is preserved',async()=>{
      await fixture.reset();const key=await complete(),before=await fixture.snapshot();assert.equal((await fixture.asAuthenticated(()=>db.query('delete from packaging_jobs where id=$1 returning id',[key]))).rows.length,0);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('column mutation grants cannot reopen direct client movement writes',async()=>{
      const columns=await createPackagingEvidenceFixture();try{
        await columns.db.exec('grant insert(quantity),update(quantity) on packaging_material_movements to authenticated;');
        assert.equal((await columns.db.query("select has_any_column_privilege('authenticated','public.packaging_material_movements','insert') granted")).rows[0].granted,true);
        assert.deepEqual(await installPackagingEvidenceCandidateObjects(columns.db),{functions:2,triggers:2});
        const actual=(await columns.db.query("select has_any_column_privilege('authenticated','public.packaging_material_movements','insert') inserted,has_any_column_privilege('authenticated','public.packaging_material_movements','update') updated")).rows[0];assert.deepEqual(actual,{inserted:false,updated:false});
      }finally{await columns.close();}
    });
    await context.test('catalog preflights verify both enabled guards, private execution and effective ledger write revocation',async()=>{
      await fixture.reset();const source=readFileSync(new URL('../sql/audit-deployment-preflight.sql',import.meta.url),'utf8');
      const statement=marker=>{const start=source.indexOf(marker);assert.ok(start>=0);return source.slice(start,source.indexOf(';',start)+1);};
      const guards=(await db.query(statement('-- R19 packaging evidence guards'))).rows;assert.equal(guards.length,2);
      for(const row of guards){assert.equal(row.attached,true);assert.equal(row.tgenabled,'O');assert.equal(row.security_definer,true);assert.equal(row.authenticated_execute,false);assert.equal(row.anonymous_execute,false);assert.match(row.definition_md5,/^[a-f0-9]{32}$/);assert.equal(row.event_mask,row.relation==='packaging_jobs'?11:27);}
      const rights=(await db.query(statement('-- R19 ledger privileges'))).rows[0];assert.deepEqual(rights,{ledger_rls:true,authenticated_read:true,authenticated_insert:false,authenticated_column_insert:false,authenticated_update:false,authenticated_column_update:false,authenticated_delete:false,anonymous_insert:false});
    });
    await context.test('a pending production-linked manifest protects even an otherwise empty active package',async()=>{
      await fixture.reset();const key=await packageId(),dispatch=(await db.query("insert into dispatches(company_id,order_id,delivery_status) values($1,$2,'pending') returning id",[f.company,f.order])).rows[0].id;
      await db.query(`insert into packing_list_items(company_id,dispatch_id,source_kind,source_record_id,source_line_id,profile_id,gross_weight_kg,tare_weight_kg,net_weight_kg,net_length_m,number_of_pieces)
        values($1,$2,'production',$3,$4,$5,5,0,5,5,1)`,[f.company,dispatch,f.order,f.job,f.profile]);const before=await fixture.snapshot();assert.equal(before.movements.length,0);
      await assert.rejects(fixture.attempt(()=>db.query('delete from packaging_jobs where id=$1',[key])),/cannot be deleted/);assert.deepEqual(await fixture.snapshot(),before);
      await issue();const issued=await fixture.snapshot();await assert.rejects(fixture.save(key,{status:'cancelled',materials:[]}),/cannot be cancelled/);assert.deepEqual(await fixture.snapshot(),issued);
    });
    await context.test('read-only historical review accepts legitimate issue, replacement and cancellation balances',async()=>{
      await fixture.reset();const key=await issue();assert.deepEqual((await db.query(historicalReview)).rows,[]);
      await fixture.save(key,{materials:[{material_id:id(90),quantity_required:2}]});assert.deepEqual((await db.query(historicalReview)).rows,[]);
      await fixture.save(key,{status:'cancelled',materials:[]});const before=await fixture.snapshot();assert.deepEqual((await db.query(historicalReview)).rows,[]);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('historical review flags an unbacked restore without certifying authorship or modifying evidence',async()=>{
      await fixture.reset();const key=await issue();await db.query("insert into packaging_material_movements(company_id,packaging_job_id,material_id,movement_type,quantity) values($1,$2,$3,'restore',10)",[f.company,key,id(90)]);
      const before=await fixture.snapshot(),rows=(await db.query(historicalReview)).rows;assert.equal(rows.length,1);assert.equal(Number(rows[0].net_issued),-9);assert.equal(Number(rows[0].expected_net_issued),1);assert.match(rows[0].review_reason,/disagrees/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('accepted original and corrective finishing portions retain independent release with the ledger guards installed',async()=>{
      const combined=await createPackagingEvidenceFixture({finishingType:'powder_coating'});try{
        await combined.reset();const original=await combined.partial(),retry=await combined.retryComplete(),state=await combined.snapshot();
        for(const [finish,weight] of [[original,40],[retry,50]]){await combined.qc(finish,weight);await combined.pack(state.packaging.find(row=>row.finishing_job_id===finish).id);}
        await combined.db.query("select set_config('test.role','dispatch_manager',false)");const release=await combined.asAuthenticated(()=>combined.ready());assert.equal(Number(release.rows[0].ready_weight_kg),90);
        const before=await combined.snapshot();assert.equal(before.materialStock,98);assert.equal(before.movements.length,2);assert.deepEqual((await combined.db.query(historicalReview)).rows,[]);
        await combined.assertDispatch(90);await assert.rejects(combined.attempt(()=>combined.db.query('delete from packaging_jobs where id=$1',[state.packaging[0].id])),/cannot be deleted/);assert.deepEqual(await combined.snapshot(),before);
        await combined.db.exec('commit;begin;');assert.equal(Number((await combined.ready()).rows[0].ready_weight_kg),90);
      }finally{await combined.close();}
    });
  }finally{await fixture.close();}
});
