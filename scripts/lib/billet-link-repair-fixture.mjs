import {existsSync,readFileSync} from 'node:fs';
import {createDirectOrderFixture,fixtureId as id} from './direct-order-fixture.mjs';
import {createHistoricalTables,sqlDefinition} from './historical-schema-fixture.mjs';

export const billetLinkCandidate='20261019050000_billet_link_repair_integrity.sql';
export const billetLinkIds={company:id(1),otherCompany:id(2),actor:id(3),otherActor:id(4),customer:id(10),t6Profile:id(20),t5Profile:id(21),legacyBillet:id(201),freeBillet:id(202)};

export async function installBilletLinkRepairObjects(db){
  const source=readFileSync(new URL(`../../supabase/migrations/${billetLinkCandidate}`,import.meta.url),'utf8');
  await db.exec(sqlDefinition(billetLinkCandidate,'public.repair_order_billet_requirement_links'));
  for(const statement of source.match(/(?:revoke|grant)[^;]+;/gi)??[])await db.exec(statement);
  return {functions:1,triggers:0};
}

export async function createBilletLinkRepairFixture({candidate=existsSync(new URL(`../../supabase/migrations/${billetLinkCandidate}`,import.meta.url))}={}){
  const db=await createDirectOrderFixture(),f=billetLinkIds;
  try{
    await createHistoricalTables(db,['notifications'],billetLinkCandidate);
    for(const [file,names]of [
      ['20260515005600_order_billet_requirements_and_allocation.sql',['public.notify_billet_allocation']],
      ['20261008020000_factory_workflow_integrity.sql',['private.allocate_billet_to_order','private.reallocate_billet_to_order']],
      ['20260602000002_security_definer_access_hardening.sql',['public.allocate_billet_to_order','public.reallocate_billet_to_order']],
      ['20260718050000_customer_accepted_quote_orders.sql',['private.enforce_customer_accepted_quote_order_link']],
      ['20260812000000_security_and_notification_integrity.sql',['public.validate_foundry_billet_lineage']]
    ])for(const name of names)await db.exec(sqlDefinition(file,name));
    await db.exec(`create trigger validate_foundry_billet_lineage before insert or update of company_id,order_id,allocation_requirement_id,production_job_id,alloy,temper,billet_diameter_inch
      on foundry_billets for each row execute function public.validate_foundry_billet_lineage();
      create trigger enforce_customer_accepted_quote_order_link before insert or update of company_id,quote_id,customer_id on orders
        for each row execute function private.enforce_customer_accepted_quote_order_link();
      revoke all on function public.repair_order_billet_requirement_links(uuid),public.refresh_order_billet_allocations(uuid),public.allocate_billets_by_priority(uuid),public.validate_foundry_billet_lineage() from public,anon,authenticated;
      revoke all on function private.allocate_billet_to_order(uuid,uuid),private.reallocate_billet_to_order(uuid,uuid) from public,anon;
      grant execute on function private.allocate_billet_to_order(uuid,uuid),private.reallocate_billet_to_order(uuid,uuid) to authenticated;
      revoke all on function public.allocate_billet_to_order(uuid,uuid),public.reallocate_billet_to_order(uuid,uuid) from public,anon;
      grant execute on function public.allocate_billet_to_order(uuid,uuid),public.reallocate_billet_to_order(uuid,uuid) to authenticated;`);
    if(candidate)await installBilletLinkRepairObjects(db);
    let orderId;
    async function attempt(callback){
      await db.exec('savepoint billet_attempt;');try{const result=await callback();await db.exec('release savepoint billet_attempt;');return result;}
      catch(error){await db.exec('rollback to savepoint billet_attempt;release savepoint billet_attempt;');throw error;}
    }
    async function reset({legacy=true,temper='T6',secondTemper='T5'}={}){
      await db.exec(`rollback;begin;set test.actor='${f.actor}';update app_users set role='owner' where id='${f.actor}';
        update aluminium_profiles set alloy='6063',temper='T5',billet_diameter_required_inch=6 where id='${f.t5Profile}';`);
      await db.query('update aluminium_profiles set temper=$1 where id=$2',[secondTemper,f.t5Profile]);
      const lines=[{profile_id:f.t5Profile,quantity_pieces:10,length_per_piece_m:6,expected_section_weight_kg_per_m:1.125,net_rate:250,gst_percent:18,hsn_code:'760421',finishing_type:'mill_finish'},
        {profile_id:f.t6Profile,quantity_pieces:10,length_per_piece_m:6,expected_section_weight_kg_per_m:.5,net_rate:250,gst_percent:18,hsn_code:'760421',finishing_type:'mill_finish'}];
      orderId=(await db.query('select public.create_direct_order_atomic($1,$2,$3) id',[
        {customer_id:f.customer,order_date:'2026-10-19',priority:'normal',notes:'Synthetic mixed-temper repair'},lines,id(200)])).rows[0].id;
      await db.query("update order_billet_requirements set created_at=case when profile_id=$2 then now()-interval '1 day' else now() end where order_id=$1",[orderId,f.t5Profile]);
      if(legacy)await insertBillet({id:f.legacyBillet,status:'allocated',order:orderId,temper});
      return orderId;
    }
    async function insertBillet({id:billetId=f.freeBillet,status='cast',order=null,requirement=null,temper='T5',company=f.company,weight=285.666,length=5800,source='in_house',created='2026-10-17'}={}){
      await db.query(`insert into foundry_billets(id,company_id,billet_code,alloy,temper,billet_diameter_inch,billet_diameter_mm,billet_length_mm,weight_kg,
        status,order_id,allocation_requirement_id,source_type,created_at,allocated_at)values($1,$2,$3,'6063',$4,6,152.4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [billetId,company,`B-${billetId.slice(-3)}`,temper,length,weight,status,order,requirement,source,created,order?created:null]);
      return billetId;
    }
    const snapshot=async()=>({orders:(await db.query('select id,current_stage,billets_required,billets_allocated,billets_short,billet_allocation_status from orders order by id')).rows,
      requirements:(await db.query('select id,company_id,order_id,profile_id,alloy,temper,billet_diameter_inch,billets_required,billets_allocated,billets_short,status from order_billet_requirements order by temper,id')).rows,
      billets:(await db.query('select * from foundry_billets order by id')).rows,notifications:(await db.query('select * from notifications order by id')).rows});
    return {db,reset,attempt,insertBillet,snapshot,get orderId(){return orderId;},repair:()=>attempt(()=>db.query('select public.repair_order_billet_requirement_links($1)',[orderId])),
      refresh:()=>attempt(()=>db.query('select public.refresh_order_billet_allocations($1)',[orderId])),
      allocate:(billetId=f.freeBillet,target=orderId)=>attempt(()=>db.query('select public.allocate_billet_to_order($1,$2) id',[billetId,target])),
      reallocate:(billetId=f.freeBillet,target=orderId)=>attempt(()=>db.query('select public.reallocate_billet_to_order($1,$2) id',[billetId,target])),
      priority:()=>attempt(()=>db.query('select public.allocate_billets_by_priority($1)',[f.company])),close:()=>db.close()};
  }catch(error){await db.close();throw error;}
}
