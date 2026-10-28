import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { procedureBaseSql, procedureSeedSql } from "./procedure-version-fixture.mjs";
import { criteriaStubSql } from "./task-blueprint-fixture.mjs";

export const eid = n => `00000000-0000-4000-8300-${String(n).padStart(12, "0")}`;
export const eids = {
  company: eid(1), otherCompany: eid(2),
  owner: eid(10), admin: eid(11), sopOwner: eid(12), sopBackup: eid(13), operator: eid(14), viewer: eid(15), foreign: eid(16), dealer: eid(17), operator2: eid(18),
  sop: eid(30), otherSop: eid(31), foreignSop: eid(32)
};

// The feature 69 tables the outcomes read, cut down to the columns used.
const handoffStubSql = `
  create table handoff_acceptances(task_id uuid primary key,company_id uuid,state text,return_count integer not null default 0);
  create table handoff_returns(id uuid primary key default gen_random_uuid(),company_id uuid,handoff_task_id uuid,return_task_id uuid,reason text,returned_at timestamptz default now());`;

export async function createProcedureEffectivenessFixture() {
  const db = new PGlite();
  const f = eids;
  await db.exec(procedureBaseSql);
  await db.exec(criteriaStubSql);
  await db.exec(handoffStubSql);
  for (const file of ["20261022390000_procedure_versions", "20261022400000_task_blueprints", "20261022410000_procedure_effectiveness"]) {
    await db.exec(readFileSync(`supabase/migrations/${file}.sql`, "utf8"));
  }

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
  const command = async (name, payload, actor = f.sopOwner) => (await asUser("select public.procedure_effectiveness_command($1,$2) data", [name, payload], actor))[0].data;
  const versions = async (name, payload, actor) => (await asUser("select public.procedure_version_command($1,$2) data", [name, payload], actor))[0].data;
  let seq = 300;
  const nextId = () => eid(++seq);
  async function release(summary = "First issue", steps = [{ text: "Isolate the press" }, { text: "Fit the die" }, { text: "Run a trial billet" }]) {
    const draft = await versions("draft.save", { procedure_id: f.sop, version_id: nextId(), steps, change_summary: summary, expected_hash: null }, f.sopOwner);
    const submitted = await versions("draft.submit", { version_id: draft.id, expected_hash: draft.content_hash }, f.sopOwner);
    const today = (await db.query("select private.ist_today()::text d")).rows[0].d;
    return versions("review.release", { version_id: draft.id, expected_hash: submitted.content_hash, effective_from: today, in_flight_policy: "keep_current" }, f.sopBackup);
  }
  /** A die-change task assigned to the operator; optionally started and completed after `hours`. */
  async function task({ status = "open", hours = null, assigned = f.operator } = {}) {
    const id = (await db.query("insert into tasks(company_id,task_type,status,assigned_to) values($1,'die_change','open',$2) returning id", [f.company, assigned])).rows[0].id;
    if (status !== "open") {
      await db.query("update tasks set status='in_progress' where id=$1", [id]);
      if (hours !== null) await db.query("update task_procedure_bindings set started_at = now() - make_interval(hours => $2::int) where task_id=$1", [id, hours]);
      if (status === "completed") await db.query("update tasks set status='completed', completed_at=now() where id=$1", [id]);
    }
    return id;
  }
  async function reset() {
    await db.exec(`truncate procedure_step_flags,procedure_improvements,task_exceptions,task_blueprint_starts,task_blueprint_revisions,task_blueprints,completion_criteria_templates,
      task_procedure_binding_events,task_procedure_bindings,procedure_task_kinds,procedure_versions,operating_procedures,handoff_acceptances,handoff_returns,
      tasks,notifications,production_jobs,orders,app_users,companies cascade`);
    await db.exec(procedureSeedSql(f));
    await db.exec(`insert into app_users values('${f.operator2}','${f.company}','production',true,'Operator Ravi',null)`);
    await asUser("select public.procedure_version_command('kinds.set',$1)", [{ task_kind: "type:die_change", procedure_id: f.sop }], f.owner);
  }
  return { db, asUser, command, versions, release, task, nextId, reset, close: () => db.close() };
}
