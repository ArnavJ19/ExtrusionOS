import assert from "node:assert/strict";
import test from "node:test";
import {runProductionReportChecks} from "../scripts/audit-production-report-reconciliation.mjs";

test("production batch reports reconcile actual completed-job SQL evidence",async context=>{
  const report=await runProductionReportChecks({runCheck:(name,callback)=>context.test(name,callback)});
  assert.equal(report.localReportControlsVerified,true);assert.equal(report.checks.length,7);
});
