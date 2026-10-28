import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const qid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const qids = {
  company: qid(1), otherCompany: qid(2), owner: qid(10), prodManager: qid(11), dispatchManager: qid(12), operator: qid(13), operator2: qid(14), driver: qid(15),
  salesRep: qid(16), viewer: qid(17), inactive: qid(18), foreign: qid(19), dealerUser: qid(20), factoryManager: qid(21),
  // tasks
  tOpen: qid(100), tProgress: qid(101), tDone: qid(102), tDealer: qid(103), tSales: qid(104), tHandoffDispatch: qid(105), tForeign: qid(106), tAssignedOp: qid(107),
  // production jobs
  jPlanned: qid(200), jPlanned2: qid(201), jRunning: qid(202), jScheduled: qid(203), jReady: qid(204), jForeign: qid(205)
};

export async function createBulkQueueFixture() {
  const db = new PGlite();
  const f = qids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table tasks(id uuid primary key,company_id uuid not null,task_type text not null default 'general',title text not null,priority text not null default 'normal',status text not null default 'open',
      assigned_to uuid,due_date date,dealership_id uuid,assigned_by_user_id uuid,updated_at timestamptz not null default now(),
      handoff_key text,handoff_team text,check (priority in ('low','normal','high','urgent')));
    create table production_jobs(id uuid primary key,company_id uuid,job_number text,status text,planned_date date,shift text,machine_id uuid,updated_at timestamptz default now());
    create table production_plan_slots(id uuid primary key default gen_random_uuid(),company_id uuid,production_job_id uuid,status text);
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(extractSqlFunction("supabase/migrations/20261022260000_department_handoffs.sql", "private.handoff_team_roles"));
  await db.exec(readFileSync("supabase/migrations/20261022270000_bulk_queue_actions.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.bulk_queue_command($1,$2) data", [name, payload], actor))[0].data;
  /** Preview, then apply with the preview's fingerprints, as the app does. */
  async function previewAndApply(payload, actor = f.owner, requestId = qid(5000)) {
    const preview = await command("bulk.preview", payload, actor);
    const expected = Object.fromEntries(preview.results.filter((r) => r.fingerprint).map((r) => [r.id, r.fingerprint]));
    const applied = await command("bulk.apply", { ...payload, expected, request_id: requestId }, actor);
    return { preview, applied, expected };
  }
  const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));

  async function reset() {
    await db.exec(`truncate bulk_queue_operations,tasks,production_jobs,production_plan_slots,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values
        ('${f.owner}','${f.company}','owner',true,'Owner Asha',null),('${f.prodManager}','${f.company}','production_manager',true,'Prod Mgr Kiran',null),
        ('${f.dispatchManager}','${f.company}','dispatch_manager',true,'Dispatch Mgr Lata',null),('${f.operator}','${f.company}','production',true,'Operator Vik',null),
        ('${f.operator2}','${f.company}','production',true,'Operator Ravi',null),('${f.driver}','${f.company}','dispatch',true,'Loader Imran',null),
        ('${f.salesRep}','${f.company}','sales',true,'Sales Neel',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
        ('${f.inactive}','${f.company}','production',false,'Left',null),('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),
        ('${f.dealerUser}','${f.company}','production',true,'Dealer staff','${qid(700)}'),('${f.factoryManager}','${f.company}','factory_manager',true,'Factory Mgr',null);
      insert into tasks(id,company_id,title,priority,status,assigned_to,due_date,dealership_id,handoff_key,handoff_team) values
        ('${f.tOpen}','${f.company}','Clean die DIE-12','normal','open',null,null,null,null,null),
        ('${f.tProgress}','${f.company}','Re-stack bundles','high','in_progress','${f.operator2}','2030-01-01',null,null,null),
        ('${f.tDone}','${f.company}','Old task','normal','completed',null,null,null,null,null),
        ('${f.tDealer}','${f.company}','Dealer follow-up','normal','open',null,null,'${qid(700)}',null,null),
        ('${f.tSales}','${f.company}','Call Kumar Facades','normal','open','${f.salesRep}',null,null,null,null),
        ('${f.tHandoffDispatch}','${f.company}','Dispatch 400 kg packed','urgent','open',null,null,null,'packaging_complete:x','dispatch'),
        ('${f.tForeign}','${f.otherCompany}','FOREIGN','normal','open',null,null,null,null,null),
        ('${f.tAssignedOp}','${f.company}','Check puller','normal','open','${f.operator}',null,null,null,null);
      insert into production_jobs values
        ('${f.jPlanned}','${f.company}','PJ-0001','planned','2030-01-10','A',null,now()),('${f.jPlanned2}','${f.company}','PJ-0002','planned',null,null,null,now()),
        ('${f.jRunning}','${f.company}','PJ-0003','in_progress','2030-01-10','A',null,now()),('${f.jScheduled}','${f.company}','PJ-0004','planned','2030-01-10','A',null,now()),
        ('${f.jReady}','${f.company}','PJ-0005','ready','2030-01-10','A',null,now()),('${f.jForeign}','${f.otherCompany}','FOREIGN','planned',null,null,null,now());
      insert into production_plan_slots(company_id,production_job_id,status) values('${f.company}','${f.jScheduled}','planned'),('${f.company}','${f.jReady}','released');`);
  }
  return { db, asUser, command, previewAndApply, byId, reset, close: () => db.close() };
}
