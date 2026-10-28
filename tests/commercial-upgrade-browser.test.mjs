import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync} from 'node:fs';import {chromium,expect} from '@playwright/test';
import {createCommercialBrowserFixture} from '../scripts/lib/commercial-upgrade-browser-fixture.mjs';import {cid} from '../scripts/lib/commercial-upgrade-fixture.mjs';
let f,browser,page,errors;
test.before(async()=>{f=await createCommercialBrowserFixture();browser=await chromium.launch({headless:true});mkdirSync('docs/evidence/EOS_UPGRADE_BATCH_4',{recursive:true});});
test.after(async()=>{await browser?.close();await f?.close();});
test.beforeEach(async()=>{await f.reset();errors=[];page=await browser.newPage({viewport:{width:375,height:900},timezoneId:'Asia/Kolkata'});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(async()=>{await page?.close();await f.rollback();assert.deepEqual(errors,[]);});
const open=(screen,role='owner')=>page.goto(`${f.base}/?screen=${screen}&role=${role}`);
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);

test('28: actual editor retains unsaved lines and notes through a conflict and explicit reconciliation',async()=>{
  await open('edit');await expect(page.getByRole('button',{name:'Update quote',exact:true})).toBeVisible();const notes=page.getByLabel('Internal quotation notes',{exact:true});
  await page.locator('details').filter({has:notes}).locator('summary').click();await notes.fill('My unsaved quotation note');
  // The enclosing fixture transaction fixes now(); a revision change models another saved version.
  await f.db.query("update quotes set notes='A colleague saved a newer note',revision_number=revision_number+1 where id=$1",[f.getDraft()]);
  await page.getByRole('button',{name:'Update quote',exact:true}).click();
  await expect(page.getByRole('heading',{name:'This quotation changed. Your entries are retained.'})).toBeVisible();await expect(notes).toHaveValue('My unsaved quotation note');
  assert.equal((await f.db.query('select notes from quotes where id=$1',[f.getDraft()])).rows[0].notes,'A colleague saved a newer note');
  await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_4/quote-conflict-phone.png',fullPage:true});
  await page.getByRole('button',{name:'I reviewed the latest lines and reconciled my entries'}).click();await page.getByRole('button',{name:'Update quote',exact:true}).click();
  await expect(page.locator('#messages')).toHaveText('Quote saved');assert.equal((await f.db.query('select notes from quotes where id=$1',[f.getDraft()])).rows[0].notes,'My unsaved quotation note');
  assert.equal((await f.db.query('select count(*)::int n from quote_items where quote_id=$1',[f.getDraft()])).rows[0].n,1);
});
test('5/86/87: phone review reconciles saved totals and creates one reviewed order in the normal queue',async()=>{
  await open('review');await expect(page.getByRole('heading',{name:'Commercial review'})).toBeVisible();await noOverflow();
  await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_4/commercial-review-phone.png',fullPage:true});
  await page.getByRole('checkbox',{name:/I reviewed this accepted revision/}).check();await page.getByRole('button',{name:'Create order from this revision'}).click();
  await expect.poll(()=>page.evaluate(()=>window.navigations.length)).toBe(1);
  const path=await page.evaluate(()=>window.navigations[0]),orderId=path.split('/').at(-1);
  assert.equal((await f.db.query('select revision_number from order_quote_snapshots where order_id=$1',[orderId])).rows[0].revision_number,1);
  assert.equal((await f.db.query('select status from factory_load_consolidations where order_id=$1',[orderId])).rows[0].status,'pending');
});
test('81: phone party review previews and saves a transaction-specific delivery override',async()=>{
  await open('party');await page.getByText('Choose a site or transaction override',{exact:true}).click();
  await page.getByLabel('Override delivery address',{exact:true}).fill('Site C / unloading gate 2');await expect(page.getByRole('button',{name:'Save reviewed details'})).toBeDisabled();
  await page.getByRole('button',{name:'Preview details',exact:true}).click();await expect(page.getByText('Site C / unloading gate 2',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save reviewed details'}).click();await expect(page.getByText(/Reviewed party details saved/)).toBeVisible();
  assert.equal((await f.db.query('select snapshot from quote_party_drafts where quote_id=$1',[f.getDraft()])).rows[0].snapshot.delivery_address,'Site C / unloading gate 2');await noOverflow();
  await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_4/customer-site-phone.png',fullPage:true});
});
test('82: multiple approved tempers require a choice and the actual save retains that specification',async()=>{
  await f.db.query("insert into pcda_master_alloys(id,company_id,value) values($1,$2,'6063')",[cid(620),f.ids.company]);
  await f.db.query("insert into pcda_master_tempers(id,company_id,value) values($1,$3,'T6'),($2,$3,'T5')",[cid(621),cid(622),f.ids.company]);
  for(const [option,temper]of [[cid(623),cid(621)],[cid(624),cid(622)]]){
    await f.actor();await f.command('profile_technical_command','option.create',{profile_id:f.ids.profile,id:option,alloy_id:cid(620),temper_id:temper});await f.actor(f.ids.admin);await f.command('profile_technical_command','option.approve',{profile_id:f.ids.profile,id:option});
  }
  await open('edit');const selector=page.getByLabel('Approved alloy and temper',{exact:true});await expect(selector).toBeVisible();await expect(selector).toHaveValue('');await selector.selectOption(cid(624));
  await page.getByRole('button',{name:'Update quote',exact:true}).click();await expect(page.locator('#messages')).toHaveText('Quote saved');
  const row=(await f.db.query('select technical_spec_snapshot from quote_items where quote_id=$1',[f.getDraft()])).rows[0];assert.equal(row.technical_spec_snapshot.temper,'T5');
});
test('12: refreshed phone suggestions reflect a new quality hold and preserve inventory quantities',async()=>{
  await open('material');await page.getByText('Current stock and die suggestions',{exact:true}).click();await page.getByRole('button',{name:'Check current material'}).click();
  await expect(page.getByText(/Shed B \/ Rack 04/)).toBeVisible();await expect(page.getByText('Meets the recorded profile, finish and length checks')).toBeVisible();
  await f.db.query("update profile_stock_batches set qc_status='on_hold' where id=$1",[cid(606)]);await page.getByRole('button',{name:'Check current material'}).click();await expect(page.getByText('Quality release is required')).toBeVisible();
  assert.equal(Number((await f.db.query('select total_weight_kg from profile_stock_batches where id=$1',[cid(606)])).rows[0].total_weight_kg),48);await noOverflow();
});
test('34: mounted order progress distinguishes confirmed zero and unavailable loading evidence',async()=>{
  await open('progress');await expect(page.getByText('Completed output',{exact:true})).toBeVisible();await expect(page.getByText('0 kg',{exact:true})).toHaveCount(4);await noOverflow();
});
test('36: approved-file linking retains one reference and verifies current access before opening',async()=>{
  await open('documents');await page.getByText('Link an existing approved file',{exact:true}).click();await page.getByRole('button',{name:'Find files'}).click();await expect(page.getByText('Approved synthetic drawing.pdf',{exact:true})).toBeVisible();
  await page.getByLabel('Purpose of document link').fill('Approved drawing for this quotation');await page.getByRole('button',{name:'Link this revision'}).click();
  await expect(page.getByRole('button',{name:'Verify file access'})).toBeVisible();await page.getByRole('button',{name:'Verify file access'}).click();await expect(page.getByRole('link',{name:/Open verified file/})).toBeVisible();
  assert.equal((await f.db.query('select count(*)::int n from record_document_links')).rows[0].n,1);await noOverflow();
});
test('55: supplier comparison shows unknown freight and records a reasoned eligible recommendation',async()=>{
  await page.setViewportSize({width:1280,height:950});await open('supplier');await expect(page.getByText('Freight cost is unknown or excluded without a cost',{exact:true})).toBeVisible();
  await page.getByLabel('Recommendation rationale').fill('Known freight, matching certificate and acceptable delivery terms');await page.getByRole('button',{name:'Recommend supplier',exact:true}).click();
  await expect(page.getByText('Known freight, matching certificate and acceptable delivery terms',{exact:false})).toBeVisible();assert.equal((await f.db.query('select count(*)::int n from supplier_comparison_recommendations')).rows[0].n,1);
  await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_4/supplier-comparison-desktop.png',fullPage:true});await page.setViewportSize({width:375,height:900});await noOverflow();
});
test('55: dedicated phone request entry creates the exact immutable purchase basis',async()=>{
  await open('supplier-new');await page.getByLabel('Purchase requirement',{exact:true}).fill('Packing material purchase');await page.getByLabel('Exact specification').fill('Approved protective wrap for aluminium profiles');await page.getByLabel('Required quantity',{exact:true}).fill('120');await page.getByLabel('Base unit',{exact:true}).selectOption('piece');
  await page.getByRole('button',{name:'Create purchase comparison',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.navigations.length)).toBe(1);
  assert.equal(Number((await f.db.query("select quantity from supplier_comparison_requests where title='Packing material purchase'")).rows[0].quantity),120);
});
test('55: dedicated offer form records source, normalized quantity, freight and payment conditions',async()=>{
  await open('offer-new');await page.getByRole('button',{name:'Find suppliers'}).click();await page.getByLabel('Supplier',{exact:true}).selectOption(cid(601));
  await page.getByLabel('Supplier quotation / source document reference').fill('SUP-PHONE-2026-02');await page.getByLabel('Offered quantity',{exact:true}).fill('1');await page.getByLabel('Offered unit',{exact:true}).selectOption('tonne');await page.getByLabel('Rate INR per offered unit').fill('249000');await page.getByLabel('Freight basis').selectOption('included');await page.getByLabel('Delivery date',{exact:true}).fill('2098-12-01');await page.getByLabel('Valid until',{exact:true}).fill('2098-12-15');await page.getByLabel('Payment terms',{exact:true}).fill('Payment after certificate acceptance');await page.getByRole('checkbox',{name:/I checked the supplier source/}).check();
  await noOverflow();await page.screenshot({path:'docs/evidence/EOS_UPGRADE_BATCH_4/supplier-offer-phone.png',fullPage:true});await page.getByRole('button',{name:'Record supplier offer',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.navigations.length)).toBe(1);
  assert.equal((await f.db.query("select payload->>'unit' unit from supplier_comparison_offers where source_reference='SUP-PHONE-2026-02'")).rows[0].unit,'tonne');
});
