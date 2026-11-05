import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createNov8Fixture, nids } from "./nov-batch8-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the batch 8 production components. The execution hub calls the real server action against the
// replayed local SQL; router and history boundaries are synthetic and scriptable.
export async function createNov8BrowserFixture() {
  const f = await createNov8Fixture();
  const a = createNov7ActionsFixture("../../lib/actions/execution.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/execution": "export async function executionAction(input){window.calls.push(structuredClone(input));const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input,actor:window.config.userId})});return response.json()}export async function orderProgressAction(){return {success:false,error:'Progress is read on the server'}}"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ExecutionActionCenter} from './components/modules/execution/action-center';
    import {ExecutionMutationForm} from './components/modules/execution/mutation-form';
    import {ExecutionRecord} from './components/modules/execution/record';
    import {QueuePanel} from './components/modules/execution/queue-panel';
    import {ProgressStripView} from './components/modules/execution/progress-strip';
    import {executionAction} from '@/lib/actions/execution';
    window.ids=${JSON.stringify(nids)};Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));
    window.config={action:'appointment.request',role:'dispatch_manager',userId:window.ids.dispatchManager,companyId:window.ids.company,screen:'form',fixed:{},initial:{}};
    window.mount=(patch={})=>{Object.assign(window.config,patch);const c=window.config,context={companyId:c.companyId,userId:c.userId,role:c.role,dealerId:null,companyName:'Synthetic factory',fullName:'Fixture employee',email:'fixture@invalid.test'};
      const screen=c.screen==='record'?<ExecutionRecord view={c.view} detail={c.detail} context={context}/>
        :c.screen==='queue'?<QueuePanel key={c.rowsKey} rows={c.rows} total={c.total} role={c.role} filters={{search:'',state:'active',sort:'priority'}}/>
        :c.screen==='strip'?<ProgressStripView progress={c.progress}/>
        :<div className='rounded-2xl border bg-white p-4'><ExecutionMutationForm key={c.action+':'+c.userId+':'+JSON.stringify(c.fixed)} action={c.action} role={c.role} fixed={c.fixed} initial={c.initial}/></div>;
      root.render(<main className='mx-auto min-w-0 max-w-4xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Execution fixture</h1><ExecutionActionCenter key={c.companyId+':'+c.userId+':'+c.role} context={context}>{screen}</ExecutionActionCenter></main>)};
    window.loadDetail=async(view,id)=>{const result=await executionAction({command:'detail',view,id});if(!result.success)throw Error(result.error);window.mount({screen:'record',view,detail:result.data})};
    window.loadQueue=async()=>{const result=await executionAction({command:'list',view:'queue'});if(!result.success)throw Error(result.error);window.mount({screen:'queue',rows:result.data.rows,total:result.data.total_count,rowsKey:result.data.as_of})};
    window.mount({});
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "nov8-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "nov8-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (path === "/action") {
      try {
        let raw = ""; for await (const part of request) raw += part;
        const { input, actor } = JSON.parse(raw);
        const result = await serialized(async () => {
          const user = (await f.db.query("select company_id,role,is_active from app_users where id=$1", [actor])).rows[0];
          a.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: null }; a.state.authenticated = !!user?.is_active;
          a.state.rpcHandler = async (_rpc, payload) => {
            try { return { data: await f.command(payload.p_command, payload.p_payload, actor), error: null }; }
            catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
          };
          return a.actions.executionAction(input);
        });
        response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ success: false, error: "Synthetic fixture boundary failed: " + error.message })); }
    } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
    else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
    else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Execution fixture</title><div id="app"></div><script src="/bundle.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { f, base: `http://127.0.0.1:${server.address().port}`, start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()), close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
