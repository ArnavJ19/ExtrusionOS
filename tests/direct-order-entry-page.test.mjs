import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require=createRequire(import.meta.url);require("tsx/cjs");const Module=require("node:module");
let context;
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(request==="@/lib/auth")return {getSessionContext:async()=>context};
  if(request==="next/navigation")return {redirect:path=>{throw new Error(`redirect:${path}`);}};
  if(request==="next/link")return function FixtureLink({children,...props}){return React.createElement("a",props,children);};
  if(request==="@/components/modules/orders/quote-order-form-client")return {QuoteOrderFormClient:({context:props})=>React.createElement("div",{"data-entry":"quotation","data-role":props.role})};
  if(request==="@/components/modules/orders/direct-order-form-client")return {DirectOrderFormClient:()=>React.createElement("div",{"data-entry":"direct"})};
  return original(request,parent,isMain);
};
let Page;
try{Page=require("../app/(dashboard)/orders/new/page.tsx").default;}finally{Module._load=original;}
const render=async query=>renderToStaticMarkup(await Page({searchParams:Promise.resolve(query??{})}));
test.beforeEach(()=>{context={companyId:"synthetic-company",role:"sales",dealerId:null};});

test("the default new-order screen offers both methods and retains quotation entry",async()=>{
  const html=await render();assert.match(html,/From approved quotation/);assert.match(html,/Direct priced order/);
  assert.match(html,/data-entry="quotation"/);assert.doesNotMatch(html,/data-entry="direct"/);
  assert.match(html,/href="\/orders\/new\?source=direct"/);
});
test("existing quotation deep links retain their exact quote selection when changing methods",async()=>{
  const html=await render({quoteId:"quote/with spaces",source:"direct"});
  assert.match(html,/href="\/orders\/new\?quoteId=quote%2Fwith%20spaces"/);assert.match(html,/data-entry="direct"/);
  assert.match(await render({quoteId:"quote-id"}),/data-entry="quotation"/);
});
test("all internal commercial entry roles can select the direct form",async()=>{
  for(const role of ["owner","admin","sales_manager","sales"]){context.role=role;const html=await render({source:"direct"});assert.match(html,/data-entry="direct"/);assert.doesNotMatch(html,/data-entry="quotation"/);}
});
test("operational roles cannot mount the direct pricing form by changing the URL",async()=>{
  for(const role of ["factory_manager","production_manager","dispatch_manager"]){context.role=role;const html=await render({source:"direct"});assert.match(html,/authorised commercial user/);assert.doesNotMatch(html,/data-entry="direct"/);}
  context.role="owner";context.dealerId="dealer";assert.doesNotMatch(await render({source:"direct"}),/data-entry="direct"/);
});
test("viewers and dealer roles still fail the factory-order creation route gate",async()=>{
  for(const role of ["viewer","dealer_admin","dealer_staff","accounts"]){context.role=role;await assert.rejects(render({source:"direct"}),/redirect:\/orders/);}
});
