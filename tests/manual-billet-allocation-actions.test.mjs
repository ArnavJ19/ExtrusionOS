import assert from 'node:assert/strict';
import test from 'node:test';
import {createManualBilletAllocationFixture,manualBilletIds as f} from '../scripts/lib/manual-billet-allocation-fixture.mjs';
import {createManualBilletActionFixture} from '../scripts/lib/manual-billet-action-fixture.mjs';
import {fixtureId as id} from '../scripts/lib/direct-order-fixture.mjs';

test('manual billet actions and SQL boundaries preserve one allocation',async context=>{
  const sql=await createManualBilletAllocationFixture(),{db}=sql;
  try{
    await context.test('actual allocation action persists the requirement and refreshes the target surfaces',async()=>{
      await sql.reset();await sql.insertBillet({temper:'T6'});const action=createManualBilletActionFixture(sql),result=await action.allocate();
      assert.equal(result.success,true);assert.equal((await sql.billet()).allocation_requirement_id,result.requirementId);
      assert.deepEqual(action.state.calls,[{name:'allocate_billet_to_order',args:{p_billet_id:f.freeBillet,p_order_id:sql.orderId}}]);
      assert.deepEqual(action.state.paths.map(([path])=>path),['/foundry','/foundry/billets',`/orders/${sql.orderId}`]);
    });
    await context.test('actual reallocation action moves the same billet and refreshes both SQL counters',async()=>{
      await sql.reset();await sql.seedAllocation();const action=createManualBilletActionFixture(sql),result=await action.reallocate({billet_id:f.legacyBillet,order_id:sql.orderId});
      assert.equal(result.success,true);assert.equal((await sql.billet(f.legacyBillet)).order_id,sql.orderId);
      assert.equal((await sql.requirements(sql.sourceOrderId)).find(row=>row.profile_id===f.t6Profile).billets_allocated,0);
      assert.equal((await sql.snapshot()).billets.length,1);
    });
    for(const role of ['sales','viewer','dealer_admin',null])await context.test(`${role??'missing identity'} is rejected before an allocation RPC`,async()=>{
      await sql.reset();await sql.insertBillet({temper:'T6'});const action=createManualBilletActionFixture(sql);action.state.role=role;const before=await sql.snapshot();
      assert.equal((await action.allocate()).success,false);assert.equal((await action.reallocate()).success,false);
      assert.deepEqual(action.state.calls,[]);assert.deepEqual(action.state.paths,[]);assert.deepEqual(await sql.snapshot(),before);
    });
    await context.test('invalid identifiers are rejected before SQL transport',async()=>{
      await sql.reset();const action=createManualBilletActionFixture(sql);
      for(const input of [{billet_id:'invalid',order_id:sql.orderId},{billet_id:f.freeBillet,order_id:'invalid'}])assert.equal((await action.allocate(input)).success,false);
      assert.deepEqual(action.state.calls,[]);assert.deepEqual(action.state.paths,[]);
    });
    await context.test('a forged company is never forwarded to the SQL writer',async()=>{
      await sql.reset();await sql.insertBillet({temper:'T6'});const action=createManualBilletActionFixture(sql);
      assert.equal((await action.allocate({billet_id:f.freeBillet,order_id:sql.orderId,company_id:f.otherCompany})).success,true);
      assert.deepEqual(Object.keys(action.state.calls[0].args).sort(),['p_billet_id','p_order_id']);assert.equal((await sql.billet()).company_id,f.company);
    });
    await context.test('database rejection does not report success or refresh a stale page',async()=>{
      await sql.reset();await sql.insertBillet({temper:'T6'});const action=createManualBilletActionFixture(sql);action.state.error='Synthetic unavailable writer';const before=await sql.snapshot();
      assert.equal((await action.allocate()).success,false);assert.deepEqual(action.state.paths,[]);assert.deepEqual(await sql.snapshot(),before);
    });
    await context.test('a lost response retains exactly one allocation and a repeated allocation cannot duplicate it',async()=>{
      await sql.reset();await sql.insertBillet({temper:'T6'});const action=createManualBilletActionFixture(sql);action.state.throwAfterWrite=true;
      assert.equal((await action.allocate()).success,false);const after=await sql.snapshot();assert.equal((await sql.billet()).order_id,sql.orderId);assert.deepEqual(action.state.paths,[]);
      action.state.throwAfterWrite=false;assert.equal((await action.allocate()).success,false);assert.deepEqual(await sql.snapshot(),after);
    });
    await context.test('private shared helpers stay closed while authenticated public delegates remain available',async()=>{
      const rights=(await db.query(`select
        has_function_privilege('authenticated','public.allocate_billet_to_order(uuid,uuid)','execute') public_allocate,
        has_function_privilege('anon','public.allocate_billet_to_order(uuid,uuid)','execute') anonymous_allocate,
        has_function_privilege('authenticated','private.assign_billet_to_order(uuid,uuid,boolean)','execute') shared_writer,
        has_function_privilege('anon','private.assign_billet_to_order(uuid,uuid,boolean)','execute') anonymous_shared_writer,
        has_function_privilege('authenticated','private.order_profile_needs_billet_allocation(uuid,uuid,uuid)','execute') profile_helper`)).rows[0];
      assert.deepEqual(rights,{public_allocate:true,anonymous_allocate:false,shared_writer:false,anonymous_shared_writer:false,profile_helper:false});
    });
    await context.test('a late projection failure rolls back the billet move and both order counters',async()=>{
      await sql.reset();await sql.seedAllocation();const before=await sql.snapshot();
      await db.exec(`create function public.fail_manual_projection() returns trigger language plpgsql as $$begin
        if new.id='${sql.orderId}' and exists(select 1 from foundry_billets where id='${f.legacyBillet}' and order_id=new.id) then
          raise exception 'Synthetic late projection failure';end if;return new;end;$$;
        create trigger zz_test_manual_projection before update on orders for each row execute function public.fail_manual_projection();`);
      try{await assert.rejects(sql.reallocate(f.legacyBillet),/late projection/);assert.deepEqual(await sql.snapshot(),before);}
      finally{await db.exec('drop trigger zz_test_manual_projection on orders;drop function public.fail_manual_projection();');}
    });
    await context.test('same-material requirements choose the profile with remaining production despite an older completed profile',async()=>{
      await sql.reset({quantityScale:20,secondTemper:'T6'});
      await sql.seedAllocation({billetId:id(900),order:sql.orderId,profile:f.t5Profile});
      await sql.seedAllocation({billetId:id(901),order:sql.orderId,profile:f.t6Profile});
      await db.query("update order_billet_requirements set created_at=case when profile_id=$1 then timestamp '2000-01-01' else timestamp '2001-01-01' end where order_id=$2",[f.t5Profile,sql.orderId]);
      await sql.seedJob({profile:f.t5Profile,status:'completed'});await sql.seedJob({profile:f.t6Profile,status:'planned'});await sql.stage('dispatched');await sql.insertBillet({temper:'T6'});
      const result=await sql.allocate();assert.equal((await sql.requirements()).find(row=>row.id===result.rows[0].id).profile_id,f.t6Profile);
    });
  }finally{await sql.close();}
});
