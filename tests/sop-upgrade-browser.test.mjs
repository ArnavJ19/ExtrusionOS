import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {createSopBrowserFixture} from '../scripts/lib/sop-upgrade-browser-fixture.mjs';
let f,browser,page,errors;
test.before(async()=>{f=await createSopBrowserFixture();browser=await chromium.launch({headless:true});});
test.beforeEach(async()=>{await f.reset();page=await browser.newPage({viewport:{width:375,height:850},timezoneId:'Asia/Kolkata'});page.setDefaultTimeout(15000);errors=[];page.on('pageerror',e=>errors.push(e.message));});
test.afterEach(async()=>{await page?.close();assert.deepEqual(errors,[]);});
test.after(async()=>{await browser?.close();await f?.close();});
const open=(role='operator',screen='guided')=>page.goto(`${f.base}/?role=${role}&screen=${screen}`);
test('65/66/68/70: mounted phone workflow records evidence, routes rework, verifies independently and completes',async()=>{
 await open();await page.getByLabel('Observation',{exact:true}).fill('Switch isolated and tagged');await page.getByRole('button',{name:'Confirm step',exact:true}).click();
 await page.getByLabel(/Actual measurement/).fill('22');await page.getByLabel('Observation',{exact:true}).fill('Sample hardness was 22');await page.getByRole('button',{name:'Confirm step',exact:true}).click();await expect(page.getByText(/different authorized employee must route rework/)).toBeVisible();
 await open('quality');await page.getByLabel('Rework instruction',{exact:true}).fill('Rework and measure a fresh sample');await page.getByRole('button',{name:'Route rework and allow a new measurement'}).click();
 await open();await page.getByLabel(/Actual measurement/).fill('15');await page.getByLabel('Observation',{exact:true}).fill('Fresh sample hardness 15');await page.getByRole('button',{name:'Confirm step',exact:true}).click();
 await page.getByLabel(/Related production job reference ID/).selectOption(f.getJob());await page.getByLabel('Observation',{exact:true}).fill('Linked actual job completion');await page.getByRole('button',{name:'Confirm step',exact:true}).click();await page.getByRole('button',{name:'Submit for verification'}).click();
 await open('quality');await page.getByLabel('Independent verification finding').fill('Sample and job evidence independently checked');await page.getByRole('button',{name:'Verify evidence'}).click();
 await open();await page.getByRole('button',{name:'Complete task with current evidence'}).click();await expect(page.getByText(/Attempt 1.*completed/)).toBeVisible();
 assert.equal((await f.db.query('select status from tasks where id=$1',[f.getTask()])).rows[0].status,'completed');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 mkdirSync('docs/evidence/EOS_UPGRADE_BATCH_3',{recursive:true});await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_3/guided-phone.png',fullPage:true});
});
test('78: continuity sheet and numbered recovery observation use the real reconciliation queue',async()=>{
 await open('operator','recovery');await expect(page.getByText(/No stock issues, quality releases/)).toBeVisible();await page.getByLabel('Temporary paper reference').fill('OUT-BROWSER-001');await page.getByLabel('Actual observation time').fill(new Date().toISOString().slice(0,16));await page.getByLabel('What was observed').fill('Actual hardness noted on paper during outage');await page.getByRole('button',{name:'Record recovery observation'}).click();await expect(page.getByRole('heading',{name:'OUT-BROWSER-001 / pending'})).toBeVisible();
 await open('quality','recovery');await page.getByLabel('Related transaction reference ID').fill(f.getJob());await page.locator('select[name=type]').selectOption('production_job');await page.getByLabel('Decision reason').fill('Matched to confirmed actual job completion');await page.getByRole('button',{name:'Record recovery decision'}).click();await expect(page.getByRole('heading',{name:'OUT-BROWSER-001 / reconciled'})).toBeVisible();
});
test('79/80: observed trial captures employee feedback and creates a controlled improvement',async()=>{
 await open('supervisor','trial');await page.getByRole('button',{name:'Start observing this employee'}).click();const notes=page.getByLabel('What the employee actually did');await expect(notes).toHaveCount(3);for(let i=0;i<3;i++)await notes.nth(i).fill('Employee demonstrated this step at the press');await page.getByLabel('Employee feedback').fill('Specify which hardness sample to use');await page.getByRole('button',{name:'Submit observed findings'}).click();await expect(page.getByRole('heading',{name:/submitted/})).toBeVisible();
 await open('owner','trial');await page.getByLabel('Process decision').selectOption('revise');await page.getByLabel('Review reason').fill('Clarify the sample location in a new reviewed revision');await page.getByRole('button',{name:'Record independent review'}).click();await expect(page.getByRole('heading',{name:/reviewed/})).toBeVisible();assert.equal((await f.db.query('select count(*)::int n from procedure_improvements')).rows[0].n,1);
});
test('77/80: released rules and small-sample outcomes render safely at desktop and phone sizes',async()=>{
 await page.setViewportSize({width:1280,height:900});await open('owner','plan');await expect(page.getByText(/Released by/)).toBeVisible();await expect(page.getByRole('button',{name:'Save execution plan'})).toBeDisabled();await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_3/execution-rules-desktop.png',fullPage:true});
 await page.setViewportSize({width:375,height:850});await open('operator','effectiveness');await expect(page.getByText('Only 0 completed tasks: too few to compare')).toBeVisible();await page.getByLabel('Describe what happened').fill('The switch location is unclear');await page.getByRole('button',{name:'Record flag'}).click();await expect(page.getByText('Flag recorded for the process owner.')).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
test('70: a reviewer returns a chosen step for correction and the performer records fresh evidence',async()=>{
 const task=f.getTask(),job=f.getJob();
 await f.record(task,1,1);await f.record(task,2,2,{value:15});await f.record(task,3,3,{source_id:job});
 await f.db.query("update tasks set priority='urgent' where id=$1",[task]);await f.cmd('run.submit',{task_id:task,expected_revision:4});
 await open('quality');await page.getByLabel('First step to redo').selectOption('2');await page.getByLabel('Correction or withdrawal reason').fill('Repeat the hardness measurement at the correct sample location');
 await page.getByRole('button',{name:'Return for correction',exact:true}).click();
 await open();await page.getByLabel(/Actual measurement/).fill('16');await page.getByLabel('Observation',{exact:true}).fill('New measurement taken at the required location');await page.getByRole('button',{name:'Confirm step',exact:true}).click();
 await expect(page.getByLabel(/Related production job reference ID/)).toBeVisible();
 assert.equal((await f.db.query("select count(*)::int n from sop_verification_events where decision='returned'")).rows[0].n,1);
});
test('65: reassignment offers a new attempt while preserving the prior employee evidence',async()=>{
 await f.record(f.getTask(),1,1);await f.db.query('update tasks set assigned_to=$2 where id=$1',[f.getTask(),'00000000-0000-4000-8300-000000000018']);
 await open('operator2');await page.getByRole('button',{name:'Start my assigned attempt'}).click();await expect(page.getByText(/Attempt 2.*Operator Ravi/)).toBeVisible();
 await expect(page.getByLabel('Observation',{exact:true})).toBeVisible();
 assert.equal((await f.db.query("select count(*)::int n from sop_runs where status='superseded'")).rows[0].n,1);
});
test('57: the mounted customer requirement records an acknowledgement of the current revision',async()=>{
 await open('quality','requirements');await expect(page.getByRole('heading',{name:/Batch hardness certificate/})).toBeVisible();
 await page.getByLabel('How will this requirement be met?').fill('Batch certificate and inspection reference checked before release');await page.getByRole('button',{name:'Acknowledge this revision for quality'}).click();
 await expect(page.getByText(/Reviewed by Backup Leela/)).toBeVisible();assert.equal((await f.db.query('select count(*)::int n from order_requirement_acknowledgements')).rows[0].n,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_3/customer-requirement-phone.png',fullPage:true});
});
test('61: the mounted blueprint form saves a real revision and its prerequisites',async()=>{
 await open('owner','blueprint');await page.getByLabel(/Task kind/).fill('type:sample_inspection');await page.getByLabel('Title',{exact:true}).fill('Sample inspection');await page.getByLabel('Purpose',{exact:true}).fill('Inspect the actual sample before the next operation');
 await page.getByLabel(/Trigger \(what starts/).fill('A completed job needs inspection');await page.getByLabel(/Inputs \(one per line/).fill('Job number\nSample identifier');await page.getByRole('checkbox',{name:'production',exact:true}).check();
 await page.getByLabel('Prerequisite record (optional)').selectOption('production_job');await page.getByRole('checkbox',{name:'completed',exact:true}).check();
 await page.getByLabel('Exception instruction',{exact:true}).fill('Contact the factory manager if the sample is missing');await page.getByLabel('Reason for this revision').fill('First issue of the inspected sample workflow');
 await page.getByRole('button',{name:'Save blueprint',exact:true}).click();await expect(page.getByText('Blueprint saved.',{exact:true})).toBeVisible();
 const b=(await f.db.query("select revision,prerequisites from task_blueprints where task_kind='type:sample_inspection'")).rows[0];assert.equal(b.revision,1);assert.equal(b.prerequisites[0].states[0],'completed');
});
