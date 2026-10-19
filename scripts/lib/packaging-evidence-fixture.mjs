import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createPartialFinishingFixture,partialFinishingIds as f} from './finishing-partial-retry-fixture.mjs';
import {sqlDefinition} from './historical-schema-fixture.mjs';

export {f as packagingEvidenceIds};
export const packagingEvidenceCandidate='20261019030000_packaging_material_evidence.sql';

export async function installPackagingEvidenceCandidateObjects(db){
  const source=readFileSync(new URL(`../../supabase/migrations/${packagingEvidenceCandidate}`,import.meta.url),'utf8');
  const names=[...source.matchAll(/create or replace function ([\w.]+)\(/g)].map(match=>match[1]);
  for(const name of names)await db.exec(sqlDefinition(packagingEvidenceCandidate,name));
  for(const statement of source.match(/(?:create (?:unique )?index|drop policy|drop trigger|create trigger|revoke|grant)[^;]+;/gi)??[])await db.exec(statement);
  return {functions:names.length,triggers:(source.match(/create trigger/g)??[]).length};
}

export async function createPackagingEvidenceFixture({candidate=existsSync(new URL(`../../supabase/migrations/${packagingEvidenceCandidate}`,import.meta.url)),finishingType='mill_finish'}={}){
  const base=await createPartialFinishingFixture({finishingType}),{db}=base;
  try{
    const source=readFileSync(new URL('../../supabase/migrations/20260530000000_packaging_multiple_materials.sql',import.meta.url),'utf8');
    const start=source.indexOf('CREATE OR REPLACE FUNCTION public.handle_packaging_job_status_change('),body=source.indexOf('$$',start),end=source.indexOf('$$;',body+2);assert.ok(start>=0&&end>body);
    await db.exec(source.slice(start,end+3));
    await db.exec(`create trigger handle_packaging_job_status_change after update of status on packaging_jobs for each row execute function public.handle_packaging_job_status_change();
      alter table packaging_job_materials add constraint fixture_packaging_material_parent foreign key(job_id) references packaging_jobs(id) on delete cascade;
      alter table packaging_material_movements add constraint fixture_packaging_movement_parent foreign key(packaging_job_id) references packaging_jobs(id) on delete cascade;
      create function public.get_current_user_company_id() returns uuid language sql security definer as $$select private.get_current_user_company_id()$$;
      create function public.get_current_user_role() returns text language sql security definer as $$select private.get_current_user_role()$$;
      alter table packaging_jobs enable row level security;
      alter table packaging_job_materials enable row level security;
      alter table packaging_material_movements enable row level security;
      grant select,insert,update,delete on packaging_jobs,packaging_job_materials,packaging_material_movements to authenticated;
      create policy "packaging_jobs tenant read" on packaging_jobs for select using(company_id=public.get_current_user_company_id());
      create policy "packaging_material_movements tenant read" on packaging_material_movements for select using(company_id=public.get_current_user_company_id());`);
    const legacy=readFileSync(new URL('../../supabase/migrations/0051_foundry_sources_scrap_billets_packaging.sql',import.meta.url),'utf8');
    for(const name of ['packaging jobs tenant insert','packaging jobs tenant update','packaging movements tenant insert']){
      const statement=legacy.split(/\r?\n/).find(line=>line.startsWith(`create policy "${name}"`));assert.ok(statement,name);await db.exec(statement);
    }
    for(const statement of source.match(/CREATE POLICY "packaging job materials[^;]+;/g)??[])await db.exec(statement);
    if(candidate)await installPackagingEvidenceCandidateObjects(db);
    async function save(packageId,{status='scheduled',materials=[]}={}){
      const row=(await db.query('select * from packaging_jobs where id=$1',[packageId])).rows[0];assert.ok(row);
      return base.attempt(()=>db.query('select public.save_packaging_job_atomic($1,$2,$3) id',[packageId,
        {order_id:f.order,production_job_id:f.job,finishing_job_id:row.finishing_job_id,scheduled_date:'2026-10-19',status,pieces:row.pieces,profile_weight_kg:row.profile_weight_kg,profile_length_m:row.profile_length_m},materials]));
    }
    async function asAuthenticated(callback){try{return await base.attempt(async()=>{await db.exec('set role authenticated;');return callback();});}finally{await db.exec('reset role;');}}
    return {...base,save,asAuthenticated};
  }catch(error){await base.close();throw error;}
}
