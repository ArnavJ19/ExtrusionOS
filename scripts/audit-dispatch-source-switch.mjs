import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createDispatchFormBrowserFixture,dispatchSource,dispatchFormIds as f} from "./lib/dispatch-form-browser-fixture.mjs";
import {createDispatchActionBoundaryFixture} from "./lib/dispatch-action-boundary-fixture.mjs";

// Current positive regression. Original failing diagnostic images/JSON remain in the R12 evidence directory.
const output=resolve(process.argv[2]??"test-results/dispatch-preparation-consistency");mkdirSync(output,{recursive:true});
const fixture=await createDispatchFormBrowserFixture({styled:true}),page=fixture.page,boundary=createDispatchActionBoundaryFixture(),checks=[];
const bundle=()=>page.getByText("Scan / Bundle ID *",{exact:true}).locator("..").locator("input");
async function bounded(name){
  await page.evaluate(()=>document.fonts.ready);assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: viewport overflow`);
}
try{
  for(const [label,width,height] of [["desktop",1440,1000],["tablet",820,1180],["mobile",390,844],["compact-mobile",320,720]]){
    await page.setViewportSize({width,height});await fixture.reset();await fixture.chooseOrder("A");await fixture.chooseOrder("B");
    await fixture.resolveSource(1,{success:true,sources:[dispatchSource("B")]});await fixture.fillBundle("B");
    await fixture.resolveSource(0,{success:true,sources:[dispatchSource("A")]});assert.match(await fixture.source().inputValue(),/B source/);
    assert.equal(await bundle().inputValue(),"B-MANIFEST");assert.match(await fixture.order().inputValue(),/ORDER-B/);await bounded(label);
    await page.screenshot({path:resolve(output,`${label}-current-source.png`),fullPage:true});
    await fixture.save().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
    const input=await page.evaluate(()=>window.__dispatch.saveRequests[0].input);assert.equal(input.order_id,f.b);assert.equal(input.bundles[0].source_line_id,f.sourceB);
    const result=await boundary.actions.saveDispatchAction(input);assert.equal(result.success,true,JSON.stringify(result));
    const posted=boundary.state.calls.filter(call=>call.name==="save_ready_dispatch_atomic").at(-1).args;
    assert.equal(posted.p_dispatch.order_id,f.b);assert.equal(posted.p_dispatch.total_weight_kg,5);
    assert.equal(posted.p_items[0].reservation_id,f.sourceB);assert.equal(posted.p_items[0].source_record_id,f.b);assert.equal(posted.p_items[0].number_of_pieces,1);assert.equal(posted.p_items[0].net_length_m,2.5);
    await page.evaluate(result=>window.__dispatch.saveRequests[0].resolve(result),result);await fixture.flush();assert.ok(await fixture.save().isDisabled());
    assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[`/dispatches/${f.dispatch}`]);
    checks.push(`${label}: late A cannot replace B's source/measurements; actual save action freshly validates B and assembles exact 5 kg / 2.5 m / 1 piece; confirmed form remains locked`);
  }
  await page.setViewportSize({width:390,height:844});await fixture.reset();await fixture.chooseOrder("A");
  await page.evaluate(()=>window.__dispatch.sourceRequests[0].reject(new Error("Synthetic source outage")));await fixture.flush();
  assert.equal(await page.getByRole("alert").count(),1);assert.ok(await fixture.save().isDisabled());await bounded("source failure");
  await page.screenshot({path:resolve(output,"mobile-source-unavailable.png"),fullPage:true});
  await page.getByRole("button",{name:"Retry source check",exact:true}).click();await page.waitForFunction(()=>window.__dispatch.sourceRequests.length===2);
  await fixture.resolveSource(1,{success:true,sources:[dispatchSource("A")]});await fixture.fillBundle("A");
  await fixture.save().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
  await page.evaluate(()=>window.__dispatch.saveRequests[0].reject(new Error("Lost confirmation after possible commit")));await fixture.flush();
  assert.ok(await fixture.save().isDisabled());await page.getByRole("link",{name:"Check dispatch records",exact:true}).waitFor();await bounded("unknown confirmation");
  await page.screenshot({path:resolve(output,"mobile-confirmation-unknown.png"),fullPage:true});
  checks.push("Source outage is explicit/retryable; uncertain write confirmation cannot auto-resubmit and provides existing-record review");
  const good={order_id:f.b,dispatch_date:"2026-10-19",delivery_status:"dispatched",bundles:[{bundle_number:"BOUNDARY",source_line_id:f.sourceB,number_of_pieces:1,net_length_m:2.5,gross_weight_kg:6,tare_weight_kg:1}]};
  const before=boundary.state.calls.filter(call=>call.name==="save_ready_dispatch_atomic").length;
  const stale=await boundary.actions.saveDispatchAction({...good,bundles:[{...good.bundles[0],source_line_id:f.sourceA}]});assert.equal(stale.success,false);assert.match(stale.error,/available source for this order/);
  boundary.state.consumed=8;const changed=await boundary.actions.saveDispatchAction(good);assert.equal(changed.success,false);assert.match(changed.error,/Only 2\.000 kg is ready/);
  boundary.state.role="viewer";const denied=await boundary.actions.saveDispatchAction(good);assert.equal(denied.success,false);assert.match(denied.error,/permission/);
  assert.equal(boundary.state.calls.filter(call=>call.name==="save_ready_dispatch_atomic").length,before);assert.deepEqual(fixture.errors,[]);
  checks.push("Actual action rejects a cross-order source, reduced fresh availability and a denied role before the captured stock-writing RPC");
  const report={localCandidateVerified:true,proof:"Actual dispatch form and actual server save action; controlled read/save transport, synthetic identities, loopback only, built CSS/fonts; atomic RPC assembled/captured, never executed against a database",
    boundary:"No Supabase migration/write, persisted dispatch, real JWT/RLS, physical-stock outcome or independent-session concurrency is proved",checks,screenshots:6,pageErrors:fixture.errors};
  writeFileSync(resolve(output,"results.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
}finally{await fixture.close();}
