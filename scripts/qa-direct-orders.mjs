import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { createDirectOrderFixture, fixtureId as id } from "./lib/direct-order-fixture.mjs";

const output=resolve(process.argv[2]??"artifacts/qa/direct-orders");
const staticRoot=resolve(".next/static");
const cssFiles=readdirSync(resolve(staticRoot,"chunks")).filter(name=>name.endsWith(".css"));
const styles=cssFiles.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
const fontClasses=[...new Set(cssFiles.flatMap(name=>[...readFileSync(resolve(staticRoot,"chunks",name),"utf8")
  .matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(" ");
assert.ok(fontClasses);
const db=await createDirectOrderFixture();
const fixtureContext={companyId:id(1),userId:id(3),role:"sales",dealerId:null};
const requestContext=new AsyncLocalStorage();
const submissions=[];
const lostResponses=new Set();

// This adapter runs only against the disposable fixture. The actual server
// action supplies the select list, company predicate, search and row bound.
const fixtureClient={
  from(table){
    assert.ok(["customers","aluminium_profiles"].includes(table));
    const query={columns:[],filters:[],sorts:[],start:0,end:24};
    const chain={
      select(columns){query.columns=columns.split(",").map(value=>value.trim());return chain;},
      eq(column,value){query.filters.push([column,"=",value]);return chain;},
      is(column,value){assert.equal(value,null);query.filters.push([column,"is null",value]);return chain;},
      ilike(column,value){query.filters.push([column,"ilike",value]);return chain;},
      order(column){query.sorts.push(column);return chain;},
      range(start,end){query.start=start;query.end=end;return chain;},
      async then(fulfilled,rejected){
        try{
          if(requestContext.getStore()==="catalogue-error")return fulfilled({data:null,error:{message:"Synthetic catalogue unavailable"}});
          for(const name of [...query.columns,...query.filters.map(filter=>filter[0]),...query.sorts])assert.match(name,/^[a-z_]+$/);
          assert.ok(query.filters.some(filter=>filter[0]==="company_id"&&filter[2]===id(1)));
          assert.equal(query.end-query.start+1,25);
          const parameters=[];
          const predicate=query.filters.map(([column,operator,value])=>{
            if(operator==="is null")return `"${column}" is null`;
            parameters.push(value);return `"${column}" ${operator} $${parameters.length}`;
          }).join(" and ");
          const result=await db.query(`select ${query.columns.map(column=>`"${column}"`).join(",")} from "${table}" where ${predicate}
            order by ${query.sorts.map(column=>`"${column}"`).join(",")} limit 25 offset ${query.start}`,parameters);
          return fulfilled({data:result.rows,error:null});
        }catch(error){if(rejected)return rejected(error);throw error;}
      }
    };return chain;
  },
  async rpc(name,args){
    assert.equal(name,"create_direct_order_atomic");
    if(requestContext.getStore()==="unavailable")return {data:null,error:{code:"PGRST202",message:"Synthetic unavailable workflow"}};
    await db.exec(`begin;set test.actor='${id(3)}';set role authenticated;`);
    try{
      const result=await db.query("select public.create_direct_order_atomic($1,$2,$3) id",[args.p_order,args.p_items,args.p_idempotency_key]);
      await db.exec("commit;reset role;");return {data:result.rows[0].id,error:null};
    }catch(error){await db.exec("rollback;reset role;");return {data:null,error};}
  }
};

const require=createRequire(import.meta.url);require("tsx/cjs");const Module=require("node:module");
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(request==="@/lib/auth")return {getSessionContext:async()=>fixtureContext};
  if(request==="@/lib/supabase/server")return {createClient:async()=>fixtureClient};
  if(request==="next/cache")return {revalidatePath(){}};
  if(request==="next/navigation")return {redirect:path=>{throw new Error(`Unexpected fixture redirect: ${path}`);}};
  if(request==="next/link")return function FixtureLink({children,...props}){return React.createElement("a",props,children);};
  if(request==="@/components/modules/orders/direct-order-form-client")return {DirectOrderFormClient:()=>React.createElement("div",{id:"app"})};
  if(request==="@/components/modules/orders/quote-order-form-client")return {QuoteOrderFormClient:()=>React.createElement("p",{"data-fixture-quotation":true},"Quotation selection boundary")};
  return original(request,parent,isMain);
};
let actions,Page;
try{actions=require("../lib/actions/direct-orders.ts");Page=require("../app/(dashboard)/orders/new/page.tsx").default;}
finally{Module._load=original;}

const bundle=await build({
  stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";
    import {DirectOrderFormClient} from "./components/modules/orders/direct-order-form-client";
    const target=document.getElementById("app");if(target)createRoot(target).render(<DirectOrderFormClient/>);`,
    resolveDir:process.cwd(),sourcefile:"fixture-direct-order.tsx",loader:"tsx"},
  bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":"\"production\""},
  plugins:[{name:"loopback-only-actions",setup(plugin){
    plugin.onResolve({filter:/^@\/lib\/actions\/direct-orders$/},()=>({path:"actions",namespace:"fixture"}));
    plugin.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation",namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",contents:args.path==="actions"?`
      async function send(path,payload){const mode=new URLSearchParams(location.search).get("mode")||"normal";
        const result=await fetch(path+"?mode="+mode,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        if(!result.ok)throw new Error("Synthetic response unavailable");return result.json();}
      export const searchDirectOrderOptionsAction=(kind,search)=>send("/fixture/search",{kind,search});
      export const createDirectOrderAction=input=>send("/fixture/create",input);`
      :`export function useRouter(){return {push(path){window.__QA_NAV__=path;},refresh(){window.__QA_REFRESH__=(window.__QA_REFRESH__||0)+1;}};}` }));
  }}]
});
const javascript=bundle.outputFiles[0].contents;

const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,"http://127.0.0.1");const mode=url.searchParams.get("mode")??"normal";
    if(url.pathname==="/fixture.js"){response.writeHead(200,{"Content-Type":"application/javascript"}).end(javascript);return;}
    if(url.pathname.startsWith("/_next/static/")){
      const target=resolve(staticRoot,decodeURIComponent(url.pathname.slice("/_next/static/".length)));
      if(!target.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}
      response.writeHead(200,{"Content-Type":extname(target)===".css"?"text/css":"application/octet-stream"}).end(readFileSync(target));return;
    }
    if(request.method==="POST"&&["/fixture/search","/fixture/create"].includes(url.pathname)){
      let body="";for await(const chunk of request){body+=chunk;if(body.length>256000)throw new Error("Fixture payload too large");}
      const input=JSON.parse(body);
      if(url.pathname==="/fixture/search"){
        const result=await requestContext.run(mode,()=>actions.searchDirectOrderOptionsAction(input.kind,input.search));
        response.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify(result));return;
      }
      submissions.push({mode,key:input.idempotency_key});
      const result=await requestContext.run(mode,()=>actions.createDirectOrderAction(input));
      if(mode==="uncertain"&&result.success&&!lostResponses.has(input.idempotency_key)){
        lostResponses.add(input.idempotency_key);response.writeHead(503).end("Synthetic lost confirmation after local commit");return;
      }
      response.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify(result));return;
    }
    const query={source:url.searchParams.get("source")??undefined,quoteId:url.searchParams.get("quoteId")??undefined};
    const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve(query)}));
    response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}).end(`<!doctype html><html lang="en" class="${fontClasses}"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body>
      <main style="max-width:1280px;margin:0 auto;padding:16px">${html}</main><script src="/fixture.js"></script></body></html>`);
  }catch(error){response.writeHead(500).end(`Local fixture failed: ${error.message}`);}
});

let browser;
try{
  await new Promise(ready=>server.listen(0,"127.0.0.1",ready));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
  mkdirSync(output,{recursive:true});const checks=[];
  async function bounded(label){
    await page.evaluate(()=>document.fonts.ready);
    assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: viewport overflow`);
    assert.ok(await page.evaluate(()=>[...document.querySelectorAll("input,select,textarea")].every(element=>{
      const rect=element.getBoundingClientRect();return rect.width===0||(rect.left>=0&&rect.right<=innerWidth+1);
    })),`${label}: overflowing controls`);
  }
  async function fill(){
    await page.getByPlaceholder("Search by customer name").click();
    await page.getByRole("button",{name:"Synthetic Customer",exact:true}).click();
    await page.getByPlaceholder("Search by profile code").first().click();
    await page.getByRole("button",{name:"P-001 - First section",exact:true}).click();
    await page.getByLabel("Pieces",{exact:true}).first().fill("10");
    await page.getByLabel("Cut length per piece (m)",{exact:true}).first().fill("6");
    await page.getByLabel("Agreed net rate (INR/kg)",{exact:true}).first().fill("250");
    await page.getByRole("button",{name:"Add profile line",exact:true}).click();
    await page.getByPlaceholder("Search by profile code").nth(1).click();
    await page.getByRole("button",{name:"P-002 - Second section",exact:true}).click();
    await page.getByLabel("Pieces",{exact:true}).nth(1).fill("20");
    await page.getByLabel("Cut length per piece (m)",{exact:true}).nth(1).fill("6");
    await page.getByLabel("Agreed net rate (INR/kg)",{exact:true}).nth(1).fill("300");
    await page.getByLabel("GST (%)",{exact:true}).nth(1).fill("5");
    await page.getByLabel("Finish",{exact:true}).nth(1).selectOption("anodizing");
    await page.getByText(/factory order is below 700 kg/).waitFor();
    assert.equal(await page.getByLabel("HSN code",{exact:true}).nth(1).inputValue(),"760429");
    assert.ok(await page.getByText(/51,375/).isVisible());
    // Editing a search or numeric field must invalidate its previous selection.
    await page.getByLabel("Customer",{exact:true}).fill("Unselected customer");
    assert.ok(await page.getByRole("button",{name:"Create Direct Order",exact:true}).isDisabled());
    await page.getByLabel("Customer",{exact:true}).fill("Synthetic");
    await page.getByRole("button",{name:"Synthetic Customer",exact:true}).click();
    await page.getByLabel("Profile",{exact:true}).first().fill("P-00");
    assert.ok(await page.getByRole("button",{name:"Create Direct Order",exact:true}).isDisabled());
    await page.getByRole("button",{name:"P-001 - First section",exact:true}).click();
    await page.getByLabel("GST (%)",{exact:true}).nth(1).fill("");
    assert.ok(await page.getByRole("button",{name:"Create Direct Order",exact:true}).isDisabled());
    await page.getByLabel("GST (%)",{exact:true}).nth(1).fill("5");
    await page.getByRole("button",{name:"Add profile line",exact:true}).click();
    assert.ok(await page.getByRole("button",{name:"Create Direct Order",exact:true}).isDisabled());
    await page.getByRole("button",{name:"Remove profile line 3",exact:true}).click();
    assert.ok(await page.getByText(/51,375/).isVisible());
  }
  async function verifySaved(){
    await page.waitForFunction(()=>Boolean(window.__QA_NAV__));
    const path=await page.evaluate(()=>window.__QA_NAV__);assert.match(path,/^\/orders\/[0-9a-f-]{36}$/);
    const orderId=path.split("/").at(-1);
    const saved=(await db.query(`select order_value,requested_weight_kg,(select count(*) from order_items where order_id=orders.id) lines,
      (select count(*) from audit_logs where entity_id=orders.id and action='direct_order_created') audits,
      (select count(*) from private.direct_order_requests where order_id=orders.id and completed) requests,
      (select status from factory_load_consolidations where order_id=orders.id) queue_status from orders where id=$1`,[orderId])).rows[0];
    assert.deepEqual(saved,{order_value:"51375.00",requested_weight_kg:"165.000",lines:2,audits:1,requests:1,queue_status:"pending"});
    return orderId;
  }
  for(const [label,width,height] of [["desktop",1440,1000],["tablet",820,1180],["mobile",390,844],["compact-mobile",320,720]]){
    await page.setViewportSize({width,height});await page.goto(`${base}/?source=direct`,{waitUntil:"networkidle"});
    await page.getByRole("heading",{name:"Direct Order",exact:true}).waitFor();
    assert.ok(await page.getByRole("button",{name:"Create Direct Order",exact:true}).isDisabled());
    await bounded(`${label} empty`);await page.screenshot({path:resolve(output,`${label}-empty.png`),fullPage:true});
    await fill();await bounded(`${label} priced`);await page.screenshot({path:resolve(output,`${label}-priced.png`),fullPage:true});
    const beforeSubmissions=submissions.length;
    await page.locator("form").evaluate(form=>{form.requestSubmit();form.requestSubmit();});await verifySaved();
    assert.equal(submissions.length,beforeSubmissions+1);
    checks.push(`${label}: empty/filled layout, two profile lines, exact prices, duplicate submit suppression and local committed order with pending load consolidation`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${base}/?source=direct&mode=catalogue-error`,{waitUntil:"networkidle"});
  await page.getByRole("alert").first().waitFor();assert.ok(await page.getByRole("button",{name:"Create Direct Order",exact:true}).isDisabled());
  await bounded("catalogue error");await page.screenshot({path:resolve(output,"mobile-catalogue-error.png"),fullPage:true});
  checks.push("Catalogue failures show alerts and cannot create an empty order");

  await page.goto(`${base}/?source=direct&mode=unavailable`,{waitUntil:"networkidle"});await fill();
  const before=(await db.query("select count(*) count from orders")).rows[0].count;
  await page.getByRole("button",{name:"Create Direct Order",exact:true}).click();await page.getByRole("alert").filter({hasText:"Direct order entry is unavailable"}).waitFor();
  assert.equal((await db.query("select count(*) count from orders")).rows[0].count,before);
  assert.equal(await page.evaluate(()=>window.__QA_NAV__??null),null);await bounded("unavailable workflow");
  await page.screenshot({path:resolve(output,"mobile-unavailable-workflow.png"),fullPage:true});checks.push("Unavailable workflow reports setup failure with no order or navigation");

  await page.goto(`${base}/?source=direct&mode=uncertain`,{waitUntil:"networkidle"});await fill();
  const beforeUncertain=(await db.query("select count(*) count from orders")).rows[0].count;
  await page.getByRole("button",{name:"Create Direct Order",exact:true}).click();await page.getByRole("alert").filter({hasText:"order confirmation could not be received"}).waitFor();
  assert.equal((await db.query("select count(*) count from orders")).rows[0].count,beforeUncertain+1);
  await page.screenshot({path:resolve(output,"mobile-uncertain-confirmation.png"),fullPage:true});
  await page.getByRole("button",{name:"Create Direct Order",exact:true}).click();await verifySaved();
  const retries=submissions.filter(submission=>submission.mode==="uncertain");assert.equal(retries.length,2);assert.equal(retries[0].key,retries[1].key);
  assert.equal((await db.query("select count(*) count from orders")).rows[0].count,beforeUncertain+1);
  checks.push("Lost confirmation after commit recovers one order and one audit with the original key on a real browser retry");
  await page.getByRole("link",{name:/From approved quotation/}).click();await page.locator("[data-fixture-quotation]").waitFor();
  await page.getByRole("link",{name:/Direct priced order/}).click();await page.getByRole("heading",{name:"Direct Order",exact:true}).waitFor();
  checks.push("Actual route method links switch between the quotation component boundary and the interactive direct form");
  assert.deepEqual(errors,[]);
  const result={evidence:"Actual new-order page navigation, React direct form, server actions and public SQL wrapper against a disposable PGlite fixture. Synthetic identity and transport; loopback only; no Supabase project, migrations, hosted JWT/RLS, live data or deployment. The quotation child is a fixture boundary, not a full quotation UI journey.",checks,errors};
  writeFileSync(resolve(output,"results.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify({...result,output},null,2));
}finally{if(browser)await browser.close();await new Promise(closed=>server.close(closed));await db.close();}
