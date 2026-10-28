import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { procedureBaseSql, procedureSeedSql } from "./procedure-version-fixture.mjs";

export const bid = n => `00000000-0000-4000-8200-${String(n).padStart(12, "0")}`;
export const bids = {
  company: bid(1), otherCompany: bid(2),
  owner: bid(10), admin: bid(11), sopOwner: bid(12), sopBackup: bid(13), operator: bid(14), viewer: bid(15), foreign: bid(16), dealer: bid(17),
  factory: bid(18), quality: bid(19), operator2: bid(20), sop: bid(30), otherSop: bid(31), foreignSop: bid(32),
  job: bid(40), heldJob: bid(41), foreignJob: bid(42), order: bid(43)
};

// Stand-ins for the feature 67 helpers the blueprint reads (record states) and counts (criteria templates).
export const criteriaStubSql = `
  create table production_jobs(id uuid primary key,company_id uuid,status text);
  create table orders(id uuid primary key,company_id uuid,current_stage text);
  create table completion_criteria_templates(id uuid primary key default gen_random_uuid(),company_id uuid,task_kind text,is_active boolean default true);
  create function private.task_source_states(p_type text) returns text[] language sql immutable as $$
    select case p_type when 'production_job' then array['planned','ready','in_progress','completed','on_hold','cancelled']
      when 'order' then array['order_confirmed','packing','dispatched'] when 'quality_inspection' then array['pending','approved','rejected','rework']
      when 'dispatch' then array['pending','dispatched'] when 'quote' then array['draft','sent'] when 'invoice' then array['draft','paid'] when 'breakdown_log' then array['open','resolved'] else array[]::text[] end $$;
  create function private.task_source_state(p_company uuid, p_type text, p_id uuid) returns text language sql stable security definer set search_path=public,private as $$
    select case p_type when 'production_job' then (select status from production_jobs where id=p_id and company_id=p_company)
      when 'order' then (select current_stage from orders where id=p_id and company_id=p_company) end $$;`;

export async function createTaskBlueprintFixture() {
  const db = new PGlite();
  const f = bids;
  await db.exec(procedureBaseSql);
  await db.exec(criteriaStubSql);
  await db.exec(readFileSync("supabase/migrations/20261022390000_procedure_versions.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261022400000_task_blueprints.sql", "utf8"));

  async function asUser(sql, parameters = [], actor = f.factory) {
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
  /** A source write made by an employee through some server action (no role switch: the trigger is the guard). */
  async function act(sql, parameters = [], actor = f.operator) {
    await db.exec("begin");
    try {
      await db.query("select set_config('test.actor',$1,true)", [actor ?? ""]);
      const result = await db.query(sql, parameters);
      await db.exec("commit");
      return result.rows;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const command = async (name, payload, actor = f.factory) => (await asUser("select public.task_blueprint_command($1,$2) data", [name, payload], actor))[0].data;
  let seq = 200;
  const nextId = () => bid(++seq);
  const blueprint = (overrides = {}) => ({
    id: nextId(), task_kind: "type:die_change", title: "Die change", purpose: "Change the die on press 2 safely", trigger_text: "A production job needs a different die",
    inputs: ["Die number", "Billet size"], responsible_roles: ["production", "production_manager"], prerequisites: [{ kind: "record_state", entity_type: "production_job", states: ["ready", "planned"] }],
    exception_role: "production_manager", exception_instruction: "Call the shift supervisor before swapping dies", is_active: true, note: "First issue", ...overrides
  });
  async function addTask(values = {}) {
    const row = { task_type: "die_change", status: "open", assigned_to: f.operator, related_entity_type: "production_job", related_entity_id: f.job, handoff_team: null, ...values };
    return (await db.query("insert into tasks(company_id,task_type,status,assigned_to,related_entity_type,related_entity_id,handoff_team) values($1,$2,$3,$4,$5,$6,$7) returning id",
      [row.company ?? f.company, row.task_type, row.status, row.assigned_to, row.related_entity_type, row.related_entity_id, row.handoff_team])).rows[0].id;
  }
  const start = (task, actor = f.operator) => act("update tasks set status='in_progress' where id=$1", [task], actor);

  async function reset() {
    await db.exec(`truncate task_exceptions,task_blueprint_starts,task_blueprint_revisions,task_blueprints,completion_criteria_templates,task_procedure_binding_events,task_procedure_bindings,
      procedure_task_kinds,procedure_versions,operating_procedures,tasks,notifications,production_jobs,orders,app_users,companies cascade`);
    await db.exec(procedureSeedSql(f));
    await db.exec(`insert into app_users values('${f.factory}','${f.company}','factory_manager',true,'Factory Mgr',null),('${f.quality}','${f.company}','quality',true,'QC Leela',null),
        ('${f.operator2}','${f.company}','production',true,'Operator Ravi',null);
      insert into production_jobs values('${f.job}','${f.company}','ready'),('${f.heldJob}','${f.company}','on_hold'),('${f.foreignJob}','${f.otherCompany}','ready');
      insert into orders values('${f.order}','${f.company}','packing');
      insert into completion_criteria_templates(company_id,task_kind) values('${f.company}','type:die_change');`);
  }
  return { db, asUser, act, command, blueprint, addTask, start, nextId, reset, close: () => db.close() };
}
