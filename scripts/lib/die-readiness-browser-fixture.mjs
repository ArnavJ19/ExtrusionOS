import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,sep,extname} from "node:path";
import {build} from "esbuild";
import {chromium} from "@playwright/test";
import {dieFixture as f} from "./die-readiness-action-fixture.mjs";

export async function createDieReadinessBrowserFixture({styled=false}={}){
  const staticRoot=resolve(".next/static");let styles="",fonts="";
  if(styled){const files=readdirSync(resolve(staticRoot,"chunks")).filter(name=>name.endsWith(".css"));
    styles=files.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
    fonts=[...new Set(files.flatMap(name=>[...readFileSync(resolve(staticRoot,"chunks",name),"utf8").matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(" ");assert.ok(fonts);}
  const bundle=await build({stdin:{sourcefile:"die-readiness-browser.tsx",loader:"tsx",resolveDir:process.cwd(),contents:`
    import React from "react";import{createRoot}from"react-dom/client";import{Toaster}from"sonner";
    import{RecordFormClient}from"./components/modules/operations/record-form-client";
    import{ProductionClient}from"./components/modules/production-client";
    import{ProductionReadinessQueue}from"./components/modules/production-planning/production-readiness-queue";
    const f=${JSON.stringify(f)},id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),params=new URLSearchParams(location.search);
    const rows=[{id:f.die,company_id:f.company,profile_id:f.profile,die_status:'under_correction',die_number:'D-CORRECTION'},
      {id:id(11),company_id:f.company,profile_id:f.profile,die_status:'approved',die_number:'D-APPROVED'},
      {id:id(12),company_id:f.company,profile_id:f.profile,die_status:'active',die_number:'D-ACTIVE'},
      {id:id(13),company_id:f.company,profile_id:id(99),die_status:'active',die_number:'D-OTHER-PROFILE'},
      {id:id(14),company_id:f.company,profile_id:f.profile,die_status:null,die_number:'D-UNKNOWN'}];
    if(params.get('correctionFirst'))rows[0].die_number='A-CORRECTION';
    if(params.get('crowded'))rows.unshift(...Array.from({length:45},(_,n)=>({id:id(100+n),company_id:f.company,profile_id:f.profile,die_status:'design',die_number:'A-DESIGN-'+n})));
    if(params.get('otherProfiles'))rows.unshift(...Array.from({length:45},(_,n)=>({id:id(300+n),company_id:f.company,profile_id:id(99),die_status:'active',die_number:'A-OTHER-'+n})));
    const preferred=params.get('preferred'),linked=preferred==='correction'?f.die:preferred==='approved'?id(11):null;
    const tables={dies:rows,orders_authorized:[{id:f.order,company_id:f.company,order_number:'ORDER-R15',quote_id:null,production_profile_id:f.profile}],
      orders:[{id:f.order,company_id:f.company,order_number:'ORDER-R15',current_stage:'extrusion_planned',production_profile_id:f.profile,production_die_id:linked}],
      order_items_authorized:[{id:id(16),company_id:f.company,order_id:f.order,profile_id:f.profile,die_id:linked,quantity_kg:10,manufacturing_weight_kg:10,quantity_pieces:2,length_per_piece_m:5}],
      aluminium_profiles:[{id:f.profile,company_id:f.company,is_active:true,profile_code:'R15',profile_name:'Synthetic section',section_weight_kg_per_m:1}],
      machines:[{id:f.machine,company_id:f.company,machine_name:'Fixture press',machine_type:'extrusion_press',status:'active'}],production_jobs:[],foundry_billets:[]};
    window.__die={tables,queries:[],writes:[],navigation:[]};
    const context={companyId:f.company,role:'owner',userId:id(10),dealerId:null},mode=params.get('mode')||'record';
    const queueOrders=['under_correction','approved','active',null,'under_trial'].map((status,n)=>({id:id(200+n),order_number:'QUEUE-'+(status||'unknown'),production_profile_id:f.profile,
      production_die:{die_number:'D-'+(status||'UNKNOWN'),die_status:status,profile_id:f.profile},billet_allocation_status:'pending'}));
    createRoot(document.getElementById('app')).render(<>{mode==='queue'?<ProductionReadinessQueue orders={queueOrders} todayJobs={[]}/>:mode==='legacy'?<ProductionClient context={context}/>:<RecordFormClient moduleKey={mode==='order-edit'?'orders':'production'} recordId={mode==='order-edit'?f.order:undefined} context={context}/>}<Toaster/></>);
  `},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":"\"production\""},plugins:[{name:"controlled-die-surface",setup(plugin){
    for(const [filter,path] of [[/^@\/lib\/supabase\/browser$/,"client"],[/^@\/lib\/actions\//,"actions"],[/^next\/navigation$/,"navigation"],[/^next\/link$/,"link"]])plugin.onResolve({filter},()=>({path,namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",resolveDir:process.cwd(),contents:args.path==="client"?`
      export function createClient(){return {from(table){const call={table,filters:[],sort:null,limit:null,columns:''};window.__die.queries.push(call);
        const q={select(columns,options){call.columns=columns;call.count=options?.count;return q},eq(key,value){call.filters.push(['eq',key,value]);return q},
          in(key,value){call.filters.push(['in',key,value]);return q},is(key,value){call.filters.push(['eq',key,value]);return q},not(){return q},or(){return q},
          order(key){call.sort=key;return q},limit(value){call.limit=value;return q},
          single(){return Promise.resolve(read(true))},maybeSingle(){return Promise.resolve(read(true))},then(yes,no){return Promise.resolve(read()).then(yes,no)}};
        function read(single=false){let rows=window.__die.tables[table]||[];rows=rows.filter(row=>call.filters.every(([kind,key,value])=>kind==='in'?value.includes(row[key]):row[key]===value));
          if(call.sort)rows=[...rows].sort((a,b)=>String(a[call.sort]).localeCompare(String(b[call.sort])));if(call.limit)rows=rows.slice(0,call.limit);
          return {data:single?rows[0]||null:rows,error:null,count:rows.length}}
        return q}}}`:args.path==="actions"?`
      const blocked=async input=>{window.__die.writes.push(input);throw new Error('Browser fixture does not execute production writes')};
      export const saveProductionJobAction=input=>new Promise((resolve,reject)=>window.__die.writes.push({input,resolve,reject}));
      export const updateProductionJobStatusAction=blocked,saveDispatchAction=blocked,saveFoundryBatchAction=blocked,savePackagingJobAction=blocked,saveOrderAction=blocked;`
      :args.path==="navigation"?`export const useRouter=()=>({push(path){window.__die.navigation.push(path)},refresh(){}});`
      :`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`}));
  }}]});
  const server=createServer((request,response)=>{try{
    if(request.url==="/fixture.js"){response.writeHead(200,{"Content-Type":"application/javascript"}).end(bundle.outputFiles[0].contents);return;}
    if(styled&&request.url.startsWith("/_next/static/")){const target=resolve(staticRoot,decodeURIComponent(request.url.slice("/_next/static/".length)));
      if(!target.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}response.writeHead(200,{"Content-Type":extname(target)===".css"?"text/css":"application/octet-stream"}).end(readFileSync(target));return;}
    response.writeHead(200,{"Content-Type":"text/html"}).end(`<!doctype html><html lang="en" class="${fonts}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head>
      <body><main style="max-width:1280px;margin:auto;padding:16px"><div id="app"></div></main><script src="/fixture.js"></script></body></html>`);
  }catch(error){if(response.headersSent)response.destroy();else response.writeHead(500).end(error.message);}});
  await new Promise(done=>server.listen(0,"127.0.0.1",done));let browser;
  try{browser=await chromium.launch({headless:true});const context=await browser.newContext(),base=`http://127.0.0.1:${server.address().port}`;
    await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
    return {page,errors,base,
      field:name=>page.getByText(name,{exact:true}).locator("..").locator("input"),
      async open(params=""){errors.length=0;await page.goto(`${base}/?${params}`);await page.waitForFunction(()=>window.__die);
        if(!params.includes("mode=queue"))await page.getByRole("button",{name:params.includes("mode=legacy")?"Plan New Job":params.includes("mode=order-edit")?"Update":"Save",exact:true}).waitFor();},
      async selectOrder(){const input=page.getByText("Order *",{exact:true}).locator("..").locator("input");await input.click();
        await page.getByRole("button",{name:"ORDER-R15",exact:true}).click();await page.waitForFunction(()=>window.__die.queries.some(query=>query.table==='order_items_authorized'));},
      async close(){await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
    };
  }catch(error){if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));throw error;}
}
