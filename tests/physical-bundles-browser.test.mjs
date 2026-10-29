import test from 'node:test';import assert from 'node:assert/strict';
import {createDispatchFormBrowserFixture,dispatchFormIds as ids,dispatchSource,dispatchFixtureId} from '../scripts/lib/dispatch-form-browser-fixture.mjs';
let f,p;test.before(async()=>{f=await createDispatchFormBrowserFixture();p=f.page;});test.after(async()=>f?.close());test.beforeEach(async()=>f.reset());
const prepared={id:dispatchFixtureId(9001),bundle_number:'MEASURED-TAG',source_line_id:ids.sourceA,number_of_pieces:1,net_length_m:2.5,gross_weight_kg:6,tare_weight_kg:1,net_weight_kg:5};
test('94: selecting an observed bundle derives quantities once and rejects a duplicate load entry',async()=>{
  await p.evaluate(row=>{window.__dispatch.preparedBundles=[row];},prepared);await f.ready('A');
  await p.getByRole('button',{name:'Add measured bundle',exact:true}).click();assert.ok(await f.save().isEnabled());
  assert.equal(await p.getByText('Gross kg *',{exact:true}).locator('..').locator('input').inputValue(),'6');
  await p.getByRole('button',{name:'Add measured bundle',exact:true}).click();await p.getByText('That physical bundle is already on this load.',{exact:true}).waitFor();
  assert.equal(await p.getByText('Scan / Bundle ID *',{exact:true}).count(),1);assert.equal(await p.evaluate(()=>window.__dispatch.saveRequests.length),0);
});
test('94: measured bundle selection cannot bypass changed authoritative availability',async()=>{
  await p.evaluate(row=>{window.__dispatch.preparedBundles=[row];},prepared);await f.chooseOrder('A');
  await f.resolveSource(0,{success:true,sources:[{...dispatchSource('A'),availableWeightKg:1}]});
  await p.getByRole('button',{name:'Add measured bundle',exact:true}).click();assert.ok(await f.save().isDisabled());assert.equal(await p.evaluate(()=>window.__dispatch.saveRequests.length),0);
});
