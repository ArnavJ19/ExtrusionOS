import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createFinishingWorkloadFixture} from './lib/finishing-workload-fixture.mjs';
import {createFinishingWorkloadBrowserFixture} from './lib/finishing-workload-browser-fixture.mjs';

const output=resolve(process.argv[2]??'test-results/finishing-workload');mkdirSync(output,{recursive:true});
const sql=await createFinishingWorkloadFixture();let ui;const checks=[];let screenshots=0;
try{
  await sql.reset();await sql.partial();const retry=await sql.retryComplete();ui=await createFinishingWorkloadBrowserFixture(sql,{styled:true});const {page}=ui;
  async function capture(name){await page.evaluate(()=>document.fonts.ready);assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: viewport overflow`);assert.deepEqual(ui.errors,[]);await page.screenshot({path:resolve(output,`${name}.png`),fullPage:true});screenshots++;}
  for(const [label,width,height]of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844],['compact-mobile',320,720]]){
    await page.setViewportSize({width,height});await ui.open();assert.equal(await page.getByRole('button',{name:'Plan One Retry',exact:true}).count(),0);await page.getByText(/A retry already exists with status Completed/).waitFor();await capture(`${label}-completed-retry-board`);
    await page.getByRole('link',{name:'View Finishing Database',exact:true}).click();await page.getByRole('heading',{name:'Finishing Database',exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),2);await capture(`${label}-finishing-database`);
    const cell=page.locator('tbody tr').filter({has:page.locator(`a[href='/production/finishing/${retry}']`)}).locator('td').nth(7);await cell.scrollIntoViewIfNeeded();const box=await cell.boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    await page.getByRole('link',{name:'Open rejected source',exact:true}).waitFor();await capture(`${label}-corrective-receipt`);
    checks.push(`${label}: remaining rejected 5 kg and accepted receipts 90 kg, completed retry prevents a duplicate offer, historical database fields remain readable in contained scrolling, full row click opens exact corrective receipt and source link`);
  }
  await page.setViewportSize({width:390,height:844});ui.control.unavailable=true;await ui.open();await page.getByText('Finishing workload is unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('Remaining rejected',{exact:true}).count(),0);await capture('mobile-unavailable-workload');ui.control.unavailable=false;
  await sql.reset();await sql.seedQueue(400);await page.setViewportSize({width:1440,height:1000});await ui.open();await page.getByText('Planned: 10 shown of 401',{exact:true}).waitFor();await capture('desktop-complete-401-record-workload');
  await page.getByRole('link',{name:'View Finishing Database',exact:true}).click();await page.getByRole('heading',{name:'401 matching receipts',exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),10);
  await page.getByRole('link',{name:'Next',exact:true}).click();await page.getByText('Page 2 of 41',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),10);await capture('desktop-database-second-page');
  await page.getByText('Search',{exact:true}).locator('input').fill('QUEUE-0400');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByRole('heading',{name:'1 matching receipts',exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),1);await capture('desktop-literal-server-search');
  const report={checks,screenshots,pageErrors:ui.errors,proof:'Actual server pages with hydrated actual workflow board, built CSS/fonts, actual read-projection SQL and native GET pagination/search; actual action-to-SQL movement journey is separately regression-tested',
    boundary:'Loopback fixture and synthetic identity. No Supabase migration, hosted request/JWT/RLS/Storage, physical gain/loss or inventory attestation, independent sessions or full signed-in operator acceptance'};
  writeFileSync(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){if(ui){await ui.page.screenshot({path:resolve(output,'qa-failure.png'),fullPage:true});writeFileSync(resolve(output,'qa-failure.json'),JSON.stringify({error:error.message,body:await ui.page.locator('body').innerText(),pageErrors:ui.errors},null,2)+'\n');}throw error;
}finally{if(ui)await ui.close();await sql.close();}
