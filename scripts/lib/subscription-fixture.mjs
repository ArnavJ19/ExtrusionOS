import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const sid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const sids = {
  company: sid(1), otherCompany: sid(2), owner: sid(10), sales: sid(11), salesMgr: sid(12), accounts: sid(13), production: sid(14), quality: sid(15), dispatcher: sid(16),
  viewer: sid(17), foreign: sid(18), dealer: sid(19), factory: sid(20),
  order: sid(30), order2: sid(31), foreignOrder: sid(32), job: sid(40), dispatch: sid(50), inspection: sid(60), quote: sid(70), invoice: sid(80)
};

// Hosted-shaped source tables; record states come from the real feature 67 helper.
export async function createSubscriptionFixture() {
  const db = new PGlite();
  const f = sids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table orders(id uuid primary key,company_id uuid,order_number text,current_stage text,deleted_at timestamptz);
    create table production_jobs(id uuid primary key,company_id uuid,job_number text,status text,order_id uuid);
    create table dispatches(id uuid primary key,company_id uuid,dispatch_number text,delivery_status text,order_id uuid);
    create table quality_inspections(id uuid primary key,company_id uuid,batch_number text,status text,production_job_id uuid);
    create table quotes(id uuid primary key,company_id uuid,quote_number text,status text,deleted_at timestamptz);
    create table invoices(id uuid primary key,company_id uuid,invoice_number text,status text,order_id uuid,grand_total numeric,amount_paid numeric default 0,credited_amount numeric default 0,
      balance_due numeric generated always as (greatest(grand_total - amount_paid - credited_amount, 0)) stored,deleted_at timestamptz);
    create table breakdown_logs(id uuid primary key,company_id uuid,status text,end_time timestamptz,resolved_at timestamptz);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null,recipient_user_id uuid,recipient_role text,notification_type text,severity text,title text,body text,
      related_entity_type text,related_entity_id uuid,is_read boolean default false,created_by uuid,action_link text,created_at timestamptz default clock_timestamp());
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(extractSqlFunction("supabase/migrations/20261022360000_task_completion_criteria.sql", "private.task_source_state"));
  await db.exec(readFileSync("supabase/migrations/20261022370000_record_subscriptions.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.sales) {
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
  /** A source change made by an employee (so the event records who changed it). */
  async function asActor(sql, actor) {
    await db.exec("begin");
    try {
      await db.query("select set_config('test.actor',$1,true)", [actor ?? ""]);
      await db.exec(sql);
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const command = async (name, payload, actor = f.sales) => (await asUser("select public.subscription_command($1,$2) data", [name, payload], actor))[0].data;
  const follow = (type, id, categories, actor = f.sales) => command("follow.set", { entity_type: type, entity_id: id, categories }, actor);
  const notifications = async (user, type) => (await db.query("select title, body, notification_type, severity from notifications where recipient_user_id=$1 and ($2::text is null or notification_type=$2) order by created_at, id", [user, type ?? null])).rows;
  const deliver = async () => (await db.query("select private.deliver_company_notifications($1) r", [f.company])).rows[0].r;

  async function reset() {
    await db.exec(`truncate action_request_reminders,action_requests,record_event_deliveries,notification_digests,record_events,notification_preferences,record_subscriptions,notifications,
      orders,production_jobs,dispatches,quality_inspections,quotes,invoices,breakdown_logs,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),
        ('${f.salesMgr}','${f.company}','sales_manager',true,'Sales Mgr Priya',null),('${f.accounts}','${f.company}','accounts',true,'Accounts Meena',null),
        ('${f.production}','${f.company}','production',true,'Press Lead',null),('${f.quality}','${f.company}','quality',true,'QC Meera',null),
        ('${f.dispatcher}','${f.company}','dispatch',true,'Dispatch Imran',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.dealer}','${f.company}','sales',true,'Dealer sales','${sid(700)}'),
        ('${f.factory}','${f.company}','factory_manager',true,'Factory Mgr',null);
      insert into orders values('${f.order}','${f.company}','SO-0042','extrusion_planned',null),('${f.order2}','${f.company}','SO-0043','packing',null),('${f.foreignOrder}','${f.otherCompany}','F-1','packing',null);
      insert into production_jobs values('${f.job}','${f.company}','PJ-0007','planned','${f.order}');
      insert into dispatches values('${f.dispatch}','${f.company}','DSP-0003','pending','${f.order}');
      insert into quality_inspections values('${f.inspection}','${f.company}','B-77','pending','${f.job}');
      insert into quotes values('${f.quote}','${f.company}','QT-0101','internal_review',null);
      insert into invoices(id,company_id,invoice_number,status,order_id,grand_total) values('${f.invoice}','${f.company}','INV-0009','sent','${f.order}',100000);`);
  }
  return { db, asUser, asActor, command, follow, notifications, deliver, reset, close: () => db.close() };
}
