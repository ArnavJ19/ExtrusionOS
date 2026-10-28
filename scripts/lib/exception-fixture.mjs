import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const eid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const eids = {
  company: eid(1), otherCompany: eid(2), owner: eid(10), admin: eid(11), salesMgr: eid(12), sales: eid(13), accounts: eid(14), dispatcher: eid(15), production: eid(16),
  foreign: eid(17), dealer: eid(18),
  kumar: eid(20), mehta: eid(21), quote: eid(30), lossQuote: eid(31), foreignQuote: eid(32), order: eid(40), mehtaOrder: eid(41), dispatch: eid(50), dispatch2: eid(51), mehtaDispatch: eid(52),
  overdueInvoice: eid(60), freshInvoice: eid(61)
};

// Hosted-shaped quotes and dispatches with the real pre-existing low-margin guard installed first.
export async function createExceptionFixture() {
  const db = new PGlite();
  const f = eids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table customers(id uuid primary key,company_id uuid,customer_name text,company_name text);
    create table quotes(id uuid primary key,company_id uuid,customer_id uuid,quote_number text,revision_number integer default 1,status text,grand_total numeric,total_margin_amount numeric,
      estimated_profit_amount numeric,estimated_profit_percent numeric,low_margin_approval_required boolean default false,deleted_at timestamptz,updated_at timestamptz default now());
    create table quote_items(id uuid primary key default gen_random_uuid(),company_id uuid,quote_id uuid,quantity_kg numeric,net_rate numeric,minimum_margin_percent numeric,created_at timestamptz default now(),updated_at timestamptz default now());
    create table orders(id uuid primary key,company_id uuid,customer_id uuid,order_number text);
    create table dispatches(id uuid primary key,company_id uuid,dispatch_number text,order_id uuid,total_weight_kg numeric,number_of_bundles integer,delivery_status text default 'pending');
    create table invoices(id uuid primary key,company_id uuid,customer_id uuid,invoice_number text,due_date date,status text,grand_total numeric,amount_paid numeric default 0,credited_amount numeric default 0,
      balance_due numeric generated always as (greatest(grand_total - amount_paid - credited_amount, 0)) stored,deleted_at timestamptz);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null,recipient_user_id uuid,recipient_role text,notification_type text,severity text,title text,body text,
      related_entity_type text,related_entity_id uuid,is_read boolean default false,created_by uuid,action_link text,created_at timestamptz default clock_timestamp());
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;
    grant select, update on quotes, dispatches to authenticated; grant insert on dispatches to authenticated;`);
  await db.exec(extractSqlFunction("supabase/migrations/20261008010000_access_projection_integrity.sql", "private.guard_low_margin_quote_approval"));
  await db.exec(`create trigger a_guard_low_margin_quote_approval before update of status on quotes for each row execute function private.guard_low_margin_quote_approval();`);
  await db.exec(readFileSync("supabase/migrations/20261022380000_exception_requests.sql", "utf8"));

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
  const command = async (name, payload, actor = f.sales) => (await asUser("select public.exception_command($1,$2) data", [name, payload], actor))[0].data;
  /** A step performed by an employee: the guards see their role. */
  const step = (sql, actor) => asUser(sql, [], actor);
  const policy = (type, fields, actor = f.owner) => command("policy.set", { exception_type: type, is_active: true, ...fields }, actor);
  const request = (type, entity, actor = f.sales, extra = {}) => command("request.create", { id: crypto.randomUUID(), exception_type: type, entity_id: entity, reason: "Strategic project; customer committed to 40 t this year", ...extra }, actor);
  const toDecide = async (actor) => (await command("request.list", { view: "to_decide" }, actor)).rows;

  async function reset() {
    await db.exec(`truncate exception_requests,exception_policies,notifications,invoices,dispatches,orders,quote_items,quotes,customers,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.admin}','${f.company}','admin',true,'Admin Kavya',null),
        ('${f.salesMgr}','${f.company}','sales_manager',true,'Sales Mgr Priya',null),('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),
        ('${f.accounts}','${f.company}','accounts',true,'Accounts Meena',null),('${f.dispatcher}','${f.company}','dispatch',true,'Dispatch Imran',null),
        ('${f.production}','${f.company}','production',true,'Press Lead',null),('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),
        ('${f.dealer}','${f.company}','sales',true,'Dealer sales','${eid(700)}');
      insert into customers values('${f.kumar}','${f.company}','Kumar','Kumar Facades'),('${f.mehta}','${f.company}','Mehta','Mehta Glass');
      insert into quotes(id,company_id,customer_id,quote_number,status,grand_total,total_margin_amount,estimated_profit_amount,estimated_profit_percent,low_margin_approval_required) values
        ('${f.quote}','${f.company}','${f.kumar}','QT-0101','internal_review',500000,22000,22000,4.4,true),
        ('${f.lossQuote}','${f.company}','${f.kumar}','QT-0102','internal_review',100000,-3000,-3000,-3,true),
        ('${f.foreignQuote}','${f.otherCompany}',null,'F-1','internal_review',1,0,0,0,true);
      insert into quote_items(company_id,quote_id,quantity_kg,net_rate,minimum_margin_percent) values('${f.company}','${f.quote}',1500,333.33,8),('${f.company}','${f.lossQuote}',300,333.33,8);
      insert into orders values('${f.order}','${f.company}','${f.kumar}','SO-0042'),('${f.mehtaOrder}','${f.company}','${f.mehta}','SO-0050');
      insert into dispatches values('${f.dispatch}','${f.company}','DSP-0003','${f.order}',1250.5,24,'pending'),('${f.dispatch2}','${f.company}','DSP-0004','${f.order}',300,6,'pending'),
        ('${f.mehtaDispatch}','${f.company}','DSP-0005','${f.mehtaOrder}',500,10,'pending');
      insert into invoices(id,company_id,customer_id,invoice_number,due_date,status,grand_total) values
        ('${f.overdueInvoice}','${f.company}','${f.kumar}','INV-0009',current_date - 45,'sent',180000),
        ('${f.freshInvoice}','${f.company}','${f.kumar}','INV-0010',current_date + 10,'sent',90000);`);
  }
  return { db, asUser, command, step, policy, request, toDecide, reset, close: () => db.close() };
}
