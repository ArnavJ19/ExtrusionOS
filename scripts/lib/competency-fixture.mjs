import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const cid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const cids = {
  company: cid(1), otherCompany: cid(2), owner: cid(10), factory: cid(11), seniorQc: cid(12), juniorQc: cid(13), traineeQc: cid(14), operator: cid(15), viewer: cid(16), foreign: cid(17), lapsedQc: cid(18),
  sop: cid(20), qcRelease: cid(30), pressOp: cid(31), inspection: cid(40), inspection2: cid(41), job: cid(50), foreignInspection: cid(42)
};

export async function createCompetencyFixture() {
  const db = new PGlite();
  const f = cids;
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create table companies(id uuid primary key);
    create table app_users(id uuid primary key,company_id uuid,role text,is_active boolean,full_name text,dealer_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function private.get_current_user_company_id() returns uuid language sql stable security definer set search_path=public,private as $$select company_id from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_role() returns text language sql stable security definer set search_path=public,private as $$select role from app_users where id=auth.uid() and is_active$$;
    create function private.get_current_user_dealer_id() returns uuid language sql stable security definer set search_path=public,private as $$select dealer_id from app_users where id=auth.uid() and is_active$$;
    create table operating_procedures(id uuid primary key,company_id uuid,title text,revision integer not null default 1,is_active boolean default true);
    create table quality_inspections(id uuid primary key,company_id uuid,status text,quantity_checked_kg numeric);
    create table production_jobs(id uuid primary key,company_id uuid,status text,job_number text);
    grant usage on schema public,private,auth to authenticated,anon;
    grant execute on all functions in schema private,auth to authenticated;`);
  await db.exec(readFileSync("supabase/migrations/20261022330000_competencies.sql", "utf8"));

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
  /** A source write performed by an employee through a guarded server action. */
  async function act(sql, actor) {
    await db.exec("begin");
    try {
      await db.query("select set_config('test.actor',$1,true)", [actor ?? ""]);
      await db.exec(sql);
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const command = async (name, payload, actor = f.factory) => (await asUser("select public.competency_command($1,$2) data", [name, payload], actor))[0].data;
  const release = (actor, inspection = f.inspection) => act(`update quality_inspections set status='approved' where id='${inspection}'`, actor);
  const grant = (employee, level, competency = f.qcRelease, actor = f.factory) => command("grant.set", { employee_id: employee, competency_id: competency, level }, actor);

  async function reset() {
    await db.exec(`truncate supervision_confirmations,competency_requirements,employee_competencies,competencies,operating_procedures,quality_inspections,production_jobs,app_users,companies cascade`);
    await db.exec(`insert into companies values('${f.company}'),('${f.otherCompany}');
      insert into app_users values('${f.owner}','${f.company}','owner',true,'Owner',null),('${f.factory}','${f.company}','factory_manager',true,'Factory Mgr',null),
        ('${f.seniorQc}','${f.company}','quality',true,'Senior QC Leela',null),('${f.juniorQc}','${f.company}','quality',true,'Junior QC Arjun',null),
        ('${f.traineeQc}','${f.company}','quality',true,'Trainee QC Sana',null),('${f.operator}','${f.company}','production',true,'Operator Vik',null),
        ('${f.viewer}','${f.company}','viewer',true,'Viewer',null),('${f.foreign}','${f.otherCompany}','owner',true,'Foreign',null),('${f.lapsedQc}','${f.company}','quality',true,'Lapsed QC',null);
      insert into operating_procedures values('${f.sop}','${f.company}','QC release of extruded profiles',3,true);
      insert into quality_inspections values('${f.inspection}','${f.company}','pending',500),('${f.inspection2}','${f.company}','pending',200),('${f.foreignInspection}','${f.otherCompany}','pending',1);
      insert into production_jobs values('${f.job}','${f.company}','ready','PJ-0007');`);
    await db.exec(`insert into competencies(id,company_id,code,name,procedure_id,validity_months,created_by) values
      ('${f.qcRelease}','${f.company}','QC-RELEASE','QC release of extruded profiles','${f.sop}',12,'${f.factory}'),
      ('${f.pressOp}','${f.company}','PRESS-OP','Extrusion press operation',null,null,'${f.factory}')`);
  }
  return { db, asUser, act, command, release, grant, reset, close: () => db.close() };
}
