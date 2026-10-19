import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {sqlDefinition} from "../scripts/lib/historical-schema-fixture.mjs";
import {dieFixture as f} from "../scripts/lib/die-readiness-action-fixture.mjs";

let db;
test.before(async()=>{
  db=new PGlite();
  await db.exec(`create schema private;
    create table orders(id uuid primary key,company_id uuid,current_stage text);
    create table dies(id uuid primary key,company_id uuid,profile_id uuid,die_status text not null);
    create table machines(id uuid primary key,company_id uuid,machine_type text,is_active boolean,status text);
    create table production_jobs(id uuid primary key,company_id uuid,order_id uuid,profile_id uuid,die_id uuid,machine_id uuid,status text);
    create table production_plan_slots(id uuid primary key,company_id uuid,production_job_id uuid,machine_id uuid,status text);
    create function private.order_job_has_remaining_production(uuid,uuid,uuid) returns boolean language sql as $$select true$$;
    insert into orders values('${f.order}','${f.company}','extrusion_planned');
    insert into dies values('${f.die}','${f.company}','${f.profile}','active');
    insert into machines values('${f.machine}','${f.company}','extrusion_press',true,'active');
    insert into production_jobs values('${f.job}','${f.company}','${f.order}','${f.profile}','${f.die}','${f.machine}','planned');
    insert into production_plan_slots values(gen_random_uuid(),'${f.company}','${f.job}','${f.machine}','scheduled');`);
  for(const name of ["private.validate_production_start_resources","private.validate_production_slot_release_resources"])
    await db.exec(sqlDefinition("20261008020000_factory_workflow_integrity.sql",name));
  await db.exec(`create trigger start_resources before update of status on production_jobs for each row execute function private.validate_production_start_resources();
    create trigger release_resources before update of status on production_plan_slots for each row execute function private.validate_production_slot_release_resources();`);
});
test.after(async()=>{await db?.close();});

const statuses=["design","ordered","received","under_trial","approved","active","under_correction","under_maintenance","blocked","retired","scrapped","trial","correction","nitriding","inactive","dead","unknown"];
for(const status of statuses){
  test(`existing SQL release/start guards independently enforce die status ${status}`,async()=>{
    await db.exec("update production_jobs set status='planned';update production_plan_slots set status='scheduled';");
    await db.query("update dies set die_status=$1",[status]);
    if(["active","approved"].includes(status)){
      await db.exec("update production_plan_slots set status='released';update production_jobs set status='in_progress';");
      assert.equal((await db.query("select status from production_jobs")).rows[0].status,"in_progress");
    }else{
      await assert.rejects(db.exec("update production_plan_slots set status='released'"),/die is no longer eligible/);
      assert.equal((await db.query("select status from production_plan_slots")).rows[0].status,"scheduled");
      await db.exec("update dies set die_status='active';update production_plan_slots set status='released';");
      await db.query("update dies set die_status=$1",[status]);
      await assert.rejects(db.exec("update production_jobs set status='in_progress'"),/die is no longer eligible/);
      assert.equal((await db.query("select status from production_jobs")).rows[0].status,"planned");
    }
  });
}
