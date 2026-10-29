import test from 'node:test';import assert from 'node:assert/strict';
import {downstreamContextSchema,downstreamContextRequest} from '../lib/workflow/downstream-context.ts';
const id='bc000000-0000-4000-8000-000000000001';
test('7: downstream requests reject forged ownership and source overrides',()=>{
  assert.equal(downstreamContextRequest.safeParse({order_id:id}).success,true);
  for(const extra of [{company_id:id},{customer_id:id},{delivery_address:'forged'},{order_id:'bad'}])assert.equal(downstreamContextRequest.safeParse({order_id:id,...extra}).success,false);
});
test('7: safe delivery projection rejects commercial and internal fields',()=>{
  const row={order_id:id,order_number:'ORDER-1',basis:'Accepted order party snapshot',immutable:false,party:{customer_name:'Customer',delivery_address:null,contact_name:null,contact_phone:null,site_name:null,instructions:null}};
  assert.equal(downstreamContextSchema.safeParse(row).success,true);
  for(const key of ['margin','cost','internal_notes','payment_terms'])assert.equal(downstreamContextSchema.safeParse({...row,party:{...row.party,[key]:10}}).success,false);
});
