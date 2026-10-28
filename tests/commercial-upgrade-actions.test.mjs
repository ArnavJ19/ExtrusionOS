import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const id='bc000000-0000-4000-8000-000000000001',hash='a'.repeat(32);
const state={role:'owner',dealerId:null,authenticated:true,calls:[],storageCalls:[],rpcData:{id},rpcError:null,cacheError:false};
const client={rpc:async(name,args)=>{state.calls.push({name,args});return {data:state.rpcData,error:state.rpcError};},storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{state.storageCalls.push({bucket,path,ttl});return {data:{signedUrl:'https://example.supabase.co/storage/v1/signed/file'},error:null};}})}};
const require=createRequire(import.meta.url);require('tsx/cjs');const Module=require('node:module'),original=Module._load;
Module._load=function(request,parent,isMain){if(request==='@/lib/auth')return {getSessionContext:async()=>{if(!state.authenticated)throw Error('No session');return {role:state.role,dealerId:state.dealerId,companyId:id,userId:id};}};if(request==='@/lib/supabase/server')return {createClient:async()=>client};if(request==='next/cache')return {revalidatePath:()=>{if(state.cacheError)throw Error('Cache failure');}};return original.call(this,request,parent,isMain);};
let commercial,party,technical,material,progress,documents,suppliers;
try{commercial=require('../lib/actions/commercial-review.ts').commercialReviewAction;party=require('../lib/actions/quote-party.ts').quotePartyAction;technical=require('../lib/actions/profile-technical-options.ts').profileTechnicalAction;({materialSuggestionsAction:material,orderTransactionProgressAction:progress}=require('../lib/actions/transaction-evidence.ts'));documents=require('../lib/actions/linked-documents.ts').linkedDocumentAction;suppliers=require('../lib/actions/supplier-comparisons.ts').supplierComparisonAction;}finally{Module._load=original;}
test.beforeEach(()=>Object.assign(state,{role:'owner',dealerId:null,authenticated:true,calls:[],storageCalls:[],rpcData:{id},rpcError:null,cacheError:false}));
const requests=()=>[[commercial,{command:'quote.review',quote_id:id}],[party,{command:'party.load',quote_id:id}],[technical,{command:'options.list',profile_id:id}],[material,{profile_id:id,finish:'mill_finish',cut_length_m:6}],[progress,id],[documents,{command:'document.list',entity_type:'quote',entity_id:id}],[suppliers,{command:'requests.list'}]];
test('all new actions refuse missing sessions and dealership-less dealer roles before any RPC',async()=>{
  state.authenticated=false;for(const [action,payload]of requests())assert.equal((await action(payload)).success,false);
  state.authenticated=true;for(const role of ['dealer_admin','dealer_staff']){state.role=role;for(const [action,payload]of requests())assert.equal((await action(payload)).success,false);}
  assert.equal(state.calls.length,0);assert.equal(state.storageCalls.length,0);
});
test('all new object commands reject injected company identity before any query',async()=>{
  for(const [action,payload]of requests().filter(([,value])=>typeof value==='object'))assert.equal((await action({...payload,company_id:id})).success,false);
  assert.equal(state.calls.length,0);
});
test('role boundaries refuse restricted repricing, linking, reviews and supplier rates',async()=>{
  state.role='accounts';assert.equal((await commercial({command:'quote.convert',quote_id:id,request_id:id,fingerprint:hash})).success,false);
  state.role='sales';assert.equal((await party({command:'party.save',quote_id:id,project_id:null,overrides:{},source_fingerprint:hash,quote_fingerprint:hash})).success,false);
  assert.equal((await technical({command:'option.approve',profile_id:id,id})).success,false);
  assert.equal((await documents({command:'document.link',entity_type:'quote',entity_id:id,document_id:id,id,purpose:'Drawing evidence'})).success,false);
  state.role='production';assert.equal((await suppliers({command:'requests.list'})).success,false);assert.equal(state.calls.length,0);
});
test('confirmed conversion remains successful across cache errors and forwards exact review identity',async()=>{
  state.rpcData={order_id:id,revision_number:3,replayed:false};state.cacheError=true;
  const result=await commercial({command:'quote.convert',quote_id:id,request_id:id,fingerprint:hash});assert.equal(result.success,true);
  assert.deepEqual(state.calls[0],{name:'commercial_review_command',args:{p_command:'quote.convert',p_payload:{quote_id:id,request_id:id,fingerprint:hash}}});
});
test('file signing follows database permission and path checks, with a bounded lifetime',async()=>{
  const payload={command:'document.open',entity_type:'quote',entity_id:id,document_id:id};
  state.rpcData={bucket:'documents',path:`${id}/profile/drawing.pdf`,file_name:'Drawing.pdf'};
  assert.equal((await documents(payload)).kind,'url');assert.deepEqual(state.storageCalls,[{bucket:'documents',path:`${id}/profile/drawing.pdf`,ttl:60}]);
  state.storageCalls=[];state.rpcData={...state.rpcData,path:'foreign-company/drawing.pdf'};assert.equal((await documents(payload)).success,false);assert.equal(state.storageCalls.length,0);
});
test('raw database failures never become successful empty results or expose diagnostic secrets',async()=>{
  state.rpcError={code:'XX000',message:'secret internal row customer 0001'};
  for(const [action,payload]of requests()){const result=await action(payload);assert.equal(result.success,false);assert.doesNotMatch(result.error,/secret|customer 0001/);}
});
