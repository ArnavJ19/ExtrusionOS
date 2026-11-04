import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { nov2Evaluation } from "./nov-batch2-actions-fixture.mjs";

// Production components are mounted here; only network/session boundaries and unrelated panels are fixtures.
export async function createNov2BrowserFixture() {
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({push:href=>window.navigations.push(href),back:()=>window.navigations.push('back'),refresh:()=>window.refreshes++});",
    "sonner": "export const toast={error:message=>window.messages.push(message),success:message=>window.messages.push(message),warning:message=>window.messages.push(message)};",
    "@/lib/supabase/browser": "export const createClient=()=>window.fixtureClient;",
    "@/components/modules/operations/operator-tools": "export const LocationGuidance=()=>null;"
  };
  const actionSource = `
      export const improvementAction=async()=>({success:false,unavailable:true,error:'Improvement reads are outside this fixture'});export const inTaskVendorAction=async()=>({kind:'error',error:'Vendor creation is outside this fixture'});export const inTaskCustomerAction=async()=>({kind:'error',error:'Customer creation is outside this fixture'});
    export const saveProductionJobAction=async input=>{window.savedInputs.push(structuredClone(input));await window.delay(250);return {success:true,jobId:window.id(40)}};
    export const inspectionPlanAction=async input=>{
      window.actionCalls.push(structuredClone(input));await window.delay(120);
      if(input.command==='inspection.plan')return window.planReadFailure?{success:false,error:'Current plan unavailable'}:{success:true,data:structuredClone(window.evaluation)};
      if(window.observationMode==='reject')return {success:false,error:'The applicable inspection plan changed. Reload it before recording results'};
      const next=structuredClone(window.evaluation);for(const row of input.results){const item=next.items.find(item=>item.item_id===row.item_id);if('observed'in row){item.observed=row.observed;item.outcome=row.observed>=item.lower_limit&&row.observed<=item.upper_limit?'pass':'fail'}else{item.visual_ok=row.visual_ok;item.outcome=row.visual_ok?'pass':'fail'}}
      next.missing=next.items.filter(item=>item.outcome==='missing').length;next.failed=next.items.filter(item=>item.outcome==='fail').length;next.state=next.failed?'fail':next.missing?'incomplete':'pass';window.evaluation=next;try{sessionStorage.setItem('synthetic-server-observations',JSON.stringify(next))}catch{}
      if(window.observationMode==='uncertain')throw Error('Lost response after commit');return {success:true,data:structuredClone(next)};
    };
    export const refreshMyWorkAction=async()=>{window.refreshCalls++;await window.delay(120);if(window.refreshThrows)throw Error('Synthetic lost read response');return {success:true,scope:window.refreshScope||window.scope(),work:structuredClone(window.nextWork||window.work)}};
    export const saveDispatchAction=async()=>({success:false,error:'Fixture does not post dispatches'});
    export const saveManualExpenseAction=async()=>({success:false,error:'Fixture does not post money'});
    export const saveFoundryBatchAction=async()=>({success:false,error:'Fixture does not cast material'});
    export const savePackagingJobAction=async()=>({success:false,error:'Fixture does not issue materials'});
    export const saveOrderAction=async()=>({success:false,error:'Fixture does not create orders'});
  `;
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {RecordFormClient} from './components/modules/operations/record-form-client';
    import {InspectionResultsPanel} from './components/modules/quality/inspection-results';
    import {WorkspaceShortcuts} from './components/layout/workspace-shortcuts';
    import {LiveMyWork} from './components/modules/live-my-work';
    import {RecordNextAction} from './components/modules/shared/record-next-action';
    window.id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');const id=window.id;window.delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    window.messages=[];window.navigations=[];window.savedInputs=[];window.actionCalls=[];window.fromCalls=[];window.completedReads=[];window.refreshes=0;window.refreshCalls=0;window.delays={};window.evaluation=${JSON.stringify(nov2Evaluation())};try{const stored=sessionStorage.getItem('synthetic-server-observations');if(stored)window.evaluation=JSON.parse(stored)}catch{}
    const common={company_id:id(1)};
    window.rows={
      orders:[{...common,id:id(10),order_number:'ORD-010',billets_required:0},{...common,id:id(12),order_number:'ORD-012',billets_required:0}],
      orders_authorized:[{...common,id:id(10),order_number:'ORD-010',updated_at:'2026-11-02T00:00:00Z',current_stage:'production_planned',quote_id:null,billets_required:0},{...common,id:id(12),order_number:'ORD-012',updated_at:'2026-11-02T00:00:00Z',current_stage:'production_planned',quote_id:null,billets_required:0}],
      order_items_authorized:[{...common,id:id(11),order_id:id(10),profile_id:id(20),die_id:id(30),quantity_pieces:100,length_per_piece_m:6,section_weight_kg_per_m:.8,quantity_kg:480,manufacturing_weight_kg:480,item_description:'Window section'},{...common,id:id(13),order_id:id(12),profile_id:id(21),die_id:id(31),quantity_pieces:200,length_per_piece_m:4,section_weight_kg_per_m:1.2,quantity_kg:960,manufacturing_weight_kg:960,item_description:'Door section'}],
      aluminium_profiles:[{...common,id:id(20),profile_code:'AL-020',profile_name:'Window section',alloy:'6063',temper:'T6',section_weight_kg_per_m:.8,is_active:true},{...common,id:id(21),profile_code:'AL-021',profile_name:'Door section',alloy:'6063',temper:'T6',section_weight_kg_per_m:1.2,is_active:true}],
      dies:[{...common,id:id(30),die_number:'D-030',profile_id:id(20),die_status:'active'},{...common,id:id(31),die_number:'D-031',profile_id:id(21),die_status:'active'}],
      production_jobs:[{...common,id:id(40),job_number:'JOB-040',order_id:id(10),profile_id:id(20),finishing_type:'mill_finish',status:'completed',actual_quantity_kg:100}],
      quality_inspections:[{...common,id:id(70),batch_number:'QC-070',status:'pending'}],
      foundry_billets:[],machines:[],finishing_accepted_outputs:[],packaging_materials:[]
    };
    window.fixtureClient={from(table){const call={table,filters:[],head:false,single:false};const chain={
      select(fields,options){call.fields=fields;call.head=options?.head||false;return chain},eq(key,value){call.filters.push(['eq',key,value]);return chain},neq(){return chain},in(key,value){call.filters.push(['in',key,value]);return chain},is(key,value){call.filters.push(['eq',key,value]);return chain},or(){return chain},order(){return chain},limit(value){call.limit=value;return chain},single(){call.single=true;return chain},maybeSingle(){call.single=true;return chain},insert(payload){call.write=payload;return chain},update(payload){call.write=payload;return chain},then(resolve,reject){return(async()=>{
      window.fromCalls.push(structuredClone(call));const selected=call.filters.find(([,key])=>key==='id')?.[2];await window.delay(window.delays[table+':'+(selected||'list')]||10);window.completedReads.push(structuredClone(call));
      if(window.failedTable===table)return {data:null,error:{code:'500',message:'Synthetic unavailable source'}};
      if(call.write){window.savedInputs.push(structuredClone(call.write));return {data:{id:id(70)},error:null}}
      let rows=(window.rows[table]||[]).filter(row=>call.filters.every(([kind,key,value])=>kind==='in'?value.includes(row[key]):(row[key]??null)===value));if(call.limit)rows=rows.slice(0,call.limit);
      return {data:call.head?null:call.single?rows[0]||null:rows,count:rows.length,error:null};
    })().then(resolve,reject)}};return chain}};
    const queue={key:'assigned',title:'Assigned to me',description:'Open tasks, earliest due first.',href:'/tasks',items:[{id:id(60),title:'Review production JOB-040',status:'open',date:'2026-11-02',dateLabel:'Due',priority:'normal',href:'/production/'+id(40),actionLabel:'Review start and completion conditions',blocker:null,ownership:'Assigned to you'}],hasMore:false,error:null};
    window.work={today:'2026-11-02',assigned:queue,unassigned:{...queue,key:'unassigned',title:'Unassigned team tasks',items:[]},departments:[]};
    const root=createRoot(document.getElementById('app'));
    window.config={screen:'inspection',module:'production',companyId:id(1),userId:id(3),role:'owner',inspectionId:id(70),allowedRoutes:['/orders','/production','/quality','/invoices','/tasks']};
    window.scope=()=>[window.config.companyId,window.config.userId,window.config.role].join(':');
    window.mount=(patch={})=>{Object.assign(window.config,patch);const c=window.config,context={companyId:c.companyId,userId:c.userId,role:c.role,companyName:'Synthetic factory',fullName:'Fixture employee',email:'fixture@example.invalid',dealerId:null};root.render(<main className='mx-auto min-w-0 max-w-4xl space-y-5 p-4 pb-24'>{c.screen==='form'?<RecordFormClient moduleKey={c.module} context={context}/>:c.screen==='workspace'?<WorkspaceShortcuts context={context} allowedRoutes={c.allowedRoutes}/>:c.screen==='work'?<LiveMyWork initial={window.work} scope={window.scope()} role={c.role} name='Fixture employee'/>:c.screen==='next'?<RecordNextAction context={context} record={{kind:'quality',id:c.inspectionId,status:'pending',updatedAt:'2026-11-02T00:00:00Z'}}/>:<><h1 className='text-2xl font-bold'>QC-070 inspection task</h1><InspectionResultsPanel inspectionId={c.inspectionId} initial={window.evaluation} contextScope={window.scope()} referenceHref={'/quality/plans/'+window.evaluation.plan_id} canRecord={['owner','admin','quality'].includes(c.role)} focused={true}/></>}</main>)};const query=Object.fromEntries(new URLSearchParams(location.search));if(query.missingWeight==='1'){window.rows.aluminium_profiles[0].section_weight_kg_per_m=null;window.rows.order_items_authorized[0].section_weight_kg_per_m=null;}window.mount(query);
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "nov-batch2-fixture.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "nov2-boundaries", setup(api) {
    api.onResolve({ filter: /^@\/lib\/actions\// }, ({ path }) => ({ path, namespace: "actions" }));
    api.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: actionSource, loader: "js" }));
    for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
    api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
    else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
    else if (path === "/font.woff2") { response.setHeader("content-type", "font/woff2"); response.end(readFileSync("node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2")); }
    else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>@font-face{font-family:Jakarta;src:url(/font.woff2)}:root{--font-jakarta:Jakarta}</style><title>November batch 2 interaction fixture</title><div id="app"></div><script src="/bundle.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
