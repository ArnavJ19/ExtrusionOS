import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from "node:fs";
import {extname,resolve,sep} from "node:path";
import {build} from "esbuild";
import {chromium} from "@playwright/test";
import {createRetainedInvoiceFixture,invoiceFixtureIds as f} from "./lib/retained-invoice-fixture.mjs";
import {createInvoiceActionFixture} from "./lib/retained-invoice-actions-fixture.mjs";

const output=resolve(process.argv[2]??"test-results/retained-dispatch-invoices"),staticRoot=resolve(".next/static");
const cssFiles=readdirSync(resolve(staticRoot,"chunks")).filter(name=>name.endsWith(".css"));
const styles=cssFiles.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
const fonts=[...new Set(cssFiles.flatMap(name=>[...readFileSync(resolve(staticRoot,"chunks",name),"utf8")
  .matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(" ");assert.ok(fonts);
const db=await createRetainedInvoiceFixture(),fixture=createInvoiceActionFixture(db);fixture.state.useSavepoint=true;
const bundle=await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {Toaster} from "sonner";
  import {InvoiceFormClient} from "./components/modules/financials/invoice-form-client";
  createRoot(document.getElementById("app")).render(<><InvoiceFormClient context={${JSON.stringify(fixture.state.context)}} recordId={new URLSearchParams(location.search).get("recordId")||undefined}/><Toaster/></>);`,
  resolveDir:process.cwd(),sourcefile:"retained-invoice-fixture.tsx",loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",
  define:{"process.env.NODE_ENV":"\"production\""},plugins:[{name:"local-invoice-transport",setup(plugin){
    for(const [filter,path] of [[/^@\/lib\/actions\/invoices$/,"actions"],[/^@\/lib\/supabase\/browser$/,"client"],[/^next\/navigation$/,"navigation"],[/^next\/link$/,"link"]])plugin.onResolve({filter},()=>({path,namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",resolveDir:process.cwd(),contents:args.path==="actions"?`
      async function send(name,input){const mode=new URLSearchParams(location.search).get("mode")||"normal";
        return (await fetch("/fixture/action?mode="+mode,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,input})})).json();}
      export const searchInvoiceSourcesAction=input=>send("searchInvoiceSourcesAction",input);
      export const saveInvoiceAction=input=>send("saveInvoiceAction",input);`
      :args.path==="client"?`export function createClient(){return {from(){let id;const q={select(){return q},eq(column,value){if(column==="id")id=value;return q},async maybeSingle(){return (await fetch('/fixture/record?id='+id)).json()}};return q}};}`
      :args.path==="navigation"?`export function useRouter(){return {push(path){window.__QA_NAV__=path;},refresh(){}};}`
      :`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` }));
  }}]});
const javascript=bundle.outputFiles[0].contents;
let queue=Promise.resolve();
const server=createServer(async(request,response)=>{
  try{
    const url=new URL(request.url,"http://127.0.0.1");
    if(url.pathname==="/fixture.js"){response.writeHead(200,{"Content-Type":"application/javascript"}).end(javascript);return;}
    if(url.pathname.startsWith("/_next/static/")){
      const target=resolve(staticRoot,decodeURIComponent(url.pathname.slice("/_next/static/".length)));
      if(!target.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}
      const content=readFileSync(target);
      response.writeHead(200,{"Content-Type":extname(target)===".css"?"text/css":"application/octet-stream"}).end(content);return;
    }
    if(url.pathname.startsWith("/fixture/")){
      let body="";for await(const chunk of request){body+=chunk;if(body.length>512000)throw new Error("Fixture payload too large");}
      const result=await (queue=queue.then(async()=>{
        if(url.pathname==="/fixture/record")return fixture.client.from("invoices").select("*").eq("company_id",f.company).eq("id",url.searchParams.get("id")).maybeSingle();
        const {name,input}=JSON.parse(body);
        fixture.state.rpcOverride=url.searchParams.get("mode")==="unavailable"?async()=>({data:null,error:new Error("Synthetic source outage")}):null;
        try{return await fixture.invoke(name,input);}finally{fixture.state.rpcOverride=null;}
      }));
      if(url.searchParams.get("mode")==="stale"&&body.includes('"search":"slow"'))await new Promise(done=>setTimeout(done,700));
      response.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify(result));return;
    }
    response.writeHead(200,{"Content-Type":"text/html; charset=utf-8"}).end(`<!doctype html><html lang="en" class="${fonts}"><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head>
      <body><main style="max-width:1280px;margin:auto;padding:16px"><div id="app"></div></main><script src="/fixture.js"></script></body></html>`);
  }catch(error){if(response.headersSent)response.destroy();else response.writeHead(500).end(`Local invoice fixture failed: ${error.message}`);}
});
let browser;
const checks=[],viewports=[["desktop",1440,1000],["tablet",820,1180],["mobile",390,844],["compact-mobile",320,720]];
let focusedSelectReopened=false;
try{
  mkdirSync(output,{recursive:true});await new Promise(ready=>server.listen(0,"127.0.0.1",ready));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
  async function bounded(label){
    await page.evaluate(()=>document.fonts.ready);assert.match(await page.evaluate(()=>getComputedStyle(document.body).fontFamily),/Plus Jakarta Sans/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: document overflow`);
  }
  for(const [label,width,height] of viewports){
    await db.exec(`reset role;begin;set test.actor='${f.actor}';set role authenticated;`);await db.query("update orders set current_stage='cancelled' where id=$1",[f.order]);
    fixture.state.calls.length=0;await page.setViewportSize({width,height});await page.goto(base,{waitUntil:"networkidle"});
    await page.getByLabel("Source order",{exact:true}).fill("cancel-001");
    await page.getByRole("button",{name:/O-CANCEL-001/}).click();
    if(label==="desktop"){
      const input=page.getByLabel("Source order",{exact:true});
      assert.equal(await input.evaluate(element=>element===document.activeElement),true);await input.click();
      await page.getByRole("button",{name:/O-CANCEL-001/}).waitFor();
      focusedSelectReopened=true;await page.screenshot({path:resolve(output,"desktop-focused-select-reopened.png"),fullPage:true});
    }
    await page.getByRole("heading",{name:"Source and Dates"}).click();
    await page.getByLabel("Source order",{exact:true}).click();await page.getByRole("button",{name:/O-CANCEL-001/}).click();
    await page.getByLabel("Packed dispatch",{exact:true}).click();await page.getByRole("button",{name:/D-RETAINED-001/}).click();
    await page.getByText("This order's unfulfilled remainder is cancelled.",{exact:false}).waitFor();
    await page.getByText("Place of supply: GST state code",{exact:false}).locator("..").locator("select").selectOption("24");
    const create=page.getByRole("button",{name:"Create Invoice",exact:true});await create.waitFor();await bounded(label);
    await page.screenshot({path:resolve(output,`${label}-retained-source.png`),fullPage:true});await create.click();
    await page.waitForFunction(()=>Boolean(window.__QA_NAV__));const invoice=(await page.evaluate(()=>window.__QA_NAV__)).split("/").at(-1);
    const totals=(await db.query("select grand_total,amount_paid,dispatch_id from invoices where id=$1",[invoice])).rows[0];
    assert.deepEqual(totals,{grand_total:"1180.00",amount_paid:"0.00",dispatch_id:f.dispatch});
    await page.goto(`${base}/?recordId=${invoice}`,{waitUntil:"networkidle"});
    const update=page.getByRole("button",{name:"Update Invoice",exact:true});await update.waitFor();
    await page.waitForFunction(()=>![...document.querySelectorAll("button")].find(button=>button.textContent==="Update Invoice")?.disabled);
    assert.ok(await page.getByLabel("Source order",{exact:true}).isDisabled());assert.ok(await page.getByLabel("Packed dispatch",{exact:true}).isDisabled());
    await page.getByText("Workflow status",{exact:false}).locator("..").locator("select").selectOption("sent");await update.click();await page.waitForFunction(()=>Boolean(window.__QA_NAV__));
    await page.goto(`${base}/?recordId=${invoice}`,{waitUntil:"networkidle"});await page.getByRole("heading",{name:"This invoice is financially locked"}).waitFor();
    await bounded(`${label} locked`);await page.screenshot({path:resolve(output,`${label}-locked.png`),fullPage:true});
    await db.exec("reset role;");const physical=(await db.query("select total_weight_kg,length_m,quantity_pieces from profile_stock_batches where id=$1",[f.batch])).rows[0];
    assert.deepEqual(physical,{total_weight_kg:"40.000",length_m:"20.000",quantity_pieces:4});
    checks.push(`${label}: retained source search, actual action/SQL save 1180, fixed edit source, issued lock, unchanged physical stock and bounded layout`);
    await db.exec("rollback;reset role;");
  }
  await db.exec(`begin;set test.actor='${f.actor}';set role authenticated;`);await db.query("update orders set current_stage='cancelled' where id=$1",[f.order]);
  await page.setViewportSize({width:390,height:844});await page.goto(`${base}/?mode=unavailable`,{waitUntil:"networkidle"});
  await page.getByRole("alert").filter({hasText:/Invoice sources are unavailable/}).waitFor();assert.ok(await page.getByRole("button",{name:"Create Invoice",exact:true}).isDisabled());
  await page.getByLabel("Source order",{exact:true}).click();await page.getByText("Invoice sources unavailable",{exact:true}).waitFor();
  assert.equal(await page.getByText("No eligible orders",{exact:true}).count(),0);await page.getByRole("heading",{name:"Source and Dates"}).click();
  await bounded("unavailable");await page.screenshot({path:resolve(output,"mobile-unavailable.png"),fullPage:true});checks.push("Source outage is explicit and prevents submission");
  await page.goto(`${base}/?mode=stale`,{waitUntil:"networkidle"});const order=page.getByLabel("Source order",{exact:true});
  const slowRequest=page.waitForRequest(request=>request.url().includes("/fixture/action")&&request.postData()?.includes('"search":"slow"'));
  const slowResponse=page.waitForResponse(response=>response.url().includes("/fixture/action")&&response.request().postData()?.includes('"search":"slow"'));
  await order.fill("slow");await slowRequest;
  await order.fill("cancel-001");await page.getByRole("button",{name:/O-CANCEL-001/}).waitFor();await slowResponse;
  await page.getByRole("button",{name:/O-CANCEL-001/}).waitFor();checks.push("Late older search response cannot replace the newer matching result");
  await order.fill("missing");assert.ok(await page.getByRole("button",{name:"Create Invoice",exact:true}).isDisabled());
  await page.getByText("No eligible orders",{exact:true}).waitFor();checks.push("Search text cannot silently retain a previous source");
  await db.exec("rollback;reset role;");assert.deepEqual(errors,[]);
  const result={proof:"Actual invoice form, server actions and extracted public/private SQL/ACL/trigger objects; synthetic session/HTTP adapter; disposable PGlite; loopback only; built CSS and fonts",
    boundary:"No Supabase migration, hosted JWT/RLS journey, independent-session race, operator cancellation workflow or deployment is proved",screenshots:10,checks,pageErrors:errors,
    selectorReopenRegression:{finding:"R12",passed:focusedSelectReopened,proof:"The actual invoice source input reopens on click while still focused, without an extra selection or invoice submission."}};
  writeFileSync(resolve(output,"results.json"),JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
}finally{if(browser)await browser.close();await new Promise(done=>server.close(done));await db.close();}
