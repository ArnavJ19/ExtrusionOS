import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createProductionScrapFixture,scrapFixture as f,scrapFixtureId as id} from "./lib/production-scrap-fixture.mjs";
import {calculateIssuedBilletRecovery} from "../lib/command-center/metrics.ts";

export async function runProductionScrapRepeatChecks({runCheck}={}){
  const fixture=await createProductionScrapFixture(),{db,attempt}=fixture,checks=[];
  let ledgerExample,recoveryExample;
  const check=async(name,callback)=>{const execute=async()=>{await fixture.reset();await callback();checks.push(name);};
    if(runCheck)await runCheck(name,execute);else await execute();};
  try{
    await check("completion posts one exact scrap entry and consumes input without creating remelt stock",async()=>{
      await db.exec("set role authenticated;");await fixture.complete();await db.exec("reset role;");
      const row=await fixture.snapshot();assert.equal(row.status,"completed");assert.equal(Number(row.actual_quantity_kg),95);
      assert.equal(row.scrap_rows,1);assert.equal(Number(row.scrap_kg),5);assert.equal(Number(row.input_kg),100);assert.equal(row.consumed_billets,1);
      assert.equal(row.packaging_jobs,1);assert.equal(row.authorizations,0);assert.equal(Number(row.remelt_available_kg),20);
      ledgerExample={inputKg:Number(row.input_kg),goodOutputKg:Number(row.actual_quantity_kg),scrapKg:Number(row.scrap_kg),scrapRows:row.scrap_rows,
        consumedBillets:row.consumed_billets,packagingJobs:row.packaging_jobs,stageEvents:row.stage_events,remeltAvailableKg:Number(row.remelt_available_kg)};
      const scrap=(await db.query("select company_id,order_id,profile_id,weight_kg from scrap_records where production_job_id=$1",[f.job])).rows[0];
      assert.equal(scrap.company_id,f.company);assert.equal(scrap.order_id,f.order);assert.equal(scrap.profile_id,f.profile);assert.equal(Number(scrap.weight_kg),5);
    });
    await check("exact and changed completion retries cannot duplicate scrap or handoffs",async()=>{
      await fixture.complete();const before=await fixture.snapshot();
      for(const [output,scrap] of [[95,5],[94,6],[95,0]])await assert.rejects(fixture.complete(output,scrap),/Start the production job/);
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await check("external repeated inserts cannot add scrap to completed production",async()=>{
      await fixture.complete();const before=await fixture.snapshot();
      for(let repeat=0;repeat<3;repeat++)await assert.rejects(attempt(()=>db.query("insert into scrap_records(company_id,production_job_id,weight_kg)values($1,$2,5)",[f.company,f.job])),/audited completion workflow/);
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await check("completed scrap cannot be edited, deleted or moved to another job",async()=>{
      await fixture.complete();const before=await fixture.snapshot();
      for(const statement of ["update scrap_records set weight_kg=6","delete from scrap_records","update scrap_records set production_job_id=null",
        "update scrap_records set production_job_id='00000000-0000-4000-8000-000000000077'","update scrap_records set company_id='00000000-0000-4000-8000-000000000099'"])
        await assert.rejects(attempt(()=>db.exec(statement)),/completed production is immutable/);
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await check("a mass-balance failure rolls back scrap, consumption, handoff and private authorization",async()=>{
      const before=await fixture.snapshot();await assert.rejects(fixture.complete(90,5),/mass balance/);assert.deepEqual(await fixture.snapshot(),before);
      await fixture.complete();assert.equal((await fixture.snapshot()).scrap_rows,1);
    });
    await check("a late scrap-insert failure rolls back already-created consumption and handoff effects",async()=>{
      const before=await fixture.snapshot();
      await db.exec(`create function private.fixture_late_scrap_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic late scrap failure';end$$;
        create trigger zz_fixture_late_scrap_failure before insert on scrap_records for each row execute function private.fixture_late_scrap_failure();`);
      await assert.rejects(fixture.complete(),/Synthetic late scrap failure/);assert.deepEqual(await fixture.snapshot(),before);
      await db.exec("drop trigger zz_fixture_late_scrap_failure on scrap_records;drop function private.fixture_late_scrap_failure();");
      await fixture.complete();assert.equal((await fixture.snapshot()).scrap_rows,1);
    });
    await check("separate pre-completion scrap entries reconcile with the completion increment",async()=>{
      await db.query("insert into scrap_records(company_id,production_job_id,weight_kg) values($1,$2,2),($1,$2,1)",[f.company,f.job]);
      await fixture.complete(95,2);const row=await fixture.snapshot();assert.equal(row.scrap_rows,3);assert.equal(Number(row.scrap_kg),5);
      assert.equal(Number(row.input_kg)-Number(row.actual_quantity_kg)-Number(row.scrap_kg),0);
      const before=await fixture.snapshot();await assert.rejects(fixture.complete(95,2),/Start the production job/);assert.deepEqual(await fixture.snapshot(),before);
    });
    await check("consumed billet input remains immutable after completion",async()=>{
      await fixture.complete();const before=await fixture.snapshot();
      await assert.rejects(attempt(()=>db.exec("update foundry_billets set weight_kg=90")),/immutable|completed|input/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await check("moving an existing scrap entry onto a completed job is rejected",async()=>{
      await fixture.complete();await db.query("insert into production_jobs(id,company_id,status)values($1,$2,'planned')",[id(77),f.company]);
      await db.query("insert into scrap_records(id,company_id,production_job_id,weight_kg)values($1,$2,$3,1)",[id(78),f.company,id(77)]);
      const before=await fixture.snapshot();await assert.rejects(attempt(()=>db.query("update scrap_records set production_job_id=$1 where id=$2",[f.job,id(78)])),/audited completion workflow/);
      assert.deepEqual(await fixture.snapshot(),before);assert.equal((await db.query("select production_job_id from scrap_records where id=$1",[id(78)])).rows[0].production_job_id,id(77));
    });
    await check("actual recorded input and output produce 95 percent recovery without a proxy denominator",async()=>{
      await fixture.complete();const jobs=(await db.query("select id,actual_quantity_kg from production_jobs where status='completed'")).rows;
      const billets=(await db.query("select production_job_id,weight_kg from foundry_billets where status='consumed'")).rows;
      recoveryExample=calculateIssuedBilletRecovery(jobs,billets);
      assert.deepEqual(recoveryExample,{percent:95,issuedInputKg:100,capturedOutputKg:95,capturedJobCount:1,missingJobCount:0});
      assert.equal(calculateIssuedBilletRecovery(jobs,[]).percent,null);
    });
    await check("denied roles and foreign job IDs cannot complete the target job",async()=>{
      const before=await fixture.snapshot();await db.exec("set test.role='viewer';");await assert.rejects(fixture.complete(),/Permission denied/);
      await db.exec("set test.role='production_manager';");await assert.rejects(fixture.complete(95,5,id(99)),/not found for this company/);assert.deepEqual(await fixture.snapshot(),before);
    });
    // Keep this last: it deliberately commits fixture data to verify a later transaction.
    await check("a retry in a later transaction cannot duplicate committed completion evidence",async()=>{
      await fixture.complete();const before=await fixture.snapshot();await db.exec("commit;begin;");
      await assert.rejects(fixture.complete(),/Start the production job/);assert.deepEqual(await fixture.snapshot(),before);
    });
    return {checks,ledgerExample,recoveryExample,localControlsVerified:true,proof:"Existing extracted production completion, scrap/input guards and handoff functions in disposable PGlite; actual public completion wrapper under synthetic authenticated SQL role; actual recovery helper",
      boundary:"No Supabase migration or hosted request; no real JWT/RLS, independent-session concurrency, physical return/remelt transfer or full report/browser journey is proved"};
  }finally{await fixture.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await runProductionScrapRepeatChecks();if(process.argv[2]){const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});writeFileSync(resolve(output,"scrap-repeat-controls.json"),JSON.stringify(report,null,2)+"\n");}
  console.log(JSON.stringify(report,null,2));
}
