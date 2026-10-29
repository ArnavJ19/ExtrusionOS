import test from 'node:test';import assert from 'node:assert/strict';import {createFactoryBrowserFixture} from '../scripts/lib/factory-upgrade-browser-fixture.mjs';
const id=n=>`bc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let f,p;test.before(async()=>{f=await createFactoryBrowserFixture({component:'Workstation',props:{companyId:id(1),userId:id(2),operatorName:'Press operator'},results:{workstationAction:{success:true,data:{kind:'stations',page:1,items:[{id:id(3),name:'Press A',machine_type:'extrusion_press'}]}},switchWorkstationOperatorAction:{success:true}}});p=f.page;});test.after(async()=>f?.close());test.beforeEach(async()=>f.reset());
async function open(expires=Date.now()+600000){await p.getByLabel('Station press',{exact:true}).selectOption(id(3));
  await p.evaluate(({values,expires})=>{const [operator,machine,lease,job,order,profile]=values;window.__factory.responses.workstationAction=[{success:true,data:{kind:'session',id:lease,machine_id:machine,name:'Press A',operator_id:operator,expires_at:new Date(expires).toISOString()}},{success:true,data:{kind:'queue',items:[{id:job,job_number:'PRESS-JOB',status:'planned',order_id:order,profile_id:profile,planned_quantity_kg:100}],expires_at:new Date(expires).toISOString()}}];},{values:[id(2),id(3),id(4),id(5),id(6),id(7)],expires});
  await p.getByRole('button',{name:'Identify operator and open station',exact:true}).click();await p.getByText('PRESS-JOB',{exact:true}).waitFor();}
test('53: account switch removes queued work and this operator draft while retaining only press context',async()=>{
  await open();await p.evaluate(({company,user})=>localStorage.setItem(`eos:dispatch-draft:v1:${company}:${user}`,'previous draft'),{company:id(1),user:id(2)});
  await p.getByRole('button',{name:'Lock and switch operator',exact:true}).click();await p.waitForFunction(()=>window.__factory.navigation.length===1);
  assert.equal(await p.getByText('PRESS-JOB',{exact:true}).count(),0);assert.match((await p.evaluate(()=>window.__factory.navigation))[0],/login/);
  assert.equal(await p.evaluate(({company,user})=>localStorage.getItem(`eos:dispatch-draft:v1:${company}:${user}`),{company:id(1),user:id(2)}),null);
  assert.equal(await p.evaluate(company=>localStorage.getItem(`eos:workstation:${company}`),id(1)),id(3));
});
test('53: expiry hides work and prevents continuing with the old station identity',async()=>{
  await open(Date.now()+500);await p.getByText('Station locked. Sign in again before viewing or opening work.',{exact:true}).waitFor();assert.equal(await p.getByText('PRESS-JOB',{exact:true}).count(),0);
});
