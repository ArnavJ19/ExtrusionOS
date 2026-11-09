import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createAutopilotFixture, apIds } from "./autopilot-batch1-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 1 screens. The real server action (lib/actions/autopilot.ts) and the real upload
// handlers (lib/master-data/import/upload.ts) run against the replayed local SQL as the chosen employee; router,
// links and history are synthetic.
export async function createAutopilotBrowserFixture() {
  const f = await createAutopilotFixture();
  const a = createNov7ActionsFixture("../../lib/actions/autopilot.ts");
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const upload = require("../../lib/master-data/import/upload.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const supabaseFor = actor => ({ rpc: async (name, payload) => {
    try { return { data: await f.call(name, payload.p_command, payload.p_payload, actor), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } });
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/autopilot": "export async function autopilotAction(rpc,command,payload={}){window.calls.push({rpc,command});const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rpc,command,payload,actor:window.config.userId})});return response.json()}"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ProposalCards} from './components/modules/autopilot/proposal-cards';
    import {JobsPanel} from './components/modules/autopilot/jobs-panel';
    import {CalendarClient} from './components/modules/autopilot/calendar-client';
    import {NumberingClient} from './components/modules/autopilot/numbering-client';
    import {PeriodsClient} from './components/modules/autopilot/periods-client';
    import {NavigationClient} from './components/modules/autopilot/navigation-client';
    import {ImportClient} from './components/modules/autopilot/import-client';
    import {CutoverClient} from './components/modules/autopilot/cutover-client';
    import {autopilotAction} from '@/lib/actions/autopilot';
    window.ids=${JSON.stringify(apIds)};Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));
    window.config={userId:window.ids.owner};
    const load=async(rpc,command,payload={})=>{const result=await autopilotAction(rpc,command,payload);if(!result.success)throw Error(result.error);return result.data};
    window.mount=async(screen,userId,options={})=>{
      window.config.userId=userId;root.render(<p>Loading</p>);let node;
      if(screen==='proposals')node=<ProposalCards type={options.type} today={options.today} initial={await load('ap_proposals','list',{status:'open',...(options.type?{type:options.type}:{})})} />;
      else if(screen==='jobs')node=<JobsPanel initial={await load('ap_jobs','overview')} initialError={null} />;
      else if(screen==='calendar')node=<CalendarClient initial={await load('ap_calendar','read',{from:options.today})} today={options.today} />;
      else if(screen==='numbering')node=<NumberingClient initial={await load('ap_series','list')} today={options.today} />;
      else if(screen==='periods')node=<PeriodsClient initial={await load('ap_period','overview')} userId={userId} />;
      else if(screen==='navigation')node=<NavigationClient initial={await load('ap_navigation','usage')} destinations={options.destinations} />;
      else if(screen==='import')node=<ImportClient />;
      else if(screen==='cutover')node=<CutoverClient initial={await load('ap_cutover','get')} />;
      root.render(<main className='mx-auto min-w-0 max-w-6xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Autopilot fixture: {screen}</h1>{node}</main>);
    };
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "autopilot-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "autopilot-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    const raw = Buffer.concat(chunks);
    try {
      if (path === "/action") {
        const { rpc, command, payload, actor } = JSON.parse(raw.toString("utf8"));
        const result = await serialized(async () => {
          const user = (await f.db.query("select company_id,role,is_active,dealer_id from app_users where id=$1", [actor])).rows[0];
          a.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null }; a.state.authenticated = !!user?.is_active;
          a.state.rpcHandler = async (name, body) => supabaseFor(actor).rpc(name, body);
          return a.actions.autopilotAction(rpc, command, payload);
        });
        json(response, 200, result);
      } else if (path === "/api/master-import/preview" || path === "/api/cutover/load") {
        const form = await new Request("http://local" + path, { method: "POST", headers: { "content-type": request.headers["content-type"] }, body: raw }).formData();
        const actor = String(form.get("actor") ?? request.headers["x-actor"] ?? "");
        const file = form.get("file");
        const buffer = Buffer.from(await file.arrayBuffer());
        const outcome = await serialized(() => path.endsWith("preview")
          ? upload.previewMasterUpload(supabaseFor(actor), { master: String(form.get("master")), fileName: file.name, buffer, mapping: form.get("mapping") ? JSON.parse(String(form.get("mapping"))) : null })
          : upload.loadCutoverUpload(supabaseFor(actor), { section: String(form.get("section")), fileName: file.name, buffer, control: JSON.parse(String(form.get("control"))) }));
        if (outcome.ok) json(response, 200, outcome.data); else json(response, outcome.status, { error: outcome.error });
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        // The page adds the acting employee to upload requests, as the session cookie would.
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Autopilot fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script>const nativeFetch=window.fetch;window.fetch=(url,init={})=>{if(init.body instanceof FormData){init.body.set('actor',window.config.userId)}return nativeFetch(url,init)};</script><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { f, base: `http://127.0.0.1:${server.address().port}`, start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
