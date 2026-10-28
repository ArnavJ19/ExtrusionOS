import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const sid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const sids = {
  company: sid(1), otherCompany: sid(2), outgoing: sid(10), incoming: sid(11), viewer: sid(12), sales: sid(13), dealer: sid(14), foreign: sid(15),
  press: sid(20), order: sid(30), jobDone: sid(40), jobRunning: sid(41), jobHeld: sid(42), jobOld: sid(43), jobReady: sid(44), jobForeign: sid(45), jobDoneLater: sid(46)
};

const HOUR = 3600 * 1000;
// The most recent day shift (08:00-20:00 IST = 02:30-14:30 UTC) that has already ended, so the
// server's "ended within the last 31 days" rule holds whenever the suite runs.
function latestDayShift(now = Date.now()) {
  const day = new Date(now);
  day.setUTCHours(2, 30, 0, 0);
  let start = day.getTime();
  while (start + 12 * HOUR > now) start -= 24 * HOUR;
  return start;
}
const base = latestDayShift();
/** ISO timestamp `hours` after the start of the test window. */
export const at = (hours) => new Date(base + hours * HOUR).toISOString();
/** IST calendar date `days` after the window's business date. */
export const istDate = (days) => new Date(base + 5.5 * HOUR + days * 24 * HOUR).toISOString().slice(0, 10);
export const WINDOW = { start: at(0), end: at(12) };

export async function createShiftHandoverFixture() {
  const db = new PGlite();
  const f = sids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table machines(id uuid primary key,company_id uuid,machine_name text);
    create table orders(id uuid primary key,company_id uuid,order_number text);
    create table production_jobs(id uuid primary key,company_id uuid,job_number text,status text,machine_id uuid,order_id uuid,planned_quantity_kg numeric,actual_quantity_kg numeric,completed_at timestamptz);
    create table production_job_holds(id uuid primary key,company_id uuid,production_job_id uuid,reason text,resume_condition text,responsible_name text,status text);
    create table production_exceptions(id uuid primary key,company_id uuid,production_job_id uuid,reason text,note text,reporter_name text,recorded_at timestamptz);
    create table breakdown_logs(id uuid primary key,company_id uuid,machine_id text,machine_ref_id uuid,status text,issue_description text,start_time timestamptz,end_time timestamptz,resolved_at timestamptz);
    create table quality_inspections(id uuid primary key,company_id uuid,production_job_id uuid,batch_number text,status text,quantity_checked_kg numeric,inspection_date timestamptz);
    create table profile_stock_batches(id uuid primary key,company_id uuid,qc_status text,status text,total_weight_kg numeric);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid,dispatch_number text,dispatch_date date,delivery_status text,vehicle_number text,transporter_name text,total_weight_kg numeric);
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022220000_shift_handover_summaries.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.outgoing) {
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
  const command = async (name, payload, actor = f.outgoing) => (await asUser("select public.shift_handover_command($1,$2) data", [name, payload], actor))[0].data;

  async function reset() {
    await db.exec(`truncate shift_handovers,companies,app_users,machines,orders,production_jobs,production_job_holds,production_exceptions,breakdown_logs,quality_inspections,profile_stock_batches,dispatches`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.outgoing}','${f.company}','production_manager',true,'Day Supervisor Neha',null),('${f.incoming}','${f.company}','production',true,'Night Supervisor Raj',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.sales}','${f.company}','sales',true,'Sales',null),('${f.dealer}','${f.company}','production',true,'Dealer prod','${sid(700)}'),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null);
      insert into machines values('${f.press}','${f.company}','Press 1');
      insert into orders values('${f.order}','${f.company}','SO-0042');
      insert into production_jobs values
        ('${f.jobDone}','${f.company}','PJ-1','completed','${f.press}','${f.order}',900,880,'${at(5.5)}'),
        ('${f.jobRunning}','${f.company}','PJ-2','in_progress','${f.press}','${f.order}',1000,350,null),
        ('${f.jobHeld}','${f.company}','PJ-3','on_hold','${f.press}','${f.order}',500,null,null),
        ('${f.jobOld}','${f.company}','PJ-0','completed','${f.press}','${f.order}',100,100,'${at(-18.5)}'),
        ('${f.jobReady}','${f.company}','PJ-4','ready','${f.press}','${f.order}',null,null,null),
        ('${f.jobDoneLater}','${f.company}','PJ-5','completed','${f.press}','${f.order}',200,190,'${at(12.5)}'),
        ('${f.jobForeign}','${f.otherCompany}','FOREIGN','in_progress',null,null,1,1,null);
      insert into production_job_holds values('${sid(90)}','${f.company}','${f.jobHeld}','die_problem','Die DIE-12 corrected','Night Supervisor Raj','active');
      insert into production_exceptions values('${sid(91)}','${f.company}','${f.jobRunning}','material_shortage','Billets short','Day Supervisor Neha','${at(3.5)}'),
        ('${sid(92)}','${f.company}','${f.jobRunning}','surface_defect','Yesterday','Someone','${at(-20.5)}');
      insert into breakdown_logs values
        ('${sid(93)}','${f.company}','legacy-press','${f.press}','resolved','Hydraulic leak','${at(-1)}','${at(1)}',null),
        ('${sid(94)}','${f.company}','legacy-press','${f.press}','open','Puller fault','${at(11)}',null,null),
        ('${sid(95)}','${f.company}','legacy-press','${f.press}','resolved','Before window','${at(-25.5)}','${at(-24.5)}',null),
        ('${sid(96)}','${f.otherCompany}','x',null,'open','FOREIGN BREAKDOWN','${at(2.5)}',null,null);
      insert into quality_inspections values('${sid(97)}','${f.company}','${f.jobDone}','B-77','rework',50,'${at(6.5)}'),
        ('${sid(98)}','${f.company}','${f.jobDone}','B-78','approved',50,'${at(7)}');
      insert into profile_stock_batches values('${sid(99)}','${f.company}','on_hold','available',120.5),('${sid(100)}','${f.company}','on_hold','dispatched',999),('${sid(101)}','${f.company}','released','available',10);
      insert into dispatches values('${sid(102)}','${f.company}','${f.order}','D-1','${istDate(0)}','pending','MH12AB1234','VRL',800),
        ('${sid(103)}','${f.company}','${f.order}','D-0','${istDate(-2)}','pending',null,null,100),
        ('${sid(104)}','${f.company}','${f.order}','D-2','${istDate(1)}','pending',null,null,100),
        ('${sid(105)}','${f.company}','${f.order}','D-3','${istDate(0)}','dispatched',null,null,100);`);
  }
  return { db, asUser, command, reset, close: () => db.close() };
}
