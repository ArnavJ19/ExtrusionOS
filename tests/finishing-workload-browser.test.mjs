import assert from 'node:assert/strict';
import test from 'node:test';
import {expect} from '@playwright/test';
import {createFinishingWorkloadFixture} from '../scripts/lib/finishing-workload-fixture.mjs';
import {createFinishingWorkloadBrowserFixture} from '../scripts/lib/finishing-workload-browser-fixture.mjs';

test('finishing workload supports actual retry and completion actions without stale totals',async context=>{
  const sql=await createFinishingWorkloadFixture();let ui;
  try{
    await sql.reset();const original=await sql.partial();ui=await createFinishingWorkloadBrowserFixture(sql);const {page}=ui;
    const metric=label=>page.getByText(label,{exact:true}).locator('..').locator('p').nth(1);
    await context.test('planning one retry moves the original rejection to pending input through the actual server action',async()=>{
      await ui.open();await expect(metric('Remaining rejected')).toHaveText('55.000 kg');await page.getByRole('button',{name:'Plan One Retry',exact:true}).click();
      await expect(metric('Remaining rejected')).toHaveText('0.000 kg');await expect(metric('Pending processing')).toHaveText('55.000 kg');assert.equal((await sql.snapshot()).jobs.length,2);
      assert.equal(ui.writer.state.calls.filter(call=>call.name==='retry_rejected_finishing_job_atomic').length,1);
      await ui.open(`/production/finishing/${original}`);await page.getByText('A retry already exists with status Planned. The rejected source remains locked as evidence.',{exact:true}).waitFor();await ui.open();
    });
    await context.test('corrective processing and completion release fifty accepted kilograms without double-counting the original',async()=>{
      await page.getByRole('button',{name:'Start Processing',exact:true}).click();await page.getByRole('button',{name:'Complete Finishing',exact:true}).waitFor();await page.waitForFunction(()=>window.__finishingReady);
      await page.getByText('Accepted output kg',{exact:true}).locator('..').locator('input').fill('50');await page.getByText('Rejected kg',{exact:true}).locator('..').locator('input').fill('5');
      await page.getByRole('button',{name:'Complete Finishing',exact:true}).click();await expect(metric('Accepted receipts')).toHaveText('90.000 kg',{timeout:15000}).catch(async error=>{throw new Error(`${error.message}\nActual action calls: ${JSON.stringify(ui.writer.state.calls)}\n${await page.locator('body').innerText()}`);});await expect(metric('Remaining rejected')).toHaveText('5.000 kg');await expect(metric('Active movements')).toHaveText('0');
      assert.equal(await page.getByRole('button',{name:'Plan One Retry',exact:true}).count(),0);const state=await sql.snapshot();assert.equal(state.packaging.length,2);assert.equal(Number(state.jobs.find(row=>row.id===original).output_weight_kg),40);
      await sql.db.exec('commit;begin;');assert.equal(Number((await sql.workload()).summary.accepted_output_kg),90);assert.ok(ui.writer.state.paths.some(args=>args[0]==='/production/finishing/database'));
    });
    await context.test('database navigation reaches retained receipt and exact original/retry links',async()=>{
      await page.getByRole('link',{name:'View Finishing Database',exact:true}).click();await page.getByRole('heading',{name:'Finishing Database',exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),2);
      const state=await sql.snapshot(),retry=state.jobs.find(row=>row.retry_of_finishing_job_id);await page.locator(`a[href='/production/finishing/${retry.id}']`).click();
      await page.getByText('This terminal receipt is retained as evidence. Accepted finishing output still requires separate QC and packaging release.',{exact:true}).waitFor();
      await page.getByRole('link',{name:'Open rejected source',exact:true}).click();await page.getByRole('link',{name:'Open corrective retry',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Plan One Retry',exact:true}).count(),0);
    });
    await context.test('unavailable workload exposes no numeric totals or movement controls',async()=>{
      ui.control.unavailable=true;await ui.open();await page.getByText('Finishing workload is unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('Remaining rejected',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Plan One Retry',exact:true}).count(),0);ui.control.unavailable=false;
    });
    assert.deepEqual(ui.errors,[]);
  }finally{if(ui)await ui.close();await sql.close();}
});
