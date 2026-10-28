import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const rid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const rids = {
  company: rid(1), otherCompany: rid(2), owner: rid(10), salesManager: rid(11), sales: rid(12), accounts: rid(13), production: rid(14), foreign: rid(15), dealer: rid(16),
  kumar: rid(20), mehta: rid(21), quote: rid(30), quote2: rid(31),
  billetGeneral: rid(40), billetNew: rid(41), conversion: rid(42), kumarConversion: rid(43), powderSqft: rid(44)
};

export async function createCostingRateFixture() {
  const db = new PGlite();
  const f = rids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table customers(id uuid primary key,company_id uuid,customer_name text,company_name text);
    create table quotes(id uuid primary key,company_id uuid,customer_id uuid,quote_number text,quote_date date,status text,revision_number integer default 1,deleted_at timestamptz);
    create table quote_items(id uuid primary key default gen_random_uuid(),company_id uuid,quote_id uuid,section_name text,item_description text,component_description text,
      billet_rate_per_kg numeric,conversion_charge_per_kg numeric,finishing_type text,finishing_charge_type text,finishing_charge numeric,created_at timestamptz default clock_timestamp());
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022340000_costing_rates.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.salesManager) {
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
  const command = async (name, payload, actor = f.salesManager) => (await asUser("select public.costing_rate_command($1,$2) data", [name, payload], actor))[0].data;
  /** Drafts by accounts, approves by the sales manager (four eyes). */
  async function approved(id, fields) {
    await command("rates.save_draft", { id, ...fields }, f.accounts);
    await command("rates.approve", { id }, f.salesManager);
  }

  async function reset() {
    await db.exec(`truncate quote_rate_bindings,costing_rates,quote_items,quotes,customers,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.salesManager}','${f.company}','sales_manager',true,'Sales Mgr Priya',null),
        ('${f.sales}','${f.company}','sales',true,'Sales Ravi',null),('${f.accounts}','${f.company}','accounts',true,'Accounts Meena',null),
        ('${f.production}','${f.company}','production',true,'Press Lead',null),('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),
        ('${f.dealer}','${f.company}','sales',true,'Dealer sales','${rid(700)}');
      insert into customers values('${f.kumar}','${f.company}','Kumar','Kumar Facades'),('${f.mehta}','${f.company}','Mehta','Mehta Glass');
      insert into quotes values('${f.quote}','${f.company}','${f.kumar}','QT-0001','2026-10-15','internal_review',1,null),('${f.quote2}','${f.company}','${f.mehta}','QT-0002','2026-10-15','draft',1,null);
      insert into quote_items(company_id,quote_id,section_name,billet_rate_per_kg,conversion_charge_per_kg,finishing_type,finishing_charge_type,finishing_charge) values
        ('${f.company}','${f.quote}','Sliding track',248,40,'powder_coating','per_sqft',18),
        ('${f.company}','${f.quote}','Interlock',250,45,'mill_finish',null,0),
        ('${f.company}','${f.quote2}','Mullion',250,45,'anodizing','per_kg',22);`);
  }
  return { db, asUser, command, approved, reset, close: () => db.close() };
}
