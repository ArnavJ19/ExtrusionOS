import assert from "node:assert/strict";
import test from "node:test";
import {createSearchableSelectBrowserFixture} from "../scripts/lib/searchable-select-browser-fixture.mjs";

let fixture,page;
test.before(async()=>{fixture=await createSearchableSelectBrowserFixture();page=fixture.page;});
test.after(async()=>{await fixture?.close();});
test.beforeEach(async()=>{await fixture.reset();});
const input=()=>page.getByLabel("Profile",{exact:true});
const option=name=>page.getByRole("button",{name,exact:true});
const state=()=>page.evaluate(()=>({changes:window.__select.changes,searches:window.__select.searches,submits:window.__select.submits}));
const choose=async()=>{await input().click();await option("Beta profile").click();assert.equal(await input().inputValue(),"Beta profile");};

test("mouse click reopens the list immediately after choosing while the input still owns focus",async()=>{
  await choose();assert.equal(await input().evaluate(element=>element===document.activeElement),true);
  await input().click();assert.equal(await option("Beta profile").count(),1);
  assert.deepEqual(await state(),{changes:["beta"],searches:[],submits:0});
});

test("clicking an open input preserves the user's current filter without firing another remote search",async()=>{
  await input().fill("Gamma");
  await input().click();assert.equal(await input().inputValue(),"Gamma");assert.equal(await option("Gamma profile").count(),1);
  assert.deepEqual((await state()).searches,["Gamma"]);assert.deepEqual((await state()).changes,[]);
});

test("ArrowDown reopens a closed focused input and Enter chooses once without submitting the enclosing form",async()=>{
  await choose();await input().press("ArrowDown");assert.equal(await option("Alpha profile").count(),1);
  await input().press("Enter");assert.deepEqual((await state()).changes,["beta","alpha"]);assert.equal((await state()).submits,0);
});

test("Escape preserves selection and keyboard reopening does not send another search",async()=>{
  await input().fill("Gamma");await input().press("Escape");await input().press("ArrowDown");
  assert.equal(await input().inputValue(),"Alpha profile");await input().press("Enter");assert.deepEqual((await state()).changes,["alpha"]);
  assert.deepEqual((await state()).searches,["Gamma"]);assert.equal((await state()).submits,0);
});

test("Tab can move from the input into option buttons and choose after the blur delay",async()=>{
  await input().click();await input().press("Tab");await page.keyboard.press("Tab");await page.waitForTimeout(180);
  assert.equal(await option("Alpha profile").count(),1);assert.equal(await option("Alpha profile").evaluate(element=>element===document.activeElement),true);
  await page.keyboard.press("Enter");assert.deepEqual((await state()).changes,["alpha"]);assert.equal((await state()).submits,0);
});

test("leaving the control closes it; refocusing before its delayed close keeps the reopened list available",async()=>{
  await input().click();await page.getByLabel("Next field").focus();await input().focus();await page.waitForTimeout(180);
  assert.equal(await option("Alpha profile").count(),1);
  await page.getByLabel("Next field").focus();await page.waitForTimeout(180);assert.equal(await option("Alpha profile").count(),0);
  assert.deepEqual((await state()).changes,[]);
});

test("clearing does not submit, trigger a search or choose an option; the still-focused input reopens on click",async()=>{
  await choose();await page.getByRole("button",{name:"Clear selection",exact:true}).click();
  assert.equal(await input().inputValue(),"");await input().click();assert.equal(await option("Alpha profile").count(),1);
  assert.deepEqual(await state(),{changes:["beta",""],searches:[],submits:0});
});

test("pending remote search cannot choose an old option by mouse or Enter",async()=>{
  await input().fill("profile");await page.evaluate(()=>window.__select.setSearching(true));
  await page.waitForFunction(()=>document.querySelector("form").dataset.searching==="true");
  assert.equal(await page.getByText("Searching...",{exact:true}).count(),1);assert.equal(await option("Alpha profile").count(),0);
  await input().press("Enter");assert.deepEqual(await state(),{changes:[],searches:["profile"],submits:0});
  await page.evaluate(()=>{window.__select.setOptions([{value:"delta",label:"Delta profile"}]);window.__select.setSearching(false);});
  await option("Delta profile").waitFor();await input().press("Enter");assert.deepEqual((await state()).changes,["delta"]);
});

test("empty results never select an option or submit while the list is open",async()=>{
  await input().fill("No matching section");await input().press("Enter");
  assert.deepEqual((await state()).changes,[]);assert.equal((await state()).submits,0);
});

test("Enter used to compose text does not choose an option",async()=>{
  await input().click();await input().evaluate(element=>element.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true})));
  assert.deepEqual((await state()).changes,[]);assert.equal(await option("Alpha profile").count(),1);
});

test("disabled controls cannot open or choose, including when disabled during an open list",async()=>{
  await input().click();await page.evaluate(()=>window.__select.setDisabled(true));
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Profile"]').disabled);
  assert.equal(await option("Alpha profile").count(),0);assert.equal(await page.getByRole("button",{name:"Clear selection",exact:true}).count(),0);
  await input().evaluate(element=>{element.click();element.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));});
  assert.deepEqual((await state()).changes,[]);assert.equal(await option("Alpha profile").count(),0);
});

test("touch selection reopens without an extra tap outside the control",async()=>{
  const context=await page.context().browser().newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  try{
    const mobile=await context.newPage();await mobile.route("**/*",route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());
    await mobile.goto(fixture.base);const field=mobile.getByLabel("Profile",{exact:true});await field.tap();
    await mobile.getByRole("button",{name:"Beta profile",exact:true}).tap();await field.tap();
    assert.equal(await mobile.getByRole("button",{name:"Beta profile",exact:true}).count(),1);
    assert.deepEqual(await mobile.evaluate(()=>window.__select.changes),["beta"]);
  }finally{await context.close();}
});

test("a delayed close is harmless when the control is removed",async()=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await input().click();await page.getByLabel("Next field").focus();await page.evaluate(()=>window.__select.setMounted(false));await page.waitForTimeout(180);
  assert.deepEqual(errors,[]);assert.deepEqual((await state()).changes,[]);
});
