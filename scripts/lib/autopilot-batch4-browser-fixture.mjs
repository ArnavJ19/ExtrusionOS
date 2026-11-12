import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createDispatchFixture, dIds } from "./autopilot-batch4-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";
import { EWAY_SCHEMA_VERSION, buildEwayExport } from "../../lib/compliance/eway-bill.ts";
import { buildTallyExport } from "../../lib/integrations/tally-xml.ts";

// Mounts the Autopilot batch 4 screens (loading by scan, gate, ready list, label station, packing, freight, e-way bills,
// Tally, summaries and status links). The real gateway server action (lib/actions/autopilot.ts) runs against the
// replayed local SQL as the chosen employee. The three multi-step actions in lib/actions/dispatch-autopilot.ts are
// reproduced here with the same steps: completing a load runs the real dispatch writer (save_ready_dispatch_atomic) on
// the scanned bundles; the export actions build the files with the same lib modules and record them through the RPC.
export async function createDispatchBrowserFixture() {
  const f = await createDispatchFixture();
  const a = createNov7ActionsFixture("../../lib/actions/autopilot.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const supabaseFor = actor => ({ rpc: async (name, payload) => {
    try { return { data: await f.call(name, payload.p_command, payload.p_payload, actor), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } });
  const post = (path) => `async function(input){const response=await fetch('${path}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input,actor:window.config.userId})});return response.json()}`;
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/autopilot": "export async function autopilotAction(rpc,command,payload={}){window.calls.push({rpc,command});const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rpc,command,payload,actor:window.config.userId})});return response.json()}",
    "@/lib/actions/dispatch-autopilot": `export const completeLoadingAction=${post("/complete-loading")};export const exportEwayAction=${post("/export-eway")};export const exportTallyAction=${post("/export-tally")};`
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {LoadingSessionsClient,LoadingStation,OrderLoadingPanel} from './components/modules/dispatch-autopilot/loading';
    import {GateClient,ReadyToShipClient} from './components/modules/dispatch-autopilot/gate';
    import {LabelStationClient} from './components/modules/dispatch-autopilot/labels';
    import {PackingClient,PackingPlanPanel,PackingSpecPanel} from './components/modules/dispatch-autopilot/packing';
    import {FreightCardsClient,FreightPanel} from './components/modules/dispatch-autopilot/freight';
    import {EwayClient} from './components/modules/dispatch-autopilot/eway';
    import {TallyClient} from './components/modules/dispatch-autopilot/tally';
    import {CopySummaryButton,OrderStatusLinkPanel} from './components/modules/dispatch-autopilot/share';
    window.ids=${JSON.stringify(dIds)};Object.assign(window,{calls:[],refreshes:0,navigations:[],downloads:[],prints:0});
    window.print=()=>{window.prints++;setTimeout(()=>window.dispatchEvent(new Event('afterprint')),50)};
    const realCreate=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{blob.text().then(t=>window.downloads.push(t));return realCreate(blob)};
    const root=createRoot(document.getElementById('app'));
    window.config={userId:window.ids.owner};
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;root.render(<p>Loading</p>);let node;
      if(screen==='loads')node=<LoadingSessionsClient/>;
      else if(screen==='station')node=<LoadingStation sessionId={o.sessionId} today={o.today}/>;
      else if(screen==='order')node=<><CopySummaryButton kind='order' id={o.orderId} canInternal={o.internal!==false}/><OrderLoadingPanel orderId={o.orderId}/><PackingPlanPanel orderId={o.orderId}/><OrderStatusLinkPanel orderId={o.orderId}/></>;
      else if(screen==='gate')node=<GateClient supervisor={Boolean(o.supervisor)} canGate={o.canGate!==false}/>;
      else if(screen==='ready')node=<ReadyToShipClient canLoad={true}/>;
      else if(screen==='labels')node=<LabelStationClient supervisor={Boolean(o.supervisor)}/>;
      else if(screen==='packing')node=<PackingClient canEditSpec={true}/>;
      else if(screen==='spec')node=<PackingSpecPanel customerId={o.customerId}/>;
      else if(screen==='freight')node=<FreightCardsClient/>;
      else if(screen==='dispatch')node=<><CopySummaryButton kind='dispatch' id={o.dispatchId} canInternal={true}/><FreightPanel kind='dispatch' id={o.dispatchId} today={o.today}/></>;
      else if(screen==='quote')node=<FreightPanel kind='quote' id={o.quoteId} today={o.today}/>;
      else if(screen==='eway')node=<EwayClient/>;
      else if(screen==='tally')node=<TallyClient/>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-5xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Dispatch fixture: {screen}</h1>{node}</main>);
    };
    // Preview: /?screen=gate&user=<id>&sessionId=... mounts a screen directly (used for the in-app browser check).
    const qs=new URLSearchParams(location.search);
    if(qs.get('screen'))window.mount(qs.get('screen'),qs.get('user')||window.ids.owner,{today:new Date(Date.now()+19800000).toISOString().slice(0,10),...Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k)))});
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "dispatch-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "dispatch-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const fail = error => ({ success: false, error: String(error.message ?? "").replace(/^AP: /, "") });

  async function completeLoading({ sessionId }, actor) {
    try {
      const data = await f.ap("ap_dispatch", "bundles_for_dispatch", { id: sessionId }, actor);
      const dispatchId = data.already_dispatched ?? await f.writeDispatch(sessionId, actor);
      await f.ap("ap_dispatch", "complete", { id: sessionId, dispatch_id: dispatchId }, actor);
      return { success: true, data: { dispatchId } };
    } catch (error) { return fail(error); }
  }
  async function exportEway(ids, actor) {
    try {
      const built = buildEwayExport(await f.ap("ap_eway", "sources", { dispatch_ids: ids }, actor));
      const skipped = built.skipped.map(s => ({ dispatch_number: s.source.dispatch_number, issues: s.issues }));
      if (!built.included.length) return { success: true, data: { json: "", filename: "", included: [], skipped } };
      const text = JSON.stringify(built.file, null, 2);
      await f.ap("ap_eway", "record_export", { schema_version: EWAY_SCHEMA_VERSION, file_sha256: createHash("sha256").update(text).digest("hex"),
        docs: built.included.map(s => ({ dispatch_id: s.dispatch_id, doc_no: s.invoice.number, doc_date: s.invoice.date, total_value: s.invoice.total })) }, actor);
      return { success: true, data: { json: text, filename: "eway-bills.json", included: built.included.map(s => ({ dispatch_number: s.dispatch_number, doc_no: s.invoice.number })), skipped } };
    } catch (error) { return fail(error); }
  }
  async function exportTally(input, actor) {
    try {
      const data = await f.ap("ap_tally", "vouchers_data", input, actor);
      const built = buildTallyExport(data.company?.name ?? "Omalco", data.vouchers ?? [], data.mappings ?? []);
      const byKind = built.exported.reduce((acc, v) => { acc[v.kind] = (acc[v.kind] ?? 0) + 1; return acc; }, {});
      if (!built.exported.length) return { success: true, data: { xml: "", filename: "", exported: 0, issues: built.issues, byKind } };
      await f.ap("ap_tally", "record_export", { ...input, file_sha256: createHash("sha256").update(built.xml).digest("hex"), vouchers: built.exported.map(v => ({ kind: v.kind, id: v.id })) }, actor);
      return { success: true, data: { xml: built.xml, filename: "tally.xml", exported: built.exported.length, issues: built.issues, byKind } };
    } catch (error) { return fail(error); }
  }

  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    try {
      if (path === "/action") {
        const { rpc, command, payload, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = await serialized(async () => {
          const user = (await f.db.query("select company_id,role,is_active,dealer_id from app_users where id=$1", [actor])).rows[0];
          a.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null }; a.state.authenticated = !!user?.is_active;
          a.state.rpcHandler = async (name, body) => supabaseFor(actor).rpc(name, body);
          return a.actions.autopilotAction(rpc, command, payload);
        });
        json(response, 200, result);
      } else if (["/complete-loading", "/export-eway", "/export-tally"].includes(path)) {
        const { input, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const result = await serialized(() => path === "/complete-loading" ? completeLoading(input, actor) : path === "/export-eway" ? exportEway(input, actor) : exportTally(input, actor));
        json(response, 200, result);
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Dispatch fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.DISPATCH_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
