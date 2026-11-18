import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createBatch10Fixture, ids } from "./autopilot-batch10-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 10 screens. The real gateway action (lib/actions/autopilot.ts) and the batch 10 actions
// (lib/actions/autopilot-batch10.ts: coating run order, combined cut pattern, configurator order) run against the replayed
// local SQL as the chosen employee. Pickers read through /pick; saving a direct order goes to /direct-order, which creates
// a synthetic order for the customer so the project link can be exercised; /api/undo is the real route's gateway call.
export async function createBatch10BrowserFixture() {
  const f = await createBatch10Fixture();
  const modules = { autopilot: createNov7ActionsFixture("../../lib/actions/autopilot.ts"), batch10: createNov7ActionsFixture("../../lib/actions/autopilot-batch10.ts") };
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const rpcFor = actor => async (name, body) => {
    try { return { data: await f.ap(name, body.p_command, body.p_payload, actor), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  async function as(fixture, actor) {
    const user = (await f.db.query("select company_id,role,is_active,dealer_id,full_name from app_users where id=$1", [actor])).rows[0];
    fixture.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null, fullName: user?.full_name }; fixture.state.authenticated = !!user?.is_active;
    fixture.state.rpcHandler = rpcFor(actor);
  }
  const post = (module, name) => `async function(...args){const response=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({module:'${module}',name:'${name}',args,actor:window.config.userId})});return response.json()}`;
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/autopilot": `export const autopilotAction=async(rpc,command,payload={})=>{window.calls.push({rpc,command});return (${post("autopilot", "autopilotAction")})(rpc,command,payload)};`,
    "@/lib/actions/autopilot-batch10": ["coatingPlanAction", "confirmCoatingRunAction", "prepareCutCombinationAction", "systemOrderDraftAction", "linkSystemOrderAction"].map(n => `export const ${n}=${post("batch10", n)};`).join(""),
    "@/lib/actions/direct-orders": "export async function searchDirectOrderOptionsAction(){return {success:true,customers:[],profiles:[]}}export async function createDirectOrderAction(input){window.directOrders.push(input);const r=await fetch('/direct-order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customer:input.order.customer_id})});return r.json()}",
    "@/lib/supabase/browser": "export function createClient(){return {from(table){const q={table,term:''};const b={select(){return b},eq(){return b},is(){return b},order(){return b},limit(){return b},or(v){q.term=(/ilike\\.\\*([^*]*)\\*/.exec(v)||[])[1]||'';return b},ilike(f,v){q.term=String(v).replace(/%/g,'');return b},then(res,rej){return fetch('/pick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(q)}).then(r=>r.json()).then(res,rej)}};return b}}}"
  };
  const entry = `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Toaster} from 'sonner';
    import {PressMetersClient,JobEnergyPanel} from './components/modules/autopilot-batch10/energy';
    import {StationCrew,CrewShiftReport,JobCrewPanel} from './components/modules/autopilot-batch10/crew';
    import {ProfileEquivalentsPanel,OrderEquivalentsPanel,EquivalentShortages} from './components/modules/autopilot-batch10/equivalents';
    import {StockRunsClient} from './components/modules/autopilot-batch10/stock-runs';
    import {CoatingRunsClient} from './components/modules/autopilot-batch10/coating';
    import {CutCombineClient,JobCutPanel} from './components/modules/autopilot-batch10/cut-combine';
    import {SystemsOrderSetting,SystemOrderPanel,SystemOrderForm} from './components/modules/autopilot-batch10/systems-order';
    import {NumericField} from './components/ui/numeric-field';
    import {NumberInput,Field} from './components/modules/autopilot-batch6/shared';
    import {DictationTextarea} from './components/ui/voice-input';
    import {offerUndo,recordUndo} from './components/ui/undo-toast';
    import {systemOrderDraftAction} from '@/lib/actions/autopilot-batch10';
    window.ids=${JSON.stringify(ids)};Object.assign(window,{calls:[],refreshes:0,navigations:[],directOrders:[],undone:[]});
    const realFetch=window.fetch.bind(window);window.fetch=(input,init={})=>String(input).startsWith('/api/')?realFetch(input,{...init,headers:{...(init.headers||{}),'x-actor':window.config.userId}}):realFetch(input,init);
    function Numbers(){const [a,setA]=useState('');const [b,setB]=useState('');const [c,setC]=useState('');
      return <div className='space-y-4 rounded-2xl border bg-white p-4'><NumericField label='Pieces' value={a} onChange={setA} decimal={false}/><NumericField label='Weight' unit='kg' value={b} onChange={setB}/>
        <Field label='Rate per kg'><NumberInput value={c} onChange={setC}/></Field><p data-testid='values'>{a}|{b}|{c}</p></div>}
    function Voice({speech}){const [text,setText]=useState('Billet short.');
      if(speech!=='true'){try{delete window.SpeechRecognition;window.webkitSpeechRecognition=undefined;window.SpeechRecognition=undefined}catch{}}
      if(speech==='true'&&!window.fakeSpeech){window.fakeSpeech=true;window.webkitSpeechRecognition=undefined;window.SpeechRecognition=class{start(){window.recognitions=(window.recognitions||0)+1;this.timer=setTimeout(()=>{this.onresult&&this.onresult({resultIndex:0,results:[Object.assign([{transcript:'press ruk gaya'}],{isFinal:true})]});this.onend&&this.onend()},150)}stop(){clearTimeout(this.timer);this.onend&&this.onend()}abort(){clearTimeout(this.timer)}}}
      return <div className='space-y-2 rounded-2xl border bg-white p-4'><label htmlFor='reason' className='text-sm font-semibold'>Exception note</label><DictationTextarea id='reason' value={text} onChange={setText} maxLength={200}/><p data-testid='text'>{text}</p></div>}
    function Undo({notification}){const [status,setStatus]=useState('open');const [read,setRead]=useState(false);
      return <div className='space-y-3 rounded-2xl border bg-white p-4'><p data-testid='status'>Task status: {status}</p>
        <button type='button' className='min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white' onClick={()=>{setStatus('completed');offerUndo({kind:'task.status',target:window.ids.task,message:'Task moved to Completed',undo:async()=>{setStatus('open');window.undone.push('task');return {success:true}}})}}>Complete task</button>
        <p data-testid='read'>Notification: {read?'read':'unread'}</p>
        <button type='button' className='min-h-11 rounded-xl border px-4 text-sm font-bold' onClick={()=>{setRead(true);offerUndo({kind:'notification.read',target:notification,message:'Marked as read',undo:async()=>{const r=await recordUndo('notification.read',notification,{id:notification});if(r.success)setRead(false);return r}})}}>Mark notification read</button>
        <button type='button' className='min-h-11 rounded-xl border px-4 text-sm font-bold' onClick={()=>offerUndo({kind:'invoice.post',target:'x',message:'Invoice posted',undo:async()=>({success:true})})}>Post invoice</button></div>}
    function SystemForm({id}){const [d,setD]=useState(null);React.useEffect(()=>{systemOrderDraftAction(id).then(setD)},[id]);
      return !d?<p role='status'>Loading…</p>:d.success?<SystemOrderForm prefill={d.data}/>:<p role='alert'>{d.error}</p>}
    const root=createRoot(document.getElementById('app'));window.config={userId:window.ids.owner};
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;window.pathname='/'+screen;let node;
      if(screen==='meters')node=<PressMetersClient today={o.today} canWrite={o.write!=='false'}/>;
      else if(screen==='job-energy')node=<><JobEnergyPanel jobId={o.job}/><JobCrewPanel jobId={o.job}/><JobCutPanel jobId={o.job}/></>;
      else if(screen==='crew')node=<><StationCrew machineId={o.machine} machineName={o.name}/><CrewShiftReport today={o.today}/></>;
      else if(screen==='equivalents')node=<ProfileEquivalentsPanel profileId={o.profile}/>;
      else if(screen==='order-equivalents')node=<><OrderEquivalentsPanel orderId={o.order} today={o.today}/><EquivalentShortages/></>;
      else if(screen==='stock-runs')node=<StockRunsClient/>;
      else if(screen==='coating')node=<CoatingRunsClient/>;
      else if(screen==='cut')node=<CutCombineClient/>;
      else if(screen==='system')node=<><SystemsOrderSetting/><SystemOrderPanel configurationId={o.id}/></>;
      else if(screen==='system-form')node=<SystemForm id={o.id}/>;
      else if(screen==='numbers')node=<Numbers/>;
      else if(screen==='voice')node=<Voice speech={o.speech}/>;
      else if(screen==='undo')node=<Undo notification={o.notification}/>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-6xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Batch 10 fixture: {screen}</h1>{node}<Toaster position='top-right' richColors/></main>);
    };
    const qs=new URLSearchParams(location.search);
    if(qs.get('screen'))window.mount(qs.get('screen'),qs.get('user')||window.ids.owner,Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "batch10-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "batch10-boundaries", setup(api) {
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
      } else if (path === "/api/undo") {
        const b = JSON.parse(body.toString("utf8")); const actor = request.headers["x-actor"];
        json(response, 200, await serialized(async () => { await as(modules.autopilot, actor);
          const r = b.kind === "notification.read" && b.id ? await modules.autopilot.actions.autopilotAction("ap_undo", "notification_unread", { id: b.id }) : await modules.autopilot.actions.autopilotAction("ap_undo", "record", { kind: b.kind, target: b.target });
          return r.success ? { success: true } : { success: false, error: r.error }; }));
      } else if (path === "/direct-order") {
        const { customer } = JSON.parse(body.toString("utf8"));
        json(response, 200, await serialized(async () => { const o = await f.order({ customer }); return { success: true, orderId: o.order }; }));
      } else if (path === "/pick") {
        const q = JSON.parse(body.toString("utf8"));
        json(response, 200, { data: await serialized(() => pick(q)), error: null });
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Batch 10 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.BATCH10_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
