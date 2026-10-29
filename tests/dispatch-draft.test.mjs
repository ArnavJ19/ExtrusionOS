import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchDraftKey, dispatchDraftSchema, readDispatchDraft, nextDispatchDraft, draftRevisionMatches, DRAFT_LIFETIME_MS } from '../lib/forms/dispatch-draft.ts';
const id=n=>`d5000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={companyId:id(1),userId:id(2)};
const payload={orderId:id(3),dispatchDate:'2026-10-29',transporterName:'Transport',vehicleNumber:'RJ01',driverName:'Driver',driverPhone:'',ewayBillNumber:'',lrNumber:'',remarks:'Unsaved observation',bundles:[{key:id(4),bundle_number:'B-1',source_line_id:id(5),number_of_pieces:'2',net_length_m:'12',gross_weight_kg:'10',tare_weight_kg:'1'}]};
const envelope=()=>nextDispatchDraft(scope,payload,null,id(10),id(11),1000);
test('16: recovered entries retain identity, observations and original sources without a posting flag',()=>{
  const value=envelope(); assert.deepEqual(readDispatchDraft(JSON.stringify(value),scope,1100)?.payload,payload);
  const next=nextDispatchDraft(scope,{...payload,remarks:'Changed'},value,id(12),id(13),1200);
  assert.equal(next.id,value.id); assert.equal(next.revision,id(13)); assert.equal('confirmed' in next,false);
});
test('16: user and company isolation applies to both keys and embedded ownership',()=>{
  for(const foreign of [{...scope,userId:id(9)},{...scope,companyId:id(9)}]){
    assert.notEqual(dispatchDraftKey(scope),dispatchDraftKey(foreign)); assert.equal(readDispatchDraft(JSON.stringify(envelope()),foreign,1100),null);
  }
});
test('16: expiry, future timestamps, corrupt versions and excessive payloads fail closed',()=>{
  const value=envelope(); assert.equal(readDispatchDraft(JSON.stringify(value),scope,1000+DRAFT_LIFETIME_MS),null);
  for(const patch of [{version:2},{savedAt:1_000_000},{userId:'invalid'},{payload:{...payload,confirmed:true}}])assert.equal(readDispatchDraft(JSON.stringify({...value,...patch}),scope,1100),null);
  for(const raw of ['{','x'.repeat(500001),null])assert.equal(readDispatchDraft(raw,scope,1100),null);
});
test('16: compare-and-save refuses another tab revision and deleted drafts',()=>{
  const raw=JSON.stringify(envelope()); assert.equal(draftRevisionMatches(raw,id(11)),true);
  for(const expected of [id(12),null])assert.equal(draftRevisionMatches(raw,expected),false);
  assert.equal(draftRevisionMatches(null,id(11)),false); assert.equal(draftRevisionMatches(null,null),true);
});
test('16: bounded drafts reject ownership injection and retain unfinished measurement text',()=>{
  assert.equal(dispatchDraftSchema.safeParse({...payload,company_id:id(9)}).success,false);
  assert.equal(dispatchDraftSchema.safeParse({...payload,bundles:Array(201).fill(payload.bundles[0])}).success,false);
  assert.equal(dispatchDraftSchema.safeParse({...payload,bundles:[{...payload.bundles[0],gross_weight_kg:'unfinished'}]}).success,true);
});
