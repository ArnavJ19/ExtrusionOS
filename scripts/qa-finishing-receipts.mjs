import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {createFinishingReceiptsBrowserFixture,receiptId as id} from "./lib/finishing-receipts-browser-fixture.mjs";

const output=resolve(process.argv[2]??'test-results/finishing-receipts');mkdirSync(output,{recursive:true});
const ui=await createFinishingReceiptsBrowserFixture({styled:true}),{page}=ui,checks=[];let screenshots=0;
async function capture(name){await page.evaluate(()=>document.fonts.ready);assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: horizontal overflow`);assert.deepEqual(ui.errors,[]);
  await page.screenshot({path:resolve(output,`${name}.png`),fullPage:true});screenshots++;}
try{
  for(const [label,width,height] of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844],['compact-mobile',320,720]]){
    await page.setViewportSize({width,height});await ui.open();await ui.choose('Completed production job *','PROD-R18');
    await ui.field('Accepted finishing receipt').click();await page.getByRole('button',{name:/Original receipt/}).waitFor();await page.getByRole('button',{name:/Corrective retry/}).waitFor();
    assert.equal(await page.getByRole('button',{name:/20$/}).count(),0);assert.equal(await ui.field('Quantity checked kg *').inputValue(),'40');await capture(`${label}-qc-receipt-choices`);
    await page.getByRole('button',{name:/Corrective retry/}).click();assert.equal(await ui.field('Quantity checked kg *').inputValue(),'50');
    await ui.open(`mode=packaging&edit=${id(71)}`);for(const field of ['Order waiting packaging *','Completed production job *','Accepted finishing receipt'])assert.equal(await ui.field(field).isDisabled(),true);
    assert.match(await ui.field('Accepted finishing receipt').inputValue(),/Original receipt/);assert.equal(await ui.field('Profile weight kg').inputValue(),'40');
    await page.getByRole('button',{name:'Add Material',exact:true}).click();await page.getByPlaceholder('Select material',{exact:true}).click();await page.getByRole('button',{name:/Synthetic packing film/}).click();await capture(`${label}-receipt-linked-packaging`);
    checks.push(`${label}: scoped original 40 kg and retry 50 kg choices, correct quantity after selection, immutable packaging source and usable material entry with no viewport overflow`);
  }
  await page.setViewportSize({width:390,height:844});await ui.open('missingView=1');await page.getByText('Accepted finishing receipts are unavailable in this schema',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Save',exact:true}).count(),0);await capture('mobile-unavailable-receipts');
  const report={checks,screenshots,pageErrors:ui.errors,proof:'Actual QC and packaging React forms with built application CSS and fonts, synthetic tenant-scoped lookup transport; separate regression test sends actual browser payloads through QC SQL and the packaging server action to SQL and commits the result',
    boundary:'No hosted browser login, JWT/RLS/Storage verification, independent-session concurrency, migration application or physical inventory verification'};
  writeFileSync(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:resolve(output,'qa-failure.png'),fullPage:true});writeFileSync(resolve(output,'qa-failure.json'),JSON.stringify({error:error.message,body:await page.locator('body').innerText()},null,2)+'\n');throw error;
}finally{await ui.close();}
