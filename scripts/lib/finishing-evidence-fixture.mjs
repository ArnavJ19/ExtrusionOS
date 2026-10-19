import {createProductionScrapFixture,scrapFixture as f,scrapFixtureId as id} from "./production-scrap-fixture.mjs";
import {createHistoricalTables,sqlDefinition} from "./historical-schema-fixture.mjs";
import {readFileSync} from "node:fs";

export const finishingFixture={...f,vendor:id(7),otherVendor:id(8)};

export async function installTerminalFinishingCandidateObjects(db){
  const file="20261019010000_terminal_finishing_evidence.sql";
  for(const name of ["private.guard_terminal_finishing_evidence","private.transition_finishing_job_atomic"])await db.exec(sqlDefinition(file,name));
  const source=readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),"utf8");
  const trigger=source.match(/create trigger guard_terminal_finishing_evidence[\s\S]*?;/i);if(!trigger)throw new Error("Missing candidate finishing trigger");
  await db.exec(trigger[0]);
  for(const statement of source.match(/revoke[^;]+;/gi)??[])await db.exec(statement);
  return {functions:2,triggers:1};
}

export async function createFinishingEvidenceFixture({candidate=false,finishingType='powder_coating'}={}){
  const core=await createProductionScrapFixture(),{db}=core;
  try{
    await createHistoricalTables(db,["vendors","finishing_status_history"],"20261019000000");
    const floor="20260718021500_floor_output_and_finishing_workflows.sql",route="20260718020500_finishing_route_and_quality_yield.sql";
    for(const [file,name] of [
      [route,"public.validate_finishing_completion"],[route,"public.route_completed_finishing_to_packaging"],
      ["20260930000000_astra_audit_fixes.sql","public.validate_finishing_transition"],[floor,"public.log_finishing_status_change"],
      [floor,"private.transition_finishing_job_atomic"],[floor,"public.transition_finishing_job_atomic"],
      [floor,"private.retry_rejected_finishing_job_atomic"],[floor,"public.retry_rejected_finishing_job_atomic"]
    ])await db.exec(sqlDefinition(file,name));
    await db.exec(`alter table finishing_status_history add foreign key(finishing_job_id) references finishing_jobs(id) on delete cascade;
      alter table finishing_jobs add foreign key(retry_of_finishing_job_id) references finishing_jobs(id) on delete restrict;
      create unique index fixture_finishing_one_retry on finishing_jobs(company_id,retry_of_finishing_job_id) where retry_of_finishing_job_id is not null;
      create trigger validate_finishing_completion before insert or update of company_id,order_id,production_job_id,status,input_weight_kg,output_weight_kg,rejection_weight_kg,received_date
        on finishing_jobs for each row execute function public.validate_finishing_completion();
      create trigger validate_finishing_transition before insert or update of company_id,order_id,production_job_id,finishing_type,retry_of_finishing_job_id,status,vendor_id,sent_date,received_date,input_weight_kg,output_weight_kg,rejection_weight_kg,remarks
        on finishing_jobs for each row execute function public.validate_finishing_transition();
      create trigger log_finishing_status_change after update of status on finishing_jobs for each row execute function public.log_finishing_status_change();
      create trigger route_completed_finishing_to_packaging after insert or update of status on finishing_jobs for each row execute function public.route_completed_finishing_to_packaging();
      revoke all on function private.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text),private.retry_rejected_finishing_job_atomic(uuid,date,text) from public,anon,authenticated;
      revoke all on function public.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text),public.retry_rejected_finishing_job_atomic(uuid,date,text) from public,anon;
      grant execute on function public.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text),public.retry_rejected_finishing_job_atomic(uuid,date,text) to authenticated;`);
    if(candidate)await installTerminalFinishingCandidateObjects(db);
    let jobId;
    async function reset(){
      await core.reset();
      await db.query('update production_jobs set finishing_type=$1',[finishingType]);
      await db.exec(`insert into vendors(id,company_id,vendor_name,vendor_type,is_active)values
          ('${finishingFixture.vendor}','${f.company}','Original finishing vendor','powder_coating',true),
          ('${finishingFixture.otherVendor}','${f.company}','Replacement vendor','powder_coating',true);`);
      await core.complete();
      jobId=(await db.query("select id from finishing_jobs where company_id=$1 and production_job_id=$2",[f.company,f.job])).rows[0]?.id;
      return jobId;
    }
    const move=(status,values={},target=jobId)=>core.attempt(()=>db.query("select public.transition_finishing_job_atomic($1,$2,$3,$4,$5,$6,$7,$8) id",
      [target,status,values.vendor??null,values.sent??null,values.received??null,values.output??null,values.rejected??null,values.remarks??null]));
    async function complete(){
      await move("sent_to_vendor",{vendor:finishingFixture.vendor,sent:"2026-10-16"});
      await move("in_process");
      await move("received",{received:"2026-10-18",output:90,rejected:5,remarks:"Audited finishing receipt"});
      await move("completed",{received:"2026-10-18"});
    }
    const retry=(target=jobId)=>core.attempt(()=>db.query("select public.retry_rejected_finishing_job_atomic($1,$2,$3) id",[target,"2026-10-20","Corrective finishing instruction"]));
    async function snapshot(){
      const rows=await db.query("select * from finishing_jobs where company_id=$1 and production_job_id=$2 order by id",[f.company,f.job]);
      return {jobs:rows.rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=="updated_at"))),
        history:(await db.query("select * from finishing_status_history where company_id=$1 order by id",[f.company])).rows,
        packaging:(await db.query("select * from packaging_jobs where company_id=$1 and production_job_id=$2 order by id",[f.company,f.job])).rows,
        production:await core.snapshot()};
    }
    return {...core,reset,move,complete,retry,snapshot,get jobId(){return jobId;}};
  }catch(error){await core.close();throw error;}
}
