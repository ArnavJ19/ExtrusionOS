import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const tid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const tids = {
  company: tid(1), otherCompany: tid(2), owner: tid(10), factory: tid(11), packer: tid(12), viewer: tid(13), foreign: tid(14), dealer: tid(15), prodManager: tid(16),
  pack: tid(100), packLate: tid(101), general: tid(102), done: tid(103), untargeted: tid(104), dealerTask: tid(105), foreignTask: tid(106)
};

export async function createTurnaroundFixture() {
  const db = new PGlite();
  const f = tids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table tasks(id uuid primary key,company_id uuid not null,task_type text not null default 'general',title text not null,status text not null default 'open',assigned_to uuid,
      due_date date,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),dealership_id uuid,handoff_team text);
    create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid not null,recipient_user_id uuid,recipient_role text,notification_type text,severity text,title text,body text,
      related_entity_type text,related_entity_id uuid,is_read boolean default false,created_by uuid,action_link text,created_at timestamptz default now());
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022300000_turnaround_targets.sql", "utf8"));

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
  const command = async (name, payload, actor = f.owner) => (await asUser("select public.turnaround_command($1,$2) data", [name, payload], actor))[0].data;
  const status = async (id, actor = f.owner) => (await command("task.status", { task_ids: [id] }, actor))[0];

  async function reset() {
    await db.exec(`truncate task_escalations,task_waits,task_turnaround_marks,turnaround_targets,notifications,tasks,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.factory}','${f.company}','factory_manager',true,'Factory Mgr',null),
        ('${f.packer}','${f.company}','production',true,'Packer Sunil',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
        ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.dealer}','${f.company}','dealer_admin',true,'Dealer','${tid(700)}'),
        ('${f.prodManager}','${f.company}','production_manager',true,'Prod Mgr',null);
      insert into turnaround_targets(company_id,task_kind,response_minutes,completion_minutes,calendar,escalation_role,updated_by) values
        ('${f.company}','handoff:packaging',60,240,'24x7','production_manager','${f.owner}'),
        ('${f.company}','type:general',null,120,'24x7','factory_manager','${f.owner}');
      insert into tasks(id,company_id,task_type,title,status,assigned_to,created_at,dealership_id,handoff_team) values
        ('${f.pack}','${f.company}','department_handoff','Pack 400 kg','open',null,now() - interval '30 minutes',null,'packaging'),
        ('${f.packLate}','${f.company}','department_handoff','Pack 200 kg (late)','open',null,now() - interval '90 minutes',null,'packaging'),
        ('${f.general}','${f.company}','general','Clean die','open','${f.packer}',now() - interval '100 minutes',null,null),
        ('${f.done}','${f.company}','general','Done task','open',null,now() - interval '200 minutes',null,null),
        ('${f.untargeted}','${f.company}','maintenance','Oil change','open',null,now() - interval '10 days',null,null),
        ('${f.dealerTask}','${f.company}','general','Dealer task','open',null,now() - interval '10 days','${tid(700)}',null),
        ('${f.foreignTask}','${f.otherCompany}','general','FOREIGN','open',null,now() - interval '10 days',null,null);`);
  }
  return { db, asUser, command, status, reset, close: () => db.close() };
}
