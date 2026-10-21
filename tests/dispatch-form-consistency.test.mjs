import assert from "node:assert/strict";
import test from "node:test";
import {createDispatchFormBrowserFixture,dispatchFormIds as f,dispatchSource,dispatchOrder} from "../scripts/lib/dispatch-form-browser-fixture.mjs";

let fixture,page;
test.before(async()=>{fixture=await createDispatchFormBrowserFixture();page=fixture.page;});
test.after(async()=>{await fixture?.close();});
test.beforeEach(async()=>{await fixture.reset();});
const loading=()=>page.getByText("Checking QC, finishing, packaging, reservations, and previously shipped quantities...",{exact:true});
const bundle=()=>page.getByText("Scan / Bundle ID *",{exact:true}).locator("..").locator("input");
const saves=()=>page.evaluate(()=>window.__dispatch.saveRequests.map(request=>request.input));
async function rejectSource(index){await page.evaluate(index=>window.__dispatch.sourceRequests[index].reject(new Error("Synthetic source transport outage")),index);await fixture.flush();}

test("an older A result cannot overwrite the selected B manifest or choices",async()=>{
  await fixture.chooseOrder("A");await fixture.chooseOrder("B");await fixture.resolveSource(1,{success:true,sources:[dispatchSource("B")]});await fixture.fillBundle("B");
  await fixture.resolveSource(0,{success:true,sources:[dispatchSource("A")]});
  assert.match(await fixture.order().inputValue(),/ORDER-B/);assert.match(await fixture.source().inputValue(),/B source/);assert.equal(await bundle().inputValue(),"B-MANIFEST");
  assert.ok(await fixture.save().isEnabled());assert.deepEqual(await saves(),[]);
});
test("an obsolete finalizer cannot unlock an order whose own sources are pending",async()=>{
  await fixture.chooseOrder("A");await fixture.chooseOrder("B");await fixture.resolveSource(0,{success:true,sources:[dispatchSource("A")]});
  assert.equal(await loading().count(),1);assert.ok(await fixture.source().isDisabled());assert.ok(await fixture.save().isDisabled());assert.deepEqual(await saves(),[]);
});
test("an older failed result cannot erase the current order's valid manifest",async()=>{
  await fixture.chooseOrder("A");await fixture.chooseOrder("B");await fixture.resolveSource(1,{success:true,sources:[dispatchSource("B")]});await fixture.fillBundle("B");
  await fixture.resolveSource(0,{success:false,error:"Obsolete A failure"});assert.equal(await page.getByText("Obsolete A failure",{exact:true}).count(),0);
  assert.match(await fixture.source().inputValue(),/B source/);assert.equal(await bundle().inputValue(),"B-MANIFEST");
});
test("a current source transport rejection is explicit and cannot leave stale choices or an unhandled error",async()=>{
  await fixture.chooseOrder("A");await rejectSource(0);assert.deepEqual(fixture.errors,[]);assert.equal(await page.getByRole("alert").count(),1);
  assert.ok(await fixture.source().isDisabled());assert.ok(await fixture.save().isDisabled());assert.equal(await loading().count(),0);
});
test("retrying a failed source check starts a fresh owned request and permits a valid manifest",async()=>{
  await fixture.chooseOrder("A");await fixture.resolveSource(0,{success:false,error:"Source check unavailable"});
  const retry=page.getByRole("button",{name:"Retry source check",exact:true});assert.equal(await retry.count(),1);await retry.click();
  await page.waitForFunction(()=>window.__dispatch.sourceRequests.length===2);assert.ok(await fixture.save().isDisabled());
  await fixture.resolveSource(1,{success:true,sources:[dispatchSource("A")]});await fixture.fillBundle("A");assert.ok(await fixture.save().isEnabled());
});
test("typing a new order search immediately invalidates the old selection, sources and manifest",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await fixture.order().fill("Unchosen order");
  assert.equal(await bundle().inputValue(),"");assert.ok(await fixture.source().isDisabled());assert.ok(await fixture.save().isDisabled());assert.deepEqual(await saves(),[]);
});
test("clearing an order cannot be undone by its late source response",async()=>{
  await fixture.chooseOrder("A");await page.getByRole("button",{name:"Clear selection",exact:true}).first().click();
  await fixture.resolveSource(0,{success:true,sources:[dispatchSource("A")]});assert.equal(await fixture.order().inputValue(),"");
  assert.ok(await fixture.source().isDisabled());assert.ok(await fixture.save().isDisabled());assert.deepEqual(await saves(),[]);
});
test("reselecting the same verified order preserves entered measurements and does not reload sources",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await fixture.order().click();await page.getByRole("button",{name:"ORDER-A - Synthetic buyer",exact:true}).click();
  assert.equal(await bundle().inputValue(),"A-MANIFEST");assert.equal(await page.evaluate(()=>window.__dispatch.sourceRequests.length),1);assert.ok(await fixture.save().isEnabled());
});
test("changing company remounts preparation and rejects source results from the previous company",async()=>{
  await fixture.chooseOrder("A");await page.evaluate(company=>window.__dispatch.setCompanyId(company),f.otherCompany);await fixture.flush();
  await fixture.resolveSource(0,{success:true,sources:[dispatchSource("A")]});assert.equal(await fixture.order().inputValue(),"");
  assert.ok(await fixture.source().isDisabled());assert.ok(await fixture.save().isDisabled());assert.deepEqual(fixture.errors,[]);
});

async function searchHeld(term){await fixture.order().fill(term);await page.waitForFunction(term=>window.__dispatch.orderRequests.some(request=>request.search.includes(term)),term);}
async function resolveOrders(term,result){await page.evaluate(({term,result})=>window.__dispatch.orderRequests.find(request=>request.search.includes(term)).resolve(result),{term,result});await fixture.flush();}
test("an older order-search result cannot replace the newer matching choices",async()=>{
  await page.evaluate(()=>{window.__dispatch.autoOrders=false;});await searchHeld("ORDER-A");await searchHeld("ORDER-B");
  await resolveOrders("ORDER-B",{data:[dispatchOrder("B")],error:null});await resolveOrders("ORDER-A",{data:[dispatchOrder("A")],error:null});
  await fixture.order().click();assert.equal(await page.getByRole("button",{name:"ORDER-B - Synthetic buyer",exact:true}).count(),1);
  assert.deepEqual(await saves(),[]);
});
test("a failed obsolete order search cannot clear the current pending state or report a current failure",async()=>{
  await page.evaluate(()=>{window.__dispatch.autoOrders=false;});await searchHeld("ORDER-A");await searchHeld("ORDER-B");
  await page.evaluate(()=>window.__dispatch.orderRequests.find(request=>request.search.includes("ORDER-A")).reject(new Error("Obsolete catalogue failure")));await fixture.flush();
  assert.deepEqual(fixture.errors,[]);assert.equal(await page.getByRole("alert").count(),0);assert.equal(await page.getByText("Searching...",{exact:true}).count(),1);
});
test("a current catalogue failure is unavailable rather than empty and can be retried",async()=>{
  await page.evaluate(()=>{window.__dispatch.autoOrders=false;});await searchHeld("ORDER-A");await resolveOrders("ORDER-A",{data:null,error:{message:"Catalogue unavailable"}});
  const retry=page.getByRole("button",{name:"Retry order search",exact:true});assert.equal(await retry.count(),1);assert.equal(await page.getByRole("alert").count(),1);
  const before=await page.evaluate(()=>window.__dispatch.orderRequests.length);await retry.click();await page.waitForFunction(count=>window.__dispatch.orderRequests.length>count,before);
  await page.evaluate(row=>window.__dispatch.orderRequests.at(-1).resolve({data:[row],error:null}),dispatchOrder("A"));await fixture.flush();
  await fixture.order().click();assert.equal(await page.getByRole("button",{name:"ORDER-A - Synthetic buyer",exact:true}).count(),1);
});
test("unmounted source and catalogue requests cannot report unhandled errors or navigate",async()=>{
  await fixture.chooseOrder("A");await page.evaluate(()=>{window.__dispatch.autoOrders=false;});await searchHeld("ORDER-B");
  await page.evaluate(()=>window.__dispatch.unmount());await fixture.flush();
  await page.evaluate(()=>{window.__dispatch.sourceRequests[0].reject(new Error("Old source outage"));window.__dispatch.orderRequests.at(-1).reject(new Error("Old catalogue outage"));});await fixture.flush();
  assert.deepEqual(fixture.errors,[]);assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[]);
});
for(const defect of ["missing-array","duplicate-id","nonfinite-weight","fractional-pieces","unknown-source","invalid-profile"]){
  test(`malformed dispatch sources ${defect} remain unavailable before submission`,async()=>{
    await fixture.chooseOrder("A");const row=dispatchSource("A"),result={success:true,sources:[row]};
    if(defect==="missing-array")result.sources=null;
    if(defect==="duplicate-id")result.sources.push({...row});
    if(defect==="nonfinite-weight")row.availableWeightKg=null;
    if(defect==="fractional-pieces")row.availablePieces=0.5;
    if(defect==="unknown-source")row.sourceKind="unknown";
    if(defect==="invalid-profile")row.profileId="broken";
    await fixture.resolveSource(0,result);assert.equal(await page.getByRole("alert").count(),1);assert.ok(await fixture.source().isDisabled());assert.ok(await fixture.save().isDisabled());
    assert.deepEqual(await saves(),[]);assert.deepEqual(fixture.errors,[]);
  });
}
test("a valid current manifest submits once, freezes editing while pending and keeps data on a handled rejection",async()=>{
  await fixture.ready("B");await fixture.fillBundle("B");await fixture.review();await fixture.confirm().evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(()=>window.__dispatch.saveRequests.length>0);const submitted=await saves();assert.equal(submitted.length,1);assert.equal(submitted[0].order_id,f.b);
  assert.deepEqual(submitted[0].bundles,[{bundle_number:"B-MANIFEST",source_line_id:f.sourceB,number_of_pieces:1,net_length_m:2.5,gross_weight_kg:6,tare_weight_kg:1}]);
  assert.ok(await fixture.order().isDisabled());assert.ok(await bundle().isDisabled());
  await page.evaluate(()=>window.__dispatch.saveRequests[0].resolve({success:false,error:"Fresh availability changed"}));await fixture.flush();
  assert.equal(await bundle().inputValue(),"B-MANIFEST");assert.ok(await fixture.order().isEnabled());assert.equal(await page.getByText("Fresh availability changed",{exact:true}).count()>0,true);
});
test("uncertain dispatch confirmation blocks a second write and directs the operator to existing records",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await fixture.review();await fixture.confirm().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
  await page.evaluate(()=>window.__dispatch.saveRequests[0].reject(new Error("Lost dispatch confirmation")));await fixture.flush();
  assert.deepEqual(fixture.errors,[]);assert.ok(await fixture.save().isDisabled());assert.equal(await page.getByRole("link",{name:"Check dispatch records",exact:true}).count(),1);
  assert.equal((await saves()).length,1);assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[]);
});
test("a successful dispatch confirmation locks the submitted form and navigates to its exact record",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await fixture.review();await fixture.confirm().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
  await page.evaluate(id=>window.__dispatch.saveRequests[0].resolve({success:true,dispatchId:id}),f.dispatch);await fixture.flush();
  assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[`/dispatches/${f.dispatch}`]);assert.ok(await fixture.save().isDisabled());
});

test("returning A to B to A still rejects the first A request despite matching order identity",async()=>{
  await fixture.chooseOrder("A");await fixture.chooseOrder("B");await fixture.chooseOrder("A");
  await page.waitForFunction(()=>window.__dispatch.sourceRequests.length===3);
  await fixture.resolveSource(2,{success:true,sources:[{...dispatchSource("A"),sourceLabel:"A source latest"}]});await fixture.fillBundle("A");
  await fixture.resolveSource(0,{success:true,sources:[{...dispatchSource("A"),sourceLabel:"A source obsolete"}]});
  assert.match(await fixture.source().inputValue(),/latest/);assert.equal(await bundle().inputValue(),"A-MANIFEST");
});

test("a complete manifest remains blocked when any one source quantity is exceeded",async()=>{
  await fixture.ready("A");assert.ok(await fixture.save().isDisabled());await fixture.fillBundle("A");assert.ok(await fixture.save().isEnabled());
  for(const [label,invalid,valid] of [["Gross kg *","12","6"],["Actual pieces *","3","1"],["Actual metres *","6","2.5"]]){
    const field=page.getByText(label,{exact:true}).locator("..").locator("input");await field.fill(invalid);assert.ok(await fixture.save().isDisabled());
    await field.fill(valid);assert.ok(await fixture.save().isEnabled());
  }
  assert.deepEqual(await saves(),[]);
});

test("duplicate tags and combined source use are checked across multiple bundle rows",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await page.getByRole("button",{name:"Add bundle",exact:true}).click();
  const row=page.getByText("Bundle 2",{exact:true}).locator("..").locator("..");await row.getByPlaceholder("Select production job or stock batch").click();
  await page.getByRole("button",{name:/A profile.*A source/}).click();
  for(const [label,value] of [["Scan / Bundle ID *","A-MANIFEST"],["Actual pieces *","1"],["Actual metres *","2.5"],["Gross kg *","6"],["Tare kg *","1"]])await row.getByText(label,{exact:true}).locator("..").locator("input").fill(value);
  assert.ok(await fixture.save().isDisabled());await row.getByText("Scan / Bundle ID *",{exact:true}).locator("..").locator("input").fill("A-SECOND");
  assert.ok(await fixture.save().isEnabled());await row.getByText("Actual metres *",{exact:true}).locator("..").locator("input").fill("3");assert.ok(await fixture.save().isDisabled());
  assert.deepEqual(await saves(),[]);
});

test("a source check with no rows is a verified empty state and can be refreshed",async()=>{
  await fixture.chooseOrder("A");await fixture.resolveSource(0,{success:true,sources:[]});
  assert.equal(await page.getByRole("alert").count(),0);assert.match(await page.locator("body").innerText(),/no dispatch-ready material yet/);
  assert.ok(await fixture.save().isDisabled());await page.getByRole("button",{name:"Refresh sources",exact:true}).click();
  await page.waitForFunction(()=>window.__dispatch.sourceRequests.length===2);await fixture.resolveSource(1,{success:true,sources:[dispatchSource("A")]});
  await fixture.fillBundle("A");assert.ok(await fixture.save().isEnabled());
});

for(const kind of ["production","dealer_stock"]){
  test(`valid ${kind} sources remain selectable with exact manifest quantities`,async()=>{
    await fixture.chooseOrder("A");await fixture.resolveSource(0,{success:true,sources:[{...dispatchSource("A"),sourceKind:kind,stockBatchId:kind==="production"?null:f.batch}]});
    await fixture.fillBundle("A");assert.ok(await fixture.save().isEnabled());assert.deepEqual(await saves(),[]);
  });
}

test("old company save completion cannot redirect or populate the new company's form",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await fixture.review();await fixture.confirm().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
  await page.evaluate(company=>window.__dispatch.setCompanyId(company),f.otherCompany);await fixture.flush();
  await page.evaluate(id=>window.__dispatch.saveRequests[0].resolve({success:true,dispatchId:id}),f.dispatch);await fixture.flush();
  assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[]);assert.equal(await fixture.order().inputValue(),"");assert.equal(await bundle().inputValue(),"");
});

for(const confirmation of [{success:true,dispatchId:"broken"},{success:"true",dispatchId:f.dispatch}]){
  test(`invalid positive confirmation ${typeof confirmation.success}/${confirmation.dispatchId==="broken"?"invalid-id":"valid-id"} remains uncertain without another write`,async()=>{
    await fixture.ready("A");await fixture.fillBundle("A");await fixture.review();await fixture.confirm().click();await page.waitForFunction(()=>window.__dispatch.saveRequests.length===1);
    await page.evaluate(value=>window.__dispatch.saveRequests[0].resolve(value),confirmation);await fixture.flush();
    assert.ok(await fixture.save().isDisabled());assert.equal(await page.getByRole("link",{name:"Check dispatch records",exact:true}).count(),1);
    assert.deepEqual(await page.evaluate(()=>window.__dispatch.navigation),[]);assert.equal((await saves()).length,1);
  });
}

test("preview rechecks sources, lists the exact load, and cancelling posts nothing",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await fixture.review();
  assert.equal(await page.getByRole("dialog",{name:"Review physical dispatch"}).count(),1);assert.equal(await page.getByRole("region",{name:"Reviewed physical bundles"}).count(),1);
  assert.deepEqual(await saves(),[]);assert.equal(await page.evaluate(()=>window.__dispatch.sourceRequests.length),2);
  await page.getByRole("button",{name:"Back to editing",exact:true}).click();assert.equal(await bundle().inputValue(),"A-MANIFEST");assert.deepEqual(await saves(),[]);
});
test("material consumed after the first source check blocks the preview and preserves measurements",async()=>{
  await fixture.ready("A");await fixture.fillBundle("A");await fixture.save().click();await page.waitForFunction(()=>window.__dispatch.sourceRequests.length===2);
  await fixture.resolveSource(1,{success:true,sources:[{...dispatchSource("A"),availableWeightKg:4}]});
  assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await bundle().inputValue(),"A-MANIFEST");assert.deepEqual(await saves(),[]);assert.equal(await page.getByRole("alert").count(),1);
});
