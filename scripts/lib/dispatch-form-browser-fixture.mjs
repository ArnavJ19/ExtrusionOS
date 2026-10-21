import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,readdirSync} from "node:fs";
import {extname,resolve,sep} from "node:path";
import {build} from "esbuild";
import {chromium} from "@playwright/test";

export const dispatchFixtureId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const dispatchFormIds={company:dispatchFixtureId(1),otherCompany:dispatchFixtureId(2),a:dispatchFixtureId(1001),b:dispatchFixtureId(1002),
  other:dispatchFixtureId(1003),sourceA:dispatchFixtureId(2001),sourceB:dispatchFixtureId(2002),profile:dispatchFixtureId(3001),batch:dispatchFixtureId(4001),dispatch:dispatchFixtureId(5001)};
export function dispatchSource(label){return {id:label==="A"?dispatchFormIds.sourceA:dispatchFormIds.sourceB,sourceKind:"reservation",sourceLabel:`${label} source`,
  profileId:dispatchFormIds.profile,profileLabel:`${label} profile`,stockBatchId:dispatchFormIds.batch,stockBatchLabel:`${label} batch`,
  availableWeightKg:10,availablePieces:2,availableLengthM:5};}
export const dispatchOrder=label=>({id:label==="A"?dispatchFormIds.a:dispatchFormIds.b,company_id:dispatchFormIds.company,order_number:`ORDER-${label}`,customer_name:"Synthetic buyer",company_name:null,quote_number:null});

export async function createDispatchFormBrowserFixture({styled=false}={}){
  const f=dispatchFormIds,staticRoot=resolve(".next/static");let styles="",fonts="";
  if(styled){
    const files=readdirSync(resolve(staticRoot,"chunks")).filter(name=>name.endsWith(".css"));
    styles=files.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
    fonts=[...new Set(files.flatMap(name=>[...readFileSync(resolve(staticRoot,"chunks",name),"utf8").matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(" ");assert.ok(fonts);
  }
  const bundle=await build({stdin:{contents:`import React,{useState} from "react";import {createRoot} from "react-dom/client";import {Toaster} from "sonner";
    import {DispatchFormClient} from "./components/modules/dispatch-form-client";
    window.__dispatch={sourceRequests:[],orderRequests:[],saveRequests:[],navigation:[],autoOrders:true};
    function Fixture(){const [companyId,setCompanyId]=useState("${f.company}"),[visible,setVisible]=useState(true);
      Object.assign(window.__dispatch,{setCompanyId,unmount:()=>setVisible(false)});
      return <>{visible?<DispatchFormClient context={{companyId,role:"owner",userId:"${dispatchFixtureId(3)}",dealerId:null}}/>:null}<Toaster/></>;}
    createRoot(document.getElementById("app")).render(<Fixture/>);`,resolveDir:process.cwd(),sourcefile:"dispatch-preparation-fixture.tsx",loader:"tsx"},
    bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":"\"production\""},plugins:[{name:"controlled-dispatch-transport",setup(plugin){
      for(const [filter,path] of [[/^@\/lib\/actions\/dispatches$/,"actions"],[/^@\/lib\/actions\/dispatch-order-balance$/,"balance"],[/^@\/lib\/supabase\/browser$/,"client"],[/^next\/navigation$/,"navigation"],[/^next\/link$/,"link"]])plugin.onResolve({filter},()=>({path,namespace:"fixture"}));
      plugin.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",resolveDir:process.cwd(),contents:args.path==="actions"?`
        export const getDispatchSourcesAction=orderId=>new Promise((resolve,reject)=>window.__dispatch.sourceRequests.push({orderId,resolve,reject}));
        export const saveDispatchAction=input=>new Promise((resolve,reject)=>window.__dispatch.saveRequests.push({input,resolve,reject}));`
        :args.path==="balance"?`export async function dispatchOrderBalanceAction(id){return {success:true,balance:{orderId:id,orderLabel:"Synthetic order",ordered:{pieces:20,metres:50},shipped:{pieces:0,metres:0}}}}`
        :args.path==="client"?`const rows=${JSON.stringify([dispatchOrder("A"),dispatchOrder("B"),{...dispatchOrder("B"),id:f.other,company_id:f.otherCompany,order_number:"OTHER-ORDER"}])};
          export function createClient(){return {from(table){if(table!=="orders_authorized")throw new Error("Unexpected fixture table "+table);
            const call={filters:[],sort:[],search:"",limit:null};const q={select(){return q},eq(key,value){call.filters.push([key,value]);return q},neq(){return q},order(key){call.sort.push(key);return q},limit(count){call.limit=count;return q},or(value){call.search=value;return q},
            then(resolve,reject){return new Promise((yes,no)=>{call.resolve=yes;call.reject=no;window.__dispatch.orderRequests.push(call);
              if(window.__dispatch.autoOrders){const company=call.filters.find(([key])=>key==="company_id")?.[1];const term=(call.search.split('.ilike.%')[1]||'').split('%')[0].toLowerCase();
                yes({data:rows.filter(row=>row.company_id===company&&(!term||row.order_number.toLowerCase().includes(term))),error:null});}}).then(resolve,reject)}};return q}};}`
        :args.path==="navigation"?`export function useRouter(){return {push(path){window.__dispatch.navigation.push(path)},refresh(){}};}`
        :`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}` }));
    }}]});
  const server=createServer((request,response)=>{
    try{
      if(request.url==="/fixture.js"){response.writeHead(200,{"Content-Type":"application/javascript"}).end(bundle.outputFiles[0].contents);return;}
      if(styled&&request.url.startsWith("/_next/static/")){
        const target=resolve(staticRoot,decodeURIComponent(request.url.slice("/_next/static/".length)));
        if(!target.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}
        const body=readFileSync(target);response.writeHead(200,{"Content-Type":extname(target)===".css"?"text/css":"application/octet-stream"}).end(body);return;
      }
      response.writeHead(200,{"Content-Type":"text/html"}).end(`<!doctype html><html lang="en" class="${fonts}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head>
        <body><main style="max-width:1280px;margin:auto;padding:16px"><div id="app"></div></main><script src="/fixture.js"></script></body></html>`);
    }catch(error){if(response.headersSent)response.destroy();else response.writeHead(500).end(error.message);}
  });
  await new Promise(ready=>server.listen(0,"127.0.0.1",ready));let browser;
  try{
    browser=await chromium.launch({headless:true});const context=await browser.newContext();const base=`http://127.0.0.1:${server.address().port}`;
    await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage(),errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    const fixture={page,base,errors,order:()=>page.getByPlaceholder("Search order or customer PO"),source:()=>page.getByPlaceholder("Select production job or stock batch"),
      save:()=>page.getByRole("button",{name:/^(Review dispatch|Rechecking the load\.\.\.)$/}),
      confirm:()=>page.getByRole("button",{name:/^(Confirm dispatch and consume stock|Verifying and posting stock\.\.\.)$/}),
      async review(){const count=await page.evaluate(()=>window.__dispatch.sourceRequests.length);const label=(await fixture.order().inputValue()).includes("ORDER-B")?"B":"A";await fixture.save().click();await page.waitForFunction(count=>window.__dispatch.sourceRequests.length>count,count);await fixture.resolveSource(count,{success:true,sources:[dispatchSource(label)]});await page.getByRole("dialog",{name:"Review physical dispatch"}).waitFor();},
      async reset(){errors.length=0;await page.goto(base);await page.getByRole("heading",{name:"Load Physical Dispatch",exact:true}).waitFor();},
      async flush(){await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));},
      async chooseOrder(label){await fixture.order().fill(`ORDER-${label}`);await page.getByRole("button",{name:`ORDER-${label} - Synthetic buyer`,exact:true}).click();
        await page.waitForFunction(id=>window.__dispatch.sourceRequests.some(request=>request.orderId===id),label==="A"?f.a:f.b);},
      async resolveSource(index,result){await page.evaluate(({index,result})=>window.__dispatch.sourceRequests[index].resolve(result),{index,result});await fixture.flush();},
      async ready(label,index=0){await fixture.chooseOrder(label);await fixture.resolveSource(index,{success:true,sources:[dispatchSource(label)]});},
      async chooseSource(label){await fixture.source().click();await page.getByRole("button",{name:new RegExp(`${label} profile.*${label} source`)}).click();},
      async fillBundle(label){await fixture.chooseSource(label);await page.getByText("Scan / Bundle ID *",{exact:true}).locator("..").locator("input").fill(`${label}-MANIFEST`);
        for(const [name,value] of [["Actual pieces *","1"],["Actual metres *","2.5"],["Gross kg *","6"],["Tare kg *","1"]])await page.getByText(name,{exact:true}).locator("..").locator("input").fill(value);},
      async close(){await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}};
    return fixture;
  }catch(error){if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));throw error;}
}
