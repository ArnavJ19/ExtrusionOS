import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createDispatchFixture, dIds as ids } from "./autopilot-batch4-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the order lifecycle Phase 5 screens in English or Hindi: the final QC after ageing (job view and record form),
// the ageing / final QC queue and the notification inbox with the alerts these raise. The real server actions
// (lib/actions/orchestration.ts) run against the replayed local SQL as the chosen employee, on top of the dispatch
// fixture. Synthetic data only; no hosted database is involved.
export async function createOloPhase5BrowserFixture() {
  const f = await createDispatchFixture();
  const orchestration = createNov7ActionsFixture("../../lib/actions/orchestration.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const rpcFor = actor => async (name, body) => {
    try {
      if (body && "p_command" in body) return { data: await f.call(name, body.p_command, body.p_payload, actor), error: null };
      const keys = Object.keys(body ?? {});
      const rows = await f.asUser(`select public.${name}(${keys.map((k, n) => `${k} => $${n + 1}`).join(",")}) data`, keys.map(k => body[k]), actor);
      return { data: rows[0]?.data ?? null, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  async function as(actor) {
    const user = (await f.db.query("select company_id,role,is_active,dealer_id,full_name from app_users where id=$1", [actor])).rows[0];
    orchestration.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null, fullName: user?.full_name };
    orchestration.state.authenticated = !!user?.is_active; orchestration.state.rpcHandler = rpcFor(actor);
  }
  const ORCH = ["orchestrationAction", "finalQcAction"];
  const proxy = names => names.map(name => `export const ${name}=async(...args)=>{window.calls.push({fn:'${name}'});const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn:'${name}',args,actor:window.config.userId})});return r.json()};`).join("");
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++;window.remount?.()},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/orchestration": proxy(ORCH),
    "@/lib/actions/notifications": "export const markNotificationReadAction=async()=>({success:true});",
    "@/components/ui/undo-toast": "export const offerUndo=()=>{};export const recordUndo=()=>{};"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {FinalQcForm} from './components/modules/orchestration/final-qc-forms';
    import {NotificationsClient} from './components/modules/notifications-client';
    import {finalQcJobSchema,finalQcQueueSchema,qualityFlowSchema} from './lib/workflow/final-qc';
    import {floorText} from './lib/i18n/floor';
    Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));window.config={userId:''};
    const call=async(fn,input)=>{const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn,args:[input],actor:window.config.userId})});return r.json()};
    const kg=n=>Number(n).toLocaleString('en-IN',{maximumFractionDigits:3})+' kg';
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;const lang=o.lang==='hi'?'hi':'en';const t=floorText(lang);let node;let title=screen;
      if(screen==='final'){const r=await call('finalQcAction',{command:'get',job_id:o.job});
        const j=r.success?finalQcJobSchema.parse(r.data):null;title=t('fqc.detailTitle',{job:j?.job_number});
        node=j?<div className='space-y-3'>
          <p className='text-sm font-semibold'>{t('fqc.h.stage')}: {t('fqc.stage.'+j.stage)} · {t('fqc.route.'+j.route.state)}</p>
          <dl className='grid grid-cols-2 gap-2 sm:grid-cols-5'>{[['fqc.q.approved',j.approved_kg],['fqc.q.agedAccepted',j.aged_accepted_kg],['fqc.q.agedRejected',j.aged_rejected_kg],['fqc.q.awaitingFinal',j.awaiting_final_kg],['fqc.q.finalAccepted',j.final_accepted_kg]].map(([k,v])=><div key={k} className='rounded-xl bg-white p-2'><dt className='text-xs'>{t(k)}</dt><dd className='font-bold'>{kg(v)}</dd></div>)}</dl>
          {j.can_record?<FinalQcForm job={j} lang={lang}/>:<p role='status' className='rounded-2xl border bg-white p-4 text-sm font-semibold'>{j.blocker}</p>}
          {j.records.map(x=><p key={x.id} className='rounded-xl border bg-white p-3 text-sm'>{x.record_number}: {t('fqc.r.line',{accepted:kg(x.accepted_kg),rejected:kg(x.rejected_kg),method:x.method,sampling:x.sampling_reference})}{x.reversals.map(v=>' · '+v.reversal_number).join('')}</p>)}</div>:<p role='alert'>{r.error}</p>;}
      else if(screen==='queue'){title=t('fqc.title');const r=await call('finalQcAction',{command:'queue',view:'awaiting'});
        const q=r.success?finalQcQueueSchema.parse(r.data):null;
        node=q?<ul className='space-y-2'>{q.rows.map(x=>qualityFlowSchema.parse(x)).map(x=><li key={x.job_id} className='rounded-xl border bg-white p-3 text-sm'>{x.job_number} · {t('fqc.stage.'+x.stage)} · {t('fqc.h.awaitingFinal')} {kg(x.awaiting_final_kg)}</li>)}<li className='text-xs'>{t(q.enforced?'fqc.enforcedOn':'fqc.enforcedOff')}</li></ul>:<p role='alert'>{r.error}</p>;}
      else if(screen==='alerts'){title='Notifications';const r=await fetch('/alerts?user='+userId).then(x=>x.json());node=<NotificationsClient notifications={r}/>;}
      root.render(<main key={Date.now()} lang={lang} className='mx-auto min-w-0 max-w-4xl space-y-5 p-4'><h1 className='text-2xl font-bold'>{title}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    const go=()=>window.mount(qs.get('screen'),qs.get('user'),Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
    window.remount=go;
    if(qs.get('screen'))go();
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "olo-phase5-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "olo-phase5-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }, "./components/modules/orchestration/final-qc-forms.tsx"] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    try {
      if (path === "/call") {
        const { fn, args, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!ORCH.includes(fn)) { json(response, 400, { success: false, error: "Unknown action" }); return; }
        json(response, 200, await serialized(async () => { await as(actor); return orchestration.actions[fn](...args); }));
      } else if (path === "/alerts") {
        const user = url.searchParams.get("user");
        const rows = await serialized(async () => (await f.db.query(`select n.id, n.title, n.body, n.severity, n.created_at, n.is_read from notifications n join app_users u on u.id = $1
          where n.company_id = u.company_id and (n.recipient_user_id = u.id or (n.recipient_user_id is null and n.recipient_role = u.role)) order by n.created_at desc, n.id desc limit 10`, [user])).rows);
        json(response, 200, rows.map(n => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, createdAt: n.created_at, isRead: n.is_read })));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Phase 5 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.OLO_PHASE5_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
