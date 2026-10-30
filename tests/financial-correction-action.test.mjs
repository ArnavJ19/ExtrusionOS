import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {correctionApplyInputSchema} from '../lib/workflow/financial-workflow-review.ts';
const id=n=>`bc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={record_type:'invoice',record_id:id(1),fingerprint:'a'.repeat(64),amount:10,reason:'Approved receivable correction',idempotency_key:id(2)};
function fixture({existing=null,allowed=true,fingerprint='a'.repeat(64)}={}){
  const source=readFileSync(new URL('../lib/actions/financial-workflow-review.ts',import.meta.url),'utf8');
  const code=ts.transpileModule(source.slice(source.indexOf('export async function applyFinancialCorrectionAction(')),
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('export async function','async function');
  const calls=[];
  const client={from(table){const query={select(){return query;},eq(){return query;},async maybeSingle(){return {data:table==='invoices'
    ?{id:id(1),invoice_date:'2026-10-01',status:'generated',grand_total:100,amount_paid:0,credited_amount:0,balance_due:100}:existing,error:null};}};return query;},
    async rpc(name,args){calls.push({name,args});return {data:{payment_id:id(3)},error:null};}};
  const fn=new Function('correctionApplyInputSchema','getSessionContext','can','createClient','fingerprint','revalidatePath','getErrorMessage',
    `${code};return applyFinancialCorrectionAction;`)(correctionApplyInputSchema,async()=>({companyId:id(10),role:'accounts'}),()=>allowed,
    async()=>client,()=>fingerprint,()=>{},e=>e.message);
  return {fn,calls};
}
test('27: uncertain credit adjustment retries its actual original posting date and reason',async()=>{
  const f=fixture({existing:{id:id(3),invoice_id:id(1),amount:10,payment_method:'credit_note',payment_status:'PAID',
    payment_date:'2026-10-30',notes:input.reason,idempotency_key:input.idempotency_key}});
  const r=await f.fn(input);assert.equal(r.success,true);assert.equal(r.idempotent_replay,true);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.p_payment.payment_date,'2026-10-30');
  assert.equal(f.calls[0].args.p_payment.notes,input.reason);assert.equal(f.calls[0].args.p_payment.idempotency_key,input.idempotency_key);
});
test('27: a changed retry reason, stale preview or unauthorized role cannot post a correction',async()=>{
  for(const options of [{existing:{invoice_id:id(1),amount:10,payment_method:'credit_note',payment_date:'2026-10-30',notes:'Different prior reason'}},
    {fingerprint:'b'.repeat(64)},{allowed:false}]){
    const f=fixture(options);assert.equal((await f.fn(input)).success,false);assert.deepEqual(f.calls,[]);
  }
});
