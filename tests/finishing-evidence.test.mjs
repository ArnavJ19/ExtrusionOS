import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createFinishingEvidenceFixture,finishingFixture as f} from "../scripts/lib/finishing-evidence-fixture.mjs";

const baseline=process.env.EXTRUSION_FINISHING_BASELINE==="1";
test("terminal finishing evidence candidate preserves movement, retries and dependent history",async context=>{
  const fixture=await createFinishingEvidenceFixture({candidate:!baseline}),{db}=fixture;
  async function terminal(status="completed"){
    await fixture.reset();
    if(status==="completed")await fixture.complete();
    else await fixture.move("rejected",{vendor:f.vendor,sent:"2026-10-16",received:"2026-10-18",output:0,rejected:95,remarks:"Rejected finish requires corrective processing"});
  }
  async function rejectsWithoutChange(callback,pattern){const before=await fixture.snapshot();await assert.rejects(fixture.attempt(callback),pattern);assert.deepEqual(await fixture.snapshot(),before);}
  try{
    await context.test("actual production and finishing completion preserve the expected 95/90/5 handoff",async()=>{
      await terminal();const state=await fixture.snapshot();assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].vendor_id,f.vendor);
      assert.equal(Number(state.jobs[0].input_weight_kg),95);assert.equal(Number(state.jobs[0].output_weight_kg),90);assert.equal(Number(state.jobs[0].rejection_weight_kg),5);
      assert.equal(state.history.length,4);assert.equal(state.packaging.length,1);assert.equal(Number(state.packaging[0].profile_weight_kg),90);
    });
    for(const status of ["completed","rejected"]){
      for(const [field,value] of [["vendor_id",f.otherVendor],["sent_date","2026-10-17"],["received_date","2026-10-19"],["planned_date","2026-10-20"],
        ["color_code","RAL-9005"],["shade_name","Different shade"],["branch_id",f.otherVendor],["plant_id",f.otherVendor],["created_at","2026-10-01T00:00:00Z"]]){
        await context.test(`${status} ${field} cannot be rewritten directly`,async()=>{
          await terminal(status);await rejectsWithoutChange(()=>db.query(`update finishing_jobs set ${field}=$1 where id=$2`,[value,fixture.jobId]),/terminal finishing/i);
        });
      }
      await context.test(`${status} movement evidence cannot be rewritten through the public RPC`,async()=>{
        await terminal(status);const before=await fixture.snapshot();
        await assert.rejects(fixture.move(status,{vendor:f.otherVendor,sent:"2026-10-17",received:"2026-10-19"}),/terminal finishing/i);
        assert.deepEqual(await fixture.snapshot(),before);
      });
      await context.test(`${status} deletion cannot erase status history or sever handoff evidence`,async()=>{
        await terminal(status);await rejectsWithoutChange(()=>db.query("delete from finishing_jobs where id=$1",[fixture.jobId]),/terminal finishing/i);
      });
    }
    await context.test("an exact public-RPC retry keeps original dates with omitted optional fields",async()=>{
      await terminal();const before=await fixture.snapshot();await fixture.move("completed");assert.deepEqual(await fixture.snapshot(),before);
      await fixture.move("completed",{vendor:f.vendor,sent:"2026-10-16",received:"2026-10-18",output:90,rejected:5,remarks:"Audited finishing receipt"});
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("existing terminal quantity, source, status and remarks controls stay enforced",async()=>{
      await terminal();
      for(const [field,value] of [["input_weight_kg",96],["output_weight_kg",89],["rejection_weight_kg",6],["remarks","Changed evidence"],["status","planned"],
        ["order_id",f.otherVendor],["company_id",f.otherVendor],["production_job_id",f.otherVendor],["finishing_type","anodizing"],["retry_of_finishing_job_id",f.otherVendor]]){
        await rejectsWithoutChange(()=>db.query(`update finishing_jobs set ${field}=$1 where id=$2`,[value,fixture.jobId]));
      }
    });
    await context.test("active movement edits remain available and receipt date survives completion",async()=>{
      await fixture.reset();await fixture.move("sent_to_vendor",{vendor:f.vendor,sent:"2026-10-16"});
      await fixture.move("sent_to_vendor",{vendor:f.otherVendor,sent:"2026-10-17"});await fixture.move("received",{received:"2026-10-18",output:90,rejected:5});
      await fixture.move("completed");const state=await fixture.snapshot();assert.equal(state.jobs[0].vendor_id,f.otherVendor);
      assert.match(String(state.jobs[0].sent_date),/2026|Oct/);assert.equal(new Date(state.jobs[0].received_date).toISOString().slice(0,10),"2026-10-18");
      assert.equal(state.history.length,3);assert.equal(state.packaging.length,1);
    });
    await context.test("a planned job can still be removed under existing table authority",async()=>{
      await fixture.reset();await db.query("delete from finishing_jobs where id=$1",[fixture.jobId]);assert.equal((await fixture.snapshot()).jobs.length,0);
    });
    await context.test("not-required legacy rows receive the same terminal evidence guard",async()=>{
      await fixture.reset();
      // Test-only legacy setup: historical not-required rows predate the current planned-only insert rule.
      await db.exec("alter table finishing_jobs disable trigger validate_finishing_transition;");
      await db.query("update finishing_jobs set status='not_required' where id=$1",[fixture.jobId]);
      await db.exec("alter table finishing_jobs enable trigger validate_finishing_transition;");
      await rejectsWithoutChange(()=>db.query("update finishing_jobs set vendor_id=$1 where id=$2",[f.otherVendor,fixture.jobId]),/terminal finishing/i);
      await rejectsWithoutChange(()=>db.query("delete from finishing_jobs where id=$1",[fixture.jobId]),/terminal finishing/i);
    });
    await context.test("one corrective retry preserves its source and rejects repeated retry creation",async()=>{
      await terminal("rejected");const source=(await fixture.snapshot()).jobs[0],retry=(await fixture.retry()).rows[0].id;
      const state=await fixture.snapshot(),row=state.jobs.find(row=>row.id===retry);assert.equal(Number(row.input_weight_kg),95);assert.equal(row.retry_of_finishing_job_id,source.id);
      assert.deepEqual(state.jobs.find(row=>row.id===source.id),source);
      const before=await fixture.snapshot();await assert.rejects(fixture.retry(),/retry already exists/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("a successful retry completes one handoff without changing the rejected original",async()=>{
      await terminal("rejected");const source=(await fixture.snapshot()).jobs[0],retry=(await fixture.retry()).rows[0].id;
      await fixture.move("in_process",{},retry);await fixture.move("completed",{received:"2026-10-19",output:94,rejected:1},retry);
      const state=await fixture.snapshot();assert.deepEqual(state.jobs.find(row=>row.id===source.id),source);assert.equal(state.packaging.length,1);assert.equal(Number(state.packaging[0].profile_weight_kg),94);
      const before=await fixture.snapshot();await fixture.move("completed",{},retry);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("a late finishing handoff failure rolls back receipt, terminal status and history",async()=>{
      await fixture.reset();await fixture.move("in_process");const before=await fixture.snapshot();
      await db.exec("create function public.fixture_finishing_handoff_failure() returns trigger language plpgsql as $$begin raise exception 'injected finishing handoff failure';end;$$; create trigger fixture_finishing_handoff_failure before insert on packaging_jobs for each row execute function public.fixture_finishing_handoff_failure();");
      await assert.rejects(fixture.move("completed",{received:"2026-10-18",output:90,rejected:5}),/injected finishing handoff failure/);assert.deepEqual(await fixture.snapshot(),before);
      await db.exec("drop trigger fixture_finishing_handoff_failure on packaging_jobs;drop function public.fixture_finishing_handoff_failure();");
      await fixture.move("completed",{received:"2026-10-18",output:90,rejected:5});assert.equal((await fixture.snapshot()).packaging.length,1);
    });
    await context.test("public authenticated execution retains role/company denial and private RPC restrictions",async()=>{
      await terminal();const before=await fixture.snapshot();
      await db.exec("set role authenticated;");await fixture.move("completed");await db.exec("reset role;");assert.deepEqual(await fixture.snapshot(),before);
      await db.query("select set_config('test.role','viewer',false)");await assert.rejects(fixture.move("completed"),/permission denied/i);
      await db.query("select set_config('test.role','production_manager',false),set_config('test.company',$1,false)",[f.otherVendor]);
      await assert.rejects(fixture.move("completed"),/not found for this company/i);
      await db.query("select set_config('test.company',$1,false)",[f.company]);await db.exec("set role authenticated;");
      await assert.rejects(fixture.attempt(()=>db.query("select private.transition_finishing_job_atomic($1,'completed',null,null,null,null,null,null)",[fixture.jobId])),/permission denied/i);
      if(!baseline)await assert.rejects(fixture.attempt(()=>db.query("select private.guard_terminal_finishing_evidence()")),/permission denied/i);
      await db.exec("reset role;");assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("replayed status transitions do not duplicate handoff or status history",async()=>{
      await terminal();const before=await fixture.snapshot();for(let repeat=0;repeat<3;repeat++)await fixture.move("completed");
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("a failed corrective-history append rolls back retry creation",async()=>{
      await terminal("rejected");const before=await fixture.snapshot();
      await db.exec("create function public.fixture_retry_history_failure() returns trigger language plpgsql as $$begin raise exception 'injected retry history failure';end;$$; create trigger fixture_retry_history_failure before insert on finishing_status_history for each row execute function public.fixture_retry_history_failure();");
      await assert.rejects(fixture.retry(),/injected retry history failure/);assert.deepEqual(await fixture.snapshot(),before);
      await db.exec("drop trigger fixture_retry_history_failure on finishing_status_history;drop function public.fixture_retry_history_failure();");
      const retry=(await fixture.retry()).rows[0].id;assert.equal((await fixture.snapshot()).jobs.find(row=>row.id===retry).retry_of_finishing_job_id,fixture.jobId);
    });
    await context.test("a compound update rolls back active edits when a terminal row is included",async()=>{
      await terminal();await db.query("insert into finishing_jobs(company_id,order_id,production_job_id,finishing_type,status,input_weight_kg)values($1,$2,$3,'powder_coating','planned',95)",[f.company,f.order,f.job]);
      await rejectsWithoutChange(()=>db.query("update finishing_jobs set vendor_id=$1 where company_id=$2",[f.otherVendor,f.company]),/terminal finishing/i);
    });
    await context.test("timestamp-only maintenance does not rewrite terminal business evidence",async()=>{
      await terminal();const before=await fixture.snapshot();await db.query("update finishing_jobs set updated_at=updated_at+interval '1 second' where id=$1",[fixture.jobId]);
      assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("the guard protects a later-added evidence column without a hard-coded field list",async()=>{
      await terminal();await db.exec("alter table finishing_jobs add column fixture_extra_evidence text;");
      await rejectsWithoutChange(()=>db.query("update finishing_jobs set fixture_extra_evidence='changed' where id=$1",[fixture.jobId]),/terminal finishing/i);
    });
    await context.test("all intended SQL roles retain exact retry access and denied roles cannot edit",async()=>{
      await terminal();const before=await fixture.snapshot();
      for(const role of ["owner","admin","factory_manager","production_manager","production"]){await db.query("select set_config('test.role',$1,false)",[role]);await fixture.move("completed");}
      for(const role of ["sales","accounts","dispatch","viewer","quality"]){await db.query("select set_config('test.role',$1,false)",[role]);await assert.rejects(fixture.move("completed"),/permission denied/i);}
      await db.query("select set_config('test.role','production_manager',false),set_config('test.actor','',false)");await assert.rejects(fixture.move("completed"),/authentication required/i);
      await db.query("select set_config('test.actor',$1,false)",[f.actor]);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("public/private privileges and the installed trigger event mask are verified",async()=>{
      await terminal();const privileges=(await db.query("select has_function_privilege('anon','public.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text)','execute') anonymous_update,has_function_privilege('authenticated','public.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text)','execute') public_update,has_function_privilege('authenticated','private.transition_finishing_job_atomic(uuid,text,uuid,date,date,numeric,numeric,text)','execute') private_update")).rows[0];
      assert.deepEqual(privileges,{anonymous_update:false,public_update:true,private_update:false});
      if(!baseline){const guard=(await db.query("select tgtype::int mask,tgenabled from pg_trigger where tgname='guard_terminal_finishing_evidence' and tgrelid='finishing_jobs'::regclass")).rows[0];assert.equal(guard.mask&24,24);assert.equal(guard.tgenabled,"O");}
    });
    await context.test("the read-only deployment preflight checks both private bodies and the attached update/delete guard",async()=>{
      await terminal();const preflight=readFileSync("sql/audit-deployment-preflight.sql","utf8"),start=preflight.indexOf("-- R17 also requires"),end=preflight.indexOf(";",start)+1;
      assert.ok(start>=0&&end>start);const rows=(await db.query(preflight.slice(start,end))).rows;assert.equal(rows.length,2);
      for(const row of rows){assert.equal(row.authenticated_execute,false);assert.equal(row.anonymous_execute,false);if(!baseline){assert.equal(row.present,true);assert.match(row.definition_md5,/^[0-9a-f]{32}$/);}}
      if(!baseline)assert.equal(rows.find(row=>row.signature==="private.guard_terminal_finishing_evidence()").update_delete_guard_attached,true);
    });
    await context.test("a legacy completed row without receipt evidence cannot be silently repaired by retry defaults",async()=>{
      await fixture.reset();
      // Local legacy seed only; the candidate guard stays enabled throughout.
      await db.exec("alter table finishing_jobs disable trigger validate_finishing_completion;alter table finishing_jobs disable trigger validate_finishing_transition;");
      await db.query("update finishing_jobs set status='completed',output_weight_kg=90,rejection_weight_kg=5,received_date=null where id=$1",[fixture.jobId]);
      await db.exec("alter table finishing_jobs enable trigger validate_finishing_completion;alter table finishing_jobs enable trigger validate_finishing_transition;");
      const before=await fixture.snapshot();await assert.rejects(fixture.move("completed"),/terminal finishing/i);assert.deepEqual(await fixture.snapshot(),before);
    });
    await context.test("a later committed retry preserves evidence and still rejects altered vendor/date",async()=>{
      await terminal();const before=await fixture.snapshot();await db.exec("commit;begin;");await fixture.move("completed");
      await assert.rejects(fixture.move("completed",{vendor:f.otherVendor,received:"2026-10-19"}),/terminal finishing/i);
      assert.deepEqual(await fixture.snapshot(),before);
    });
  }finally{await db.exec("reset role;");await fixture.close();}
});
