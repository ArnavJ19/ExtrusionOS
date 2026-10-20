import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,readdirSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve,sep,extname} from "node:path";
import {build} from "esbuild";
import {chromium} from "@playwright/test";
import {partialFinishingIds as f} from "./finishing-partial-retry-fixture.mjs";

export const receiptId=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

export function createPackagingActionFixture(db){
  const state={role:"production_manager",calls:[],paths:[]};
  const client={async rpc(name,args){
    state.calls.push({name,args});assert.equal(name,"save_packaging_job_atomic");
    await db.query("select set_config('test.role',$1,false)",[state.role]);
    await db.exec("savepoint browser_package;");
    try{const result=await db.query("select public.save_packaging_job_atomic($1,$2,$3) id",[args.p_job_id,args.p_job,args.p_materials]);
      await db.exec("release savepoint browser_package;");return {data:result.rows[0].id,error:null};
    }catch(error){await db.exec("rollback to savepoint browser_package;release savepoint browser_package;");return {data:null,error:{message:error.message}};}
  }};
  const require=createRequire(import.meta.url);require("tsx/cjs");const Module=require("node:module"),original=Module._load;
  Module._load=function(request,parent,isMain){
    if(request==="@/lib/auth")return {getSessionContext:async()=>({companyId:f.company,userId:f.actor,role:state.role,dealerId:null})};
    if(request==="@/lib/supabase/server")return {createClient:async()=>client};
    if(request==="next/cache")return {revalidatePath:path=>state.paths.push(path)};
    return original(request,parent,isMain);
  };
  const path=require.resolve("../../lib/actions/packaging.ts");delete require.cache[path];
  let actions;try{actions=require(path);}finally{Module._load=original;}
  return {state,actions};
}

export async function createFinishingReceiptsBrowserFixture({tables={},styled=false}={}){
  const staticRoot=resolve(".next/static");let styles="",fonts="";
  if(styled){const files=readdirSync(resolve(staticRoot,"chunks")).filter(name=>name.endsWith(".css"));
    styles=files.map(name=>`<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
    fonts=[...new Set(files.flatMap(name=>[...readFileSync(resolve(staticRoot,"chunks",name),"utf8").matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match=>match[1])))].join(" ");assert.ok(fonts);}
  const bundle=await build({stdin:{sourcefile:"finishing-receipts-browser.tsx",loader:"tsx",resolveDir:process.cwd(),contents:`
    import React from 'react';import{createRoot}from'react-dom/client';import{Toaster}from'sonner';
    import{RecordFormClient}from'./components/modules/operations/record-form-client';
    const f=${JSON.stringify(f)},id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),params=new URLSearchParams(location.search);
    const defaults={production_jobs:[{id:f.job,company_id:f.company,order_id:f.order,job_number:'PROD-R18',profile_id:f.profile,status:'completed',finishing_type:'powder_coating',actual_quantity_kg:95,pieces:10,actual_pieces:10,actual_meters:50,length_per_piece_m:5},
        {id:id(60),company_id:f.company,order_id:id(61),job_number:'PROD-OTHER',profile_id:f.profile,status:'completed',finishing_type:'powder_coating',actual_quantity_kg:20,pieces:2,length_per_piece_m:5}],
      orders:[{id:f.order,company_id:f.company,order_number:'ORDER-R18'},{id:id(61),company_id:f.company,order_number:'ORDER-OTHER'}],
      aluminium_profiles:[{id:f.profile,company_id:f.company,is_active:true,profile_code:'R18',profile_name:'Synthetic section'}],
      finishing_accepted_outputs:[{id:id(51),company_id:f.company,production_job_id:f.job,order_id:f.order,finishing_type:'powder_coating',status:'rejected',output_weight_kg:40,received_date:'2026-10-18',receipt_kind:'Original receipt'},
        {id:id(52),company_id:f.company,production_job_id:f.job,order_id:f.order,finishing_type:'powder_coating',status:'completed',output_weight_kg:50,received_date:'2026-10-19',receipt_kind:'Corrective retry'},
        {id:id(53),company_id:f.company,production_job_id:id(60),order_id:id(61),finishing_type:'powder_coating',status:'completed',output_weight_kg:20,received_date:'2026-10-19',receipt_kind:'Original receipt'}],
      packaging_jobs:[{id:id(71),company_id:f.company,order_id:f.order,production_job_id:f.job,finishing_job_id:id(51),packaging_number:'PKG-R18',scheduled_date:'2026-10-19',pieces:4,profile_weight_kg:40,profile_length_m:20,status:'scheduled',notes:''}],
      packaging_materials:[{id:id(90),company_id:f.company,is_active:true,material_code:'FILM-R18',material_name:'Synthetic packing film',current_stock:100,unit:'roll'}],packaging_job_materials:[]};
    window.__receipts={tables:{...defaults,...${JSON.stringify(tables)}},queries:[],writes:[],navigation:[],errors:{},deferAutofill:false,pending:[]};
    if(params.get('missingView'))window.__receipts.errors.finishing_accepted_outputs={message:'Accepted finishing receipts are unavailable in this schema'};
    const moduleKey=params.get('mode')==='packaging'?'packaging':'quality',recordId=params.get('edit')||undefined;
    createRoot(document.getElementById('app')).render(<><RecordFormClient moduleKey={moduleKey} recordId={recordId} context={{companyId:f.company,userId:f.actor,role:'owner',dealerId:null}}/><Toaster/></>);
  `},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":"\"production\""},plugins:[{name:"controlled-receipt-boundaries",setup(plugin){
    for(const [filter,path] of [[/^@\/lib\/supabase\/browser$/,"client"],[/^@\/lib\/actions\//,"actions"],[/^next\/navigation$/,"navigation"],[/^next\/link$/,"link"]])plugin.onResolve({filter},()=>({path,namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},args=>({loader:"js",resolveDir:process.cwd(),contents:args.path==="client"?`
      export function createClient(){return {from(table){const state=window.__receipts,call={table,filters:[],columns:'',sort:null,limit:null};state.queries.push(call);let payload=null;
        const q={select(columns){call.columns=columns;return q},eq(key,value){call.filters.push(['eq',key,value]);return q},in(key,value){call.filters.push(['in',key,value]);return q},
          is(key,value){call.filters.push(['eq',key,value]);return q},not(){return q},or(){return q},order(key){call.sort=key;return q},limit(n){call.limit=n;return q},
          insert(input){payload=input;return q},update(input){payload=input;return q},single(){return perform(true)},maybeSingle(){return perform(true)},then(yes,no){return perform(false).then(yes,no)}};
        async function perform(single){if(payload){state.writes.push({kind:table,input:payload});return {data:{id:'00000000-0000-4000-8000-000000000801'},error:null}}
          const read=()=>{if(state.errors[table])return {data:null,error:state.errors[table]};let rows=state.tables[table]||[];
            rows=rows.filter(row=>call.filters.every(([kind,key,value])=>kind==='in'?value.includes(row[key]):row[key]===value));
            if(call.sort)rows=[...rows].sort((a,b)=>String(a[call.sort]).localeCompare(String(b[call.sort])));if(call.limit)rows=rows.slice(0,call.limit);
            return {data:single?rows[0]||null:rows,error:null}};
          if(state.deferAutofill&&table==='production_jobs'&&call.limit===1)return new Promise(resolve=>state.pending.push({call,release:()=>resolve(read())}));return read();}
        return q}}}`:args.path==="actions"?`
      const capture=async input=>{window.__receipts.writes.push({kind:'packaging-action',input});return {success:true,jobId:input.editing_id||'00000000-0000-4000-8000-000000000802'}};
      export const savePackagingJobAction=capture;
      const blocked=async()=>{throw new Error('Unrelated action is outside this browser fixture')};
      export const saveProductionJobAction=blocked,saveDispatchAction=blocked,saveFoundryBatchAction=blocked,saveOrderAction=blocked,saveManualExpenseAction=blocked;`
      :args.path==="navigation"?`export const useRouter=()=>({push(path){window.__receipts.navigation.push(path)},refresh(){}});`
      :`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`}));
  }}]});
  const server=createServer((request,response)=>{try{
    if(request.url==="/fixture.js"){response.writeHead(200,{"Content-Type":"application/javascript"}).end(bundle.outputFiles[0].contents);return;}
    if(styled&&request.url.startsWith("/_next/static/")){const target=resolve(staticRoot,decodeURIComponent(request.url.slice("/_next/static/".length)));
      if(!target.startsWith(staticRoot+sep)){response.writeHead(404).end();return;}response.writeHead(200,{"Content-Type":extname(target)===".css"?"text/css":"application/octet-stream"}).end(readFileSync(target));return;}
    response.writeHead(200,{"Content-Type":"text/html"}).end(`<!doctype html><html lang="en" class="${fonts}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><main style="max-width:1280px;margin:auto;padding:16px"><div id="app"></div></main><script src="/fixture.js"></script></body></html>`);
  }catch(error){if(response.headersSent)response.destroy();else response.writeHead(500).end(error.message);}});
  await new Promise(done=>server.listen(0,"127.0.0.1",done));let browser;
  try{browser=await chromium.launch({headless:true});const context=await browser.newContext(),base=`http://127.0.0.1:${server.address().port}`;
    await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on("pageerror",error=>errors.push(error.message));
    const field=name=>page.getByText(name,{exact:true}).locator("..").locator("input");
    return {page,errors,base,field,
      async open(params=""){errors.length=0;await page.goto(`${base}/?${params}`);await page.waitForFunction(()=>window.__receipts);if(!params.includes('missingView'))await page.getByRole("button",{name:params.includes('edit=')?'Update':'Save',exact:true}).waitFor();},
      async choose(label,name){await field(label).click();await page.getByRole('button',{name,exact:typeof name==='string'}).click();},
      async close(){await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
    };
  }catch(error){if(browser)await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));throw error;}
}
