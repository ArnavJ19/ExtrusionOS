import assert from "node:assert/strict";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createProductionScrapFixture,scrapFixture as f} from "./lib/production-scrap-fixture.mjs";
import {createProductionReportActionFixture,reportValue as value} from "./lib/production-report-action-fixture.mjs";

export async function runProductionReportChecks({runCheck}={}){
  const sql=await createProductionScrapFixture(),{db}=sql,report=createProductionReportActionFixture();
  const checks=[],examples=[];
  const check=async(name,callback)=>{await (runCheck?runCheck(name,callback):callback());checks.push(name);};
  const viewSource=readFileSync(new URL("../supabase/migrations/20261008010000_access_projection_integrity.sql",import.meta.url),"utf8");
  const viewStart=viewSource.indexOf("create or replace view public.production_jobs_authorized ");assert.ok(viewStart>=0);
  const viewDefinition=viewSource.slice(viewStart,viewSource.indexOf(";",viewStart)+1);
  async function reset(){
    await sql.reset();report.reset();
    await db.exec(`update production_jobs set input_billet_weight=80,output_good_weight=70,planned_quantity_kg=100;${viewDefinition}`);
    report.state.provider=async table=>{
      assert.ok(["production_jobs_authorized","foundry_billets","scrap_records"].includes(table));
      await db.query("select set_config('test.role',$1,false)",[report.state.role]);
      const predicate=table==="production_jobs_authorized"?"id":"production_job_id";
      return (await db.query(`select * from ${table} where company_id=$1 and ${predicate}=$2`,[f.company,f.job])).rows;
    };
  }
  const fields=model=>Object.fromEntries(["Billet Weight kg","Output Good kg","Scrap kg","Recovery %","Scrap %","Balance Difference kg","Reconciliation"].map(label=>[label,value(model,label)]));
  async function example(name){
    const before=await sql.snapshot(),gate=await report.readiness();assert.equal(gate.ready,true);
    const model=await report.build(),result=await report.generate();assert.equal(result.success,true,result.error);
    assert.deepEqual(await sql.snapshot(),before,"Report generation must not change production evidence");
    const upload=report.state.uploads.at(-1);assert.ok(upload.path.startsWith(`${f.company}/reports/production_job/${f.job}/`));
    const captured={name,gate,model,fields:fields(model),ledger:before,reads:structuredClone(report.state.reads),pdf:upload.bytes};examples.push(captured);return captured;
  }
  try{
    await check("actual completion, authorized projection, readiness, builder and PDF action reconcile 100/95/5 despite stale source values",async()=>{
      await reset();await sql.complete();const result=await example("completed-recorded");
      assert.deepEqual(result.fields,{"Billet Weight kg":100,"Output Good kg":95,"Scrap kg":5,"Recovery %":95,"Scrap %":5,"Balance Difference kg":0,"Reconciliation":"Within production tolerance"});
      assert.equal(result.ledger.consumed_billets,1);assert.equal(result.ledger.scrap_rows,1);
    });
    await check("a real lossless completion has zero recorded scrap with no scrap rows",async()=>{
      await reset();await sql.complete(100,0);const result=await example("completed-zero-scrap");
      assert.equal(result.fields["Scrap kg"],0);assert.equal(result.fields["Recovery %"],100);assert.equal(result.ledger.scrap_rows,0);
    });
    await check("a legacy completion without billet requirements/input stays unknown",async()=>{
      await reset();await db.exec("delete from foundry_billets;update production_jobs set required_billet_count=0;");await sql.complete(95,0);
      const result=await example("legacy-missing-input");
      assert.equal(result.fields["Billet Weight kg"],"Not Captured");assert.equal(result.fields["Output Good kg"],95);
      for(const label of ["Scrap kg","Recovery %","Scrap %","Balance Difference kg"])assert.equal(result.fields[label],"Not Captured");
    });
    await check("1,201 persisted billet and scrap rows reconcile through smaller transport pages",async()=>{
      await reset();await db.exec(`delete from foundry_billets;
        insert into foundry_billets(id,company_id,production_job_id,status,weight_kg)
          select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${f.company}','${f.job}','issued',1 from generate_series(1,1201)n;
        insert into scrap_records(id,company_id,production_job_id,weight_kg)
          select ('00000000-0000-4000-8000-'||lpad((3000+n)::text,12,'0'))::uuid,'${f.company}','${f.job}',0.001 from generate_series(1,1201)n;`);
      await sql.complete(1199.799,0);report.state.pageCap=79;const result=await example("completed-large-history");
      assert.equal(result.fields["Billet Weight kg"],1201);assert.equal(result.fields["Scrap kg"],1.201);
      assert.equal(result.fields["Output Good kg"],1199.799);assert.equal(result.fields["Balance Difference kg"],0);
      assert.equal(result.ledger.consumed_billets,1201);assert.equal(result.ledger.scrap_rows,1201);
      for(const table of ["foundry_billets","scrap_records"])assert.ok(result.reads.filter(call=>call.table===table).length>15);
    });
    await check("an in-progress persisted job keeps planning-report access without final recovery",async()=>{
      await reset();const result=await example("in-progress");assert.equal(result.fields["Output Good kg"],"Not Captured");
      assert.equal(result.fields["Recovery %"],"Not Captured");assert.equal(result.fields.Reconciliation,"Pending production completion");
    });
    await check("all permitted template roles can read the actual authorized projection and build a PDF",async()=>{
      await reset();await sql.complete();
      for(const role of ["owner","admin","production_manager","production"]){
        report.state.role=role;const result=await report.generate();assert.equal(result.success,true,`${role}: ${result.error}`);
        assert.equal(value(await report.build(),"Recovery %"),95);
      }
    });
    await check("a persisted-history transport error prevents any report upload or history",async()=>{
      await reset();await sql.complete();
      report.state.respond=(call,result)=>call.table==="scrap_records"?{data:null,count:null,error:{message:"injected transport failure"}}:result;
      const result=await report.generate();assert.equal(result.success,false);assert.equal(report.state.uploads.length,0);assert.equal(report.state.history.length,0);
    });
    return {finding:"R16",localReportControlsVerified:true,checks,examples,
      proof:"Actual existing completion/handoff SQL, actual authorized production view, readiness, report builder, customer wrapper, action and PDF generator; disposable PGlite data",
      boundary:"Synthetic session identity, company/user display metadata and REST/Storage transport. Captured uploads/history only; no Supabase migration or hosted request, real JWT/RLS/Storage, independent-session, deployment or physical-inventory conclusion."};
  }finally{await sql.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await runProductionReportChecks(),output=resolve(process.argv[2]??"test-results/production-report-reconciliation");mkdirSync(output,{recursive:true});
  const examples=report.examples.map(({pdf,...example})=>{writeFileSync(resolve(output,`${example.name}.pdf`),pdf);return example;});
  const result={...report,examples};
  // Preserve production-report-diagnostic.json: it records the original, failing behavior.
  writeFileSync(resolve(output,"production-report-regression.json"),JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify({finding:report.finding,localReportControlsVerified:true,checks:report.checks,examples:examples.map(example=>({name:example.name,fields:example.fields})),boundary:report.boundary},null,2));
}
