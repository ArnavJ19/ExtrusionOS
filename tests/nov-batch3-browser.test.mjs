import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createNov3BrowserFixture } from "../scripts/lib/nov-batch3-browser-fixture.mjs";
import { nids as i } from "../scripts/lib/nov-batch3-fixture.mjs";

let fixture,browser,page,errors;
const evidence="docs/evidence/NOV_UPGRADES_BATCH_3";
test.before(async()=>{fixture=await createNov3BrowserFixture();browser=await chromium.launch({headless:true});mkdirSync(evidence,{recursive:true});});
test.after(async()=>{await browser?.close();await fixture?.close();});
test.beforeEach(async()=>{await fixture.start();errors=[];page=await browser.newPage({viewport:{width:375,height:900},timezoneId:"Asia/Kolkata"});page.setDefaultTimeout(15000);page.on("pageerror",error=>errors.push(error.message));await page.goto(fixture.base);});
test.afterEach(async()=>{await page?.close();await fixture.rollback();assert.deepEqual(errors,[]);});
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
async function review(){await page.getByRole("button",{name:"Review this action",exact:true}).click();await expect(page.getByRole("heading",{name:"Review before confirming",exact:true})).toBeVisible();}
async function confirm(){await page.getByRole("button",{name:"Confirm reviewed action",exact:true}).click();await expect(page.getByRole("heading",{name:"Action confirmed",exact:true})).toBeVisible();}
async function restart(){await page.getByRole("button",{name:"Start another action",exact:true}).click();}

test("NOV-097: phone review uses the real server consequence and commits only after explicit confirmation",async()=>{
  await review();assert.equal((await fixture.f.db.query("select priority from orders where id=$1",[i.order])).rows[0].priority,"normal");
  await expect(page.getByText(/existing-priority-due-v1:/)).toBeVisible();await noOverflow();
  await page.screenshot({path:`${evidence}/priority-review-phone.png`,fullPage:true});
  await confirm();assert.equal((await fixture.f.db.query("select priority from orders where id=$1",[i.order])).rows[0].priority,"high");
  await expect(page.getByRole("link",{name:"Open confirmed record"})).toBeVisible();await noOverflow();
});

test("NOV-098: repeated taps send one commit and a lost response resolves by reading the original request",async()=>{
  await review();await page.evaluate(()=>{window.lostCommand="commit";const button=[...document.querySelectorAll('button')].find(button=>button.textContent==='Confirm reviewed action');button.click();button.click();});
  await expect(page.getByRole("heading",{name:"Outcome needs checking"})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==="commit").length),1);
  await page.getByRole("button",{name:"Check original request"}).click();await expect(page.getByRole("heading",{name:"Action confirmed"})).toBeVisible();
  assert.equal((await fixture.f.db.query("select count(*) n from coordination_events where entity_id=$1",[i.order])).rows[0].n,1);
});

test("NOV-098: reload keeps the original identity and a rejected review retains entered values",async()=>{
  await review();await page.evaluate(()=>{window.lostCommand="commit";});await page.getByRole("button",{name:"Confirm reviewed action"}).click();
  await expect(page.getByRole("heading",{name:"Outcome needs checking"})).toBeVisible();await page.reload();
  await expect(page.getByRole("heading",{name:"Outcome needs checking"})).toBeVisible();await expect(page.getByRole("button",{name:"Review this action"})).toBeDisabled();
  await page.getByRole("button",{name:"Check original request"}).click();await expect(page.getByRole("heading",{name:"Action confirmed"})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call.command==="commit").length),0);await restart();
  await page.getByLabel("Reason, contact outcome or supporting decision").fill("Keep this source-change explanation");await review();
  await fixture.f.db.query("update orders set expected_dispatch_date=expected_dispatch_date+1 where id=$1",[i.order]);
  await page.getByRole("button",{name:"Confirm reviewed action"}).click();await expect(page.getByRole("heading",{name:"Action rejected"})).toBeVisible();
  await expect(page.getByLabel("Reason, contact outcome or supporting decision")).toHaveValue("Keep this source-change explanation");
});

test("NOV-098: interrupted preview can be recovered or cancelled without a duplicate action",async()=>{
  await page.evaluate(()=>{window.lostCommand="preview";});await page.getByRole("button",{name:"Review this action"}).click();
  await expect(page.getByRole("heading",{name:"Outcome needs checking"})).toBeVisible();await page.reload();
  await page.getByRole("button",{name:"Check original request"}).click();await expect(page.getByRole("heading",{name:"Review before confirming"})).toBeVisible();
  await page.getByRole("button",{name:"Cancel this review"}).click();await expect(page.getByText(/This request made no operational change/)).toBeVisible();
  await restart();assert.equal((await fixture.f.db.query("select count(*) n from coordination_events")).rows[0].n,0);
});

test("NOV-041/043: coordinator acceptance is shown only to the proposed employee and keeps priority context",async()=>{
  const result=await fixture.f.apply({action:"coordinator.propose",order_id:i.order,employee_id:i.sales,note:"Reviewed coordinator responsibility"});assert.equal(result.state,"confirmed");
  await page.evaluate(async()=>{window.mount({role:'sales',userId:window.ids.sales});await window.loadDetail('orders',window.ids.order);});
  await expect(page.getByRole("heading",{name:"Accept coordinator responsibility"})).toBeVisible();
  const form=page.locator("form").filter({has:page.getByRole("heading",{name:"Accept coordinator responsibility"})});
  await form.getByRole("textbox",{name:"Reason, contact outcome or supporting decision",exact:true}).fill("I accept the cross-team coordination responsibility");
  await form.getByRole("button",{name:"Review this action"}).click();await confirm();
  await expect(page.getByText(/Responsible employee: Fixture sales/)).toBeVisible();
  await expect(page.getByText("Set operational priority",{exact:true})).toHaveCount(0);
  await page.screenshot({path:`${evidence}/coordinator-confirmed-phone.png`,fullPage:true});await noOverflow();
});

test("NOV-040: finance entry keeps promises and real invoice balance distinct with exact lookup context",async()=>{
  await page.evaluate(()=>window.mount({action:'collection.create',role:'accounts',userId:window.ids.accounts,fixed:{},initial:{employee_id:window.ids.accounts,amount:'500',due_date:'2026-11-10',disputed_amount:'0',note:'Customer confirmed the bank payment promise'}}));
  const lookup=page.getByRole("combobox",{name:"Issued invoice",exact:true});await lookup.click();
  await page.getByRole("option").filter({hasText:/Balance INR 1000/}).click();await review();
  await expect(page.getByText("Promised amount (INR)",{exact:true}).first()).toBeVisible();await expect(page.getByText("Current balance (INR)",{exact:true})).toBeVisible();
  await confirm();await noOverflow();await page.screenshot({path:`${evidence}/collection-confirmed-phone.png`,fullPage:true});
  assert.equal((await fixture.f.db.query("select count(*) n from payments")).rows[0].n,0);
});

test("NOV-046/048/049/050/056: reference-heavy forms work at enlarged desktop width without page overflow",async()=>{
  await page.setViewportSize({width:1280,height:960});await page.addStyleTag({content:"html{font-size:24px}"});
  for(const action of ['contract.publish','coverage.propose','session.start','request.create','steward.assign','correction.report']){
    await page.evaluate(action=>window.mount({action,fixed:{},initial:{note:'Reviewed the process and its evidence'},role:'owner',userId:window.ids.owner}),action);
    await expect(page.getByRole("button",{name:"Review this action"})).toBeVisible();await noOverflow();
  }
  await page.screenshot({path:`${evidence}/correction-desktop-enlarged.png`,fullPage:true});
});

test("NOV-098/security: switching company or user cannot recover another employee's in-flight reference",async()=>{
  await review();await page.evaluate(()=>window.mount({role:'accounts',userId:window.ids.accounts}));
  await expect(page.getByRole("heading",{name:"Review before confirming"})).toHaveCount(0);await expect(page.getByRole("button",{name:"Check original request"})).toHaveCount(0);
  await page.evaluate(()=>window.mount({role:'owner',userId:window.ids.foreign,companyId:window.ids.foreignCompany}));
  await expect(page.getByRole("button",{name:"Check original request"})).toHaveCount(0);
});

test("NOV-098: unavailable session storage stops submission before any request is sent",async()=>{
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('Synthetic storage unavailable')};});
  await page.getByRole("button",{name:"Review this action"}).click();
  await expect(page.getByText(/No action was submitted/)).toBeVisible();await expect(page.getByRole("button",{name:"Review this action"})).toBeDisabled();
  assert.equal(await page.evaluate(()=>window.calls.length),0);
});
