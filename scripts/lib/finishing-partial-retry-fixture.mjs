import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";
import {createFinishingEvidenceFixture,finishingFixture as f} from "./finishing-evidence-fixture.mjs";
import {createHistoricalTables,sqlDefinition} from "./historical-schema-fixture.mjs";

export {f as partialFinishingIds};
export const partialFinishingCandidate="20261019020000_finishing_accepted_dispositions.sql";
const read=file=>readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),"utf8");
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export function historicalDefinition(file,name){
  const source=read(file).replace(/CREATE OR REPLACE FUNCTION/g,"create or replace function");
  const start=source.indexOf(`create or replace function ${name}(`);assert.ok(start>=0,name);
  const body=source.indexOf("$$",start),end=source.indexOf("$$;",body+2);assert.ok(end>body,name);return source.slice(start,end+3);
}

export async function installPartialFinishingCandidateObjects(db){
  const source=read(partialFinishingCandidate);
  for(const statement of source.match(/alter table public\.packaging_jobs[\s\S]*?;/gi)??[])await db.exec(statement);
  const names=[...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for(const name of names)await db.exec(sqlDefinition(partialFinishingCandidate,name));
  for(const statement of source.match(/create or replace view public\.finishing_accepted_outputs[\s\S]*?;/gi)??[])await db.exec(statement);
  for(const statement of source.match(/(?:drop index|create (?:unique )?index|drop trigger|create trigger|revoke|grant)[^;]+;/gi)??[])await db.exec(statement);
  return {functions:names.length,triggers:(source.match(/create trigger/g)??[]).length};
}

export async function createPartialFinishingFixture({candidate=existsSync(new URL(`../../supabase/migrations/${partialFinishingCandidate}`,import.meta.url)),finishingType='powder_coating'}={}){
  const base=await createFinishingEvidenceFixture({candidate:true,finishingType}),{db}=base;
  try{
    await createHistoricalTables(db,["quality_rework_resolutions","packaging_materials","packaging_job_materials","dispatches","profile_stock_reservations",
      "profile_stock_batches","order_dealer_stock_fulfillments","feature_flags"],partialFinishingCandidate);
    const handoff="20260718020000_production_quality_packaging_handoffs.sql";
    for(const [file,names] of [
      ["20261008020000_factory_workflow_integrity.sql",["public.validate_quality_production_link"]],
      ["20260718020500_finishing_route_and_quality_yield.sql",["public.guard_terminal_quality_inspection"]],
      ["20260715000000_atomic_business_workflows.sql",["private.keep_jsonb_keys","private.insert_jsonb_row","private.update_jsonb_row"]],
      ["20260930000000_astra_audit_fixes.sql",["private.next_business_number_locked"]],
      ["20260515005200_packaging_queue_and_calculation_hardening.sql",["public.refresh_packaging_job_material"]],
      [handoff,["public.guard_terminal_packaging_job","public.guard_terminal_packaging_material","public.validate_completed_packaging_materials",
        "public.sync_packaging_order_stage","private.save_packaging_job_atomic","public.save_packaging_job_atomic"]],
      ["20260721091307_physical_dispatch_stock_provenance.sql",["private.assert_dispatch_ready"]]
    ])for(const name of names)await db.exec(sqlDefinition(file,name));
    await db.exec(historicalDefinition("20260530000000_packaging_multiple_materials.sql","public.apply_packaging_material_stock_from_materials"));
    await db.exec(`create unique index packaging_jobs_one_active_production_source_idx on packaging_jobs(company_id,production_job_id)
        where production_job_id is not null and status<>'cancelled';
      create trigger validate_quality_production_link before insert or update on quality_inspections for each row execute function public.validate_quality_production_link();
      create trigger guard_terminal_quality_inspection before update or delete on quality_inspections for each row execute function public.guard_terminal_quality_inspection();
      create trigger guard_terminal_packaging_job before update on packaging_jobs for each row execute function public.guard_terminal_packaging_job();
      create trigger refresh_packaging_job_material before insert or update on packaging_jobs for each row execute function public.refresh_packaging_job_material();
      create trigger guard_terminal_packaging_material before insert or update or delete on packaging_job_materials for each row execute function public.guard_terminal_packaging_material();
      create trigger apply_packaging_material_stock_from_materials after insert or update or delete on packaging_job_materials for each row execute function public.apply_packaging_material_stock_from_materials();
      create trigger sync_packaging_order_stage after insert or update of status on packaging_jobs for each row execute function public.sync_packaging_order_stage();
      create constraint trigger validate_completed_packaging_job after insert or update on packaging_jobs deferrable initially deferred for each row execute function public.validate_completed_packaging_materials();
      create constraint trigger validate_completed_packaging_material after insert or update or delete on packaging_job_materials deferrable initially deferred for each row execute function public.validate_completed_packaging_materials();
      revoke all on function private.save_packaging_job_atomic(uuid,jsonb,jsonb),private.assert_dispatch_ready(uuid) from public,anon,authenticated;
      revoke all on function public.save_packaging_job_atomic(uuid,jsonb,jsonb) from public,anon;
      grant execute on function public.save_packaging_job_atomic(uuid,jsonb,jsonb) to authenticated;`);
    if(candidate)await installPartialFinishingCandidateObjects(db);
    async function reset(){
      const original=await base.reset();
      await db.exec(`insert into packaging_materials(id,company_id,material_name,is_active,current_stock)values('${id(90)}','${f.company}','Synthetic packing film',true,100);
        insert into feature_flags(company_id,module_name,is_enabled)values('${f.company}','quality_compliance',true);`);
      return original;
    }
    const qc=(finish,weight)=>base.attempt(()=>db.query(`insert into quality_inspections(company_id,production_job_id,finishing_job_id,profile_id,inspection_date,
      quantity_checked_kg,status,inspector_name,surface_finish_ok) values($1,$2,$3,$4,now(),$5,'approved','Synthetic QC inspector',true) returning id`,[f.company,f.job,finish,f.profile,weight]));
    async function pack(packageId,weight){
      const job=(await db.query("select * from packaging_jobs where id=$1",[packageId])).rows[0];assert.ok(job);
      const payload={packaging_number:job.packaging_number,order_id:f.order,production_job_id:f.job,scheduled_date:"2026-10-19",status:"completed",
        pieces:job.pieces,profile_weight_kg:weight??Number(job.profile_weight_kg),profile_length_m:job.profile_length_m,notes:"Synthetic measured packaging"};
      if(job.finishing_job_id)payload.finishing_job_id=job.finishing_job_id;
      return base.attempt(()=>db.query("select public.save_packaging_job_atomic($1,$2,$3) id",[packageId,payload,[{material_id:id(90),quantity_required:1}]]));
    }
    async function partial(){
      const original=base.jobId;
      await base.move("sent_to_vendor",{vendor:f.vendor,sent:"2026-10-16"});
      await base.move("received",{received:"2026-10-18",output:40,rejected:55,remarks:"40 kg accepted; 55 kg for corrective processing"});
      await base.move("rejected",{received:"2026-10-18",output:40,rejected:55,remarks:"40 kg accepted; 55 kg for corrective processing"});
      return original;
    }
    async function retryComplete(){
      const retry=(await base.retry()).rows[0].id;await base.move("in_process",{},retry);
      await base.move("completed",{received:"2026-10-19",output:50,rejected:5,remarks:"50 kg accepted; 5 kg remains rejected"},retry);return retry;
    }
    const ready=()=>db.query("select public.get_finished_production_readiness($1) data",[f.order]).then(result=>result.rows[0].data);
    const createPackage=(finish,weight)=>base.attempt(()=>db.query("select public.save_packaging_job_atomic(null,$1,$2) id",[
      {order_id:f.order,production_job_id:f.job,finishing_job_id:finish,scheduled_date:"2026-10-19",pieces:1,profile_weight_kg:weight,profile_length_m:5,status:"scheduled"},[]]));
    async function assertDispatch(weight){
      return base.attempt(async()=>{
        const dispatch=(await db.query(`insert into dispatches(company_id,order_id,number_of_bundles,total_weight_kg,total_tare_weight_kg,delivery_status)
          values($1,$2,1,$3,0,'pending') returning id`,[f.company,f.order,weight])).rows[0].id;
        await db.query(`insert into packing_list_items(company_id,dispatch_id,source_kind,source_record_id,source_line_id,profile_id,
          gross_weight_kg,tare_weight_kg,net_weight_kg,net_length_m,number_of_pieces) values($1,$2,'production',$3,$4,$5,$6,0,$6,5,1)`,[f.company,dispatch,f.order,f.job,f.profile,weight]);
        await db.query("select private.assert_dispatch_ready($1)",[dispatch]);return dispatch;
      });
    }
    async function snapshot(){return {...await base.snapshot(),
      qc:(await db.query("select * from quality_inspections where company_id=$1 order by id",[f.company])).rows,
      materials:(await db.query("select * from packaging_job_materials where company_id=$1 order by id",[f.company])).rows,
      materialStock:Number((await db.query("select current_stock from packaging_materials where id=$1",[id(90)])).rows[0].current_stock),
      movements:(await db.query("select * from packaging_material_movements where company_id=$1 order by id",[f.company])).rows};}
    return {...base,reset,qc,pack,partial,retryComplete,ready,snapshot,createPackage,assertDispatch,get jobId(){return base.jobId;}};
  }catch(error){await base.close();throw error;}
}
