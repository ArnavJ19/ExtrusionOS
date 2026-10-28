import test from 'node:test';import assert from 'node:assert/strict';
import {commercialReviewProblems,commercialReviewCommandSchema} from '../lib/workflow/commercial-review.ts';
import {partyOverridesSchema,quotePartyCommandSchema} from '../lib/workflow/quote-party.ts';
import {soleTechnicalOption,technicalOptionCommandSchema} from '../lib/workflow/profile-technical-options.ts';
import {materialSuggestionInputSchema,evidenceQuantity} from '../lib/workflow/transaction-evidence.ts';
import {safeLinkedDocumentPath,linkedDocumentCommandSchema} from '../lib/workflow/linked-documents.ts';
import {normalizedSupplierUnit,supplierOfferSchema,supplierComparisonCommandSchema} from '../lib/workflow/supplier-comparisons.ts';
import {hasRouteAccess} from '../lib/auth/route-permissions.ts';
const id='bc000000-0000-4000-8000-000000000001';
test('86: missing lines, inconsistent totals and distinct billing basis remain visible',()=>{
  assert.equal(commercialReviewProblems({line_count:0,difference:0,items:[]}).length,1);
  assert.match(commercialReviewProblems({line_count:1,difference:10,items:[]})[0],/differ/);
  const issues=commercialReviewProblems({line_count:1,difference:0,items:[{billing_kg:100,physical_kg:90,costing_complete:false}]});assert.equal(issues.length,2);
});
test('87: conversion accepts an exact version fingerprint and rejects injected financial values',()=>{
  const input={command:'quote.convert',quote_id:id,request_id:id,fingerprint:'a'.repeat(32)};
  assert.equal(commercialReviewCommandSchema.safeParse(input).success,true);
  for(const extra of [{order_value:1},{company_id:id},{fingerprint:'stale'},{request_id:''}])assert.equal(commercialReviewCommandSchema.safeParse({...input,...extra}).success,false);
});
test('81: party overrides have bounded explicit fields and do not accept customer identity changes',()=>{
  assert.equal(partyOverridesSchema.safeParse({delivery_address:'Site gate',payment_terms:'Advance'}).success,true);
  for(const value of [{customer_id:id},{gst_number:'forged'},{delivery_address:'x'.repeat(1001)},{payment_terms:42}])assert.equal(partyOverridesSchema.safeParse(value).success,false);
  assert.equal(quotePartyCommandSchema.safeParse({command:'sites.list',quote_id:id,page:0}).success,false);
});
test('82: only a sole current approved choice may be selected automatically',()=>{
  const option={id,status:'approved',current_source:true};
  assert.equal(soleTechnicalOption({eligible_count:1,items:[option]}).id,id);
  for(const data of [{eligible_count:2,items:[option]},{eligible_count:0,items:[]},{eligible_count:1,items:[{...option,current_source:false}]}])assert.equal(soleTechnicalOption(data),null);
  assert.equal(technicalOptionCommandSchema.safeParse({command:'option.create',profile_id:id,id,alloy_id:id,temper_id:id,approved_by:id}).success,false);
});
test('12: malformed source scope, impossible units and invalid pages cannot query suggestions',()=>{
  const input={profile_id:id,finish:'mill_finish',cut_length_m:6};assert.equal(materialSuggestionInputSchema.safeParse(input).success,true);
  for(const extra of [{cut_length_m:0},{cut_length_m:NaN},{page:0},{company_id:id},{profile_id:'foreign'}])assert.equal(materialSuggestionInputSchema.safeParse({...input,...extra}).success,false);
});
test('34: unavailable evidence stays separate from a recorded zero',()=>{assert.equal(evidenceQuantity(null),'Unavailable evidence');assert.equal(evidenceQuantity(0),'0 kg');assert.equal(evidenceQuantity(600),'600 kg');});
test('36: only tenant-owned storage references and strict link targets are accepted',()=>{
  assert.equal(safeLinkedDocumentPath(id,`${id}/profiles/drawing.pdf`),true);
  for(const path of [`other/${id}/drawing.pdf`,`${id}/../other.pdf`,`${id}/https://outside.example/file`,`${id}\\outside.pdf`,`${id}/bad\nfile`,`${id}/%2e%2e/other.pdf`,`${id}/%252fother.pdf`])assert.equal(safeLinkedDocumentPath(id,path),false);
  assert.equal(linkedDocumentCommandSchema.safeParse({command:'document.open',entity_type:'quote',entity_id:id,document_id:id,storage_path:'forged'}).success,false);
});
test('55: supplier units preserve dimensions and requests cannot inject ownership or fake approval',()=>{
  assert.deepEqual(normalizedSupplierUnit('tonne'),{unit:'kg',factor:1000});assert.deepEqual(normalizedSupplierUnit('dozen'),{unit:'piece',factor:12});assert.equal(normalizedSupplierUnit('litre'),null);
  const payload={command:'request.create',id,title:'Material purchase',specification:'6063 T6 billet',unit:'piece',quantity:1.5,required_by:null};
  assert.equal(supplierComparisonCommandSchema.safeParse(payload).success,false);
  assert.equal(supplierComparisonCommandSchema.safeParse({...payload,quantity:2,company_id:id}).success,false);
  assert.equal(supplierOfferSchema.safeParse({}).success,false);
});
test('55/82: module routes agree with supplier privacy and the independent technical review role',()=>{
  for(const role of ['owner','admin','accounts'])assert.equal(hasRouteAccess('/vendors/comparisons/database',role),true);
  for(const role of ['sales','sales_manager','production','production_manager','quality','viewer','dealer_admin'])assert.equal(hasRouteAccess('/vendors/comparisons/database',role),false);
  assert.equal(hasRouteAccess(`/profiles/${id}/specifications`,'quality'),true);
});
