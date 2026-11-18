import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createBatch9Fixture, ids } from "./autopilot-batch9-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 9 screens. The real gateway action (lib/actions/autopilot.ts) and the batch 9 readers
// (lib/actions/autopilot-batch9.ts) run against the replayed local SQL as the chosen employee. Uploads land in the
// fixture's synthetic storage, where the actions read them back. Search pickers read through /pick (the same company
// filter row security applies). The packing scale is a synthetic Web Serial port that streams indicator lines.
export async function createBatch9BrowserFixture() {
  const f = await createBatch9Fixture();
  const modules = { autopilot: createNov7ActionsFixture("../../lib/actions/autopilot.ts"), batch9: createNov7ActionsFixture("../../lib/actions/autopilot-batch9.ts") };
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const rpcFor = actor => async (name, body) => {
    try { return { data: await f.call(name, body.p_command, body.p_payload, actor), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  async function as(fixture, actor) {
    const user = (await f.db.query("select company_id,role,is_active,dealer_id,full_name from app_users where id=$1", [actor])).rows[0];
    fixture.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null, fullName: user?.full_name }; fixture.state.authenticated = !!user?.is_active;
    fixture.state.rpcHandler = rpcFor(actor);
    fixture.state.storage = modules.batch9.state.storage;
  }
  const post = (module, name) => `async function(...args){const response=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({module:'${module}',name:'${name}',args,actor:window.config.userId})});return response.json()}`;
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/autopilot": `export const autopilotAction=async(rpc,command,payload={})=>{window.calls.push({rpc,command});return (${post("autopilot", "autopilotAction")})(rpc,command,payload)};`,
    "@/lib/actions/autopilot-batch9": ["pasteEnquiryAction", "createRegisterCaptureAction", "storedFileUrlAction", "readProfileDrawingAction", "enquiryQuoteDraftAction", "linkEnquiryQuoteAction"].map(n => `export const ${n}=${post("batch9", n)};`).join(""),
    "@/lib/actions/workstation": "export async function workstationAction(input){if(input.command==='stations.list')return {success:true,data:{kind:'stations',items:[{id:'00000000-0000-4000-8000-000000000901',name:'Press 1 (1800 T)'}]}};return {success:false,error:'Not part of the fixture'}}export async function switchWorkstationOperatorAction(){return {success:false,error:'Not part of the fixture'}}",
    "@/lib/utils/files": "export async function uploadTenantFile(bucket,companyId,folder,file){const path=companyId+'/'+folder+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'-');const r=await fetch('/upload?bucket='+bucket+'&path='+encodeURIComponent(path),{method:'POST',body:await file.arrayBuffer()});if(!r.ok)throw Error('upload');window.uploads.push(path);return path}",
    "@/lib/supabase/browser": "export function createClient(){return {from(table){const q={table,term:''};const b={select(){return b},eq(){return b},is(){return b},order(){return b},limit(){return b},or(v){q.term=(/ilike\\.\\*([^*]*)\\*/.exec(v)||[])[1]||'';return b},ilike(f,v){q.term=String(v).replace(/%/g,'');return b},then(res,rej){return fetch('/pick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(q)}).then(r=>r.json()).then(res,rej)}};return b}}}"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {RateCardsClient,RateCardRecord} from './components/modules/autopilot-batch9/rate-cards';
    import {ScrapOffers,ScrapSaleRecord} from './components/modules/autopilot-batch9/scrap-sales';
    import {InvoiceWeightPanel,WeightNotesQueue,WeightTolerances} from './components/modules/autopilot-batch9/weight-notes';
    import {CashForecastClient} from './components/modules/autopilot-batch9/cash-forecast';
    import {PasteEnquiry,EnquiryList,EnquiryRecord} from './components/modules/autopilot-batch9/enquiries';
    import {NewRegisterCapture,RegisterList,RegisterRecord} from './components/modules/autopilot-batch9/registers';
    import {BundleWeightsClient} from './components/modules/autopilot-batch9/bundle-weights';
    import {ScaleCapture} from './components/modules/autopilot-batch9/scale-capture';
    import {DrawingGeometryPanel} from './components/modules/autopilot-batch9/drawing-geometry';
    import {ProposalCards} from './components/modules/autopilot/proposal-cards';
    import {Workstation} from './components/modules/production/workstation';
    window.ids=${JSON.stringify(ids)};Object.assign(window,{calls:[],refreshes:0,navigations:[],uploads:[],captures:[]});
    // A synthetic packing-scale indicator: settles on 120.00 kg after a moment of motion.
    let tick=0;Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async()=>({open:async()=>{},close:async()=>{},getInfo:()=>({usbVendorId:0x1a86,usbProductId:0x7523}),
      readable:new ReadableStream({start(c){const enc=new TextEncoder();const t=setInterval(()=>{tick++;c.enqueue(enc.encode(tick<4?'US,GS,+0118.40kg\\r\\n':'ST,GS,+0120.00kg\\r\\n'))},150);window.stopScale=()=>clearInterval(t)}})})}});
    const realFetch=window.fetch.bind(window);window.fetch=(input,init={})=>String(input).startsWith('/api/')?realFetch(input,{...init,headers:{...(init.headers||{}),'x-actor':window.config.userId}}):realFetch(input,init);
    const root=createRoot(document.getElementById('app'));window.config={userId:window.ids.owner};
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;window.pathname='/'+screen;let node;
      if(screen==='rate-cards')node=<RateCardsClient canMake={o.canMake!=='false'}/>;
      else if(screen==='rate-card')node=<RateCardRecord id={o.id} canShare={true}/>;
      else if(screen==='scrap')node=<ScrapOffers canManage={o.canManage!=='false'}/>;
      else if(screen==='scrap-sale')node=<ScrapSaleRecord id={o.id} canManage={true} canMoney={o.money==='true'}/>;
      else if(screen==='weight')node=<><InvoiceWeightPanel invoiceId={o.invoice} canDecide={o.decide==='true'}/><WeightNotesQueue canDecide={o.decide==='true'}/><WeightTolerances canSet={true}/></>;
      else if(screen==='cash')node=<CashForecastClient/>;
      else if(screen==='enquiries')node=<><PasteEnquiry/><EnquiryList/></>;
      else if(screen==='enquiry')node=<EnquiryRecord id={o.id} canQuote={o.quote!=='false'}/>;
      else if(screen==='registers')node=<><NewRegisterCapture companyId={window.ids.company} today={o.today}/><RegisterList/></>;
      else if(screen==='register')node=<RegisterRecord id={o.id} canConfirm={o.confirm!=='false'}/>;
      else if(screen==='scale')node=<><ScaleCapture lang={o.lang||'en'} onCapture={v=>window.captures.push(v)}/><BundleWeightsClient/></>;
      else if(screen==='arrivals')node=<ProposalCards type='stock.reservation' initial={null} today={o.today} title='Reserve arriving stock'/>;
      else if(screen==='geometry')node=<DrawingGeometryPanel companyId={window.ids.company} profileId={o.profile} canUpload={true} canSetDensity={true} today={o.today}/>;
      else if(screen==='workstation')node=<Workstation companyId={window.ids.company} userId={userId} operatorName='Fixture operator' today={o.today} lang={o.lang||'en'}/>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-6xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Batch 9 fixture: {screen}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    const go=()=>window.mount(qs.get('screen'),qs.get('user')||window.ids.owner,Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
    window.remount=go;
    if(qs.get('screen'))go();
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "batch9-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "batch9-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const pick = async ({ table, term }) => {
    const t = `%${String(term ?? "").toLowerCase()}%`;
    if (table === "customers") return (await f.db.query("select id, customer_name, company_name, city from customers where company_id=$1 and is_active and deleted_at is null and lower(customer_name||' '||coalesce(company_name,'')) like $2 order by customer_name limit 10", [ids.company, t])).rows;
    if (table === "aluminium_profiles") return (await f.db.query("select id, profile_code, profile_name, section_weight_kg_per_m from aluminium_profiles where company_id=$1 and is_active and deleted_at is null and lower(profile_code||' '||profile_name) like $2 order by profile_code limit 10", [ids.company, t])).rows;
    return (await f.db.query("select id, machine_name, machine_code from machines where company_id=$1 and is_active and machine_type='extrusion_press' and lower(machine_name) like $2 order by machine_name limit 20", [ids.company, t])).rows;
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    const body = Buffer.concat(chunks);
    try {
      if (path === "/call") {
        const { module, name, args, actor } = JSON.parse(body.toString("utf8"));
        const target = modules[module];
        json(response, 200, await serialized(async () => { await as(target, actor); return target.actions[name](...args); }));
      } else if (path === "/api/floor-language") {
        const { language } = JSON.parse(body.toString("utf8")); const actor = request.headers["x-actor"];
        json(response, 200, await serialized(async () => { await as(modules.autopilot, actor); return modules.autopilot.actions.autopilotAction("ap_language", "set", { language }); }));
      } else if (path === "/pick") {
        const q = JSON.parse(body.toString("utf8"));
        json(response, 200, { data: await serialized(() => pick(q)), error: null });
      } else if (path === "/upload") {
        modules.batch9.state.storage[`${url.searchParams.get("bucket")}/${url.searchParams.get("path")}`] = new Uint8Array(body);
        json(response, 200, { ok: true });
      } else if (path.startsWith("/files/")) {
        const key = decodeURIComponent(path.slice("/files/".length)); const bytes = modules.batch9.state.storage[key];
        if (!bytes) { response.statusCode = 404; response.end(); return; }
        response.setHeader("content-type", key.endsWith(".png") ? "image/png" : key.endsWith(".pdf") ? "application/pdf" : "image/jpeg"); response.end(Buffer.from(bytes));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Batch 9 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.BATCH9_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, storage: modules.batch9.state.storage, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
