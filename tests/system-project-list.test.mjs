import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildProjectListQuery, getProjectListOptions } from "../lib/systems-configurator/project-list.ts";
import { renderToStaticMarkup } from "react-dom/server";

const require=createRequire(import.meta.url);
require("tsx/cjs");
const Module=require("node:module");
let replyError=null;
let calls=[];
let role="owner";
const rows=Array.from({length:111},(_,i)=>({id:`configuration-${String(i).padStart(3,"0")}`,company_id:"company-a",configuration_number:`CONF-${i}`,project_name:`Project ${i}`,design_reference:`Design ${i}`,status:"draft",system_type:"sliding_door",created_at:`2026-10-08T10:${String(i%60).padStart(2,"0")}:00Z`,grand_total:1000,width_mm:1200,height_mm:2100,quantity:1}));
function client() {
  return { from(table) {
    const call={table,filters:[],orders:[]};
    calls.push(call);
    return {
      select(columns,options){call.columns=columns;call.count=options?.count;return this;},
      eq(column,value){call.filters.push([column,value]);return this;},
      or(value){call.search=value;return this;},
      order(column,options){call.orders.push([column,options]);return this;},
      async range(from,to){
        call.range=[from,to];
        if(replyError) return {data:null,error:replyError,count:null};
        let found=rows.filter(row=>call.filters.every(([column,value])=>row[column]===value));
        if(call.search){const term=call.search.split("*")[1];found=found.filter(row=>[row.configuration_number,row.project_name,row.design_reference].some(value=>value.toLowerCase().includes(term.toLowerCase())));}
        found.sort((a,b)=>{for(const [column,options] of call.orders){const comparison=String(a[column]).localeCompare(String(b[column]));if(comparison)return options.ascending?comparison:-comparison;}return 0;});
        return {data:found.slice(from,to+1),count:found.length,error:null};
      }
    };
  } };
}
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(request==="@/lib/supabase/server")return{createClient:async()=>client()};
  if(request==="@/lib/systems-configurator/access")return{getSystemsConfiguratorContext:async()=>({companyId:"company-a",role})};
  if(request==="@/lib/systems-configurator/project-list")return original(require.resolve("../lib/systems-configurator/project-list.ts"),parent,isMain);
  if(request==="@/lib/auth/permissions")return{can:()=>role==="owner"};
  if(request==="@/types/app")return{labelize:value=>value};
  if(request==="next/link")return{__esModule:true,default:({children,...props})=>require("react").createElement("a",props,children)};
  if(request.startsWith("@/components/"))return new Proxy({}, {get:(_target,key)=>key==="__esModule"?true:({children,...props})=>require("react").createElement("div",props,children)});
  return original(request,parent,isMain);
};
const Page=require("../app/(dashboard)/systems-configurator/projects/page.tsx").default;
Module._load=original;

test("project lists are server paged ten at a time with exact count and stable sort",async()=>{
  calls=[];replyError=null;
  const first=await buildProjectListQuery(client(),"company-a",getProjectListOptions({page:"1",sort:"configuration_number",direction:"asc"}));
  const later=await buildProjectListQuery(client(),"company-a",getProjectListOptions({page:"11",sort:"configuration_number",direction:"asc"}));
  assert.equal(first.data.length,10);assert.equal(later.data.length,10);assert.equal(later.count,111);
  assert.ok(later.data.every(row=>!first.data.some(first=>first.id===row.id)));
  assert.deepEqual(calls[1].range,[100,109]);assert.equal(calls[1].count,"exact");assert.equal(calls[1].table,"system_configurations_authorized");
  assert.equal(calls[1].orders.at(-1)[0],"id");
  const exact=await buildProjectListQuery(client(),"company-a",getProjectListOptions({q:"Design 101",status:"draft",system:"sliding_door"}));
  assert.equal(exact.count,1);assert.equal(exact.data[0].id,"configuration-101");
});
test("project query controls reject arbitrary sort/filter inputs and sanitize search syntax",()=>{
  const options=getProjectListOptions({page:"-2",sort:"internal_cost",direction:"injected",q:"a%,(b)*",status:"unknown"});
  assert.equal(options.page,1);assert.equal(options.sort,"created_at");assert.equal(options.status,"");assert.equal(options.search,"a b");
});
test("failed project query renders an unavailable state rather than a fabricated empty dataset",async()=>{
  role="owner";replyError={code:"42501"};
  const tree=await Page({searchParams:Promise.resolve({})});
  const html=renderToStaticMarkup(tree);
  assert.match(html,/Retry loading projects/);assert.doesNotMatch(html,/No configurations match/);assert.doesNotMatch(html,/matching configurations/);
  replyError=null;role="production";
  const operational=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
  assert.doesNotMatch(operational,/Rs\./);assert.doesNotMatch(operational,/New Configuration/);
});
