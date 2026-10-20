import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createFinishingEvidenceFixture,finishingFixture as f} from "./lib/finishing-evidence-fixture.mjs";

// Preserve the original-state diagnostic; --candidate verifies extracted prepared objects.
const candidate=process.argv.includes("--candidate"),fixture=await createFinishingEvidenceFixture({candidate});
try{
  await fixture.reset();await fixture.complete();const before=await fixture.snapshot();
  assert.equal(before.jobs.length,1);assert.equal(before.jobs[0].status,"completed");
  assert.equal(Number(before.jobs[0].output_weight_kg),90);assert.equal(before.packaging.length,1);
  if(candidate){
    await assert.rejects(fixture.move("completed",{vendor:f.otherVendor,sent:"2026-10-17",received:"2026-10-19"}),/terminal finishing/i);
    await fixture.move("completed");
    await assert.rejects(fixture.attempt(()=>fixture.db.query("delete from finishing_jobs where id=$1",[fixture.jobId])),/terminal finishing/i);
  }else await fixture.move("completed",{vendor:f.otherVendor,sent:"2026-10-17",received:"2026-10-19"});
  const after=await fixture.snapshot();
  if(candidate)assert.deepEqual(after,before);
  else{
    assert.equal(after.jobs[0].vendor_id,f.otherVendor);assert.notEqual(after.jobs[0].vendor_id,before.jobs[0].vendor_id);
    assert.notDeepEqual(after.jobs[0].sent_date,before.jobs[0].sent_date);assert.notDeepEqual(after.jobs[0].received_date,before.jobs[0].received_date);
  }
  assert.deepEqual(after.history,before.history);assert.deepEqual(after.packaging,before.packaging);assert.deepEqual(after.production,before.production);
  await assert.rejects(fixture.move("completed",{output:89,received:"2026-10-19"}),/Terminal finishing evidence is immutable/);
  const report={finding:"R17",findingConfirmed:!candidate,localCandidateVerified:candidate,before,after,
    conclusion:candidate?"Extracted candidate objects preserve terminal movement evidence, exact retries, history and handoff; the prepared migration remains unapplied.":"The public finishing RPC rewrites vendor and sent/received dates on a completed job without a new status-history event; weight edits remain blocked.",
    proof:candidate?"Actual completion/handoff and finishing SQL plus extracted prepared terminal guard/revised private transition function over disposable persisted data":"Actual completion/handoff SQL, current Astra finishing transition guard, public finishing RPC and actual history/packaging triggers over disposable persisted data",
    boundary:"Synthetic SQL identity and historical table fixture; no Supabase migration, hosted write, JWT/RLS, independent-session or physical-stock result is proved."};
  const output=resolve(process.argv.slice(2).find(value=>value!=="--candidate")??"test-results/finishing-evidence");mkdirSync(output,{recursive:true});writeFileSync(resolve(output,candidate?"finishing-evidence-regression.json":"finishing-evidence-diagnostic.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({finding:report.finding,findingConfirmed:report.findingConfirmed,localCandidateVerified:candidate,before:before.jobs[0],after:after.jobs[0],historyEvents:after.history.length,boundary:report.boundary},null,2));
}finally{await fixture.close();}
