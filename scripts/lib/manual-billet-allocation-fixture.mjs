import {existsSync,readFileSync} from 'node:fs';
import {createBilletLinkRepairFixture,billetLinkIds as f} from './billet-link-repair-fixture.mjs';
import {fixtureId as id} from './direct-order-fixture.mjs';
import {sqlDefinition} from './historical-schema-fixture.mjs';

export {f as manualBilletIds};
export const manualBilletCandidate='20261020000000_manual_billet_requirement_lineage.sql';

export async function installManualBilletAllocationObjects(db){
  const source=readFileSync(new URL(`../../supabase/migrations/${manualBilletCandidate}`,import.meta.url),'utf8');
  const names=[...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for(const name of names)await db.exec(sqlDefinition(manualBilletCandidate,name));
  for(const statement of source.match(/(?:revoke|grant)[^;]+;/gi)??[])await db.exec(statement);
  return {functions:names.length,triggers:0};
}

export async function createManualBilletAllocationFixture({candidate=existsSync(new URL(`../../supabase/migrations/${manualBilletCandidate}`,import.meta.url))}={}){
  const base=await createBilletLinkRepairFixture(),{db}=base;let targetId,sourceId,sequence=700;
  try{
    if(candidate)await installManualBilletAllocationObjects(db);
    async function createOrder({quantityScale=1,quoted=false,otherCompany=false}={}){
      const company=otherCompany?f.otherCompany:f.company,customer=otherCompany?id(11):f.customer;
      if(otherCompany)await db.exec(`set test.actor='${f.otherActor}';update app_users set role='owner' where id='${f.otherActor}';`);
      try{
        const profiles=(await db.query('select id,section_weight_kg_per_m from aluminium_profiles where company_id=$1 order by id',[company])).rows;
        const lines=profiles.map(profile=>({profile_id:profile.id,quantity_pieces:10*quantityScale,length_per_piece_m:6,
          expected_section_weight_kg_per_m:Number(profile.section_weight_kg_per_m),net_rate:250,gst_percent:18,hsn_code:'760421',finishing_type:'mill_finish'}));
        if(!quoted)return (await db.query('select public.create_direct_order_atomic($1,$2,$3) id',[
          {customer_id:customer,order_date:'2026-10-20',priority:'normal',notes:'Synthetic manual billet target'},lines,id(sequence++)])).rows[0].id;
        const quote=id(sequence++),order=id(sequence++),weight=lines.reduce((sum,line)=>sum+line.quantity_pieces*line.length_per_piece_m*line.expected_section_weight_kg_per_m,0);
        await db.query("insert into quotes(id,company_id,customer_id,quote_number,status,grand_total)values($1,$2,$3,$4,'customer_approved',$5)",[quote,company,customer,`Q-MANUAL-${sequence}`,weight*250*1.18]);
        for(const line of lines){const kg=line.quantity_pieces*line.length_per_piece_m*line.expected_section_weight_kg_per_m;await db.query(
          "insert into quote_items(id,company_id,quote_id,profile_id,billing_weight_kg,total_weight_kg,drawing_approval_status)values($1,$2,$3,$4,$5,$5,'Approved')",[id(sequence++),company,quote,line.profile_id,kg]);}
        await db.query("insert into orders(id,company_id,customer_id,quote_id,order_number,current_stage,production_quantity_kg,manufacturing_weight_kg,priority)values($1,$2,$3,$4,$5,'order_confirmed',$6,$6,'normal')",[order,company,customer,quote,`ORD-Q-MANUAL-${sequence}`,weight]);
        return order;
      }finally{if(otherCompany)await db.exec(`set test.actor='${f.actor}';`);}
    }
    async function reset({quantityScale=1,quoted=false,secondTemper='T5'}={}){
      await base.reset({legacy:false,secondTemper});sequence=700;sourceId=base.orderId;targetId=await createOrder({quantityScale,quoted});return targetId;
    }
    const requirements=async(order=targetId)=>(await db.query('select * from order_billet_requirements where order_id=$1 order by created_at,id',[order])).rows;
    const billet=async(billetId=f.freeBillet)=>(await db.query('select * from foundry_billets where id=$1',[billetId])).rows[0];
    async function asAuthenticated(callback){await db.exec('set role authenticated;');try{return await base.attempt(callback);}finally{await db.exec('reset role;');}}
    const allocate=(billetId=f.freeBillet,order=targetId)=>asAuthenticated(()=>db.query('select public.allocate_billet_to_order($1,$2) id',[billetId,order]));
    const reallocate=(billetId=f.freeBillet,order=targetId)=>asAuthenticated(()=>db.query('select public.reallocate_billet_to_order($1,$2) id',[billetId,order]));
    async function seedAllocation({billetId=f.legacyBillet,order=sourceId,profile=f.t6Profile,status='allocated'}={}){
      const req=(await requirements(order)).find(row=>row.profile_id===profile);if(!req)throw new Error('Fixture requirement missing');
      await base.insertBillet({id:billetId,status,order,requirement:req.id,temper:req.temper});
      await base.attempt(()=>db.query('select public.refresh_order_billet_allocations($1)',[order]));return billetId;
    }
    async function seedJob({order=targetId,profile=f.t6Profile,status='planned',weight=null}={}){
      const line=(await db.query('select id,quantity_kg from order_items where order_id=$1 and profile_id=$2 order by id limit 1',[order,profile])).rows[0];
      const job=id(sequence++),kg=weight??Number(line?.quantity_kg??30);
      await db.query(`insert into production_jobs(id,company_id,order_id,profile_id,source_line_id,status,planned_quantity_kg,actual_quantity_kg)
        select $1,company_id,id,$2,$3,$4,$5,$6 from orders where id=$7`,[job,profile,line?.id??null,status,kg,status==='completed'?kg:0,order]);return job;
    }
    async function stage(stage,order=targetId){return base.attempt(()=>db.query('update orders set current_stage=$1 where id=$2',[stage,order]));}
    return {...base,reset,createOrder,requirements,billet,asAuthenticated,allocate,reallocate,seedAllocation,seedJob,stage,
      get orderId(){return targetId;},get sourceOrderId(){return sourceId;}};
  }catch(error){await base.close();throw error;}
}
