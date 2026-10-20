import {PGlite} from "@electric-sql/pglite";
import {createHistoricalTables,sqlDefinition} from "./historical-schema-fixture.mjs";

export const scrapFixtureId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const scrapFixture={company:scrapFixtureId(1),actor:scrapFixtureId(2),profile:scrapFixtureId(3),order:scrapFixtureId(4),job:scrapFixtureId(5),billet:scrapFixtureId(6)};

export async function createProductionScrapFixture(){
  const db=new PGlite(),f=scrapFixture;
  try{
    await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function private.get_current_user_company_id() returns uuid language sql as $$select nullif(current_setting('test.company',true),'')::uuid$$;
      create function private.get_current_user_role() returns text language sql as $$select current_setting('test.role',true)$$;`);
    await createHistoricalTables(db,["orders","production_jobs","foundry_billets","scrap_records","order_billet_requirements","finishing_jobs",
      "quality_inspections","packaging_jobs","packaging_material_movements","packing_list_items","production_output_corrections","foundry_aluminium_scrap","order_stage_history"],"20261015000000");
    await db.exec(`create unique index fixture_packaging_number on packaging_jobs(company_id,packaging_number);
      create table private.production_completion_authorizations(transaction_id bigint,job_id uuid,company_id uuid,actor_id uuid,
        expected_weight_kg numeric(14,3) not null,expected_pieces integer not null,expected_meters numeric(14,3) not null,
        expected_scrap_kg numeric(14,3) not null,scrap_inserted boolean not null default false,primary key(transaction_id,job_id));
      create table private.production_output_correction_authorizations(transaction_id bigint,job_id uuid,company_id uuid,actor_id uuid,reason text,
        expected_weight_kg numeric(14,3),expected_pieces integer,expected_meters numeric(14,3),primary key(transaction_id,job_id));
      revoke all on private.production_completion_authorizations,private.production_output_correction_authorizations from public,anon,authenticated;`);
    const floor="20260718021500_floor_output_and_finishing_workflows.sql",factory="20261008020000_factory_workflow_integrity.sql";
    for(const [file,name] of [["20260718020000_production_quality_packaging_handoffs.sql","private.advance_order_stage"],
      [floor,"private.complete_production_job_atomic"],[floor,"public.validate_production_completion"],
      [factory,"public.enforce_production_completion_integrity"],[factory,"private.guard_completed_production_scrap"],
      [factory,"private.guard_completed_billet_inputs"],[factory,"public.complete_production_job_atomic"],
      ["20260718020500_finishing_route_and_quality_yield.sql","public.link_billets_to_production_job"]])await db.exec(sqlDefinition(file,name));
    await db.exec(`create trigger completion_integrity before insert or update or delete on production_jobs for each row execute function public.enforce_production_completion_integrity();
      create trigger completion_status before insert or update of status on production_jobs for each row execute function public.validate_production_completion();
      create trigger scrap_integrity before insert or update or delete on scrap_records for each row execute function private.guard_completed_production_scrap();
      create trigger billet_integrity before insert or update or delete on foundry_billets for each row execute function private.guard_completed_billet_inputs();
      create trigger complete_handoffs after update of status on production_jobs for each row execute function public.link_billets_to_production_job();
      revoke all on function private.complete_production_job_atomic(uuid,numeric,integer,numeric,numeric,text) from public,anon,authenticated;
      grant usage on schema public,auth,private to authenticated;
      revoke all on function public.complete_production_job_atomic(uuid,numeric,integer,numeric,numeric,text) from public,anon;
      grant execute on function public.complete_production_job_atomic(uuid,numeric,integer,numeric,numeric,text) to authenticated;`);
    async function attempt(callback){
      await db.exec("savepoint scrap_attempt;");
      try{const result=await callback();await db.exec("release savepoint scrap_attempt;");return result;}
      catch(error){await db.exec("rollback to savepoint scrap_attempt;release savepoint scrap_attempt;");throw error;}
    }
    async function reset(){
      await db.exec("reset role;rollback;begin;");
      await db.query("select set_config('test.actor',$1,false),set_config('test.company',$2,false),set_config('test.role','production_manager',false)",[f.actor,f.company]);
      await db.exec(`insert into orders(id,company_id,current_stage)values('${f.order}','${f.company}','in_production');
        insert into production_jobs(id,company_id,order_id,profile_id,status,pieces,required_billet_count,job_number,finishing_type,length_per_piece_m)
          values('${f.job}','${f.company}','${f.order}','${f.profile}','planned',10,1,'SCRAP-FIXTURE','mill_finish',5);
        update production_jobs set status='ready' where id='${f.job}';update production_jobs set status='in_progress' where id='${f.job}';
        insert into foundry_billets(id,company_id,production_job_id,status,weight_kg) values('${f.billet}','${f.company}','${f.job}','issued',100);
        insert into foundry_aluminium_scrap(company_id,weight_kg,available_weight_kg,status)values('${f.company}',20,20,'available');`);
    }
    const complete=(output=95,scrap=5,job=f.job)=>attempt(()=>db.query("select public.complete_production_job_atomic($1,$2,10,50,$3,'Synthetic audited completion') id",[job,output,scrap]));
    async function snapshot(){return (await db.query(`select j.status,j.actual_quantity_kg,j.actual_pieces,j.actual_meters,
      (select count(*)::int from scrap_records where production_job_id=j.id) scrap_rows,
      (select coalesce(sum(weight_kg),0) from scrap_records where production_job_id=j.id) scrap_kg,
      (select coalesce(sum(weight_kg),0) from foundry_billets where production_job_id=j.id) input_kg,
      (select count(*)::int from foundry_billets where production_job_id=j.id and status='consumed') consumed_billets,
      (select count(*)::int from packaging_jobs where production_job_id=j.id) packaging_jobs,
      (select count(*)::int from order_stage_history where order_id=j.order_id) stage_events,
      (select current_stage from orders where id=j.order_id) order_stage,
      (select count(*)::int from private.production_completion_authorizations where job_id=j.id) authorizations,
      (select sum(available_weight_kg) from foundry_aluminium_scrap where company_id=j.company_id) remelt_available_kg
      from production_jobs j where j.id=$1`,[f.job])).rows[0];}
    return {db,reset,attempt,complete,snapshot,close:()=>db.close()};
  }catch(error){await db.close();throw error;}
}
