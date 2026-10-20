import assert from 'node:assert/strict';
import test from 'node:test';
import {createManualBilletAllocationFixture,manualBilletIds as f} from '../scripts/lib/manual-billet-allocation-fixture.mjs';
import {fixtureId as id} from '../scripts/lib/direct-order-fixture.mjs';

test('manual billet allocation uses actual requirement and production lineage',async context=>{
  const fixture=await createManualBilletAllocationFixture(),{db}=fixture;
  try{
    await context.test('the billet schema has no invented profile column',async()=>{
      assert.equal((await db.query("select count(*)::integer count from information_schema.columns where table_schema='public' and table_name='foundry_billets' and column_name='profile_id'")).rows[0].count,0);
    });
    for(const quoted of [false,true])await context.test(`${quoted?'quoted':'priced direct'} orders accept a compatible cast billet through the actual authenticated wrapper`,async()=>{
      await fixture.reset({quoted});await fixture.insertBillet({temper:'T6'});const before=await fixture.billet(),result=await fixture.allocate(),saved=await fixture.billet();
      assert.equal(saved.order_id,fixture.orderId);assert.equal(saved.status,'allocated');assert.equal(saved.allocation_requirement_id,result.rows[0].id);
      assert.equal((await fixture.requirements()).find(row=>row.id===saved.allocation_requirement_id).profile_id,f.t6Profile);
      for(const key of ['weight_kg','billet_length_mm','billet_diameter_inch','source_type','foundry_batch_id','outsourced_batch_id','production_job_id'])assert.deepEqual(saved[key],before[key],key);
    });
    await context.test('cast reallocation uses the same actual schema and requirement identity',async()=>{
      await fixture.reset();await fixture.insertBillet({temper:'T6'});const result=await fixture.reallocate();assert.equal((await fixture.billet()).allocation_requirement_id,result.rows[0].id);
    });
    await context.test('moving an allocated billet refreshes both orders without creating or consuming stock',async()=>{
      await fixture.reset();await fixture.seedAllocation();const before=await fixture.billet(f.legacyBillet),result=await fixture.reallocate(f.legacyBillet),after=await fixture.billet(f.legacyBillet);
      assert.equal(after.order_id,fixture.orderId);assert.equal(after.allocation_requirement_id,result.rows[0].id);assert.equal(after.weight_kg,before.weight_kg);
      assert.equal((await fixture.requirements(fixture.sourceOrderId)).find(row=>row.profile_id===f.t6Profile).billets_allocated,0);
      assert.equal((await fixture.requirements()).find(row=>row.profile_id===f.t6Profile).billets_allocated,1);
      assert.equal((await fixture.snapshot()).billets.length,1);
    });
    for(const role of ['owner','admin','factory_manager','production_manager','production'])await context.test(`${role} can allocate using the authenticated public wrapper`,async()=>{
      await fixture.reset();await fixture.insertBillet({temper:'T6'});await db.query('update app_users set role=$1 where id=$2',[role,f.actor]);await fixture.allocate();assert.equal((await fixture.billet()).order_id,fixture.orderId);
    });
    for(const role of ['sales','accounts','quality','inventory_manager','dispatch','viewer','dealer_admin',null])await context.test(`${role??'missing role'} cannot allocate or reallocate`,async()=>{
      await fixture.reset();await fixture.insertBillet({temper:'T6'});await db.query('update app_users set role=$1 where id=$2',[role,f.actor]);const before=await fixture.snapshot();
      await assert.rejects(fixture.allocate(),/permission/i);await assert.rejects(fixture.reallocate(),/permission/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    for(const stage of ['closed','cancelled','delivered','payment_pending'])await context.test(`${stage} target orders remain unavailable for allocation`,async()=>{
      await fixture.reset();await fixture.stage(stage);await fixture.insertBillet({temper:'T6'});const before=await fixture.snapshot();
      await assert.rejects(fixture.allocate(),/not open|no remaining production|not available/i);await assert.rejects(fixture.reallocate(),/not open|no remaining production|not available/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    for(const status of ['planned','allocated','issued','consumed','scrap','cancelled'])await context.test(`${status} stock is not newly allocated as an unallocated cast billet`,async()=>{
      await fixture.reset();await fixture.insertBillet({status,temper:'T6'});const before=await fixture.snapshot();await assert.rejects(fixture.allocate(),/unallocated cast|available/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    for(const [name,change]of [['alloy',"alloy='6061'"],['temper',"temper='T4'"],['diameter','billet_diameter_inch=8']])await context.test(`incompatible ${name} is rejected without altering the billet`,async()=>{
      await fixture.reset();await fixture.insertBillet({temper:'T6'});await db.query(`update foundry_billets set ${change} where id=$1`,[f.freeBillet]);const before=await fixture.snapshot();
      await assert.rejects(fixture.allocate(),/match|compatible/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('the target company is derived from the active identity',async()=>{
      await fixture.reset();const other=await fixture.createOrder({otherCompany:true});await fixture.insertBillet({temper:'T6'});const before=await fixture.snapshot();await assert.rejects(fixture.allocate(f.freeBillet,other),/Order not found/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('an inactive identity cannot allocate through the actual wrapper',async()=>{
      await fixture.reset();await fixture.insertBillet({temper:'T6'});await db.query('update app_users set is_active=false where id=$1',[f.actor]);const before=await fixture.snapshot();await assert.rejects(fixture.allocate(),/Authentication/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('unknown and null billet identities cannot mutate other stock',async()=>{
      await fixture.reset();const before=await fixture.snapshot();for(const key of [id(999),null])await assert.rejects(fixture.allocate(key),/Billet not found/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('dispatched orders still allow unplanned production for the matching requirement',async()=>{
      await fixture.reset();await fixture.stage('dispatched');await fixture.insertBillet({temper:'T6'});await fixture.allocate();assert.equal((await fixture.billet()).order_id,fixture.orderId);
    });
    await context.test('fully committed dispatched production uses the matching active job rather than a billet profile column',async()=>{
      await fixture.reset({secondTemper:'T6'});await fixture.seedJob({profile:f.t5Profile,status:'completed'});await fixture.seedJob({profile:f.t6Profile,status:'planned'});await fixture.stage('dispatched');await fixture.insertBillet({temper:'T6'});
      await fixture.allocate();const saved=await fixture.billet();assert.equal((await fixture.requirements()).find(row=>row.id===saved.allocation_requirement_id).profile_id,f.t6Profile);
    });
    await context.test('fully covered dispatched orders cannot take another billet',async()=>{
      await fixture.reset();await fixture.seedJob({profile:f.t5Profile,status:'completed'});await fixture.seedJob({profile:f.t6Profile,status:'completed'});await fixture.stage('dispatched');await fixture.insertBillet({temper:'T6'});const before=await fixture.snapshot();
      await assert.rejects(fixture.allocate(),/no remaining production|eligible|compatible/);assert.deepEqual(await fixture.snapshot(),before);
    });
  }finally{await fixture.close();}
});
