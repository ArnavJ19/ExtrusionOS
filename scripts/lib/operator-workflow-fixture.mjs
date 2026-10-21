import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const workflowId = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const workflowIds = { company: workflowId(1), otherCompany: workflowId(2), actor: workflowId(10), otherActor: workflowId(11), colleague: workflowId(12), customer: workflowId(20), otherCustomer: workflowId(21), profile: workflowId(30), secondProfile: workflowId(31), otherProfile: workflowId(32), die: workflowId(40), item: workflowId(41), otherDie: workflowId(42), otherItem: workflowId(43), job: workflowId(50), otherJob: workflowId(51), order: workflowId(60), machine: workflowId(70) };

export async function createOperatorWorkflowFixture() {
  const db = new PGlite();
  const f = workflowIds;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table customers(id uuid primary key,company_id uuid,customer_name text,is_active boolean default true,deleted_at timestamptz);
    create table aluminium_profiles(id uuid primary key,company_id uuid,profile_code text,profile_name text,is_active boolean default true);
    create table dies(id uuid primary key,company_id uuid,rack_location text);
    create table inventory_items(id uuid primary key,company_id uuid,location text,current_stock numeric);
    create table production_jobs(id uuid primary key,company_id uuid,order_id uuid,machine_id uuid,operator_name text,status text);
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;
    insert into companies values('${f.company}'),('${f.otherCompany}');
    insert into app_users values('${f.actor}','${f.company}','owner',true,'Mira Sales',null),('${f.otherActor}','${f.otherCompany}','owner',true,'Other company',null),('${f.colleague}','${f.company}','sales',true,'Colleague',null);
    insert into customers values('${f.customer}','${f.company}','Mira Windows',true,null),('${f.otherCustomer}','${f.otherCompany}','FOREIGN CUSTOMER',true,null);
    insert into aluminium_profiles values('${f.profile}','${f.company}','AL-101','Window section',true),('${f.secondProfile}','${f.company}','AL-202','Door section',true),('${f.otherProfile}','${f.otherCompany}','FOREIGN','FOREIGN PROFILE',true);
    insert into dies values('${f.die}','${f.company}','Shed A / Rack 1'),('${f.otherDie}','${f.otherCompany}','FOREIGN DIE RACK');
    insert into inventory_items values('${f.item}','${f.company}','Shed B / Rack 4',420),('${f.otherItem}','${f.otherCompany}','FOREIGN STOCK RACK',999);
    insert into production_jobs values('${f.job}','${f.company}','${f.order}','${f.machine}','Recorded operator','in_progress'),('${f.otherJob}','${f.otherCompany}',null,null,'FOREIGN OPERATOR','in_progress');`);
  await db.exec(readFileSync("supabase/migrations/20261022000000_operator_workflow_helpers.sql", "utf8"));
  async function asUser(sql, parameters = [], { actor = f.actor, role = "owner", sqlRole = "authenticated" } = {}) {
    await db.query("update app_users set role=$1 where id=$2", [role, actor]);
    await db.exec("begin");
    try {
      await db.query("select set_config('test.actor',$1,true)", [actor]);
      if (sqlRole !== "authenticated" && sqlRole !== "anon") throw new Error("Unexpected SQL role");
      await db.exec(`set local role ${sqlRole}`);
      const result = await db.query(sql, parameters);
      await db.exec("commit");
      return result.rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const command = async (name, payload, options) => (await asUser("select public.operator_workflow_command($1,$2) data", [name, payload], options))[0].data;
  async function reset() {
    await db.exec("truncate customer_commitment_events,customer_commitments,production_exceptions,operator_location_history,customer_profile_aliases");
    await db.exec(`update customers set is_active=true,deleted_at=null;update aluminium_profiles set is_active=true;update app_users set is_active=true,dealer_id=null;`);
    await db.exec("alter table dies disable trigger operator_die_location_history;alter table inventory_items disable trigger operator_inventory_location_history");
    await db.exec(`update dies set rack_location='Shed A / Rack 1' where company_id='${f.company}';update inventory_items set location='Shed B / Rack 4' where company_id='${f.company}';`);
    await db.exec("alter table dies enable trigger operator_die_location_history;alter table inventory_items enable trigger operator_inventory_location_history");
  }
  return { db, command, asUser, reset, close: () => db.close() };
}
