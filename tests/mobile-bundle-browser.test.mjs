import test from 'node:test';import assert from 'node:assert/strict';
import {createDispatchFormBrowserFixture,dispatchSource,dispatchFormIds as ids} from '../scripts/lib/dispatch-form-browser-fixture.mjs';
let f,p;test.before(async()=>{f=await createDispatchFormBrowserFixture({mode:'capture'});p=f.page;});test.after(async()=>f?.close());test.beforeEach(async()=>f.reset());
async function fill(){await p.waitForFunction(()=>window.__dispatch.sourceRequests.length===1);await f.resolveSource(0,{success:true,sources:[dispatchSource('A')]});await p.getByLabel('Material source',{exact:true}).selectOption(ids.sourceA);await p.getByRole('button',{name:'Generate bundle tag'}).click();for(const [name,value] of [['Actual pieces','1'],['Actual metres','2.5'],['Gross kg','6'],['Tare kg','1']])await p.getByLabel(name,{exact:true}).fill(value);}
for(const width of [375,1280])test(`17: ${width}px operator completes the real capture component through its server boundary`,async()=>{
  await p.setViewportSize({width,height:900});await fill();assert.equal(await p.getByLabel('Gross kg',{exact:true}).getAttribute('inputmode'),'decimal');
  await p.getByRole('button',{name:'Record measured bundle',exact:true}).click();await p.getByText('Bundle observations recorded. No stock has been consumed.',{exact:true}).waitFor();
  const requests=await p.evaluate(()=>window.__dispatch.recordedBundleRequests);assert.equal(requests.length,1);assert.equal(requests[0].gross_weight_kg-requests[0].tare_weight_kg,5);assert.equal(await p.getByRole('button',{name:'Record measured bundle',exact:true}).isDisabled(),true);
});
test('17: a refused confirmation retains observations and the same request identity for retry',async()=>{
  await fill();await p.evaluate(()=>{window.__dispatch.recordBundleFailure=true;});await p.getByRole('button',{name:'Record measured bundle',exact:true}).click();await p.getByText('Source changed; recheck available material.',{exact:true}).waitFor();
  assert.equal(await p.getByLabel('Gross kg',{exact:true}).inputValue(),'6');await p.evaluate(()=>{window.__dispatch.recordBundleFailure=false;});await p.getByRole('button',{name:'Record measured bundle',exact:true}).click();
  await p.getByText('Bundle observations recorded. No stock has been consumed.',{exact:true}).waitFor();const requests=await p.evaluate(()=>window.__dispatch.recordedBundleRequests);assert.equal(requests[0].id,requests[1].id);
});
