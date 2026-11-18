import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { PDFDocument } from "pdf-lib";
import { createBatch8Fixture, ids } from "./autopilot-batch8-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 8 screens. The real gateway action (lib/actions/autopilot.ts), the certificate reader
// (lib/actions/autopilot-batch8.ts) and the saved-view actions (lib/actions/saved-views.ts) run against the replayed local
// SQL as the chosen employee. /api/saved-views is answered by the same actions the real route forwards to. A browser upload lands in the fixture's synthetic storage, where the certificate action reads
// it back. /api/pdf/batch is answered by the fixture (records the request, returns a one-page PDF per id), because the
// real route needs a Next.js session; the route itself is unit-tested.
export async function createBatch8BrowserFixture() {
  const f = await createBatch8Fixture();
  const modules = { autopilot: createNov7ActionsFixture("../../lib/actions/autopilot.ts"), batch8: createNov7ActionsFixture("../../lib/actions/autopilot-batch8.ts"),
    views: createNov7ActionsFixture("../../lib/actions/saved-views.ts") };
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const rpcFor = actor => async (name, body) => {
    try { return { data: await f.call(name, body.p_command, body.p_payload, actor), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  async function as(fixture, actor) {
    const user = (await f.db.query("select company_id,role,is_active,dealer_id from app_users where id=$1", [actor])).rows[0];
    fixture.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null }; fixture.state.authenticated = !!user?.is_active;
    fixture.state.rpcHandler = rpcFor(actor);
  }
  const printRequests = [];
  const post = (module, name) => `async function(...args){const response=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({module:'${module}',name:'${name}',args,actor:window.config.userId})});return response.json()}`;
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "sonner": "export const toast={success:t=>window.toasts.push(['ok',t]),error:t=>window.toasts.push(['error',t])};",
    "@/lib/actions/autopilot": `export const autopilotAction=async(rpc,command,payload={})=>{window.calls.push({rpc,command});return (${post("autopilot", "autopilotAction")})(rpc,command,payload)};`,
    "@/lib/actions/autopilot-batch8": `export const readCertificateAction=${post("batch8", "readCertificateAction")};export const certificateFileUrlAction=${post("batch8", "certificateFileUrlAction")};`,
    "@/lib/utils/files": "export async function uploadTenantFile(bucket,companyId,folder,file){const path=companyId+'/'+folder+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'-');const r=await fetch('/upload?bucket='+bucket+'&path='+encodeURIComponent(path),{method:'POST',body:file});if(!r.ok)throw new Error('upload');window.uploads.push(path);return path}"
  };
  const entry = `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {CertificatesClient,CertificateCoverage,CertificateDetail,CertificateUpload,CertificateLinePanel} from './components/modules/autopilot-batch8/certificates';
    import {SpcAlarmsPanel,SpcChartsClient,SpcDiePanel} from './components/modules/autopilot-batch8/spc';
    import {DieAvailabilityPanel,DieConflictsPanel,JobDieWarnings} from './components/modules/autopilot-batch8/die-availability';
    import {AtRiskCustomers,CustomerHealthPanel} from './components/modules/autopilot-batch8/customer-health';
    import {QuoteCapacityPanel,ProfileCapacityHint,CapacityAccuracy} from './components/modules/autopilot-batch8/capacity';
    import {SavedViewsMenu,useDefaultView} from './components/modules/autopilot-batch8/saved-views';
    import {PrintSelectedBar,SelectCheckbox,usePrintSelection} from './components/modules/autopilot-batch8/print-selected';
    window.ids=${JSON.stringify(ids)};Object.assign(window,{calls:[],refreshes:0,navigations:[],toasts:[],uploads:[],applied:[]});
    const root=createRoot(document.getElementById('app'));
    window.config={userId:window.ids.owner};const realFetch=window.fetch.bind(window);window.fetch=(input,init={})=>String(input).startsWith('/api/saved-views')?realFetch(input,{...init,headers:{...(init.headers||{}),'x-actor':window.config.userId}}):realFetch(input,init);
    function Views({o}){const [q,setQ]=useState(o.query??'status=packing');const def=useDefaultView('orders',Boolean(o.hasFilters),(query,name)=>{window.applied.push([query,name]);setQ(query)});
      const sel=usePrintSelection();const rows=(o.rows||'').split(',').filter(Boolean).map(id=>({id,label:'DSP-'+id.slice(-4)}));
      return <div className='space-y-4'><section className='flex flex-wrap items-center gap-2'><p data-testid='query'>{q}</p><SavedViewsMenu pageKey='orders' query={q} onApply={query=>{window.applied.push([query]);setQ(query)}} appliedDefault={def}/>
        <input aria-label='Filter query' className='form-input' value={q} onChange={e=>setQ(e.target.value)}/></section>
        <section className='rounded-2xl border bg-white'><PrintSelectedBar kind='challan' selection={sel} pageRows={rows} singleDay={o.day||null}/><ul className='p-4'>{rows.map(r=><li key={r.id}><label className='flex items-center gap-2'><SelectCheckbox id={r.id} label={r.label} selection={sel}/>{r.label}</label></li>)}</ul></section></div>}
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;window.pathname=o.pathname||'/'+screen;root.render(<p>Loading</p>);let node;
      if(screen==='certificates')node=<><CertificatesClient/><CertificateCoverage/></>;
      else if(screen==='certificate')node=<CertificateDetail id={o.id} role={o.role||'quality'}/>;
      else if(screen==='upload')node=<CertificateUpload companyId={window.ids.company} receiptLineId={o.line}/>;
      else if(screen==='line')node=<CertificateLinePanel receiptLineId={o.line} canUpload={true}/>;
      else if(screen==='spc')node=<><SpcAlarmsPanel/><SpcChartsClient/></>;
      else if(screen==='die-spc')node=<SpcDiePanel dieId={o.die}/>;
      else if(screen==='die')node=<><DieAvailabilityPanel dieId={o.die} role={o.role||'production_manager'} today={o.today}/><DieConflictsPanel/>{o.job?<JobDieWarnings jobId={o.job}/>:null}</>;
      else if(screen==='health')node=<><AtRiskCustomers/>{o.customer?<CustomerHealthPanel customerId={o.customer}/>:null}</>;
      else if(screen==='capacity')node=<><QuoteCapacityPanel quoteId={o.quote} canRecord={o.canRecord!=='false'}/><ProfileCapacityHint profileId={o.profile} quantityKg={Number(o.kg||0)} finishingType='mill_finish'/><CapacityAccuracy/></>;
      else if(screen==='views')node=<Views o={o}/>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-5xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Batch 8 fixture: {screen}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    if(qs.get('screen'))window.mount(qs.get('screen'),qs.get('user')||window.ids.owner,Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "batch8-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "batch8-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    const body = Buffer.concat(chunks);
    try {
      if (path === "/call") {
        const { module, name, args, actor } = JSON.parse(body.toString("utf8"));
        const target = modules[module];
        json(response, 200, await serialized(async () => { await as(target, actor); return target.actions[name](...args); }));
      } else if (path === "/api/saved-views") {
        // The real route only forwards to these actions; here they run as the signed-in fixture user.
        const { command, payload } = JSON.parse(body.toString("utf8")); const actor = url.searchParams.get("actor") ?? request.headers["x-actor"];
        const fn = { list: "listViewsAction", default: "defaultViewAction", save: "saveViewAction", set_default: "setDefaultViewAction", clear_default: "clearDefaultViewAction", delete: "deleteViewAction" }[command];
        const arg = ["save"].includes(command) ? payload : ["set_default", "delete"].includes(command) ? payload.id : payload.page_key;
        json(response, 200, await serialized(async () => { await as(modules.views, actor); return modules.views.actions[fn](arg); }));
      } else if (path === "/upload") {
        modules.batch8.state.storage[`${url.searchParams.get("bucket")}/${url.searchParams.get("path")}`] = new Uint8Array(body);
        json(response, 200, { ok: true });
      } else if (path === "/api/pdf/batch") {
        const request = JSON.parse(body.toString("utf8")); printRequests.push(request);
        const pdf = await PDFDocument.create(); for (let n = 0; n < (request.ids ?? [request.date]).length; n++) pdf.addPage();
        response.setHeader("content-type", "application/pdf"); response.end(Buffer.from(await pdf.save()));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Batch 8 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.BATCH8_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, printRequests, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
