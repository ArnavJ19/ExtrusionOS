import assert from "node:assert/strict";
import test from "node:test";
import {createDieReadinessBrowserFixture} from "../scripts/lib/die-readiness-browser-fixture.mjs";

let fixture;
test.before(async()=>{fixture=await createDieReadinessBrowserFixture();});
test.after(async()=>{await fixture?.close();});

test("production form autofill uses a matching active or approved die",async()=>{
  await fixture.open();await fixture.selectOrder();await fixture.field("Die *").waitFor();
  await fixture.page.waitForFunction(()=>!document.body.innerText.includes('Loading production'));
  await fixture.page.getByText(/Auto-filled/).waitFor();assert.equal(await fixture.field("Die *").inputValue(),"D-ACTIVE");
  assert.deepEqual(fixture.errors,[]);
});

test("an earlier correction die cannot win fallback autofill",async()=>{
  await fixture.open("correctionFirst=1");await fixture.selectOrder();await fixture.page.getByText(/Auto-filled/).waitFor();
  assert.equal(await fixture.field("Die *").inputValue(),"D-ACTIVE");assert.deepEqual(fixture.errors,[]);
});

test("an explicitly assigned correction die is not silently substituted",async()=>{
  await fixture.open("preferred=correction");await fixture.selectOrder();await fixture.page.getByText(/assigned die|Select an active or approved/i).waitFor();
  assert.equal(await fixture.field("Die *").inputValue(),"");assert.deepEqual(fixture.errors,[]);
});

test("an explicitly assigned approved die retains its identity",async()=>{
  await fixture.open("preferred=approved");await fixture.selectOrder();await fixture.page.getByText(/Auto-filled/).waitFor();
  assert.equal(await fixture.field("Die *").inputValue(),"D-APPROVED");assert.deepEqual(fixture.errors,[]);
});

test("production die choices contain only matching active/approved dies",async()=>{
  await fixture.open();await fixture.selectOrder();await fixture.page.getByText(/Auto-filled/).waitFor();await fixture.field("Die *").click();
  for(const valid of ["D-APPROVED","D-ACTIVE"])await fixture.page.getByRole("button",{name:valid,exact:true}).waitFor();
  for(const invalid of ["D-CORRECTION","D-UNKNOWN","D-OTHER-PROFILE"])assert.equal(await fixture.page.getByRole("button",{name:invalid,exact:true}).count(),0);
});

test("production die lookup filters eligibility before its 40-row limit",async()=>{
  await fixture.open("crowded=1");await fixture.selectOrder();await fixture.field("Die *").click();
  await fixture.page.getByRole("button",{name:"D-APPROVED",exact:true}).waitFor();
  const queries=await fixture.page.evaluate(()=>window.__die.queries.filter(query=>query.table==='dies'&&query.limit===40));
  assert.ok(queries.every(query=>query.filters.some(([kind,key,value])=>kind==='in'&&key==='die_status'&&value.includes('active')&&value.includes('approved'))));
});

test("the older production form also offers approved dies",async()=>{
  await fixture.open("mode=legacy");await fixture.page.getByRole("button",{name:"Plan New Job",exact:true}).click();
  await fixture.page.getByText("Profile *",{exact:true}).locator("..").locator("select").selectOption("00000000-0000-4000-8000-000000000002");
  const select=fixture.page.getByText("Die",{exact:true}).locator("..").locator("select");
  await fixture.page.waitForFunction(()=>[...document.querySelectorAll('option')].some(row=>row.textContent==='D-APPROVED'));
  assert.deepEqual(await select.locator("option").allTextContents(),["No die","D-ACTIVE","D-APPROVED"]);assert.deepEqual(fixture.errors,[]);
});

test("autofill refreshes die choices for its exact profile beyond a crowded company preview",async()=>{
  await fixture.open("otherProfiles=1");await fixture.selectOrder();await fixture.page.getByText(/Select an active or approved/).waitFor();
  await fixture.field("Die *").click();await fixture.page.getByRole("button",{name:"D-APPROVED",exact:true}).waitFor();
  assert.equal(await fixture.page.getByRole("button",{name:/A-OTHER-/}).count(),0);
  const scoped=await fixture.page.evaluate(()=>window.__die.queries.filter(query=>query.table==='dies'&&query.limit===40&&query.filters.some(([,key])=>key==='profile_id')));
  assert.ok(scoped.length>0);assert.deepEqual(fixture.errors,[]);
});

test("an operator can explicitly replace an unavailable assigned die with an approved one",async()=>{
  await fixture.open("preferred=correction");await fixture.selectOrder();await fixture.page.getByText(/assigned die is unavailable/).waitFor();
  await fixture.field("Die *").click();await fixture.page.getByRole("button",{name:"D-APPROVED",exact:true}).click();
  assert.equal(await fixture.field("Die *").inputValue(),"D-APPROVED");assert.deepEqual(fixture.errors,[]);
});

test("a read-only order preserves its historical die identity without declaring it usable",async()=>{
  await fixture.open("mode=order-edit&preferred=correction");const input=fixture.field("Production die");
  assert.ok(await input.isDisabled());assert.match(await input.inputValue(),/D-CORRECTION.*Unavailable for production/);assert.deepEqual(fixture.errors,[]);
});
