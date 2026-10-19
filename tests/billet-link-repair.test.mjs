import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createBilletLinkRepairFixture,installBilletLinkRepairObjects,billetLinkIds as f} from '../scripts/lib/billet-link-repair-fixture.mjs';
import {fixtureId as id} from '../scripts/lib/direct-order-fixture.mjs';

test('legacy billet link repair respects material compatibility and actual linked counts',async context=>{
  const fixture=await createBilletLinkRepairFixture();
  const requirement=async temper=>(await fixture.db.query('select * from order_billet_requirements where order_id=$1 and temper=$2',[fixture.orderId,temper])).rows[0];
  const billet=async billetId=>(await fixture.db.query('select * from foundry_billets where id=$1',[billetId])).rows[0];
  try{
    await context.test('an older T5 requirement does not capture or block the valid T6 legacy billet',async()=>{
      await fixture.reset();const t6=await requirement('T6');await fixture.repair();assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,t6.id);
    });
    await context.test('requirement refresh counts the matching repaired billet and retains the other shortage',async()=>{
      await fixture.reset();await fixture.refresh();const state=await fixture.snapshot();
      assert.equal(state.orders[0].billet_allocation_status,'partial');assert.equal(state.orders[0].billets_allocated,1);assert.equal(state.orders[0].billets_short,1);
      assert.equal((await requirement('T6')).status,'complete');assert.equal((await requirement('T5')).status,'shortage');
    });
    await context.test('priority allocation can fill T5 while the valid T6 legacy billet is repaired',async()=>{
      await fixture.reset();await fixture.insertBillet();await fixture.priority();const state=await fixture.snapshot();
      assert.equal(state.orders[0].billet_allocation_status,'complete');assert.equal(state.orders[0].billets_allocated,2);assert.equal(state.orders[0].billets_short,0);
      assert.equal((await billet(f.freeBillet)).allocation_requirement_id,(await requirement('T5')).id);
      assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,(await requirement('T6')).id);
    });
    await context.test('quoted material generation supplies the same mixed-temper repair contract as direct entry',async()=>{
      await fixture.reset({legacy:false});
      await fixture.db.query("insert into quotes(id,company_id,customer_id,quote_number,status,grand_total) values($1,$2,$3,'QUOTE-REPAIR','customer_approved',28762.50)",[id(300),f.company,f.customer]);
      for(const [lineId,profile,weight]of [[id(301),f.t5Profile,67.5],[id(302),f.t6Profile,30]])await fixture.db.query(
        "insert into quote_items(id,company_id,quote_id,profile_id,total_weight_kg,billing_weight_kg,drawing_approval_status)values($1,$2,$3,$4,$5,$5,'Approved')",[lineId,f.company,id(300),profile,weight]);
      await fixture.db.query("insert into orders(id,company_id,customer_id,quote_id,order_number,current_stage,manufacturing_weight_kg,production_quantity_kg,priority)values($1,$2,$3,$4,'QUOTED-REPAIR','order_confirmed',97.5,97.5,'normal')",[id(303),f.company,f.customer,id(300)]);
      const requirements=(await fixture.db.query('select * from order_billet_requirements where order_id=$1 order by temper',[id(303)])).rows;
      assert.equal(requirements.length,2);assert.equal(Number(requirements[0].required_weight_kg),67.5);assert.equal(Number(requirements[1].required_weight_kg),30);
      await fixture.db.query("update order_billet_requirements set created_at=case when temper='T5' then now()-interval '1 day' else now() end where order_id=$1",[id(303)]);
      await fixture.insertBillet({id:f.legacyBillet,status:'allocated',order:id(303),temper:'T6'});
      await fixture.attempt(()=>fixture.db.query('select public.refresh_order_billet_allocations($1)',[id(303)]));
      assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,requirements.find(row=>row.temper==='T6').id);
      assert.equal((await fixture.db.query('select billet_allocation_status from orders where id=$1',[id(303)])).rows[0].billet_allocation_status,'partial');
    });
    for(const status of ['issued','consumed'])await context.test(`${status} legacy stock follows its production profile when requirements share material identity`,async()=>{
      await fixture.reset({legacy:false,secondTemper:'T6'});
      const line=(await fixture.db.query('select id from order_items where order_id=$1 and profile_id=$2',[fixture.orderId,f.t6Profile])).rows[0].id;
      await fixture.db.query("insert into production_jobs(id,company_id,order_id,profile_id,source_line_id,status,planned_quantity_kg)values($1,$2,$3,$4,$5,'planned',30)",[id(400),f.company,fixture.orderId,f.t6Profile,line]);
      await fixture.insertBillet({id:f.legacyBillet,status,order:fixture.orderId,temper:'T6'});await fixture.db.query('update foundry_billets set production_job_id=$1 where id=$2',[id(400),f.legacyBillet]);
      const jobs=(await fixture.db.query('select * from production_jobs order by id')).rows;await fixture.refresh();
      const target=(await fixture.db.query('select id from order_billet_requirements where order_id=$1 and profile_id=$2',[fixture.orderId,f.t6Profile])).rows[0].id;
      assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,target);assert.deepEqual((await fixture.db.query('select * from production_jobs order by id')).rows,jobs);
      assert.equal((await billet(f.legacyBillet)).status,status);
    });
    for(const status of ['allocated','issued','consumed'])await context.test(`actual ${status} links prevent a stale low counter from overfilling a requirement`,async()=>{
      await fixture.reset();const t6=await requirement('T6');await fixture.db.query("update order_billet_requirements set status='cancelled' where order_id=$1 and temper='T5'",[fixture.orderId]);
      await fixture.insertBillet({id:id(203),status,order:fixture.orderId,requirement:t6.id,temper:'T6'});await fixture.repair();
      assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,null);assert.equal((await billet(id(203))).allocation_requirement_id,t6.id);
    });
    await context.test('a stale high counter cannot hide a real unlinked compatible billet',async()=>{
      await fixture.reset();const t6=await requirement('T6');await fixture.db.query("update order_billet_requirements set billets_allocated=99 where id=$1",[t6.id]);await fixture.repair();
      assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,t6.id);
    });
    await context.test('repair retries never move a second legacy billet beyond the actual requirement',async()=>{
      await fixture.reset();await fixture.insertBillet({id:id(203),status:'allocated',order:fixture.orderId,temper:'T6',created:'2026-10-18'});
      await fixture.repair();const once=await fixture.snapshot();await fixture.repair();assert.deepEqual(await fixture.snapshot(),once);
      assert.equal(once.billets.filter(row=>row.allocation_requirement_id===(once.requirements.find(row=>row.temper==='T6').id)).length,1);
      assert.equal((await billet(id(203))).allocation_requirement_id,null);
    });
    for(const temper of ['t6',' T6 ',' t6 '])await context.test(`legacy temper ${JSON.stringify(temper)} uses the same normalization as the lineage guard`,async()=>{
      await fixture.reset({temper});await fixture.repair();assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,(await requirement('T6')).id);
    });
    for(const [label,change]of [['temper',"temper='T4'"],['alloy',"alloy='6061'"],['diameter','billet_diameter_inch=8']])await context.test(`an incompatible legacy ${label} stays unlinked without blocking other requirements`,async()=>{
      await fixture.reset();await fixture.db.query(`update foundry_billets set ${change} where id=$1`,[f.legacyBillet]);const before=await billet(f.legacyBillet);
      await fixture.repair();assert.deepEqual(await billet(f.legacyBillet),before);
    });
    await context.test('link repair preserves physical quantities, source, dates and issued identity',async()=>{
      await fixture.reset();const before=await billet(f.legacyBillet);await fixture.repair();const after=await billet(f.legacyBillet);
      for(const key of Object.keys(before).filter(key=>!['allocation_requirement_id','updated_at'].includes(key)))assert.deepEqual(after[key],before[key],key);
    });
    for(const status of ['cast','scrap','cancelled'])await context.test(`${status} stock is not newly attached by legacy link repair`,async()=>{
      await fixture.reset();await fixture.db.query('update foundry_billets set status=$1 where id=$2',[status,f.legacyBillet]);const before=await billet(f.legacyBillet);
      await fixture.repair();assert.deepEqual(await billet(f.legacyBillet),before);
    });
    for(const status of ['cast','scrap','cancelled'])await context.test(`a retained ${status} historical link does not consume an active requirement slot`,async()=>{
      await fixture.reset();const t6=await requirement('T6');await fixture.insertBillet({id:id(203),status,order:fixture.orderId,requirement:t6.id,temper:'T6'});
      await fixture.repair();assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,t6.id);
      assert.equal((await billet(id(203))).status,status);
    });
    await context.test('a cancelled requirement is never reopened or linked by the repair helper',async()=>{
      await fixture.reset();const t6=await requirement('T6');await fixture.db.query("update order_billet_requirements set status='cancelled' where id=$1",[t6.id]);
      await fixture.repair();assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,null);assert.equal((await requirement('T6')).status,'cancelled');
    });
    await context.test('the established allocation-date ordering wins over a newer creation timestamp',async()=>{
      await fixture.reset();await fixture.db.query("update foundry_billets set allocated_at='2026-10-18' where id=$1",[f.legacyBillet]);
      await fixture.insertBillet({id:id(203),status:'allocated',order:fixture.orderId,temper:'T6',created:'2026-10-18'});
      await fixture.db.query("update foundry_billets set allocated_at='2026-10-16' where id=$1",[id(203)]);await fixture.repair();
      assert.equal((await billet(id(203))).allocation_requirement_id,(await requirement('T6')).id);assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,null);
    });
    await context.test('a different order and company retain their own unlinked billet and requirement',async()=>{
      await fixture.reset();await fixture.db.exec(`set test.actor='${f.otherActor}';update app_users set role='owner' where id='${f.otherActor}';`);
      const other=(await fixture.db.query('select public.create_direct_order_atomic($1,$2,$3) id',[
        {customer_id:id(11),order_date:'2026-10-19',priority:'normal'},
        [{profile_id:id(22),quantity_pieces:10,length_per_piece_m:6,expected_section_weight_kg_per_m:.5,net_rate:250,gst_percent:18,hsn_code:'760421',finishing_type:'mill_finish'}],id(204)])).rows[0].id;
      await fixture.insertBillet({id:id(205),company:f.otherCompany,status:'allocated',order:other,temper:'T6'});
      const before=await billet(id(205));await fixture.db.exec(`set test.actor='${f.actor}';`);await fixture.repair();
      assert.deepEqual(await billet(id(205)),before);assert.equal((await fixture.db.query('select billets_allocated from order_billet_requirements where order_id=$1',[other])).rows[0].billets_allocated,0);
      assert.equal((await billet(f.legacyBillet)).allocation_requirement_id,(await requirement('T6')).id);
    });
    for(const role of ['owner','admin','factory_manager','production_manager','production'])await context.test(`${role}'s real order refresh trigger can complete mixed-temper allocation`,async()=>{
      await fixture.reset();await fixture.insertBillet();await fixture.db.query('update app_users set role=$1 where id=$2',[role,f.actor]);
      await fixture.attempt(()=>fixture.db.query("update orders set priority='high' where id=$1",[fixture.orderId]));
      assert.equal((await fixture.snapshot()).orders[0].billet_allocation_status,'complete');
    });
    await context.test('a late lineage failure rolls back earlier repaired links and all counters',async()=>{
      await fixture.reset();await fixture.insertBillet({id:id(203),status:'allocated',order:fixture.orderId,temper:'T5'});
      await fixture.db.exec(`create function public.fixture_repair_failure() returns trigger language plpgsql as $$begin
        if new.temper='T6' and new.allocation_requirement_id is not null then raise exception 'Synthetic late link failure';end if;return new;end;$$;
        create trigger zz_fixture_repair_failure before update on foundry_billets for each row execute function public.fixture_repair_failure();`);
      const before=await fixture.snapshot();await assert.rejects(fixture.repair(),/Synthetic late link failure/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('historical review identifies unlinked and overfilled evidence without rewriting rows',async()=>{
      await fixture.reset();const t6=await requirement('T6');
      for(const billetId of [id(203),id(204)])await fixture.insertBillet({id:billetId,status:'allocated',order:fixture.orderId,requirement:t6.id,temper:'T6'});
      await fixture.insertBillet({id:id(205),status:'allocated',order:fixture.orderId,requirement:t6.id,temper:'T6'});
      await fixture.db.exec('alter table foundry_billets disable trigger user;');await fixture.db.query('update foundry_billets set order_id=null where id=$1',[id(205)]);await fixture.db.exec('alter table foundry_billets enable trigger user;');
      const before=await fixture.snapshot(),review=readFileSync(new URL('../sql/audit-billet-allocation-links.sql',import.meta.url),'utf8');
      await fixture.db.exec('create role billet_review_reader;grant usage on schema public to billet_review_reader;grant select on foundry_billets,order_billet_requirements,production_jobs to billet_review_reader;set role billet_review_reader;');
      let results;try{results=await fixture.db.exec(review);}finally{await fixture.db.exec('reset role;');}
      assert.ok(results[0].rows.some(row=>row.billet_id===f.legacyBillet&&row.review_reason==='unlinked_legacy_billet'));
      assert.ok(results[0].rows.some(row=>row.billet_id===id(205)&&row.review_reason==='inconsistent_scope'));
      assert.ok(results[1].rows.some(row=>row.requirement_id===t6.id&&row.actual_linked_count===2));assert.deepEqual(await fixture.snapshot(),before);
    });
    for(const [label,change]of [['temper',"temper='T4'"],['company',`company_id='${f.otherCompany}'`],['order',`order_id='${id(999)}'`],['missing order','order_id=null']])await context.test(`an inconsistent retained ${label} link requires review rather than being counted as verified`,async()=>{
      await fixture.reset();const t6=await requirement('T6');await fixture.insertBillet({id:id(203),status:'allocated',order:fixture.orderId,requirement:t6.id,temper:'T6'});
      // Inject impossible legacy evidence only inside the disposable fixture, then restore its writer guard.
      await fixture.db.exec('alter table foundry_billets disable trigger user;');await fixture.db.query(`update foundry_billets set ${change} where id=$1`,[id(203)]);await fixture.db.exec('alter table foundry_billets enable trigger user;');
      const before=await fixture.snapshot();await assert.rejects(fixture.refresh(),/review historical allocation evidence/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('reinstalling the extracted candidate preserves data and closed helper execution',async()=>{
      await fixture.reset();await fixture.refresh();const before=await fixture.snapshot();assert.deepEqual(await installBilletLinkRepairObjects(fixture.db),{functions:1,triggers:0});assert.deepEqual(await fixture.snapshot(),before);
      assert.equal((await fixture.db.query("select has_function_privilege('authenticated','public.repair_order_billet_requirement_links(uuid)','execute') allowed")).rows[0].allowed,false);
    });
    await context.test('a retained link to the wrong production profile is rejected and reported without rewriting history',async()=>{
      await fixture.reset({legacy:false,secondTemper:'T6'});
      const line=(await fixture.db.query('select id from order_items where order_id=$1 and profile_id=$2',[fixture.orderId,f.t5Profile])).rows[0].id;
      await fixture.db.query("insert into production_jobs(id,company_id,order_id,profile_id,source_line_id,status,planned_quantity_kg)values($1,$2,$3,$4,$5,'planned',67.5)",[id(400),f.company,fixture.orderId,f.t5Profile,line]);
      const target=(await fixture.db.query('select id from order_billet_requirements where order_id=$1 and profile_id=$2',[fixture.orderId,f.t6Profile])).rows[0].id;
      await fixture.insertBillet({id:f.legacyBillet,status:'consumed',order:fixture.orderId,requirement:target,temper:'T6'});
      await fixture.db.exec('alter table foundry_billets disable trigger user;');await fixture.db.query('update foundry_billets set production_job_id=$1 where id=$2',[id(400),f.legacyBillet]);await fixture.db.exec('alter table foundry_billets enable trigger user;');
      const before=await fixture.snapshot();await assert.rejects(fixture.refresh(),/review historical allocation evidence/);
      const review=await fixture.db.exec(readFileSync(new URL('../sql/audit-billet-allocation-links.sql',import.meta.url),'utf8'));
      assert.ok(review[0].rows.some(row=>row.billet_id===f.legacyBillet&&row.production_job_id===id(400)&&row.review_reason==='inconsistent_production_identity'));
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test('catalog preflight verifies the internal-only security-definer repair body',async()=>{
      await fixture.reset();const source=readFileSync(new URL('../sql/audit-deployment-preflight.sql',import.meta.url),'utf8'),start=source.indexOf('-- R21 link repair');assert.ok(start>=0);
      const row=(await fixture.db.query(source.slice(start,source.indexOf(';',start)+1))).rows[0];
      assert.equal(row.present,true);assert.equal(row.security_definer,true);assert.equal(row.authenticated_execute,false);assert.equal(row.anonymous_execute,false);assert.match(row.definition_md5,/^[a-f0-9]{32}$/);
    });
    await context.test('direct and anonymous execution of the internal repair helper remain closed',async()=>{
      await fixture.reset();for(const role of ['authenticated','anon']){
        assert.equal((await fixture.db.query("select has_function_privilege($1,'public.repair_order_billet_requirement_links(uuid)','execute') allowed",[role])).rows[0].allowed,false);
        await fixture.db.exec(`set role ${role};`);try{await assert.rejects(fixture.repair(),/permission denied/);}finally{await fixture.db.exec('reset role;');}
      }
    });
    await context.test('a committed later retry retains the same links and physical stock evidence',async()=>{
      await fixture.reset();await fixture.insertBillet();await fixture.priority();const before=await fixture.snapshot();await fixture.db.exec('commit;begin;');
      await fixture.repair();await fixture.refresh();assert.deepEqual(await fixture.snapshot(),before);
    });
  }finally{await fixture.close();}
});
