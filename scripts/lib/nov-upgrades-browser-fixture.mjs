import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";

// The mounted UI is production source. Only session, network and unrelated panels
// are replaced; this fixture is interaction evidence, not hosted authorization proof.
export async function createNovBrowserFixture() {
  const noPanel = "export const RecordPreview=()=>null;export const StageWaiting=()=>null;export const TableColumnPreferences=()=>null;export const LocationGuidance=()=>null;export const RecordDiscussion=()=>null;export const RecordNextAction=()=>null;";
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
    "next/navigation": "const router={push:href=>window.navigations.push(href),back:()=>window.navigations.push('back'),refresh:()=>{}};export const useRouter=()=>router;export const useSearchParams=()=>new URLSearchParams(location.search);",
    "sonner": "const record=message=>{window.messages.push(message);document.getElementById('messages').textContent=message};export const toast={error:record,success:record,warning:record};",
    "@/lib/supabase/browser": "export const createClient=()=>window.fixtureClient;",
    "@/components/modules/operations/record-preview": noPanel,
    "@/components/modules/orders/stage-waiting": noPanel,
    "@/components/ui/table-column-preferences": noPanel,
    "@/components/modules/operations/operator-tools": noPanel,
    "@/components/modules/operations/collaboration-tools": noPanel,
    "@/components/modules/shared/record-next-action": noPanel
  };
  const actionExports = ["saveDispatchAction", "saveManualExpenseAction", "saveFoundryBatchAction", "savePackagingJobAction", "saveProductionJobAction", "saveOrderAction", "productionHoldAction"];
  const actions = actionExports.map((name) => `export const ${name}=async input=>window.action(input);`).join("\n");
  const entry = `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ModuleDatabaseClient} from './components/modules/operations/module-database-client';
    import {DiesDatabaseClient} from './components/modules/dies/dies-database-client';
    import {RecordFormClient} from './components/modules/operations/record-form-client';
    import {RecordDetailClient} from './components/modules/operations/record-detail-client';
    import {ProductionReadinessPanel} from './components/modules/production/production-readiness-panel';
    import {SearchableSelect} from './components/ui/searchable-select';
    import {DataTable} from './components/data/data-table';import {Badge} from './components/ui/badge';
    const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
    window.navigations=[];window.messages=[];window.rpcCalls=[];window.fromCalls=[];window.writes=[];
    window.rpcMode='normal';window.relatedFail=false;window.uncertainSave=false;window.readinessFailure=false;window.formReadFailure=false;
    window.readiness={job_status:'ready',start_issues:[{code:'drawing_not_approved',enforced:true,message:'Approved drawing evidence is missing'},{code:'slot_missing',enforced:false,message:'Record a press slot'}],release_issues:[],resume_issues:[],hold:null};
    window.action=async input=>{if(input.command==='holds.readiness')return window.readinessFailure?{success:false,error:'Readiness source unavailable'}:{success:true,data:window.readiness};return {success:false,error:'This write is outside the interaction fixture'}};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const records=()=>Array.from({length:11},(_,i)=>({id:id(i+1),company_id:id(100),order_number:'O-'+String(i+1).padStart(3,'0'),job_number:'JOB-'+(i+1),company_name:'Synthetic aluminium customer '+(i+1),customer_name:'Factory Contact '+(i+1),customer_type:'fabricator',phone:'9876543210',city:'Delhi',is_active:true,current_stage:'packing',priority:'normal',order_date:'2026-11-01',expected_dispatch_date:'2026-11-02',billets_required:i===0?null:10,billets_allocated:i===0?0:5,billet_allocation_status:'partially_allocated',order_value:123456.78,invoice_number:'INV-'+(i+1),status:'overdue',grand_total:123456.78,balance_due:0,due_date:'2026-11-02',created_at:'2026-11-01T10:00:00Z',notes:'Retained notes'}));
    window.fixtureClient={
      async rpc(name,p){window.rpcCalls.push({name,p});const mode=window.rpcMode;const term=p.p_search||'';await wait(term==='old'?700:15);if(mode==='failed'||mode==='denied')return {data:null,error:{code:mode==='denied'?'42501':'500',message:'SQL SECRET: do not display'}};let rows=records();if(mode==='empty'||term==='none')rows=[];if(term==='old'||term==='new')rows=rows.map(row=>({...row,order_number:term.toUpperCase()+'-'+row.order_number}));if(p.p_filters?.status&&p.p_filters.status!=='packing'&&p.p_module==='orders')rows=[];const count=rows.length;return {data:{rows:rows.slice((p.p_page-1)*10,p.p_page*10),count},error:null};},
      from(table){const request={table,filters:[],head:false,single:false,write:null};const chain={
        select(fields,options){request.fields=fields;request.head=options?.head||false;return chain},eq(field,value){request.filters.push([field,value]);return chain},neq(){return chain},in(){return chain},or(){return chain},order(){return chain},range(from,to){request.range=[from,to];return chain},limit(value){request.limit=value;return chain},single(){request.single=true;return chain},maybeSingle(){request.single=true;return chain},update(payload){request.write=payload;return chain},insert(payload){request.write=payload;return chain},
        then(resolve,reject){return (async()=>{window.fromCalls.push(structuredClone(request));if(request.write){window.writes.push(request);await wait(350);if(window.uncertainSave)throw Error('Lost response after commit');return {data:{id:id(1)},error:null};}if(window.formReadFailure&&request.single&&table==='customers')return {data:null,error:{code:'500',message:'Customer source unavailable'}};if(request.head)return window.relatedFail?{count:null,error:{code:'500',message:'SECRET'}}:{count:0,error:null};if(table==='dies')return {data:[{id:id(1),die_number:'D-1',die_status:'blocked',rack_location:'Rack 8',total_production_kg:null,ownership_type:'company_owned',aluminium_profiles:{profile_code:'AL-101',profile_name:'Window section'}}],count:1,error:null};const selected=request.filters.find(([key])=>key==='id')?.[1];const rows=records().filter(row=>!selected||row.id===selected);return {data:request.single?rows[0]??null:rows,error:null};})().then(resolve,reject)}
      };return chain;}
    };
    const root=createRoot(document.getElementById('app'));
    function Selector(){const [value,setValue]=useState('');const [failed,setFailed]=useState(false);window.failLookup=()=>setFailed(true);window.setSelected=setValue;return <><SearchableSelect ariaLabel='Customer' value={value} onChange={next=>{setValue(next);window.chosen=next}} error={failed?'source failed':null} onRetry={()=>setFailed(false)} options={[{value:'inactive',label:'Similar Aluminium',description:'Mumbai | inactive',disabled:true,disabledReason:'Inactive record'},{value:'delhi',label:'Similar Aluminium',description:'Delhi | 9876543210'},{value:'pune',label:'Similar Aluminium',description:'Pune | 9123456780'}]}/><p id='chosen'>{value}</p></>}
    function Table(){return <DataTable rows={[{id:'ROW-1'}]} getRowId={row=>row.id} onRowClick={()=>window.navigations.push('record')} emptyTitle='No rows' emptyDescription='No records' columns={[{id:'name',header:'Order',mobile:'identity',accessor:row=>row.id},{id:'state',header:'Status',mobile:'primary',accessor:()=> <Badge value='on_hold'/>},{id:'secondary',header:'Hidden note',mobile:'secondary',accessor:()=> 'Secondary detail'},{id:'action',header:'Action',mobile:'secondary',accessor:()=> <button onClick={()=>window.messages.push('nested')}>Nested action</button>}]} />}
    window.config={screen:'database',module:'orders',role:'owner',recordId:id(1),companyId:id(100)};
    window.mount=(next={})=>{Object.assign(window.config,next);const c=window.config,context={companyId:c.companyId,userId:id(101),companyName:'Synthetic factory',email:'synthetic@example.invalid',fullName:'Synthetic employee',role:c.role,dealerId:null};root.render(<div className='lg:grid lg:grid-cols-[200px_1fr]'><aside className='fixed bottom-0 left-0 right-0 z-30 h-16 bg-neutral-100 lg:static lg:h-screen'>Navigation</aside><main className='min-w-0 pb-24'><header className='sticky top-0 z-20 h-20 bg-white'>Synthetic factory</header><div className='space-y-6 p-4'>{c.screen==='database'?<ModuleDatabaseClient moduleKey={c.module} context={context} canCreate={c.role==='owner'}/>:c.screen==='die-database'?<DiesDatabaseClient context={context} canCreate={false}/>:c.screen==='form'?<RecordFormClient moduleKey={c.module} context={context} recordId={c.recordId}/>:c.screen==='detail'?<RecordDetailClient moduleKey={c.module} context={context} recordId={c.recordId} canEdit={c.role==='owner'}/>:c.screen==='readiness'?<ProductionReadinessPanel jobId={id(1)} role={c.role} initial={window.readiness} unavailableMessage={null} links={{jobId:id(1),profileId:id(2)}} canWrite={false} people={[]}/>:c.screen==='selector'?<Selector/>:<Table/>}</div></main></div>)};window.mount(Object.fromEntries(new URLSearchParams(location.search)));
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "nov-interaction-fixture.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "nov-boundaries", setup(api) {
    api.onResolve({ filter: /^@\/lib\/actions\// }, ({ path }) => ({ path, namespace: "actions" }));
    api.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: actions, loader: "js" }));
    for (const specifier of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: specifier, namespace: "boundary" }));
    api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
    else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
    else if (path === "/font.woff2") { response.setHeader("content-type", "font/woff2"); response.end(readFileSync("node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2")); }
    else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><style>@font-face{font-family:Jakarta;src:url(/font.woff2)}:root{--font-jakarta:Jakarta}</style><title>November interaction evidence</title><div id="app"></div><p id="messages" role="status"></p><script src="/bundle.js"></script></html>'); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
