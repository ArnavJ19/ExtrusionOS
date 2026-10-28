import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const kid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const kids = {
  company: kid(1), otherCompany: kid(2), owner: kid(10), factory: kid(11), prodMgr: kid(12), operator: kid(13), quality: kid(14), quality2: kid(15), dispatcher: kid(16),
  viewer: kid(17), foreign: kid(18), dealer: kid(19), salesMgr: kid(20),
  profile: kid(30), order: kid(40), order2: kid(41), foreignOrder: kid(42), job: kid(50), inspection: kid(60), dispatch: kid(70), invoice: kid(80), breakdown: kid(90),
  task: kid(100), inspectionTask: kid(101), handoffTask: kid(102), plainTask: kid(103), foreignTask: kid(104), plan: kid(110)
};

const M = "supabase/migrations/";

// Hosted-shaped tables with the real inspection plans (feature 54) underneath the criteria.
export async function createCompletionCriteriaFixture() {
  const db = new PGlite();
  const f = kids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table tasks(id uuid primary key default gen_random_uuid(),company_id uuid not null,task_type text not null default 'general',title text not null,description text,priority text not null default 'normal',status text not null default 'open',
      assigned_to uuid,due_date date,related_entity_type text,related_entity_id uuid,created_by uuid,completed_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default now(),dealership_id uuid,
      assigned_by_user_id uuid,handoff_key text,handoff_team text,check (status in ('open','in_progress','completed','cancelled')));
    create table handoff_acceptances(task_id uuid primary key references tasks(id) on delete cascade,company_id uuid not null,state text not null default 'pending');
    create table orders(id uuid primary key,company_id uuid,order_number text,current_stage text,deleted_at timestamptz);
    create table production_jobs(id uuid primary key,company_id uuid,status text);
    create table dispatches(id uuid primary key,company_id uuid,delivery_status text);
    create table quotes(id uuid primary key,company_id uuid,status text,deleted_at timestamptz);
    create table invoices(id uuid primary key,company_id uuid,status text,balance_due numeric,deleted_at timestamptz);
    create table breakdown_logs(id uuid primary key,company_id uuid,status text,end_time timestamptz,resolved_at timestamptz);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null,recipient_user_id uuid,recipient_role text,notification_type text,severity text,title text,body text,
      related_entity_type text,related_entity_id uuid,is_read boolean default false,created_by uuid,action_link text,created_at timestamptz default now());
    create table aluminium_profiles(id uuid primary key,company_id uuid,profile_code text);
    create table quality_inspections(id uuid primary key default gen_random_uuid(),company_id uuid,production_job_id uuid,finishing_job_id uuid,profile_id uuid,inspection_date timestamptz,batch_number text,
      quantity_checked_kg numeric,status text,inspector_name text,surface_finish_ok boolean,notes text);
    create table quality_rework_resolutions(id uuid primary key default gen_random_uuid(),company_id uuid,source_inspection_id uuid,production_job_id uuid,finishing_job_id uuid,profile_id uuid,
      source_quantity_kg numeric,approved_weight_kg numeric,rejected_weight_kg numeric,reason text,inspector_name text,resolved_by uuid,created_at timestamptz default now());
    alter table quality_inspections add column resolution_id uuid references quality_rework_resolutions(id);
    create table private.quality_resolution_authorizations(transaction_id bigint not null,resolution_id uuid not null,actor_id uuid not null,children_remaining integer not null,primary key(transaction_id,resolution_id));`);
  await db.exec(extractSqlFunction(M + "20261008020000_factory_workflow_integrity.sql", "private.guard_quality_resolution_child"));
  await db.exec(`create trigger guard_quality_resolution_child before insert or update of resolution_id on quality_inspections for each row execute function private.guard_quality_resolution_child();
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync(M + "20261022320000_inspection_plans.sql", "utf8"));
  await db.exec(readFileSync(M + "20261022360000_task_completion_criteria.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.task_criteria_command($1,$2) data", [name, payload], actor))[0].data;
  const evaluate = (task, actor) => command("task.evaluate", { task_id: task }, actor);
  /** Completes a task the way the tasks API does: a direct update by a privileged session. */
  const complete = (task) => db.query(`update tasks set status='completed', completed_at=now() where id=$1`, [task]);
  const addCriterion = (task, id, kind, label, config = {}, actor = f.prodMgr) => command("criteria.add", { task_id: task, id, kind, label, config }, actor);
  /** A two-characteristic plan for the profile, drafted by one quality user and approved by another. */
  async function approvedPlan() {
    const plan = (payload, actor) => asUser("select public.inspection_plan_command($1,$2) data", [payload.command, payload.body], actor);
    await plan({ command: "plan.save_draft", body: { plan_id: f.plan, profile_id: f.profile, sampling_instruction: "3 pieces per lot", items: [
      { characteristic: "Wall thickness", unit: "mm", nominal: 1.6, lower_limit: 1.52, upper_limit: 1.68 }, { characteristic: "Surface finish", unit: "visual" }] } }, f.quality);
    await plan({ command: "plan.approve", body: { plan_id: f.plan } }, f.quality2);
    const items = (await db.query("select id from inspection_plan_items where plan_id=$1 order by seq", [f.plan])).rows;
    const record = (results) => plan({ command: "results.record", body: { inspection_id: f.inspection, plan_id: f.plan, results } }, f.quality);
    return { items, record };
  }

  async function reset() {
    await db.exec(`truncate task_completion_checks,task_criterion_evidence,task_completion_criteria,completion_criteria_templates,handoff_acceptances,notifications,tasks,
      inspection_results,inspection_plan_items,inspection_plans,quality_inspections,quality_rework_resolutions,aluminium_profiles,orders,production_jobs,dispatches,quotes,invoices,breakdown_logs,app_users,companies cascade;
      truncate private.quality_resolution_authorizations;`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.factory}','${f.company}','factory_manager',true,'Factory Mgr',null),
        ('${f.prodMgr}','${f.company}','production_manager',true,'Prod Mgr Rao',null),('${f.operator}','${f.company}','production',true,'Operator Sunil',null),
        ('${f.quality}','${f.company}','quality',true,'QC Meera',null),('${f.quality2}','${f.company}','quality',true,'QC Anil',null),
        ('${f.dispatcher}','${f.company}','dispatch',true,'Dispatch Imran',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.dealer}','${f.company}','production_manager',true,'Dealer mgr','${kid(700)}'),
        ('${f.salesMgr}','${f.company}','sales_manager',true,'Sales Mgr',null);
      insert into aluminium_profiles values('${f.profile}','${f.company}','EX-101');
      insert into orders values('${f.order}','${f.company}','SO-0042','packing',null),('${f.order2}','${f.company}','SO-0043','packing',null),('${f.foreignOrder}','${f.otherCompany}','F-1','dispatched',null);
      insert into production_jobs values('${f.job}','${f.company}','completed');
      insert into dispatches values('${f.dispatch}','${f.company}','in_transit');
      insert into invoices values('${f.invoice}','${f.company}','sent',5000,null);
      insert into breakdown_logs values('${f.breakdown}','${f.company}','in_progress',null,null);
      insert into quality_inspections(id,company_id,production_job_id,profile_id,quantity_checked_kg,status) values('${f.inspection}','${f.company}','${f.job}','${f.profile}',500,'pending');
      insert into tasks(id,company_id,task_type,title,assigned_to,related_entity_type,related_entity_id) values
        ('${f.task}','${f.company}','dispatch_follow_up','Dispatch SO-0042','${f.dispatcher}','order','${f.order}'),
        ('${f.inspectionTask}','${f.company}','quality_follow_up','Inspect lot B-77','${f.quality}','quality_inspection','${f.inspection}'),
        ('${f.plainTask}','${f.company}','general','Clean die rack','${f.operator}',null,null),
        ('${f.foreignTask}','${f.otherCompany}','general','FOREIGN',null,null,null);
      insert into tasks(id,company_id,task_type,title,related_entity_type,related_entity_id,handoff_key,handoff_team) values
        ('${f.handoffTask}','${f.company}','department_handoff','Pack 400 kg','quality_inspection','${f.inspection}','inspection_release:x','packaging');
      insert into handoff_acceptances values('${f.handoffTask}','${f.company}','pending');`);
  }
  return { db, asUser, command, evaluate, complete, addCriterion, approvedPlan, reset, close: () => db.close() };
}
