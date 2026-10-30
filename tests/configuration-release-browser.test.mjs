import test from 'node:test';
import assert from 'node:assert/strict';
import {createBatch6Browser} from '../scripts/lib/eos-batch6-browser-fixture.mjs';
const id=n=>`bc000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const state={kind:'release_state',configuration_id:id(1),status:'pending_approval',current_rules_revision:3,current_output_revision:10,
  latest:{id:id(2),revision:1,author_id:id(3),created_at:'2026-10-29',input_fingerprint:'a'.repeat(64),rules_fingerprint:'b'.repeat(64),
    output_fingerprint:'c'.repeat(64),rules_revision:3,output_revision:10,readiness:'ready',release_status:'pending_approval',unresolved_reasons:[],
    estimated_fields:[],approved_by:null,approved_at:null,approval_note:null,handoff_order_id:null,handed_off_at:null},unresolved_reasons:[]};

test('100: the mounted release view prevents self approval and shows unresolved fabrication requirements',async()=>{
  const f=await createBatch6Browser({component:'ConfigurationRelease',props:{initialState:{...state,status:'blocked',latest:{...state.latest,
    readiness:'blocked',unresolved_reasons:['Glass width rule is missing.']}},configurationId:id(1),userId:id(3),canApprove:true}});
  try{await f.reset();await f.page.getByText('Glass width rule is missing.',{exact:true}).waitFor();
    assert.equal(await f.page.getByRole('button',{name:'Approve this exact snapshot'}).count(),0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

test('100: uncertain independent approval freezes its exact snapshot, note and retry identity on phone and desktop',async()=>{
  const f=await createBatch6Browser({component:'ConfigurationRelease',props:{initialState:state,configurationId:id(1),userId:id(4),canApprove:true},
    results:{configurationReleaseAction:{'release.approve':{throw:true}}}});
  try{for(const width of [375,1280]){await f.page.setViewportSize({width,height:900});await f.reset();
    await f.page.getByLabel('Independent review note (optional)').fill('Reviewed cuts, glass and hardware against the opening.');
    await f.page.getByRole('button',{name:'Approve this exact snapshot',exact:true}).click();
    await f.page.getByRole('button',{name:'Retry identical approval',exact:true}).click();
    assert.equal(await f.page.getByLabel('Independent review note (optional)').isDisabled(),true);
    const calls=await f.page.evaluate(()=>window.__batch6.calls);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
    assert.equal(calls[0].input.payload.output_fingerprint,state.latest.output_fingerprint);assert.deepEqual(f.errors,[]);
  }}finally{await f.close();}
});
