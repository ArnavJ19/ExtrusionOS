import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchFormBrowserFixture, dispatchSource, dispatchFormIds as ids } from '../scripts/lib/dispatch-form-browser-fixture.mjs';
let f,p; test.before(async()=>{ f=await createDispatchFormBrowserFixture();p=f.page; }); test.after(async()=>f?.close());
test.beforeEach(async()=>f.reset());
const saved=()=>p.getByText(/^Saved on this device\. Draft/).waitFor();
test('16: reload restores measurements and reloads current sources before review is enabled',async()=>{
  await f.ready('A');await f.fillBundle('A');await saved();await p.reload();
  await p.getByRole('button',{name:'Restore saved draft',exact:true}).click();
  await p.waitForFunction(()=>window.__dispatch.sourceRequests.length===1);
  assert.ok(await f.save().isDisabled());
  assert.equal(await p.getByText('Gross kg *',{exact:true}).locator('..').locator('input').inputValue(),'6');
  await f.resolveSource(0,{success:true,sources:[{...dispatchSource('A'),availableWeightKg:1}]});
  assert.ok(await f.save().isDisabled());assert.deepEqual(await p.evaluate(()=>window.__dispatch.saveRequests),[]);
});
test('16: another tab revision cannot be overwritten by a delayed autosave',async()=>{
  await f.ready('A');await f.fillBundle('A');await saved();
  await p.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('eos:dispatch-draft'));const draft=JSON.parse(localStorage.getItem(key));draft.revision=crypto.randomUUID();draft.payload.remarks='Other tab';localStorage.setItem(key,JSON.stringify(draft));});
  await p.getByText('Gross kg *',{exact:true}).locator('..').locator('input').fill('7');
  await p.getByText('Another tab changed this draft.',{exact:false}).waitFor();
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('eos:dispatch-draft')))).payload.remarks),'Other tab');
  assert.equal(await p.getByText('Gross kg *',{exact:true}).locator('..').locator('input').inputValue(),'7');
});
test('16: company switch cannot recover the previous company draft',async()=>{
  await f.ready('A');await f.fillBundle('A');await saved();await p.evaluate(id=>window.__dispatch.setCompanyId(id),ids.otherCompany);await f.flush();
  assert.equal(await p.getByRole('button',{name:'Restore saved draft',exact:true}).count(),0);assert.equal(await f.order().inputValue(),'');
});
