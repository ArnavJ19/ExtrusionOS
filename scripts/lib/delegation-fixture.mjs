import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { extractSqlFunction } from "./sql-function-extract.mjs";

export const gid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const gids = {
  company: gid(1), otherCompany: gid(2), owner: gid(10), prodManager: gid(11), dispatchManager: gid(12), absent: gid(13), cover: gid(14), cover2: gid(15),
  driver: gid(16), salesRep: gid(17), viewer: gid(18), foreign: gid(19), inactive: gid(20),
  t1: gid(100), t2: gid(101), t3: gid(102), tDone: gid(103), tOther: gid(104), tDispatchHandoff: gid(105), tPackHandoff: gid(106), tForeign: gid(107)
};

export async function createDelegationFixture() {
  const db = new PGlite();
  const f = gids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table tasks(id uuid primary key default gen_random_uuid(),company_id uuid not null,task_type text not null default 'general',title text not null,status text not null default 'open',assigned_to uuid,
      due_date date,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),dealership_id uuid,handoff_team text);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null,recipient_user_id uuid,recipient_role text,notification_type text,severity text,title text,body text,
      related_entity_type text,related_entity_id uuid,is_read boolean default false,created_by uuid,action_link text,created_at timestamptz default now());
    grant usage on schema public,private,auth to authenticated,anon;`);
  await db.exec(extractSqlFunction("supabase/migrations/20261022290000_handoff_acceptance.sql", "private.handoff_team_roles"));
  await db.exec(extractSqlFunction("supabase/migrations/20261022270000_bulk_queue_actions.sql", "private.bulk_supervised_roles"));
  await db.exec(`grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022310000_task_delegation.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.prodManager) {
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
  const command = async (name, payload, actor = f.prodManager) => (await asUser("select public.task_delegation_command($1,$2) data", [name, payload], actor))[0].data;
  const assignee = async (task) => (await db.query("select assigned_to from tasks where id=$1", [task])).rows[0].assigned_to;
  const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
  const create = (extra = {}, actor = f.prodManager) => command("delegation.create", { request_id: gid(5000), delegator_id: f.absent, delegate_id: f.cover, ends_at: hours(48), scope: "all_open", reason: "Annual leave", ...extra }, actor);

  async function reset() {
    await db.exec(`truncate task_delegation_items,task_delegations,notifications,tasks,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.prodManager}','${f.company}','production_manager',true,'Prod Mgr Kiran',null),
        ('${f.dispatchManager}','${f.company}','dispatch_manager',true,'Dispatch Mgr',null),('${f.absent}','${f.company}','production',true,'Operator Vik (on leave)',null),
        ('${f.cover}','${f.company}','production',true,'Operator Ravi',null),('${f.cover2}','${f.company}','production',true,'Operator Sam',null),
        ('${f.driver}','${f.company}','dispatch',true,'Loader Imran',null),('${f.salesRep}','${f.company}','sales',true,'Sales',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.inactive}','${f.company}','production',false,'Left',null);
      insert into tasks(id,company_id,task_type,title,status,assigned_to,handoff_team) values
        ('${f.t1}','${f.company}','general','Clean die DIE-12','open','${f.absent}',null),
        ('${f.t2}','${f.company}','general','Re-stack bundles','in_progress','${f.absent}',null),
        ('${f.t3}','${f.company}','general','Check puller','open','${f.absent}',null),
        ('${f.tDone}','${f.company}','general','Old','completed','${f.absent}',null),
        ('${f.tOther}','${f.company}','general','Someone else','open','${f.cover2}',null),
        ('${f.tDispatchHandoff}','${f.company}','department_handoff','Dispatch 400 kg','open','${f.absent}','dispatch'),
        ('${f.tPackHandoff}','${f.company}','department_handoff','Pack 100 kg','open','${f.absent}','packaging'),
        ('${f.tForeign}','${f.otherCompany}','general','FOREIGN','open','${f.absent}',null);`);
  }
  return { db, asUser, command, assignee, hours, create, reset, close: () => db.close() };
}
