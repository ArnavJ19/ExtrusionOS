import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const pid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const pids = {
  company: pid(1), otherCompany: pid(2), owner: pid(10), sales: pid(11), viewer: pid(12), production: pid(13), dealer: pid(14), foreign: pid(15), accountsUser: pid(16), quality: pid(17),
  kumar: pid(20), mehta: pid(21), inactiveCustomer: pid(22), foreignCustomer: pid(23),
  quote: pid(30), quote2: pid(31), mehtaQuote: pid(32), deletedQuote: pid(33),
  order: pid(40), order2: pid(41), mehtaOrder: pid(42), cancelledOrder: pid(43), foreignOrder: pid(44),
  dispatch: pid(50), dispatch2: pid(51), mehtaDispatch: pid(52), returned: pid(53)
};

export async function createCustomerProjectFixture() {
  const db = new PGlite();
  const f = pids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table customers(id uuid primary key,company_id uuid,customer_name text,company_name text,is_active boolean,deleted_at timestamptz);
    create table quotes(id uuid primary key,company_id uuid,customer_id uuid,quote_number text,quote_date date,status text,grand_total numeric,deleted_at timestamptz);
    create table orders(id uuid primary key,company_id uuid,customer_id uuid,quote_id uuid,order_number text,order_date date,current_stage text,expected_dispatch_date date,requested_weight_kg numeric,order_value numeric,deleted_at timestamptz);
    create table dispatches(id uuid primary key,company_id uuid,order_id uuid,dispatch_number text,dispatch_date date,delivery_status text,total_weight_kg numeric,vehicle_number text);
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022240000_customer_projects.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.customer_project_command($1,$2) data", [name, payload], actor))[0].data;

  async function reset() {
    await db.exec(`truncate customer_project_link_events,customer_project_links,customer_projects,dispatches,orders,quotes,customers,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner Asha',null),('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.production}','${f.company}','production',true,'Press Lead',null),
        ('${f.dealer}','${f.company}','dealer_admin',true,'Dealer','${pid(700)}'),('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),
        ('${f.accountsUser}','${f.company}','accounts',true,'Accounts',null),('${f.quality}','${f.company}','quality',true,'QC',null);
      insert into customers values('${f.kumar}','${f.company}','Kumar','Kumar Facades',true,null),('${f.mehta}','${f.company}','Mehta','Mehta Glass',true,null),
        ('${f.inactiveCustomer}','${f.company}','Old','Old Co',false,null),('${f.foreignCustomer}','${f.otherCompany}','F','Foreign Co',true,null);
      insert into quotes values('${f.quote}','${f.company}','${f.kumar}','QT-0001','2026-10-01','converted_to_order',118000,null),
        ('${f.quote2}','${f.company}','${f.kumar}','QT-0002','2026-10-10','sent',59000,null),
        ('${f.mehtaQuote}','${f.company}','${f.mehta}','QT-0003','2026-10-05','sent',1000,null),
        ('${f.deletedQuote}','${f.company}','${f.kumar}','QT-0004','2026-10-06','draft',1,now());
      insert into orders values('${f.order}','${f.company}','${f.kumar}','${f.quote}','SO-0001','2026-10-03','extrusion_planned','2026-11-01',1200,118000,null),
        ('${f.order2}','${f.company}','${f.kumar}',null,'SO-0002','2026-10-12','order_confirmed',null,800,70000,null),
        ('${f.mehtaOrder}','${f.company}','${f.mehta}','${f.quote}','SO-0003','2026-10-04','order_confirmed',null,700,5000,null),
        ('${f.cancelledOrder}','${f.company}','${f.kumar}',null,'SO-0004','2026-10-13','cancelled',null,999,99999,null),
        ('${f.foreignOrder}','${f.otherCompany}','${f.foreignCustomer}',null,'FOREIGN-1','2026-10-01','order_confirmed',null,1,1,null);
      insert into dispatches values('${f.dispatch}','${f.company}','${f.order}','DSP-0001','2026-10-15','delivered',600,'MH12AB1234'),
        ('${f.dispatch2}','${f.company}','${f.order}','DSP-0002','2026-10-18','pending',300,null),
        ('${f.mehtaDispatch}','${f.company}','${f.mehtaOrder}','DSP-0003','2026-10-16','delivered',100,null),
        ('${f.returned}','${f.company}','${f.order}','DSP-0004','2026-10-19','returned',50,null);`);
  }
  const create = (extra = {}, actor = pids.owner) => command("project.create", { request_id: pid(5000), customer_id: pids.kumar, name: "Lodha Altamount Tower B", site_name: "Tower B, Altamount Road", city: "Mumbai", state: "Maharashtra", pincode: "400026", contact_name: "Site engineer Joshi", contact_phone: "+91 98200 12345", ...extra }, actor);
  const link = (entity_type, entity_id, extra = {}, actor = pids.owner) => command("project.link", { project_id: pid(5000), entity_type, entity_id, ...extra }, actor);
  return { db, asUser, command, reset, create, link, close: () => db.close() };
}
