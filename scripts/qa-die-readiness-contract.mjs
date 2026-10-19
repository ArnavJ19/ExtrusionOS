import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createDieReadinessBrowserFixture} from "./lib/die-readiness-browser-fixture.mjs";
import {createDieReadinessActionFixture,dieFixture as f,dieFixtureId as id} from "./lib/die-readiness-action-fixture.mjs";

const output=resolve(process.argv[2]??"test-results/die-readiness-contract");mkdirSync(output,{recursive:true});
const ui=await createDieReadinessBrowserFixture({styled:true}),page=ui.page,actions=createDieReadinessActionFixture(),checks=[];
async function bounded(label){await page.evaluate(()=>document.fonts.ready);assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: viewport overflow`);assert.deepEqual(ui.errors,[]);}
async function record(){await ui.open("preferred=approved&crowded=1");await ui.selectOrder();await page.getByText(/Auto-filled/).waitFor();
  assert.equal(await ui.field("Die *").inputValue(),"D-APPROVED");await ui.field("Machine").click();
  await page.getByRole("button",{name:"Fixture press",exact:true}).click();}
async function submission(){await page.getByRole("button",{name:"Save",exact:true}).click();await page.waitForFunction(()=>window.__die.writes.length===1);
  return page.evaluate(()=>window.__die.writes[0].input);}
function boundary(status="approved"){actions.reset();actions.state.dieRows=[{id:id(11),company_id:f.company,profile_id:f.profile,die_status:status}];}
try{
  for(const [label,width,height] of [["desktop",1440,1000],["tablet",820,1180],["mobile",390,844],["compact-mobile",320,720]]){
    await page.setViewportSize({width,height});await ui.open("mode=queue");
    for(const status of ["approved","active","under_correction","unknown","under_trial"]){
      const row=page.getByRole("link").filter({has:page.getByText(`QUEUE-${status}`,{exact:true})});
      const text=await row.innerText();assert.match(text,["approved","active"].includes(status)?/ready/i:/blocked/i);
    }
    await bounded(`${label}-queue`);await page.screenshot({path:resolve(output,`${label}-readiness-queue.png`),fullPage:true});
    await record();await ui.field("Die *").click();await page.getByRole("button",{name:"D-APPROVED",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"D-CORRECTION",exact:true}).count(),0);assert.equal(await page.getByRole("button",{name:"D-OTHER-PROFILE",exact:true}).count(),0);
    await page.getByRole("button",{name:"D-APPROVED",exact:true}).click();await bounded(`${label}-approved`);
    await page.screenshot({path:resolve(output,`${label}-approved-form.png`),fullPage:true});
    const input=await submission();assert.equal(input.die_id,id(11));boundary();
    const result=await actions.production.saveProductionJobAction(input);assert.equal(result.success,true,JSON.stringify(result));
    const write=actions.state.calls.find(call=>call.name==="save_production_job_atomic");assert.ok(write);assert.equal(write.args.p_job.die_id,id(11));
    assert.equal(write.args.p_job.profile_id,f.profile);assert.equal(write.args.p_job.source_line_id,id(16));assert.equal(write.args.p_job.company_id,f.company);
    await page.evaluate(result=>window.__die.writes[0].resolve(result),result);
    await page.waitForFunction(()=>window.__die.navigation.length===1);assert.deepEqual(await page.evaluate(()=>window.__die.navigation),[`/production/${id(9)}`]);
    await ui.open("mode=legacy");await page.getByRole("button",{name:"Plan New Job",exact:true}).click();
    await page.getByText("Profile *",{exact:true}).locator("..").locator("select").selectOption(f.profile);
    const select=page.getByText("Die",{exact:true}).locator("..").locator("select");await select.selectOption(id(11));
    assert.deepEqual(await select.locator("option").allTextContents(),["No die","D-ACTIVE","D-APPROVED"]);
    await bounded(`${label}-legacy`);await page.screenshot({path:resolve(output,`${label}-legacy-approved-die.png`),fullPage:true});
    checks.push(`${label}: queue blocks correction/trial/unknown; approved die survives crowded lookup and remains selectable in both forms; actual new-production action validates the UI payload and assembles exact company/profile/order-line/die identity`);
  }
  await page.setViewportSize({width:390,height:844});await ui.open("preferred=correction");await ui.selectOrder();
  await page.getByText(/assigned die is unavailable/i).waitFor();assert.equal(await ui.field("Die *").inputValue(),"");
  await page.getByRole("button",{name:"Save",exact:true}).click();await page.getByText("Select a die",{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__die.writes.length),0);await bounded("assigned correction");
  await page.screenshot({path:resolve(output,"mobile-assigned-correction-review.png"),fullPage:true});
  await record();const input=await submission();boundary("under_maintenance");const denied=await actions.production.saveProductionJobAction(input);
  assert.equal(denied.success,false);assert.match(denied.error,/under maintenance.*cannot be used/);assert.deepEqual(actions.state.calls,[]);
  await page.evaluate(result=>window.__die.writes[0].resolve(result),denied);await page.getByText(/under maintenance.*cannot be used/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__die.navigation),[]);await bounded("stale die status");
  await page.screenshot({path:resolve(output,"mobile-stale-die-status-rejected.png"),fullPage:true});
  checks.push("An assigned correction die requires review without substitution or a write; a die changed to maintenance after selection is rejected by the actual save action before any RPC, with no success navigation");
  await ui.open("otherProfiles=1");await ui.selectOrder();await page.getByText(/Select an active or approved/).waitFor();await ui.field("Die *").click();
  await page.getByRole("button",{name:"D-APPROVED",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:/A-OTHER-/}).count(),0);
  await bounded("profile-scoped choices");await page.screenshot({path:resolve(output,"mobile-profile-scoped-choices.png"),fullPage:true});
  checks.push("Autofill refreshes exact-profile eligible choices even when the original company preview contains 45 other-profile dies");
  await ui.open("mode=order-edit&preferred=correction");assert.ok(await ui.field("Production die").isDisabled());
  assert.match(await ui.field("Production die").inputValue(),/D-CORRECTION.*Unavailable for production/);await bounded("historical assignment");
  await page.screenshot({path:resolve(output,"mobile-historical-assigned-die.png"),fullPage:true});
  checks.push("The read-only order form retains its historical assigned die with an unavailable-for-production label, without making it selectable for new production");
  const report={localCandidateVerified:true,proof:"Actual queue and both production forms with built CSS/fonts; actual server save action with synthetic tenant-scoped reads; write RPCs captured without database execution",
    checks,screenshots:16,pageErrors:ui.errors,boundary:"No Supabase migration/request, persisted job/schedule/stock result, hosted JWT/RLS or independent-session concurrency is proved"};
  writeFileSync(resolve(output,"results.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
}catch(error){writeFileSync(resolve(output,"qa-failure.json"),JSON.stringify({error:error.message,body:await page.locator("body").innerText(),writes:await page.evaluate(()=>window.__die?.writes.map(write=>write.input))},null,2)+"\n");
  await page.screenshot({path:resolve(output,"qa-failure.png"),fullPage:true});throw error;
}finally{await ui.close();}
