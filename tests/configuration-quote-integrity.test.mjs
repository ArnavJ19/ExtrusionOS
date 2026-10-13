import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { z } from "zod";
import { groupProfileCutsForProduction } from "../lib/systems-configurator/production-handoff.ts";

const configurationId="00000000-0000-4000-8000-000000000001";
const quoteId="00000000-0000-4000-8000-000000000002";
function action({role="owner",result={data:quoteId,error:null}}={}) {
  const source=readFileSync(new URL("../lib/systems-configurator/actions.ts",import.meta.url),"utf8");
  const start=source.indexOf("export async function generateSystemQuote(");
  const end=source.indexOf("\nexport async function ",start+1);
  const javascript=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("export async function","async function");
  const calls=[], paths=[], destinations=[];
  const fn=new Function("z","getSystemsConfiguratorContext","createClient","revalidatePath","redirect",`${javascript};return generateSystemQuote;`)(z,async()=>({role}),async()=>({
    from(){throw new Error("Non-atomic table write attempted");},
    async rpc(name,args){calls.push({name,args});return result;}
  }),path=>paths.push(path),path=>destinations.push(path));
  return {fn,calls,paths,destinations};
}
test("configuration quote generation runs actual SQL calculation/conversion/handoff and transactional negatives",()=>{
  const output=execFileSync(process.execPath,["scripts/test-configuration-quote-integrity.mjs"],{encoding:"utf8",cwd:process.cwd(),timeout:120000});
  assert.match(output,/PASS B04 real conversion\/handoff/);
  assert.match(output,/PASS A06 rollback/);
  assert.match(output,/PASS precision migration/);
});
test("quote action validates identity and delegates one atomic transaction before redirect",async()=>{
  const good=action();await good.fn(configurationId);
  assert.deepEqual(good.calls,[{name:"generate_system_quote_atomic",args:{p_configuration_id:configurationId}}]);
  assert.deepEqual(good.destinations,[`/quotes/${quoteId}`]);
  assert.ok(good.paths.includes("/quotes/database"));
  const invalid=action();await assert.rejects(invalid.fn("foreign/invalid"));assert.equal(invalid.calls.length,0);
  const denied=action({role:"sales"});await assert.rejects(denied.fn(configurationId),/owner or admin/);assert.equal(denied.calls.length,0);
  const failed=action({result:{data:null,error:new Error("Injected atomic failure")}});
  await assert.rejects(failed.fn(configurationId),/Injected atomic failure/);assert.equal(failed.destinations.length,0);assert.equal(failed.paths.length,0);
});
test("production cut groups retain repeated-profile metres to three decimals",()=>{
  const groups=groupProfileCutsForProduction([{profile_id:configurationId,profile_code:"A",total_weight_kg:1.111,total_length_m:0.555},{profile_id:configurationId,profile_code:"A",total_weight_kg:2.222,total_length_m:1.111},{profile_id:quoteId,profile_code:"B",total_weight_kg:3.055,total_length_m:5.505}]);
  assert.equal(groups.length,2);assert.equal(groups[0].plannedMeters,1.666);assert.equal(groups[0].plannedQuantityKg,3.333);assert.equal(groups[1].plannedMeters,5.505);
});
