import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createPhase4Fixture, ids } from "./fs-phase4-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the FABLE_SUGGESTIONS Phase 4 screens. The real gateway actions (lib/actions/intelligence.ts and, for the
// thirteen-week cash forecast, lib/actions/autopilot.ts) run against the replayed local SQL as the chosen employee.
// Supabase Realtime is a synthetic channel: window.liveChange() delivers a change, window.presence(names) a presence sync.
export async function createPhase4BrowserFixture() {
  const f = await createPhase4Fixture();
  const modules = { intelligence: createNov7ActionsFixture("../../lib/actions/intelligence.ts"), autopilot: createNov7ActionsFixture("../../lib/actions/autopilot.ts") };
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
  }
  const post = (module, name) => `async function(...args){const response=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({module:'${module}',name:'${name}',args,actor:window.config.userId})});return response.json()}`;
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/intelligence": `export const intelligenceAction=async(rpc,command,payload={})=>{window.calls.push({rpc,command});return (${post("intelligence", "intelligenceAction")})(rpc,command,payload)};`,
    "@/lib/actions/autopilot": `export const autopilotAction=async(rpc,command,payload={})=>{window.calls.push({rpc,command});return (${post("autopilot", "autopilotAction")})(rpc,command,payload)};`,
    "@/lib/supabase/browser": `export function createClient(){return {channel(name){const handlers=[];let presence={};const ch={on(kind,filter,cb){handlers.push({kind,filter,cb});return ch},
      subscribe(cb){window.channels.push({name,handlers,ch});setTimeout(()=>cb('SUBSCRIBED'),0);return ch},presenceState(){return presence},async track(v){window.tracked.push({name,v})},
      _presence(p){presence=p;handlers.filter(h=>h.kind==='presence').forEach(h=>h.cb())}};return ch},removeChannel(ch){window.channels=window.channels.filter(c=>c.ch!==ch)}}}`
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {OtifClient} from './components/modules/intelligence/otif';
    import {CashForecastClient} from './components/modules/autopilot-batch9/cash-forecast';
    import {MetalExposureClient} from './components/modules/intelligence/metal-exposure';
    import {OrderBookClient} from './components/modules/intelligence/order-book';
    import {MaterialPlanClient} from './components/modules/intelligence/material-plan';
    import {DieLifeClient} from './components/modules/intelligence/die-life';
    import {PromiseClient} from './components/modules/intelligence/promise';
    import {DevelopmentBoard,DevelopmentDetail,DevelopmentDatabase} from './components/modules/intelligence/development';
    import {CockpitClient} from './components/modules/intelligence/cockpit';
    import {WallClient} from './components/modules/intelligence/wall';
    import {LiveRefresh,EditingPresence} from './components/modules/intelligence/live';
    window.ids=${JSON.stringify(ids)};Object.assign(window,{calls:[],refreshes:0,navigations:[],channels:[],tracked:[]});
    window.liveChange=table=>window.channels.forEach(c=>c.handlers.filter(h=>h.kind==='postgres_changes'&&h.filter.table===table).forEach(h=>h.cb({})));
    window.presence=names=>window.channels.filter(c=>c.name.startsWith('presence:')).forEach(c=>c.ch._presence(Object.fromEntries(names.map((n,k)=>['u'+k,[{user_id:'other-'+k,name:n}]]))));
    const root=createRoot(document.getElementById('app'));window.config={userId:window.ids.owner};
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;let node;const lists=o.lists||{customers:[],users:[],dies:[],profiles:[],vendors:[],presses:[]};
      if(screen==='otif')node=<OtifClient canEdit={o.edit!==false} canSetTolerance={o.tolerance===true}/>;
      else if(screen==='cash')node=<CashForecastClient/>;
      else if(screen==='metal')node=<MetalExposureClient canSetLimit={o.limit===true}/>;
      else if(screen==='order-book')node=<OrderBookClient canSet={o.set===true}/>;
      else if(screen==='mrp')node=<MaterialPlanClient canApprove={o.approve===true}/>;
      else if(screen==='die-life')node=<DieLifeClient canSetLead={o.lead===true} canSeeMakers={o.makers===true}/>;
      else if(screen==='promise')node=<PromiseClient profiles={lists.profiles}/>;
      else if(screen==='development')node=<><DevelopmentBoard canEdit={o.edit!==false} lists={lists}/><DevelopmentDatabase/></>;
      else if(screen==='development-detail')node=<><EditingPresence recordKey={'development:'+o.id} me={{id:userId,name:'Fixture me'}}/><DevelopmentDetail id={o.id} canEdit={o.edit!==false} lists={lists}/></>;
      else if(screen==='cockpit')node=<CockpitClient/>;
      else if(screen==='wall')node=<WallClient/>;
      else if(screen==='live')node=<LiveRefresh name='orders' tables={['orders']}/>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-6xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Phase 4 fixture: {screen}</h1>{node}</main>);
    };
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "phase4-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "phase4-boundaries", setup(api) {
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
      if (path === "/call") {
        const { module, name, args, actor } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const target = modules[module];
        json(response, 200, await serialized(async () => { await as(target, actor); return target.actions[name](...args); }));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Phase 4 fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
