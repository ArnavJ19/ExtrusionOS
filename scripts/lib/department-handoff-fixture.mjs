import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const did = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const dids = {
  company: did(1), otherCompany: did(2), owner: did(10), quality: did(11), packer: did(12), dispatcher: did(13), viewer: did(14), sales: did(15), foreign: did(16), dealer: did(17), supervisor: did(18),
  profile: did(20), order: did(30), foreignOrder: did(31), job: did(40), foreignJob: did(41), finishing: did(50), packaging: did(60), openPackaging: did(61),
  inspection: did(70), reworkInspection: did(71)
};

const M = "supabase/migrations/";
const WORKFLOW = M + "20261008020000_factory_workflow_integrity.sql";

// Hosted-shaped source tables with the real rework-resolution action and its child guard.
export async function createDepartmentHandoffFixture({ acceptance = false } = {}) {
  const db = new PGlite();
  const f = dids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table aluminium_profiles(id uuid primary key,company_id uuid);
    create table orders(id uuid primary key,company_id uuid,order_number text,priority text,expected_dispatch_date date,current_stage text default 'extrusion_planned');
    create table production_jobs(id uuid primary key,company_id uuid,order_id uuid,job_number text,status text default 'completed');
    create table finishing_jobs(id uuid primary key,company_id uuid,order_id uuid,production_job_id uuid,finishing_type text,shade_name text,status text,output_weight_kg numeric,rejection_weight_kg numeric);
    create table packaging_jobs(id uuid primary key,company_id uuid,packaging_number text,order_id uuid,production_job_id uuid,pieces integer,profile_weight_kg numeric,status text,created_at timestamptz default now());
    create table quality_inspections(id uuid primary key default gen_random_uuid(),company_id uuid,production_job_id uuid,finishing_job_id uuid,profile_id uuid,inspection_date timestamptz,batch_number text,quantity_checked_kg numeric,status text,inspector_name text,surface_finish_ok boolean,notes text);
    create table tasks(id uuid primary key default gen_random_uuid(),company_id uuid not null,task_type text not null,title text not null,description text,priority text not null default 'normal',status text not null default 'open',
      assigned_to uuid,due_date date,related_entity_type text,related_entity_id uuid,created_by uuid,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),dealership_id uuid,assigned_by_user_id uuid,
      check (priority in ('low','normal','high','urgent')),check (status in ('open','in_progress','completed','cancelled')));
    create table quality_rework_resolutions(id uuid primary key default gen_random_uuid(),company_id uuid,source_inspection_id uuid,production_job_id uuid,finishing_job_id uuid,profile_id uuid,
      source_quantity_kg numeric,approved_weight_kg numeric,rejected_weight_kg numeric,reason text,inspector_name text,resolved_by uuid,created_at timestamptz default now());
    alter table quality_inspections add column resolution_id uuid references quality_rework_resolutions(id);
    create table private.quality_resolution_authorizations(transaction_id bigint not null,resolution_id uuid not null,actor_id uuid not null,children_remaining integer not null,primary key(transaction_id,resolution_id));`);
  for (const name of ["public.resolve_quality_rework_atomic", "private.guard_quality_resolution_child"]) await db.exec(extractSqlFunction(WORKFLOW, name));
  await db.exec(`create trigger guard_quality_resolution_child before insert or update of resolution_id on quality_inspections for each row execute function private.guard_quality_resolution_child();
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;
    grant select on all tables in schema public to authenticated;
    grant execute on function public.resolve_quality_rework_atomic(uuid,numeric,numeric,text,text) to authenticated;`);
  await db.exec(readFileSync(M + "20261022260000_department_handoffs.sql", "utf8"));
  // Feature 69 layers acceptance on top of the handoffs.
  if (acceptance) await db.exec(readFileSync(M + "20261022290000_handoff_acceptance.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.owner) {
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
  /** Runs a source write as a privileged session (the way the app's guarded actions do). */
  async function asSystem(sql, actor = f.owner) {
    await db.exec("begin");
    try {
      await db.query("select set_config('test.actor',$1,true)", [actor]);
      await db.exec(sql);
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.department_handoff_command($1,$2) data", [name, payload], actor))[0].data;
  const handoffs = async () => (await db.query("select handoff_key, handoff_team, handoff_quantity_kg::float8 qty, handoff_source_type, status, priority, due_date::text due, title, description, related_entity_id from tasks where handoff_key is not null order by created_at, handoff_key")).rows;

  async function reset() {
    await db.exec(`truncate ${acceptance ? "handoff_returns,handoff_acceptances,handoff_team_policies," : ""}tasks,quality_inspections,quality_rework_resolutions,packaging_jobs,finishing_jobs,production_jobs,orders,aluminium_profiles,app_users,companies cascade;
      truncate private.quality_resolution_authorizations;`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.quality}','${f.company}','quality',true,'QC Meera',null),
        ('${f.packer}','${f.company}','production',true,'Packer Sunil',null),('${f.dispatcher}','${f.company}','dispatch',true,'Dispatch Imran',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.sales}','${f.company}','sales',true,'Sales',null),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.dealer}','${f.company}','production',true,'Dealer prod','${did(700)}'),
        ('${f.supervisor}','${f.company}','production_manager',true,'Supervisor',null);
      insert into aluminium_profiles values('${f.profile}','${f.company}');
      insert into orders values('${f.order}','${f.company}','SO-0042','urgent','2030-01-15'),('${f.foreignOrder}','${f.otherCompany}','FOREIGN-1','normal',null);
      insert into production_jobs values('${f.job}','${f.company}','${f.order}','PJ-0007'),('${f.foreignJob}','${f.otherCompany}','${f.foreignOrder}','FOREIGN-JOB');
      insert into packaging_jobs(id,company_id,packaging_number,order_id,production_job_id,pieces,profile_weight_kg,status) values('${f.openPackaging}','${f.company}','PKG-0001','${f.order}','${f.job}',100,400,'scheduled');`);
  }
  return { db, asUser, asSystem, command, handoffs, reset, close: () => db.close() };
}
