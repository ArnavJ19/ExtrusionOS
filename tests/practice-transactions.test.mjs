import test from 'node:test';
import assert from 'node:assert/strict';
import {newPracticeLedger,reviewPracticeTransaction,confirmPracticeTransaction} from '../lib/training/practice-transactions.ts';
const quote={pieces:10,length_m:6,rate_inr_per_kg:250,gst_percent:18};
test('60: sample quote review derives quantities and GST while preserving the original ledger',()=>{
  const state=newPracticeLedger('desk');const before=structuredClone(state);
  const review=reviewPracticeTransaction(state,'quotation',quote,'quote-1');assert.deepEqual(review.totals,{kg:48,subtotal:12000,gst:2160,total:14160});
  const saved=confirmPracticeTransaction(state,review);assert.equal(saved.state.events.length,1);assert.equal(saved.state.events[0].number,'SAMPLE-001');
  assert.deepEqual(state,before);assert.deepEqual(saved.state.remaining,state.remaining);
});
test('60: a reviewed partial sample dispatch depletes only its original remaining units and replays once',()=>{
  const state=newPracticeLedger('desk');const review=reviewPracticeTransaction(state,'dispatch',{pieces:20,metres:120,actual_kg:96},'dispatch-1');
  const saved=confirmPracticeTransaction(state,review);assert.deepEqual(saved.state.remaining,{pieces:60,metres:360,kg:288});
  const replay=confirmPracticeTransaction(saved.state,review);assert.equal(replay.replayed,true);assert.equal(replay.state.events.length,1);assert.deepEqual(replay.state.remaining,saved.state.remaining);
  assert.throws(()=>confirmPracticeTransaction(saved.state,{...review,values:{...review.values,actual_kg:90}}),/different reviewed facts/);
  assert.throws(()=>reviewPracticeTransaction(saved.state,'dispatch',{pieces:61,metres:366,actual_kg:280},'too-many'),/remaining/);
});
test('60: observation splits reconcile actual pieces and weights without accepting held material as accepted',()=>{
  const state=newPracticeLedger('desk'),values={accepted_pieces:92,rejected_pieces:5,held_pieces:3,accepted_kg:441.6,rejected_kg:24,held_kg:14.4};
  const proposal=reviewPracticeTransaction(state,'inspection',values,'inspection-1');assert.equal(proposal.totals.blocked_pieces,8);assert.equal(proposal.totals.accepted_kg,441.6);
  assert.throws(()=>reviewPracticeTransaction(state,'inspection',{...values,held_kg:10},'short'),/Reconcile/);
  assert.throws(()=>reviewPracticeTransaction(state,'inspection',{...values,accepted_pieces:91.5,held_pieces:3.5},'fraction'),/Reconcile/);
});
test('60: stale or reset reviews and edited totals cannot create sample entries',()=>{
  const state=newPracticeLedger('desk'),proposal=reviewPracticeTransaction(state,'quotation',quote,'q1');
  const saved=confirmPracticeTransaction(state,proposal);
  const other=reviewPracticeTransaction(state,'quotation',quote,'q2');
  assert.throws(()=>confirmPracticeTransaction(saved.state,other),/changed the source/);
  assert.throws(()=>confirmPracticeTransaction(newPracticeLedger('reset'),proposal),/earlier reset/);
  assert.throws(()=>confirmPracticeTransaction(state,{...proposal,totals:{...proposal.totals,total:1}}),/totals changed/);
  for(const value of [NaN,Infinity,-1,0,1.5])assert.throws(()=>reviewPracticeTransaction(state,'quotation',{...quote,pieces:value},'bad'));
});
