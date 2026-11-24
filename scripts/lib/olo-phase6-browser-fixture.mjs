import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createDispatchFixture, dIds as ids } from "./autopilot-batch4-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the order lifecycle Phase 6 client screens in English or Hindi: sending packed bundles to the finished-goods
// area, scanning a transfer in (and closing it short or cancelling it) and a bundle trace summary. The real server
// action (packagingFlowAction in lib/actions/orchestration.ts) runs against the replayed local SQL as the chosen
// employee, on top of the dispatch fixture. Synthetic data only; no hosted database is involved.
export async function createOloPhase6BrowserFixture() {
  const f = await createDispatchFixture();
  const orchestration = createNov7ActionsFixture("../../lib/actions/orchestration.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const rpcFor = actor => async (name, body) => {
    try {
      if (body && "p_command" in body) return { data: await f.call(name, body.p_command, body.p_payload, actor), error: null };
      return { data: null, error: { code: "42883", message: "not mounted" } };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  async function as(actor) {
    const user = (await f.db.query("select company_id,role,is_active,dealer_id,full_name from app_users where id=$1", [actor])).rows[0];
    orchestration.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null, fullName: user?.full_name };
    orchestration.state.authenticated = !!user?.is_active; orchestration.state.rpcHandler = rpcFor(actor);
  }
  const ORCH = ["packagingFlowAction"];
  const proxy = names => names.map(name => `export const ${name}=async(...args)=>{window.calls.push({fn:'${name}'});const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn:'${name}',args,actor:window.config.userId})});return r.json()};`).join("");
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++;window.remount?.()},push:href=>{window.navigations.push(href);const m=href.match(/fg-transfers\\/([0-9a-f-]{36})/);if(m)window.mount('transfer',window.config.userId,{id:m[1],lang:window.config.lang})},replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/orchestration": proxy(ORCH)
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {FgSendForm,FgReceivePanel,FgCloseForm} from './components/modules/orchestration/packaging-flow-forms';
    import {fgCandidatesSchema,fgLocationsSchema,fgTransferSchema,bundleLookupSchema} from './lib/workflow/packaging-flow';
    import {floorText} from './lib/i18n/floor';
    Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));window.config={userId:'',lang:'en'};
    const call=async(fn,input)=>{const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn,args:[input],actor:window.config.userId})});return r.json()};
    const kg=n=>Number(n).toLocaleString('en-IN',{maximumFractionDigits:3})+' kg';
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;const lang=o.lang==='hi'?'hi':'en';window.config.lang=lang;const t=floorText(lang);let node;let title=screen;
      if(screen==='send'){title=t('pkf.fg.newTitle');
        const [l,c]=await Promise.all([call('packagingFlowAction',{command:'fg.locations'}),call('packagingFlowAction',{command:'fg.candidates'})]);
        node=l.success&&c.success?<FgSendForm lang={lang} locations={fgLocationsSchema.parse(l.data).rows} candidates={fgCandidatesSchema.parse(c.data).rows}/>:<p role='alert'>{l.error||c.error}</p>;}
      else if(screen==='transfer'){const r=await call('packagingFlowAction',{command:'fg.get',transfer_id:o.id});
        const d=r.success?fgTransferSchema.parse(r.data):null;title=d?t('pkf.fg.detailTitle',{number:d.transfer_number}):'transfer';
        node=d?<div className='space-y-3'>
          <p className='rounded-2xl border bg-white p-4 text-sm font-semibold'>{t('pkf.status.'+d.status)} · {t('pkf.fg.progress',{received:d.received,remaining:d.remaining,missing:d.missing})}</p>
          {d.status==='in_transit'&&d.can_receive?<FgReceivePanel lang={lang} transferId={d.id} remaining={d.remaining}/>:d.status==='in_transit'?<p className='rounded-2xl border bg-white p-4 text-sm'>{t('pkf.fg.notReceiver')}</p>:null}
          {d.status==='in_transit'?<div className='flex flex-wrap gap-2'>{d.can_receive&&d.received>0?<FgCloseForm lang={lang} transferId={d.id} mode='close'/>:null}{d.can_cancel?<FgCloseForm lang={lang} transferId={d.id} mode='cancel'/>:null}</div>:null}
          <ul className='space-y-1 rounded-2xl border bg-white p-4 text-sm'>{d.lines.map(x=><li key={x.bundle_id}><b className='font-mono'>{x.bundle_number}</b> · {x.order_number} · {kg(x.net_kg)} · {t('pkf.line.'+x.state)}{x.received_by_name?' · '+x.received_by_name:''}</li>)}</ul>
        </div>:<p role='alert'>{r.error}</p>;}
      else if(screen==='trace'){const r=await call('packagingFlowAction',{command:'bundle.trace',tag:o.tag});
        const d=r.success?bundleLookupSchema.parse(r.data):null;title=t('pkf.t.title',{tag:o.tag});
        node=d&&d.found?<div className='space-y-2 text-sm'><p className='font-bold'>{t('pkf.state.'+d.bundle.state)} · {d.order.order_number} · {d.job?.job_number} · {kg(d.bundle.net_kg)}</p>
          <p>{t('pkf.t.custody')}: {d.custody.map(x=>x.transfer_number+' '+t('pkf.line.'+x.state)).join(', ')||t('pkf.t.noCustody')}</p>
          <p>{t('pkf.t.dispatch')}: {d.dispatch?.dispatch_number??t('pkf.t.notDispatched')} · {t('pkf.t.invoice')}: {d.invoice?.invoice_number??t('pkf.t.noInvoice')}</p>
          <h2 className='font-bold'>{t('pkf.t.gaps')}</h2><ul className='list-disc pl-5 text-amber-900'>{d.gaps.map(g=><li key={g}>{g}</li>)}</ul></div>:<p role='alert'>{r.error||t('pkf.b.notFound',{tag:o.tag})}</p>;}
      root.render(<main key={Date.now()} lang={lang} className='mx-auto min-w-0 max-w-4xl space-y-5 p-4'><h1 className='text-2xl font-bold'>{title}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    const go=()=>window.mount(qs.get('screen'),qs.get('user'),Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
    window.remount=()=>{const m=window.navigations.at(-1);if(!m)go();else window.mount(window.currentScreen?.screen??qs.get('screen'),window.config.userId,window.currentScreen?.o??{})};
    const mount=window.mount;window.mount=(s,u,o={})=>{window.currentScreen={screen:s,o};return mount(s,u,o)};
    if(qs.get('screen'))go();
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "olo-phase6-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "olo-phase6-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }, "./components/modules/orchestration/packaging-flow-forms.tsx"] })])
    .process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    try {
      if (path === "/call") {
        const { fn, args, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!ORCH.includes(fn)) { json(response, 400, { success: false, error: "Unknown action" }); return; }
        json(response, 200, await serialized(async () => { await as(actor); return orchestration.actions[fn](...args); }));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Phase 6 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.OLO_PHASE6_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
