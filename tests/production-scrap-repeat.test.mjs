import assert from "node:assert/strict";
import test from "node:test";
import {runProductionScrapRepeatChecks} from "../scripts/audit-production-scrap-repeat.mjs";

test("production scrap posting preserves completion, rollback and recovery evidence",async(context)=>{
  const report=await runProductionScrapRepeatChecks({runCheck:(name,callback)=>context.test(name,callback)});
  assert.equal(report.localControlsVerified,true);
  assert.equal(report.ledgerExample.inputKg,report.ledgerExample.goodOutputKg+report.ledgerExample.scrapKg);
  assert.equal(report.recoveryExample.percent,95);
});
