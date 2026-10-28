import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const xid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const xids = {
  company: xid(1), otherCompany: xid(2), owner: xid(10), factory: xid(11), dispatchMgr: xid(12), dispatcherA: xid(13), dispatcherB: xid(14), quality: xid(15),
  sales: xid(16), accounts: xid(17), viewer: xid(18), foreign: xid(19), dealer: xid(20), prodMgr: xid(21), leftDispatcher: xid(22), salesMgr: xid(23),
  overdueOrder: xid(30), onTimeOrder: xid(31), dispatchedOrder: xid(32), foreignOrder: xid(33),
  inspection: xid(40), breakdown: xid(50), shortBreakdown: xid(51), quote: xid(60), invoice: xid(70), paidInvoice: xid(71),
  dispatchRule: xid(100), qualityRule: xid(101), breakdownRule: xid(102), quoteRule: xid(103), invoiceRule: xid(104)
};

// Hosted-shaped source tables; the run uses the real supervised-roles helper from feature 13.
export async function createTaskTriggerFixture() {
  const db = new PGlite();
  const f = xids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table tasks(id uuid primary key default gen_random_uuid(),company_id uuid not null,task_type text not null default 'general',title text not null,description text,priority text not null default 'normal',status text not null default 'open',
      assigned_to uuid,due_date date,related_entity_type text,related_entity_id uuid,created_by uuid,completed_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default now(),dealership_id uuid,assigned_by_user_id uuid,
      check (priority in ('low','normal','high','urgent')),check (status in ('open','in_progress','completed','cancelled')));
    create table orders(id uuid primary key,company_id uuid,order_number text,expected_dispatch_date date,current_stage text,deleted_at timestamptz);
    create table quality_inspections(id uuid primary key,company_id uuid,batch_number text,quantity_checked_kg numeric,status text default 'pending',inspection_date timestamptz default now());
    create table breakdown_logs(id uuid primary key,company_id uuid,machine_id text,machine_type text,breakdown_date date default current_date,start_time timestamptz,end_time timestamptz,status text default 'open',resolved_at timestamptz);
    create table quotes(id uuid primary key,company_id uuid,quote_number text,status text,valid_until date,deleted_at timestamptz);
    create table invoices(id uuid primary key,company_id uuid,invoice_number text,due_date date,status text,balance_due numeric,deleted_at timestamptz);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null,recipient_user_id uuid,recipient_role text,notification_type text,severity text,title text,body text,
      related_entity_type text,related_entity_id uuid,is_read boolean default false,created_by uuid,action_link text,created_at timestamptz default now());
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(extractSqlFunction("supabase/migrations/20261022270000_bulk_queue_actions.sql", "private.bulk_supervised_roles"));
  await db.exec(readFileSync("supabase/migrations/20261022350000_task_trigger_rules.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.task_trigger_command($1,$2) data", [name, payload], actor))[0].data;
  const tasks = async () => (await db.query("select id, title, task_type, assigned_to, status, priority, due_date::text due, trigger_key, trigger_source_type, trigger_source_id, trigger_event_at, trigger_assignment, trigger_assignment_note from tasks where trigger_key is not null order by created_at, id")).rows;
  /** Rules are saved through the command, as the page does. */
  const rule = (id, fields, actor = f.owner) => command("rules.save", { id, due_days: 1, due_calendar: "calendar", ...fields }, actor);

  async function reset() {
    await db.exec(`truncate task_trigger_runs,notifications,tasks,task_trigger_rules,orders,quality_inspections,breakdown_logs,quotes,invoices,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.factory}','${f.company}','factory_manager',true,'Factory Mgr',null),
        ('${f.dispatchMgr}','${f.company}','dispatch_manager',true,'Dispatch Mgr',null),('${f.dispatcherA}','${f.company}','dispatch',true,'Arjun Dispatch',null),
        ('${f.dispatcherB}','${f.company}','dispatch',true,'Bina Dispatch',null),('${f.quality}','${f.company}','quality',true,'QC Meera',null),
        ('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),('${f.accounts}','${f.company}','accounts',true,'Accounts Meena',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),
        ('${f.dealer}','${f.company}','dispatch',true,'Dealer dispatch','${xid(700)}'),('${f.prodMgr}','${f.company}','production_manager',true,'Prod Mgr',null),
        ('${f.leftDispatcher}','${f.company}','dispatch',false,'Left Dispatch',null),('${f.salesMgr}','${f.company}','sales_manager',true,'Sales Mgr',null);
      insert into orders values('${f.overdueOrder}','${f.company}','SO-0042',current_date - 5,'packing',null),('${f.onTimeOrder}','${f.company}','SO-0043',current_date + 3,'extruded',null),
        ('${f.dispatchedOrder}','${f.company}','SO-0040',current_date - 9,'dispatched',null),('${f.foreignOrder}','${f.otherCompany}','FOREIGN-1',current_date - 20,'packing',null);
      insert into breakdown_logs(id,company_id,machine_id,machine_type,start_time,status) values('${f.breakdown}','${f.company}','PRESS-2','extrusion_press',now() - interval '7 hours','in_progress'),
        ('${f.shortBreakdown}','${f.company}','SAW-1','cutting_machine',now() - interval '1 hour','open');
      insert into quotes values('${f.quote}','${f.company}','QT-0101','sent',current_date + 2,null);
      insert into invoices values('${f.invoice}','${f.company}','INV-0009',current_date - 40,'sent',125000.50,null),('${f.paidInvoice}','${f.company}','INV-0008',current_date - 60,'paid',0,null);`);
  }
  return { db, asUser, command, tasks, rule, reset, close: () => db.close() };
}
