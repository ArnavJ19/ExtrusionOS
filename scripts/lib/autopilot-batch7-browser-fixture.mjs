import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createBatch7Fixture, ids } from "./autopilot-batch7-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 7 screens. The real gateway server action (lib/actions/autopilot.ts), the purchase price
// action (lib/actions/purchase-lifecycle.ts) and the statement email action (lib/actions/autopilot-batch7.ts) run against
// the replayed local SQL as the chosen employee. Scanner resolution (lib/actions/scan) is a browser stub that knows the
// labels listed in window.labels, so the keyboard-wedge flow is exercised without a QR table.
export async function createBatch7BrowserFixture() {
  const f = await createBatch7Fixture();
  const modules = { autopilot: createNov7ActionsFixture("../../lib/actions/autopilot.ts"), purchase: createNov7ActionsFixture("../../lib/actions/purchase-lifecycle.ts"),
    batch7: createNov7ActionsFixture("../../lib/actions/autopilot-batch7.ts") };
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
  const post = (module, name) => `async function(...args){const response=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({module:'${module}',name:'${name}',args,actor:window.config.userId})});return response.json()}`;
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "sonner": "export const toast={success:t=>window.toasts.push(['ok',t]),error:t=>window.toasts.push(['error',t])};",
    "@/lib/actions/autopilot": `export const autopilotAction=async(rpc,command,payload={})=>{window.calls.push({rpc,command});return (${post("autopilot", "autopilotAction")})(rpc,command,payload)};`,
    "@/lib/actions/purchase-lifecycle": `export const purchasePriceAction=${post("purchase", "purchasePriceAction")};export async function purchaseLifecycleAction(){return {success:false,error:'Not used in this fixture'}};export async function extractSupplierDocumentAction(){return {success:false,error:'Not used'}};`,
    "@/lib/actions/autopilot-batch7": `export const emailStatementAction=${post("batch7", "emailStatementAction")};`,
    "@/lib/actions/scan": "export async function resolveScanAction(raw){window.scans.push(raw);const hit=(window.labels||{})[raw];return hit?{ok:true,qrId:null,warnings:[],details:{},...hit}:{ok:false,error:'No current record uses this code. Check the label, or search for the record instead.'}}"
  };
  const entry = `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {QualityClient} from './components/modules/autopilot-batch7/quality';
    import {PricesClient} from './components/modules/autopilot-batch7/prices';
    import {PriceCheck,OrderPriceChecks} from './components/modules/vendors/purchase-price-check';
    import {DelayQueueClient,OrderDelayPanel} from './components/modules/autopilot-batch7/delay';
    import {StatementsClient} from './components/modules/autopilot-batch7/statements';
    import {DateRangeFilter} from './components/data/data-table-toolbar';
    import {SearchableSelect} from './components/ui/searchable-select';
    import {RecentScopeProvider} from './components/ui/recent-scope';
    import {WedgeScanner} from './components/ui/wedge-scanner';
    import {AttachmentDropZone} from './components/ui/attachment-drop-zone';
    import {PincodeInput} from './components/ui/pincode-input';
    import {LengthUnitInput} from './components/modules/shared/length-unit-input';
    window.ids=${JSON.stringify(ids)};Object.assign(window,{calls:[],refreshes:0,navigations:[],toasts:[],scans:[],attached:[],labels:{}});
    const root=createRoot(document.getElementById('app'));
    window.config={userId:window.ids.owner};
    function Line(){const [d,setD]=useState('');const [u,setU]=useState('kg');const [r,setR]=useState('');const [reason,setReason]=useState('');const [flag,setFlag]=useState(false);
      return <fieldset className='grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-6'><legend>Line 1</legend>
        <label className='sm:col-span-3'>Material / service<input className='form-input' value={d} onChange={e=>setD(e.target.value)}/></label>
        <label>Unit<select className='form-input' value={u} onChange={e=>setU(e.target.value)}>{['kg','m','piece','set','box','lot'].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Rate INR / unit<input className='form-input' value={r} onChange={e=>setR(e.target.value)}/></label>
        <PriceCheck description={d} unit={u} vendorId={window.ids.transporter} rate={r} reason={reason} onReason={setReason} onFlag={setFlag}/>
        <p data-testid='flag'>{flag?'flagged':'clear'}</p></fieldset>}
    function Shared(){const [from,setFrom]=useState('');const [to,setTo]=useState('');const [pick,setPick]=useState('');const [src,setSrc]=useState('');const [pin,setPin]=useState('');const [state,setState]=useState('');const [city,setCity]=useState('');const [m,setM]=useState(5.8);const [text,setText]=useState(null);
      const customers=['Sharma Fabricators','Patel Aluminium','Mehta Windows','Kaur Systems','Iyer Glass','Rao Facades','Das Doors'].map((label,n)=>({value:'c'+n,label}));
      const sources=[{value:'src-job',label:'Sliding track | production JOB-1 | 600 kg',scanIds:['src-job','job-1']},{value:'src-stock',label:'Sliding track | reservation B-7 | 120 kg',scanIds:['src-stock','batch-7']}];
      return <div className='space-y-4'>
        <section><h2>Dates</h2><DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onRangeChange={(a,b)=>{setFrom(a);setTo(b)}}/><p data-testid='range'>{from}|{to}</p></section>
        <section><h2>Customer</h2><SearchableSelect ariaLabel='Customer' value={pick} options={customers} onChange={setPick}/><p data-testid='pick'>{pick}</p></section>
        <section><h2>Bundle source</h2><SearchableSelect ariaLabel='Exact material source' placeholder='Select production job or stock batch' recentKey={false} value={src} options={sources} onChange={setSrc} scanAccept={['inventory_batch','production_job']}/><p data-testid='src'>{src}</p></section>
        <section><h2>Notes</h2><input aria-label='Notes' className='form-input'/></section>
        <section><h2>Attachment</h2><AttachmentDropZone label='Choose, drop or paste a file' accept='image/png,image/jpeg,application/pdf' onFile={file=>{window.attached.push(file.name+':'+file.type+':'+file.size)}}/></section>
        <section><h2>Address</h2><label>PIN code<PincodeInput value={pin} onChange={setPin} state={state} onState={setState} city={city} onCity={setCity}/></label><label>State<input aria-label='State' className='form-input' value={state} onChange={e=>setState(e.target.value)}/></label></section>
        <section><h2>Length</h2><LengthUnitInput metres={m} onChange={setM} text={text} onTextChange={setText}/><p data-testid='length'>{m}|{text}</p></section>
      </div>}
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;window.pathname=o.pathname||'/'+screen;root.render(<p>Loading</p>);let node;
      if(screen==='quality')node=<QualityClient canRecord={o.canRecord!==false}/>;
      else if(screen==='prices')node=<PricesClient canSetThreshold={o.canSet!==false}/>;
      else if(screen==='po-line')node=<Line/>;
      else if(screen==='po-checks')node=<OrderPriceChecks orderId={o.orderId} canJustify={o.canJustify!==false}/>;
      else if(screen==='delay')node=<DelayQueueClient canSend={o.canSend!==false} canPrepare={o.canPrepare!==false}/>;
      else if(screen==='order-delay')node=<OrderDelayPanel orderId={o.orderId}/>;
      else if(screen==='statements')node=<StatementsClient/>;
      else if(screen==='shared')node=<Shared/>;
      root.render(<RecentScopeProvider scope={'company:'+userId}><WedgeScanner/><main key={Date.now()} className='mx-auto min-w-0 max-w-5xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Batch 7 fixture: {screen}</h1>{node}</main></RecentScopeProvider>);
    };
    const qs=new URLSearchParams(location.search);
    if(qs.get('screen'))window.mount(qs.get('screen'),qs.get('user')||window.ids.owner,Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "batch7-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "batch7-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const pinTable = readFileSync("public/data/pin-prefixes.json", "utf8");
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    try {
      if (path === "/call") {
        const { module, name, args, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const target = modules[module];
        json(response, 200, await serialized(async () => { await as(target, actor); return target.actions[name](...args); }));
      } else if (path === "/data/pin-prefixes.json") { response.setHeader("content-type", "application/json"); response.end(pinTable); }
      else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Batch 7 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.BATCH7_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
