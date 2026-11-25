import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createDispatchFixture, dIds as ids } from "./autopilot-batch4-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the order lifecycle Phase 7 client forms: the delivery receipt, logging a complaint, the complaint workflow
// steps, receivable disputes and write-offs, and final closure. The real server actions (lib/actions/orchestration.ts)
// run against the replayed local SQL as the chosen employee, on top of the dispatch fixture. Synthetic data only; no
// hosted database is involved.
export async function createOloPhase7BrowserFixture() {
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
  const ORCH = ["deliveryTrackingAction", "complaintAction", "receivableFollowupAction", "orderClosureAction"];
  const proxy = names => names.map(name => `export const ${name}=async(...args)=>{window.calls.push({fn:'${name}'});const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn:'${name}',args,actor:window.config.userId})});return r.json()};`).join("");
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++;window.remount?.()},push:href=>{window.navigations.push(href);const m=href.match(/complaints\\/([0-9a-f-]{36})/);if(m)window.mount('complaint',window.config.userId,{id:m[1]})},replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/orchestration": proxy(ORCH)
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {CommandForm,DeliveryReceiptForm,ComplaintLogForm} from './components/modules/orchestration/delivery-closure-forms';
    import {deliveryDetailSchema,complaintDetailSchema,complaintCandidatesSchema,receivableDetailSchema,ACCEPTANCE_LABELS,SHIPMENT_STATE_LABELS,COMPLAINT_STATUS_LABELS,
      CONTAINMENT_ACTIONS,CONTAINMENT_LABELS,RESOLUTIONS,RESOLUTION_LABELS,DEPARTMENTS,REASON_CATEGORIES,REASON_LABELS} from './lib/workflow/delivery-closure';
    Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));window.config={userId:''};
    const call=async(fn,input)=>{const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn,args:[input],actor:window.config.userId})});return r.json()};
    const kg=n=>Number(n).toLocaleString('en-IN',{maximumFractionDigits:3})+' kg';
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;window.currentScreen={screen,o};let node;let title=screen;
      if(screen==='receipt'){const r=await call('deliveryTrackingAction',{command:'get',dispatch_id:o.id});const d=r.success?deliveryDetailSchema.parse(r.data):null;
        title='Shipment '+(d?.dispatch.dispatch_number??'');
        node=d?<div className='space-y-3'><p className='rounded-2xl border bg-white p-4 text-sm font-semibold' data-testid='state'>{SHIPMENT_STATE_LABELS[d.shipment.state]} · {ACCEPTANCE_LABELS[d.shipment.acceptance.outcome]}{d.shipment.discrepancy?.open?' · discrepancy '+kg(d.shipment.discrepancy.discrepancy_kg):''}</p>
          <DeliveryReceiptForm dispatchId={d.dispatch.id} bundles={d.manifest.bundles} netKg={d.manifest.kg} correcting={d.receipts.some(x=>x.status==='current')}/></div>:<p role='alert'>{r.error}</p>;}
      else if(screen==='log'){const r=await call('complaintAction',{command:'candidates'});title='Log a customer complaint';
        node=r.success?<ComplaintLogForm initialOrders={complaintCandidatesSchema.parse(r.data).orders??[]}/>:<p role='alert'>{r.error}</p>;}
      else if(screen==='complaint'){const r=await call('complaintAction',{command:'get',complaint_id:o.id});const d=r.success?complaintDetailSchema.parse(r.data):null;
        title=d?d.complaint.complaint_number+' · '+COMPLAINT_STATUS_LABELS[d.complaint.status]:'complaint';const fx={complaint_id:o.id};
        node=d?<div className='space-y-3'>
          {d.close_blocker?<p className='rounded-2xl border bg-white p-3 text-sm'>Before closing: {d.close_blocker}</p>:null}
          {d.can.investigate&&d.complaint.status==='open'?<CommandForm area='complaint' command='investigate' fixed={fx} title='Record the containment decision' submitLabel='Record containment' done='Containment recorded.'
            fields={[{name:'containment_action',label:'Containment',type:'select',required:true,options:CONTAINMENT_ACTIONS.map(a=>({value:a,label:CONTAINMENT_LABELS[a]}))},{name:'containment_note',label:'What was held or checked',type:'textarea',required:true,minLength:5}]}/>:null}
          {d.can.root_cause&&d.complaint.status==='investigating'?<CommandForm area='complaint' command='root_cause' fixed={fx} title='Record the root cause and corrective action' submitLabel='Record root cause'
            fields={[{name:'root_cause',label:'Root cause',type:'textarea',required:true},{name:'corrective_action',label:'Corrective action',type:'textarea',required:true},{name:'responsible_department',label:'Responsible department',type:'select',required:true,options:DEPARTMENTS.map(x=>({value:x,label:x}))}]}/>:null}
          {d.can.resolve?<CommandForm area='complaint' command='resolve' fixed={fx} title='Record the agreed resolution' submitLabel='Record resolution'
            fields={[{name:'resolution',label:'Resolution',type:'select',required:true,options:RESOLUTIONS.map(x=>({value:x,label:RESOLUTION_LABELS[x]}))},{name:'replacement_kg',label:'Replacement kg',type:'number'},
              {name:'replacement_billing',label:'Replacement billing',type:'select',options:[{value:'free_of_charge',label:'Free of charge'},{value:'chargeable',label:'Chargeable'}]},{name:'resolution_note',label:'What was agreed',type:'textarea',required:true}]}/>:null}
          {d.can.close?<CommandForm area='complaint' command='close' fixed={fx} title='Verify and close' submitLabel='Close complaint' fields={[{name:'note',label:'Verification',type:'textarea',required:true}]}/>:null}
          <ol className='space-y-1 rounded-2xl border bg-white p-4 text-sm'>{d.events.map((e,n)=><li key={n}><b>{e.action}</b> {e.note??''}</li>)}</ol></div>:<p role='alert'>{r.error}</p>;}
      else if(screen==='receivable'){const r=await call('receivableFollowupAction',{command:'get',invoice_id:o.id});const d=r.success?receivableDetailSchema.parse(r.data):null;
        title='Payment follow-up '+(d?.invoice.invoice_number??'');const opts=REASON_CATEGORIES.map(x=>({value:x,label:REASON_LABELS[x]}));
        node=d?<div className='space-y-3'><p className='rounded-2xl border bg-white p-4 text-sm font-semibold' data-testid='money'>Collectible ₹{d.collectible.collectible} · disputed ₹{d.collectible.disputed} · written off ₹{d.collectible.written_off}</p>
          <CommandForm area='receivable' command='dispute.open' fixed={{invoice_id:o.id}} withId collapsed title='Record a customer dispute' submitLabel='Record dispute' done='Dispute recorded.'
            fields={[{name:'amount',label:'Disputed amount',type:'number',required:true,step:'0.01'},{name:'reason_category',label:'Reason',type:'select',required:true,options:opts},{name:'reason',label:'Explanation',type:'textarea',required:true}]}/>
          <ul className='rounded-2xl border bg-white p-4 text-sm'>{d.exceptions.map(e=><li key={e.id}>{e.kind} ₹{e.amount} · {e.status}</li>)}</ul></div>:<p role='alert'>{r.error}</p>;}
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-4xl space-y-5 p-4'><h1 className='text-2xl font-bold'>{title}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    const go=()=>window.mount(qs.get('screen'),qs.get('user'),Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
    window.remount=()=>{const c=window.currentScreen;if(c)window.mount(c.screen,window.config.userId,c.o);else go()};
    if(qs.get('screen'))go();
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "olo-phase7-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "olo-phase7-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }, "./components/modules/orchestration/delivery-closure-forms.tsx"] })])
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
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Phase 7 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.OLO_PHASE7_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
