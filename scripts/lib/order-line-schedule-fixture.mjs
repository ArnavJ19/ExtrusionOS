import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const lid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const lids = {
  company: lid(1), otherCompany: lid(2), owner: lid(10), sales: lid(11), viewer: lid(12), production: lid(13), dealer: lid(14), foreign: lid(15), accountsUser: lid(16),
  customer: lid(20), profile: lid(21), order: lid(30), singleOrder: lid(31), closedOrder: lid(32), dispatchedOrder: lid(33), foreignOrder: lid(34),
  line1: lid(40), line2: lid(41), line3: lid(42), singleLine: lid(43), closedLine: lid(44), dispatchedLine: lid(45), foreignLine: lid(46),
  dispatch: lid(50), returned: lid(51)
};

const DAY = 86_400_000;
/** IST calendar date `n` days from today, as the database computes "today". */
export const day = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * DAY).toISOString().slice(0, 10);

export async function createOrderLineScheduleFixture() {
  const db = new PGlite();
  const f = lids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table customers(id uuid primary key,company_id uuid,customer_name text,company_name text);
    create table aluminium_profiles(id uuid primary key,company_id uuid,profile_code text);
    create table orders(id uuid primary key,company_id uuid,order_number text,customer_id uuid,order_date date,expected_dispatch_date date,priority text,current_stage text,deleted_at timestamptz,production_quantity_kg numeric,manufacturing_weight_kg numeric);
    create table order_items(id uuid primary key,company_id uuid,order_id uuid references orders(id),profile_id uuid,section_name text,component_description text,item_description text,quantity_kg numeric);
    create table production_jobs(id uuid primary key default gen_random_uuid(),company_id uuid,order_id uuid,source_line_id uuid,status text,planned_quantity_kg numeric,actual_quantity_kg numeric);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid,delivery_status text);
    create table packing_list_items(id uuid primary key default gen_random_uuid(),company_id uuid,dispatch_id uuid,source_line_id uuid,net_weight_kg numeric);
    create table order_dealer_stock_fulfillments(id uuid primary key default gen_random_uuid(),company_id uuid,order_item_id uuid,fulfilled_weight_kg numeric,credited_at timestamptz);
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022230000_order_line_delivery_schedule.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.order_line_schedule_command($1,$2) data", [name, payload], actor))[0].data;

  async function reset() {
    await db.exec(`truncate order_line_schedule_events,order_line_schedules,packing_list_items,dispatches,production_jobs,order_dealer_stock_fulfillments,order_items,orders,customers,aluminium_profiles,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner Asha',null),('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.production}','${f.company}','production',true,'Press Lead',null),
        ('${f.dealer}','${f.company}','dealer_admin',true,'Dealer',${`'${lid(700)}'`}),('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),
        ('${f.accountsUser}','${f.company}','accounts',true,'Accounts',null);
      insert into customers values('${f.customer}','${f.company}','Kumar','Kumar Facades');
      insert into aluminium_profiles values('${f.profile}','${f.company}','EX-101');
      insert into orders values
        ('${f.order}','${f.company}','SO-0001','${f.customer}','${day(-5)}','${day(10)}','normal','extrusion_planned',null,null,2000),
        ('${f.singleOrder}','${f.company}','SO-0002','${f.customer}','${day(-20)}','${day(-2)}','high','order_confirmed',null,800,900),
        ('${f.closedOrder}','${f.company}','SO-0003','${f.customer}','${day(-30)}','${day(-10)}','normal','closed',null,null,700),
        ('${f.dispatchedOrder}','${f.company}','SO-0004','${f.customer}','${day(-30)}','${day(-10)}','normal','dispatched',null,null,700),
        ('${f.foreignOrder}','${f.otherCompany}','FOREIGN-1',null,'${day(-5)}','${day(1)}','urgent','order_confirmed',null,null,700);
      insert into order_items values
        ('${f.line1}','${f.company}','${f.order}','${f.profile}','Sliding track',null,null,1000),
        ('${f.line2}','${f.company}','${f.order}','${f.profile}',null,'Interlock',null,500),
        ('${f.line3}','${f.company}','${f.order}','${f.profile}',null,null,null,null),
        ('${f.singleLine}','${f.company}','${f.singleOrder}','${f.profile}','Mullion',null,null,null),
        ('${f.closedLine}','${f.company}','${f.closedOrder}','${f.profile}','Closed',null,null,100),
        ('${f.dispatchedLine}','${f.company}','${f.dispatchedOrder}','${f.profile}','Gone',null,null,100),
        ('${f.foreignLine}','${f.otherCompany}','${f.foreignOrder}',null,'FOREIGN LINE',null,null,10);
      insert into dispatches values('${f.dispatch}','${f.company}','${f.order}','dispatched'),('${f.returned}','${f.company}','${f.order}','returned');`);
  }
  const set = (extra = {}, actor = lids.owner) => command("schedule.set", { order_item_id: lids.line1, required_date: day(3), priority: "urgent", reason: "Site needs tracks first", expected_version: 0, request_id: lid(5000), ...extra }, actor);
  const lines = async (actor = lids.owner, order = lids.order) => Object.fromEntries((await command("schedule.lines", { order_id: order }, actor)).rows.map((row) => [row.order_item_id, row]));
  return { db, asUser, command, reset, set, lines, close: () => db.close() };
}
