import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createPressFixture, pIds } from "./autopilot-batch2-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 2 screens (press station, job panel, press floor, scrap standards, die service, PM, QC
// samples, numeric keypad). The real server action (lib/actions/autopilot.ts) runs against the replayed local SQL as the
// chosen employee; router, links and history are synthetic.
export async function createPressBrowserFixture() {
  const f = await createPressFixture();
  const a = createNov7ActionsFixture("../../lib/actions/autopilot.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const supabaseFor = actor => ({ rpc: async (name, payload) => {
    try { return { data: await f.call(name, payload.p_command, payload.p_payload, actor), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } });
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/autopilot": "export async function autopilotAction(rpc,command,payload={}){window.calls.push({rpc,command});if(window.offline&&command==='push')throw new TypeError('Failed to fetch');const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rpc,command,payload,actor:window.config.userId})});return response.json()}"
  };
  const entry = `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {PressStation} from './components/modules/press/press-station';
    import {PressJobPanel} from './components/modules/press/press-job-panel';
    import {FloorClient} from './components/modules/press/floor-client';
    import {ScrapStandardsClient} from './components/modules/press/scrap-standards-client';
    import {DieServicePanel,DieFlagsPanel} from './components/modules/press/die-service';
    import {PmPanel} from './components/modules/press/pm-panel';
    import {SamplesClient,SampleClient,TriggersClient} from './components/modules/press/sampling-client';
    import {NumericField,WorkstationMode} from './components/ui/numeric-field';
    window.ids=${JSON.stringify(pIds)};Object.assign(window,{calls:[],refreshes:0,navigations:[],offline:false});
    const root=createRoot(document.getElementById('app'));
    window.config={userId:window.ids.owner};
    function Keypad(){const [v,setV]=useState('');return <WorkstationMode><NumericField label='Reject pieces' value={v} onChange={setV} decimal={false}/><p data-testid='value'>{v}</p></WorkstationMode>}
    window.mount=async(screen,userId,options={})=>{
      window.config.userId=userId;root.render(<p>Loading</p>);let node;const today=options.today;
      if(screen==='station')node=<PressStation companyId={window.ids.company} userId={userId} sessionId={options.sessionId} today={today} onExpired={m=>{window.expired=m}} onRenewed={()=>{}} />;
      else if(screen==='job')node=<PressJobPanel jobId={options.jobId} role={options.role} today={today} />;
      else if(screen==='floor')node=<FloorClient role={options.role} today={today} />;
      else if(screen==='standards')node=<ScrapStandardsClient presses={[{id:window.ids.press,name:'Press 1 (1460 T)'}]} canWeigh={true} />;
      else if(screen==='die')node=<DieServicePanel dieId={options.dieId} today={today} />;
      else if(screen==='flags')node=<DieFlagsPanel />;
      else if(screen==='pm')node=<PmPanel today={today} />;
      else if(screen==='samples')node=<SamplesClient />;
      else if(screen==='sample')node=<SampleClient id={options.sampleId} />;
      else if(screen==='triggers')node=<TriggersClient />;
      else if(screen==='keypad')node=<Keypad />;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-6xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Press fixture: {screen}</h1>{node}</main>);
    };
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "press-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "press-boundaries", setup(api) {
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
        const result = await serialized(async () => {
          const user = (await f.db.query("select company_id,role,is_active,dealer_id from app_users where id=$1", [actor])).rows[0];
          a.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null }; a.state.authenticated = !!user?.is_active;
          a.state.rpcHandler = async (name, body) => supabaseFor(actor).rpc(name, body);
          return a.actions.autopilotAction(rpc, command, payload);
        });
        json(response, 200, result);
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Press fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.PRESS_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, base: `http://127.0.0.1:${server.address().port}`, start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
