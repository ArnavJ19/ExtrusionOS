import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const pid = n => `00000000-0000-4000-8100-${String(n).padStart(12, "0")}`;
export const pids = {
  company: pid(1), otherCompany: pid(2),
  owner: pid(10), admin: pid(11), sopOwner: pid(12), sopBackup: pid(13), operator: pid(14), viewer: pid(15), foreign: pid(16), dealer: pid(17),
  sop: pid(20), otherSop: pid(21), foreignSop: pid(22)
};

/** Base tables the feature 77 migration needs, cut down to the columns it reads and writes. */
export const procedureBaseSql = `
  create role authenticated;create role anon;create schema auth;create schema private;
  create table companies(id uuid primary key);
  create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
  create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
  create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
  create table operating_procedures(id uuid primary key,company_id uuid,title text,owner_id uuid,owner_name text,backup_id uuid,backup_name text,revision integer not null default 1,is_active boolean default true);
  create table tasks(id uuid primary key default gen_random_uuid(),company_id uuid,task_type text not null default 'general',title text not null default 'Task',status text not null default 'open',
    assigned_to uuid,dealership_id uuid,handoff_team text,completed_at timestamptz,updated_at timestamptz default now(),created_at timestamptz default now(),related_entity_type text,related_entity_id uuid);
  create table notifications(id uuid primary key default gen_random_uuid(),company_id uuid,recipient_user_id uuid,recipient_role text,notification_type text,severity text,title text,body text,
    related_entity_type text,related_entity_id uuid,created_by uuid,action_link text,created_at timestamptz default now());
  grant usage on schema public,private,auth to authenticated,anon;
  grant execute on all functions in schema private,auth to authenticated;`;

export const procedureSeedSql = f => `
  insert into companies values('${f.company}'),('${f.otherCompany}');
  insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner Rao',null),('${f.admin}','${f.company}','admin',true,'Admin Meera',null),
    ('${f.sopOwner}','${f.company}','production_manager',true,'SOP Owner Kiran',null),('${f.sopBackup}','${f.company}','quality',true,'Backup Leela',null),
    ('${f.operator}','${f.company}','production',true,'Operator Vik',null),('${f.viewer}','${f.company}','viewer',true,'Viewer',null),
    ('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.dealer}','${f.company}','dealer_admin',true,'Dealer',gen_random_uuid());
  insert into operating_procedures(id,company_id,title,owner_id,owner_name,backup_id,backup_name) values
    ('${f.sop}','${f.company}','Die change on press 2','${f.sopOwner}','SOP Owner Kiran','${f.sopBackup}','Backup Leela'),
    ('${f.otherSop}','${f.company}','Bundle strapping','${f.admin}','Admin Meera',null,null),
    ('${f.foreignSop}','${f.otherCompany}','Foreign SOP','${f.foreign}','Foreign',null,null);`;

export async function createProcedureVersionFixture() {
  const db = new PGlite();
  const f = pids;
  await db.exec(procedureBaseSql);
  await db.exec(readFileSync("supabase/migrations/20261022390000_procedure_versions.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.sopOwner) {
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
  const command = async (name, payload, actor = f.sopOwner) => (await asUser("select public.procedure_version_command($1,$2) data", [name, payload], actor))[0].data;
  let seq = 100;
  const nextId = () => pid(++seq);
  const steps = (...texts) => texts.map(text => ({ text }));
  /** Writes, submits and releases a version: author writes, reviewer releases. */
  async function release({ procedure = f.sop, author = f.sopOwner, reviewer = f.sopBackup, stepsList = steps("Isolate the press", "Fit the die", "Run a trial billet"),
    summary = "First issue", effective = "today", policy = "keep_current" } = {}) {
    const draft = await command("draft.save", { procedure_id: procedure, version_id: nextId(), steps: stepsList, change_summary: summary, expected_hash: null }, author);
    const submitted = await command("draft.submit", { version_id: draft.id, expected_hash: draft.content_hash }, author);
    const date = effective === "today" ? (await db.query("select private.ist_today()::text d")).rows[0].d : effective;
    return command("review.release", { version_id: draft.id, expected_hash: submitted.content_hash, effective_from: date, in_flight_policy: policy }, reviewer);
  }
  async function addTask(values = {}) {
    const row = { task_type: "die_change", status: "open", dealership_id: null, handoff_team: null, ...values };
    const result = await db.query("insert into tasks(company_id,task_type,status,dealership_id,handoff_team) values($1,$2,$3,$4,$5) returning id",
      [row.company ?? f.company, row.task_type, row.status, row.dealership_id, row.handoff_team]);
    return result.rows[0].id;
  }
  const setStatus = (task, status) => db.query("update tasks set status=$2, completed_at=case when $2='completed' then now() end where id=$1", [task, status]);
  const binding = async task => (await db.query(`select b.*, v.version_no from task_procedure_bindings b join procedure_versions v on v.id=b.version_id where b.task_id=$1`, [task])).rows[0];
  const daysFromToday = async n => (await db.query(`select (private.ist_today() + $1::integer)::text d`, [n])).rows[0].d;

  async function reset() {
    await db.exec(`truncate task_procedure_binding_events,task_procedure_bindings,procedure_task_kinds,procedure_versions,operating_procedures,tasks,notifications,app_users,companies cascade`);
    await db.exec(procedureSeedSql(f));
  }
  return { db, asUser, command, release, addTask, setStatus, binding, daysFromToday, steps, nextId, reset, close: () => db.close() };
}
