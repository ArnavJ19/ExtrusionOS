import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createManualBilletAllocationFixture,manualBilletIds as f} from '../scripts/lib/manual-billet-allocation-fixture.mjs';
import {fixtureId as id} from '../scripts/lib/direct-order-fixture.mjs';

const migration='20261020090729_priority_billet_allocation_integrity.sql';
const source=readFileSync(new URL(`../supabase/migrations/${migration}`,import.meta.url),'utf8');

test('automatic allocation shares manual material and per-profile eligibility',async context=>{
  const fixture=await createManualBilletAllocationFixture(),{db}=fixture;
  try{
    await db.exec(source);
    async function seed(options){
      await fixture.reset(options);
      await fixture.stage('delivered',fixture.sourceOrderId);
    }
    for(const [alloy,temper]of [[' 6063 ','T6'],['6063',' t6 '],[' 6063 ',' t6 ']])await context.test(`automatic allocation accepts normalized ${JSON.stringify(alloy)}/${JSON.stringify(temper)}`,async()=>{
      await seed();await fixture.insertBillet({temper:'T6'});
      await db.query('update foundry_billets set alloy=$1,temper=$2 where id=$3',[alloy,temper,f.freeBillet]);
      const before=await fixture.billet();await fixture.priority();const after=await fixture.billet();
      assert.equal(after.order_id,fixture.orderId);assert.equal(after.status,'allocated');
      assert.equal((await fixture.requirements()).find(row=>row.id===after.allocation_requirement_id).profile_id,f.t6Profile);
      for(const key of ['weight_kg','billet_length_mm','billet_diameter_inch','source_type','production_job_id'])assert.deepEqual(after[key],before[key],key);
    });
    await context.test('remaining work on one dispatched profile cannot allocate to another completed profile',async()=>{
      await seed();
      await fixture.seedJob({profile:f.t5Profile,status:'completed'});
      await fixture.stage('dispatched');await fixture.insertBillet({temper:'T5'});
      const before=await fixture.billet();await fixture.priority();
      assert.deepEqual(await fixture.billet(),before);
      assert.equal((await fixture.requirements()).find(row=>row.profile_id===f.t5Profile).billets_allocated,0);
    });
    await context.test('a complete dispatched order cannot take a new billet',async()=>{
      await seed();await fixture.seedJob({profile:f.t5Profile,status:'completed'});await fixture.seedJob({profile:f.t6Profile,status:'completed'});
      await fixture.stage('dispatched');await fixture.insertBillet({temper:'T6'});const before=await fixture.billet();
      await fixture.priority();assert.deepEqual(await fixture.billet(),before);
    });
    for(const status of ['planned','ready','in_progress','on_hold'])await context.test(`a matching ${status} job retains dispatched-profile allocation eligibility`,async()=>{
      await seed({secondTemper:'T6'});await fixture.seedJob({profile:f.t5Profile,status:'completed'});
      await fixture.seedJob({profile:f.t6Profile,status});await fixture.stage('dispatched');await fixture.insertBillet({temper:'T6'});
      await fixture.priority();const after=await fixture.billet();
      assert.equal((await fixture.requirements()).find(row=>row.id===after.allocation_requirement_id).profile_id,f.t6Profile);
    });
    for(const stage of ['closed','cancelled','delivered','payment_pending'])await context.test(`${stage} orders do not receive stock`,async()=>{
      await seed();await fixture.stage(stage);await fixture.insertBillet({temper:'T6'});const before=await fixture.billet();
      await fixture.priority();assert.deepEqual(await fixture.billet(),before);
    });
    for(const [label,patch]of [['alloy',"alloy='6061'"],['temper',"temper='T4'"],['diameter','billet_diameter_inch=8']])await context.test(`incompatible ${label} is excluded rather than altered to fit`,async()=>{
      await seed();await fixture.insertBillet({temper:'T6'});await db.query(`update foundry_billets set ${patch} where id=$1`,[f.freeBillet]);
      const before=await fixture.billet();await fixture.priority();assert.deepEqual(await fixture.billet(),before);
    });
    for(const status of ['planned','issued','consumed','scrap','cancelled'])await context.test(`${status} billets are not selected from free cast stock`,async()=>{
      await seed();await fixture.insertBillet({temper:'T6',status});const before=await fixture.billet();
      await fixture.priority();assert.deepEqual(await fixture.billet(),before);
    });
    await context.test('higher-priority orders keep precedence over older ordinary work',async()=>{
      await fixture.reset();await db.query("update orders set priority='urgent' where id=$1",[fixture.orderId]);
      await fixture.insertBillet({temper:'T6'});await fixture.priority();assert.equal((await fixture.billet()).order_id,fixture.orderId);
    });
    await context.test('earlier dispatch dates decide otherwise equal order priorities',async()=>{
      await fixture.reset();await db.query("update orders set expected_dispatch_date=case when id=$1 then date '2026-10-22' else date '2026-10-23' end",[fixture.orderId]);
      await fixture.insertBillet({temper:'T6'});await fixture.priority();assert.equal((await fixture.billet()).order_id,fixture.orderId);
    });
    await context.test('the existing in-house source preference is retained',async()=>{
      await seed();await fixture.insertBillet({id:f.freeBillet,temper:'T6',source:'outsourced',created:'2026-10-01'});
      await fixture.insertBillet({id:id(203),temper:'T6',source:'in_house',created:'2026-10-19'});await fixture.priority();
      assert.equal((await fixture.billet(f.freeBillet)).status,'cast');assert.equal((await fixture.billet(id(203))).order_id,fixture.orderId);
    });
    await context.test('oldest stock within the preferred source is selected first',async()=>{
      await seed();await fixture.insertBillet({id:f.freeBillet,temper:'T6',created:'2026-10-19'});
      await fixture.insertBillet({id:id(203),temper:'T6',created:'2026-10-01'});await fixture.priority();
      assert.equal((await fixture.billet(f.freeBillet)).status,'cast');assert.equal((await fixture.billet(id(203))).order_id,fixture.orderId);
    });
    await context.test('actual links prevent excess allocation on repeated automatic runs',async()=>{
      await seed();await fixture.insertBillet({id:f.freeBillet,temper:'T6'});await fixture.insertBillet({id:id(203),temper:'T6'});
      await fixture.priority();const once=await fixture.snapshot();await fixture.priority();assert.deepEqual(await fixture.snapshot(),once);
      assert.equal(once.billets.filter(row=>row.status==='allocated').length,1);
    });
    for(const role of ['owner','admin','factory_manager','production_manager','production'])await context.test(`${role} can enter the allocator through its internal business-role gate`,async()=>{
      await seed();await fixture.insertBillet({temper:'T6'});await db.query('update app_users set role=$1 where id=$2',[role,f.actor]);
      await fixture.priority();assert.equal((await fixture.billet()).order_id,fixture.orderId);
    });
    for(const role of ['sales','accounts','inventory_manager','quality','dispatch','viewer',null])await context.test(`${role??'missing role'} fails the allocator business-role gate without stock changes`,async()=>{
      await seed();await fixture.insertBillet({temper:'T6'});await db.query('update app_users set role=$1 where id=$2',[role,f.actor]);const before=await fixture.snapshot();
      await assert.rejects(fixture.priority(),/Permission denied/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('another company cannot run allocation for the current company',async()=>{
      await seed();await fixture.insertBillet({temper:'T6'});await db.exec(`set test.actor='${f.otherActor}';`);const before=await fixture.snapshot();
      await assert.rejects(fixture.priority(),/outside the active company/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('an inactive identity cannot run company allocation',async()=>{
      await seed();await fixture.insertBillet({temper:'T6'});await db.query('update app_users set is_active=false where id=$1',[f.actor]);const before=await fixture.snapshot();
      await assert.rejects(fixture.priority(),/outside the active company/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('both client database roles remain unable to call the internal writer directly',async()=>{
      await seed();for(const role of ['anon','authenticated']){
        await db.exec(`set role ${role};`);
        try{await assert.rejects(fixture.priority(),/permission denied for function/);}finally{await db.exec('reset role;');}
      }
      const rights=(await db.query(`select p.prosecdef,p.proconfig,
        has_function_privilege('anon',p.oid,'execute') anonymous,
        has_function_privilege('authenticated',p.oid,'execute') authenticated,
        has_function_privilege('authenticated','private.order_profile_needs_billet_allocation(uuid,uuid,uuid)','execute') private_helper
        from pg_proc p where p.oid='public.allocate_billets_by_priority(uuid)'::regprocedure`)).rows[0];
      assert.deepEqual(rights,{prosecdef:true,proconfig:['search_path=public, private'],anonymous:false,authenticated:false,private_helper:false});
    });
    await context.test('a late material write failure rolls back earlier allocations and counters',async()=>{
      await seed();await fixture.insertBillet({temper:'T5'});await fixture.insertBillet({id:id(203),temper:'T6'});
      await db.query("update order_billet_requirements set created_at=case when profile_id=$1 then now()-interval '1 day' else now() end where order_id=$2",[f.t5Profile,fixture.orderId]);
      await db.exec(`create function public.fail_later_priority_allocation() returns trigger language plpgsql as $$
        begin if new.status='allocated' and new.temper='T6' then raise exception 'Injected later allocation failure';end if;return new;end;$$;
        create trigger fail_later_priority_allocation before update on foundry_billets for each row execute function public.fail_later_priority_allocation();`);
      const before=await fixture.snapshot();await assert.rejects(fixture.priority(),/Injected later allocation failure/);assert.deepEqual(await fixture.snapshot(),before);
    });
  }finally{await fixture.close();}
});

test('the whole forward migration and a committed allocation can be replayed without another stock change',async()=>{
  const fixture=await createManualBilletAllocationFixture(),{db}=fixture;
  try{
    await db.exec(source);await db.exec(source);
    await fixture.reset();await fixture.stage('delivered',fixture.sourceOrderId);await fixture.insertBillet({temper:' T6 '});await fixture.priority();
    await db.exec('commit;begin;');const once=await fixture.snapshot();await fixture.priority();await db.exec('commit;begin;');
    assert.deepEqual(await fixture.snapshot(),once);assert.equal((await fixture.billet()).status,'allocated');
  }finally{await fixture.close();}
});
