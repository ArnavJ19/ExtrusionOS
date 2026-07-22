import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actions = readFileSync("lib/actions/finishing.ts", "utf8");
const board = readFileSync("components/modules/finishing-workflow-board.tsx", "utf8");
const page = readFileSync("app/(dashboard)/production/finishing/page.tsx", "utf8");

test("rejected finishing exposes the bounded database retry as an operator workflow", () => {
  assert.match(actions, /export async function retryRejectedFinishingJobAction/);
  assert.match(actions, /rpc\("retry_rejected_finishing_job_atomic"/);
  assert.match(board, /retry_of_finishing_job_id/);
  assert.match(board, /Plan One Retry/);
  assert.match(board, /The rejected source remains locked as evidence/);
  assert.match(board, /retryRejectedFinishingJobAction/);
  assert.match(page, /retry_of_finishing_job_id/);
  assert.match(page, /workflowRows/);
});
