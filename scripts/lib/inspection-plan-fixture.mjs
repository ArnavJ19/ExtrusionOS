import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const iid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const iids = {
  company: iid(1), otherCompany: iid(2), owner: iid(10), qcManager: iid(11), inspector: iid(12), prodManager: iid(13), viewer: iid(14), sales: iid(15), foreign: iid(16),
  profile: iid(20), profile2: iid(21), foreignProfile: iid(22), job: iid(30),
  inspection: iid(40), inspection2: iid(41), noPlanInspection: iid(42), reworkInspection: iid(43), foreignInspection: iid(44),
  plan: iid(50), defaultPlan: iid(51)
};

export async function createInspectionPlanFixture() {
  const db = new PGlite();
  const f = iids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table aluminium_profiles(id uuid primary key,company_id uuid,profile_code text);
    create table quality_inspections(id uuid primary key default gen_random_uuid(),company_id uuid,production_job_id uuid,finishing_job_id uuid,profile_id uuid,inspection_date timestamptz,batch_number text,
      quantity_checked_kg numeric,status text,inspector_name text,surface_finish_ok boolean,notes text);
    create table quality_rework_resolutions(id uuid primary key default gen_random_uuid(),company_id uuid,source_inspection_id uuid,production_job_id uuid,finishing_job_id uuid,profile_id uuid,
      source_quantity_kg numeric,approved_weight_kg numeric,rejected_weight_kg numeric,reason text,inspector_name text,resolved_by uuid,created_at timestamptz default now());
    alter table quality_inspections add column resolution_id uuid references quality_rework_resolutions(id);
    create table private.quality_resolution_authorizations(transaction_id bigint not null,resolution_id uuid not null,actor_id uuid not null,children_remaining integer not null,primary key(transaction_id,resolution_id));`);
  for (const name of ["public.resolve_quality_rework_atomic", "private.guard_quality_resolution_child"]) await db.exec(extractSqlFunction("supabase/migrations/20261008020000_factory_workflow_integrity.sql", name));
  await db.exec(`create trigger guard_quality_resolution_child before insert or update of resolution_id on quality_inspections for each row execute function private.guard_quality_resolution_child();
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;
    grant execute on function public.resolve_quality_rework_atomic(uuid,numeric,numeric,text,text) to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022320000_inspection_plans.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.qcManager) {
    await db.exec("begin");
    try {
      await db.query("select set_config('test.actor',$1,true)", [actor]);
      await db.exec("set local role authenticated");
      const result = await db.query(sql, parameters);
      await db.exec("commit");
      return result.rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const command = async (name, payload, actor = f.qcManager) => (await asUser("select public.inspection_plan_command($1,$2) data", [name, payload], actor))[0].data;
  // A 6063-T6 sliding-track plan: wall thickness, weight per metre, hardness, coating, visual finish.
  const items = [
    { characteristic: "Wall thickness", unit: "mm", method: "Micrometer, 3 points", nominal: 1.6, lower_limit: 1.52, upper_limit: 1.68 },
    { characteristic: "Weight per metre", unit: "kg/m", nominal: 0.95, lower_limit: 0.92, upper_limit: 0.98 },
    { characteristic: "Hardness", unit: "HW", lower_limit: 12 },
    { characteristic: "Surface finish", unit: "visual" }
  ];
  const saveDraft = (extra = {}, actor = f.qcManager) => command("plan.save_draft", { plan_id: f.plan, profile_id: f.profile, sampling_instruction: "3 pieces per 500 kg lot, ends and middle", items, ...extra }, actor);
  const approvedPlan = async () => { await saveDraft(); await command("plan.approve", { plan_id: f.plan }, f.inspector); };
  const itemIds = async (plan = f.plan) => (await db.query("select id, characteristic from inspection_plan_items where plan_id=$1 order by seq", [plan])).rows;
  const setStatus = (inspection, status) => db.exec(`update quality_inspections set status='${status}' where id='${inspection}'`);

  async function reset() {
    await db.exec(`truncate inspection_results,inspection_plan_items,inspection_plans,quality_inspections,quality_rework_resolutions,aluminium_profiles,app_users,companies cascade;
      truncate private.quality_resolution_authorizations;`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.qcManager}','${f.company}','quality_manager',true,'QC Manager Leela',null),
        ('${f.inspector}','${f.company}','quality',true,'Inspector Meera',null),('${f.prodManager}','${f.company}','production_manager',true,'Prod Mgr',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.sales}','${f.company}','sales',true,'Sales',null),('${f.foreign}','${f.otherCompany}','quality_manager',true,'Foreign',null);
      insert into aluminium_profiles values('${f.profile}','${f.company}','EX-101'),('${f.profile2}','${f.company}','EX-205'),('${f.foreignProfile}','${f.otherCompany}','F-1');
      insert into quality_inspections(id,company_id,production_job_id,profile_id,quantity_checked_kg,status,inspector_name) values
        ('${f.inspection}','${f.company}','${f.job}','${f.profile}',500,'pending','Inspector Meera'),
        ('${f.inspection2}','${f.company}','${f.job}','${f.profile}',300,'pending','Inspector Meera'),
        ('${f.noPlanInspection}','${f.company}','${f.job}','${f.profile2}',200,'pending','Inspector Meera'),
        ('${f.reworkInspection}','${f.company}','${f.job}','${f.profile}',100,'rework','Inspector Meera'),
        ('${f.foreignInspection}','${f.otherCompany}',null,'${f.foreignProfile}',1,'pending','x');`);
  }
  return { db, asUser, command, saveDraft, approvedPlan, itemIds, setStatus, items, reset, close: () => db.close() };
}
