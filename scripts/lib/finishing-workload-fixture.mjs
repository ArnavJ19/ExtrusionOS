import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createPartialFinishingFixture,partialFinishingIds as f} from './finishing-partial-retry-fixture.mjs';
import {createHistoricalTables,sqlDefinition} from './historical-schema-fixture.mjs';

export {f as workloadIds};
export const workloadCandidate='20261019040000_finishing_workload_projection.sql';

export async function installFinishingWorkloadObjects(db){
  const source=readFileSync(new URL(`../../supabase/migrations/${workloadCandidate}`,import.meta.url),'utf8');
  const names=[...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for(const name of names)await db.exec(sqlDefinition(workloadCandidate,name));
  for(const statement of source.match(/(?:revoke|grant)[^;]+;/gi)??[])await db.exec(statement);
  return {functions:names.length,triggers:0};
}

export async function createFinishingWorkloadFixture({candidate=existsSync(new URL(`../../supabase/migrations/${workloadCandidate}`,import.meta.url))}={}){
  const base=await createPartialFinishingFixture(),{db}=base;
  try{
    await createHistoricalTables(db,['customers'],workloadCandidate);
    if(candidate)await installFinishingWorkloadObjects(db);
    const workload=({order=null,production=null,record=null,status='',search='',sort='planned_date',direction='asc',page=1}={})=>base.attempt(()=>db.query(
      'select public.get_finishing_workload($1,$2,$3,$4,$5,$6,$7,$8) data',[order,production,record,status,search,sort,direction,page])).then(result=>result.rows[0].data);
    async function seedQueue(count){return base.attempt(async()=>{
      assert.ok(Number.isInteger(count)&&count>0&&count<=1200);
      await db.query(`insert into production_jobs(id,company_id,order_id,profile_id,status,pieces,required_billet_count,job_number,finishing_type,length_per_piece_m)
        select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,$2,$3,'planned',10,1,'QUEUE-'||lpad(n::text,4,'0'),'powder_coating',5 from generate_series(1,$4::integer)n`,[f.company,f.order,f.profile,count]);
      await db.exec("update production_jobs set status='ready' where id::text like '10000000-%';update production_jobs set status='in_progress' where id::text like '10000000-%';");
      await db.query(`insert into foundry_billets(company_id,production_job_id,status,weight_kg) select company_id,id,'issued',100 from production_jobs where id::text like '10000000-%'`);
      await db.exec(`do $$declare source record;begin for source in select id from production_jobs where id::text like '10000000-%' order by id loop
        perform public.complete_production_job_atomic(source.id,95,10,50,5,'Synthetic queue batch completion');end loop;end;$$;`);
    });}
    return {...base,workload,seedQueue,get jobId(){return base.jobId;}};
  }catch(error){await base.close();throw error;}
}
