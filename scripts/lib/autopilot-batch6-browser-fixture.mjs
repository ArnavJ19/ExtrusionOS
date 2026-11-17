import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { addBatch6Helpers, createBatch6Fixture, createFloorFixture, ids as opsIds, pIds } from "./autopilot-batch6-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 6 screens. The real gateway server action (lib/actions/autopilot.ts) and the real batch 6
// actions (lib/actions/autopilot-batch6.ts: e-invoice export/IRN import, TDS statement import, billet options/choice)
// run against the replayed local SQL as the chosen employee. kind "ops" uses the order-to-cash/operations data;
// kind "floor" uses the press-floor data (presses, running and planned jobs, an open station session).
export async function createBatch6BrowserFixture(kind = "ops") {
  const f = kind === "floor" ? await createFloorFixture() : await createBatch6Fixture();
  const ids = kind === "floor" ? pIds : opsIds;
  const a = createNov7ActionsFixture("../../lib/actions/autopilot.ts");
  const b = createNov7ActionsFixture("../../lib/actions/autopilot-batch6.ts");
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
  const post = name => `async function(...args){const response=await fetch('/b6',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'${name}',args,actor:window.config.userId})});return response.json()}`;
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/autopilot": "export async function autopilotAction(rpc,command,payload={}){window.calls.push({rpc,command});const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rpc,command,payload,actor:window.config.userId})});return response.json()}",
    "@/lib/actions/autopilot-batch6": ["exportEinvoiceAction", "importIrnAction", "importTdsStatementAction", "billetOptionsAction", "chooseBilletLengthAction"].map(n => `export const ${n}=${post(n)};`).join(""),
    "@/lib/actions/physical-bundles": "export async function recordPhysicalBundleAction(){return {success:false,error:'Not used in this fixture'}};export async function listPhysicalBundlesAction(){return {success:true,data:{items:[]}}}"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {WeightDriftList,DieWeightPanel} from './components/modules/autopilot-batch6/weight';
    import {RepriceClient,RepriceRun} from './components/modules/autopilot-batch6/reprice';
    import {SystemHealth} from './components/modules/autopilot-batch6/health';
    import {ReorderClient} from './components/modules/autopilot-batch6/reorder';
    import {NcrClient,NcrRecord,ComplaintForm} from './components/modules/autopilot-batch6/ncr';
    import {TdsClient} from './components/modules/autopilot-batch6/tds';
    import {EinvoiceClient} from './components/modules/autopilot-batch6/einvoice';
    import {BilletLengthPanel,PressBilletSettings} from './components/modules/autopilot-batch6/billet-length';
    import {PressPlanDraft} from './components/modules/autopilot-batch6/press-plan';
    import {PressStation} from './components/modules/press/press-station';
    window.ids=${JSON.stringify(ids)};Object.assign(window,{calls:[],refreshes:0,navigations:[],downloads:[],prints:0});
    window.print=()=>{window.prints++};
    const realCreate=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{blob.text().then(t=>window.downloads.push(t));return realCreate(blob)};
    const root=createRoot(document.getElementById('app'));
    window.config={userId:window.ids.owner};
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;root.render(<p>Loading</p>);let node;
      if(screen==='weight')node=<WeightDriftList canSet={true}/>;
      else if(screen==='die-weight')node=<DieWeightPanel dieId={o.dieId} today={o.today}/>;
      else if(screen==='reprice')node=<RepriceClient canApply={o.canApply!==false}/>;
      else if(screen==='reprice-run')node=<RepriceRun id={o.runId}/>;
      else if(screen==='health')node=<SystemHealth/>;
      else if(screen==='reorder')node=<ReorderClient canApprove={true}/>;
      else if(screen==='ncrs')node=<NcrClient canDecide={true} canSetThresholds={true}/>;
      else if(screen==='ncr')node=<NcrRecord id={o.ncrId} canDecide={true}/>;
      else if(screen==='complaint')node=<ComplaintForm customerId={o.customerId} orderId={o.orderId}/>;
      else if(screen==='tds')node=<TdsClient today={o.today} customers={o.customers||[]}/>;
      else if(screen==='einvoice')node=<EinvoiceClient today={o.today}/>;
      else if(screen==='billet')node=<><BilletLengthPanel jobId={o.jobId} canChoose={true}/><PressBilletSettings/></>;
      else if(screen==='plan')node=<PressPlanDraft canEdit={o.canEdit!==false}/>;
      else if(screen==='station')node=<PressStation companyId={o.companyId} userId={userId} sessionId={o.sessionId} today={o.today} onExpired={()=>{}} onRenewed={()=>{}}/>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-5xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Batch 6 fixture: {screen}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    if(qs.get('screen'))window.mount(qs.get('screen'),qs.get('user')||window.ids.owner,{today:new Date(Date.now()+19800000).toISOString().slice(0,10),...Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k)))});
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "batch6-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "batch6-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    try {
      if (path === "/action") {
        const { rpc, command, payload, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        json(response, 200, await serialized(async () => { await as(a, actor); return a.actions.autopilotAction(rpc, command, payload); }));
      } else if (path === "/b6") {
        const { name, args, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        json(response, 200, await serialized(async () => { await as(b, actor); return b.actions[name](...args); }));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Batch 6 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.BATCH6_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
export { addBatch6Helpers };
