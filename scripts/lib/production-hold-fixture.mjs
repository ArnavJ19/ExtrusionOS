import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const hid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const hids = {
  company: hid(1), otherCompany: hid(2), owner: hid(10), operator: hid(11), viewer: hid(12), sales: hid(13), dealer: hid(14), foreign: hid(15), inactive: hid(16),
  order: hid(20), line: hid(21), profile: hid(30), otherProfile: hid(31), die: hid(40), otherDie: hid(41), press: hid(50), press2: hid(51),
  job: hid(60), otherJob: hid(61), foreignJob: hid(62), slot: hid(70), requirement: hid(80), billet1: hid(90), billet2: hid(91)
};

const M = "supabase/migrations/";

// Hosted-shaped production tables with the real start guards installed from their latest migrations.
export async function createProductionHoldFixture() {
  const db = new PGlite();
  const f = hids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table orders(id uuid primary key,company_id uuid,current_stage text);
    create table order_items(id uuid primary key,company_id uuid,order_id uuid,profile_id uuid);
    create table aluminium_profiles(id uuid primary key,company_id uuid,drawing_approval_status text);
    create table dies(id uuid primary key,company_id uuid,die_number text,profile_id uuid,die_status text);
    create table machines(id uuid primary key,company_id uuid,machine_name text,machine_type text,is_active boolean,status text);
    create table production_jobs(id uuid primary key,company_id uuid,order_id uuid,machine_id uuid,die_id uuid,profile_id uuid,status text,job_number text,source_line_id uuid,source_record_id uuid,remarks text,updated_at timestamptz,actual_quantity_kg numeric,actual_pieces integer);
    create table production_plan_slots(id uuid primary key,company_id uuid,production_job_id uuid,machine_id uuid,status text);
    create table production_job_status_history(id uuid primary key default gen_random_uuid(),company_id uuid,production_job_id uuid,previous_status text,new_status text,reason text,changed_by uuid,changed_by_role text,created_at timestamptz default clock_timestamp());
    create table order_billet_requirements(id uuid primary key,company_id uuid,order_id uuid,profile_id uuid,status text,billets_required integer);
    create table foundry_billets(id uuid primary key,company_id uuid,billet_code text,order_id uuid,production_job_id uuid,status text,weight_kg numeric,measured_weight_kg numeric,allocation_requirement_id uuid,allocated_at timestamptz,allocated_by uuid,updated_at timestamptz);
    create table private.production_billet_release_authorizations(transaction_id bigint not null,job_id uuid not null,company_id uuid not null,actor_id uuid not null,primary key(transaction_id,job_id));`);
  for (const [file, name] of [
    ["20261021100000_production_cancel_billet_release.sql", "private.release_production_job_billets"],
    ["20261021100000_production_cancel_billet_release.sql", "private.transition_production_job_atomic"],
    ["20261021050000_die_schedule_exclusivity.sql", "private.validate_production_start_resources"],
    ["20261021260000_physical_billet_issue_step.sql", "private.validate_production_job_source_line"]
  ]) await db.exec(extractSqlFunction(M + file, name));
  await db.exec(`create trigger validate_production_start_resources before insert or update of status on production_jobs for each row execute function private.validate_production_start_resources();
    create trigger production_job_source_line_guard before insert or update of company_id,order_id,profile_id,source_line_id,source_record_id,status on production_jobs for each row execute function private.validate_production_job_source_line();
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;
    grant select on all tables in schema public to authenticated;
    create function public.transition_production_job_atomic(p_job_id uuid,p_status text,p_reason text default null) returns uuid language sql security definer set search_path=public,private as $$select private.transition_production_job_atomic(p_job_id,p_status,p_reason)$$;
    grant execute on function public.transition_production_job_atomic(uuid,text,text) to authenticated;`);
  await db.exec(readFileSync(M + "20261022210000_production_readiness_and_holds.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.production_hold_command($1,$2) data", [name, payload], actor))[0].data;
  const transition = (status, actor = f.owner, job = f.job) => asUser("select public.transition_production_job_atomic($1,$2,$3) id", [job, status, "test"], actor);

  async function reset() {
    await db.exec(`truncate production_job_holds,production_job_status_history,production_jobs,production_plan_slots,foundry_billets,order_billet_requirements,orders,order_items,aluminium_profiles,dies,machines,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner Asha',null),('${f.operator}','${f.company}','production',true,'Press Operator Vik',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.sales}','${f.company}','sales',true,'Sales',null),('${f.dealer}','${f.company}','production',true,'Dealer prod',${`'${hid(700)}'`}),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.inactive}','${f.company}','production',false,'Gone',null);
      insert into orders values('${f.order}','${f.company}','extrusion_planned');
      insert into order_items values('${f.line}','${f.company}','${f.order}','${f.profile}');
      insert into aluminium_profiles values('${f.profile}','${f.company}','approved'),('${f.otherProfile}','${f.company}','pending');
      insert into dies values('${f.die}','${f.company}','DIE-12','${f.profile}','active'),('${f.otherDie}','${f.company}','DIE-99','${f.otherProfile}','active');
      insert into machines values('${f.press}','${f.company}','Press 1','extrusion_press',true,'active'),('${f.press2}','${f.company}','Press 2','extrusion_press',true,'active');
      insert into production_jobs values('${f.job}','${f.company}','${f.order}','${f.press}','${f.die}','${f.profile}','planned','PJ-0001','${f.line}',null,null,now(),null,null),
        ('${f.otherJob}','${f.company}','${f.order}','${f.press2}','${f.die}','${f.profile}','planned','PJ-0002','${f.line}',null,null,now(),null,null),
        ('${f.foreignJob}','${f.otherCompany}',null,null,null,null,'planned','FOREIGN',null,null,null,now(),null,null);
      insert into order_billet_requirements values('${f.requirement}','${f.company}','${f.order}','${f.profile}','open',2);
      insert into foundry_billets values('${f.billet1}','${f.company}','B-001','${f.order}','${f.job}','allocated',25,null,'${f.requirement}',now(),'${f.owner}',now()),
        ('${f.billet2}','${f.company}','B-002','${f.order}','${f.job}','allocated',25,null,'${f.requirement}',now(),'${f.owner}',now());`);
  }
  /** Puts the main job in "ready" with a released slot, as the release workflow would. */
  async function makeReady({ issue = true } = {}) {
    await db.exec(`insert into production_plan_slots values('${hids.slot}','${hids.company}','${hids.job}','${hids.press}','released');
      update production_jobs set status='ready' where id='${hids.job}';`);
    if (issue) await db.exec(`update foundry_billets set status='issued' where id='${hids.billet1}'`);
  }
  return { db, asUser, command, transition, reset, makeReady, close: () => db.close() };
}
