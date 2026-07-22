import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync("components/modules/dispatch-delivery-workflow.tsx", "utf8");
const page = readFileSync("app/(dashboard)/dispatches/[id]/page.tsx", "utf8");
const action = readFileSync("lib/actions/dispatches.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260718054000_dispatch_proof_upload.sql", "utf8");

test("dispatch users can capture private POD evidence from the delivery workflow", () => {
  assert.match(workflow, /capture="environment"/);
  assert.match(workflow, /uploadTenantFile\("documents", companyId, `dispatches\/\$\{dispatch\.id\}\/proof-of-delivery`/);
  assert.match(workflow, /document_type: "proof_of_delivery"/);
  assert.match(workflow, /linked_entity_type: "dispatch"/);
  assert.match(workflow, /getSignedFileUrl\("documents", proofUrl\.trim\(\)\)/);
  assert.match(page, /companyId=\{context\.companyId\}/);
  assert.match(page, /userId=\{context\.userId\}/);
});

test("server rejects cross-company or cross-dispatch storage paths", () => {
  assert.match(action, /expectedProofPrefix/);
  assert.match(action, /Stored proof of delivery does not belong to this company and dispatch/);
});

test("RLS grants dispatch roles only dispatch-scoped POD inserts", () => {
  assert.match(migration, /linked_entity_type = 'dispatch'/);
  assert.match(migration, /document_type = 'proof_of_delivery'/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[2\] = 'dispatches'/);
  assert.match(migration, /'dispatch_manager', 'dispatch'/);
});
