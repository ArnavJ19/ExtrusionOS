import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
test("operation database search executes the full migration twice with GST and broad-relation controls",()=>{
  const result=execFileSync(process.execPath,["--no-warnings","--experimental-strip-types","scripts/test-operation-search-integrity.mjs"],{cwd:process.cwd(),encoding:"utf8",timeout:120000});
  assert.match(result,/PASS A10 authority/);
});
