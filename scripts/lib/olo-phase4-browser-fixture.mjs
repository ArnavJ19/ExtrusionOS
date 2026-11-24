import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createDispatchFixture, dIds as ids } from "./autopilot-batch4-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the order lifecycle Phase 4 and review-fix screens in English or Hindi: QC reversal, earlier-approval reviews,
// finance release and "dispatch has left", and the notification inbox with the alerts these raise. The real server
// actions (lib/actions/orchestration.ts, lib/actions/dispatches.ts) run against the replayed local SQL as the chosen
// employee, on top of the dispatch fixture (real dispatch writer). Synthetic data only; no hosted database is involved.
export async function createOloPhase4BrowserFixture() {
  const f = await createDispatchFixture();
  const orchestration = createNov7ActionsFixture("../../lib/actions/orchestration.ts");
  const dispatches = createNov7ActionsFixture("../../lib/actions/dispatches.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  // Command RPCs (p_command / p_payload) go through the fixture's call; others are called with named arguments.
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
    for (const m of [orchestration, dispatches]) {
      m.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null, fullName: user?.full_name };
      m.state.authenticated = !!user?.is_active; m.state.rpcHandler = rpcFor(actor);
    }
  }
  const ORCH = ["orchestrationAction", "diePreparationAction", "containmentAction", "remeltAction", "priorityAction", "dispatchFinanceAction", "dispatchCommAction", "qualityReversalAction"];
  const DISP = ["updateDeliveryStatusAction"];
  const proxy = names => names.map(name => `export const ${name}=async(...args)=>{window.calls.push({fn:'${name}'});const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn:'${name}',args,actor:window.config.userId})});return r.json()};`).join("");
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/orchestration": proxy(ORCH),
    "@/lib/actions/dispatches": proxy(DISP),
    "@/lib/actions/notifications": "export const markNotificationReadAction=async()=>({success:true});",
    "@/components/ui/undo-toast": "export const offerUndo=()=>{};export const recordUndo=()=>{};"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ReversalForm} from './components/modules/orchestration/reversal-forms';
    import {ContainmentActions,OpenContainmentForm,PriorApprovalReviews} from './components/modules/orchestration/nonconforming-forms';
    import {ReleaseForm,SendOutButton} from './components/modules/orchestration/dispatch-forms';
    import {NotificationsClient} from './components/modules/notifications-client';
    import {reversalPreviewSchema} from './lib/workflow/quality-reversal';
    import {containmentCandidatesSchema,containmentDetailSchema} from './lib/workflow/nonconforming';
    import {clearanceDetailSchema,clearanceStateText,termsText} from './lib/workflow/dispatch-orchestration';
    import {floorText} from './lib/i18n/floor';
    Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));window.config={userId:''};
    const call=async(fn,input)=>{const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn,args:[input],actor:window.config.userId})});return r.json()};
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;const lang=o.lang==='hi'?'hi':'en';const t=floorText(lang);let node;let title=screen;
      if(screen==='reverse'){title=t('olo.rev.newTitle');const r=await call('qualityReversalAction',{command:'preview',inspection_id:o.inspection});
        node=r.success?(r.data.can_reverse?<ReversalForm preview={reversalPreviewSchema.parse(r.data)} lang={lang}/>:<p role='status' className='rounded-2xl border bg-white p-4 text-sm font-semibold'>{r.data.blocker}</p>):<p role='alert'>{r.error}</p>;}
      else if(screen==='containment'){title=t('olo.qc.title');const r=await call('containmentAction',{command:'get',id:o.id});
        const c=r.success?containmentDetailSchema.parse(r.data):null;node=c?<div className='space-y-3'><p className='text-sm font-semibold'>{c.containment_number} · {t('olo.qc.status.'+c.status)}</p><ContainmentActions c={c} lang={lang}/><PriorApprovalReviews c={c} lang={lang}/></div>:<p role='alert'>{r.error}</p>;}
      else if(screen==='clearance'){title=t('olo.fc.title');const r=await call('dispatchFinanceAction',{command:'status',dispatch_id:o.dispatch});
        const c=r.success?clearanceDetailSchema.parse(r.data):null;
        node=c?<div className='space-y-3'><section className={'rounded-2xl border p-4 text-sm '+(c.state==='blocked'?'border-red-200 bg-red-50 text-red-950':'border-emerald-200 bg-emerald-50 text-emerald-950')}>
          <p className='font-bold'>{c.dispatch_number} · {clearanceStateText(t,c.state)} · {termsText(t,c.terms)}</p>
          <p>{c.state==='blocked'?t('olo.fc.blockedNote'):c.state==='released'?t('olo.fc.releasedUntil',{at:new Date(c.release.expires_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})}):''}</p>
          {c.delivery_status==='pending'?<p className='mt-1'>{t('olo.fc.heldPending')}</p>:<p className='mt-1 font-semibold'>{c.delivery_status}</p>}</section>
          {c.can_release&&c.state==='blocked'?<ReleaseForm dispatchId={c.dispatch_id} canException={c.can_exception} hours={c.release_hours} lang={lang}/>:null}
          {c.delivery_status==='pending'&&['not_required','covered','released'].includes(c.state)?<SendOutButton dispatchId={c.dispatch_id} lang={lang}/>:null}</div>:<p role='alert'>{r.error}</p>;}
      else if(screen==='hold'){title=t('olo.qc.title');const r=await call('containmentAction',{command:'candidates'});
        node=r.success?<OpenContainmentForm candidates={containmentCandidatesSchema.parse(r.data).rows} lang={lang}/>:<p role='alert'>{r.error}</p>;}
      else if(screen==='alerts'){title='Notifications';const r=await fetch('/alerts?user='+userId).then(x=>x.json());node=<NotificationsClient notifications={r}/>;}
      root.render(<main key={Date.now()} lang={lang} className='mx-auto min-w-0 max-w-4xl space-y-5 p-4'><h1 className='text-2xl font-bold'>{title}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    const go=()=>window.mount(qs.get('screen'),qs.get('user'),Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
    window.remount=go;
    if(qs.get('screen'))go();
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "olo-phase4-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "olo-phase4-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    try {
      if (path === "/call") {
        const { fn, args, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const target = ORCH.includes(fn) ? orchestration : DISP.includes(fn) ? dispatches : null;
        if (!target) { json(response, 400, { success: false, error: "Unknown action" }); return; }
        json(response, 200, await serialized(async () => { await as(actor); return target.actions[fn](...args); }));
      } else if (path === "/alerts") {
        // The notification inbox of one employee: their own messages and their role's, newest first (as /notifications).
        const user = url.searchParams.get("user");
        const rows = await serialized(async () => (await f.db.query(`select n.id, n.title, n.body, n.severity, n.created_at, n.is_read from notifications n join app_users u on u.id = $1
          where n.company_id = u.company_id and (n.recipient_user_id = u.id or (n.recipient_user_id is null and n.recipient_role = u.role)) order by n.created_at desc, n.id desc limit 10`, [user])).rows);
        json(response, 200, rows.map(n => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, createdAt: n.created_at, isRead: n.is_read })));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Phase 4 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.OLO_PHASE4_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
