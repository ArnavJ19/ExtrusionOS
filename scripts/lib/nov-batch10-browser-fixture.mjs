import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createNov10Fixture, nids } from "./nov-batch10-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the batch 10 production components. The specialist hub calls the real server action against the
// replayed local SQL; router and history boundaries are synthetic and scriptable.
export async function createNov10BrowserFixture() {
  const f = await createNov10Fixture();
  const a = createNov7ActionsFixture("../../lib/actions/specialist.ts");
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/specialist": "export async function specialistAction(input){window.calls.push(structuredClone(input));const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input,actor:window.config.userId})});return response.json()}"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {SpecialistActionCenter} from './components/modules/specialist/action-center';
    import {SpecialistMutationForm} from './components/modules/specialist/mutation-form';
    import {SpecialistRecord} from './components/modules/specialist/record';
    import {specialistAction} from '@/lib/actions/specialist';
    window.ids=${JSON.stringify(nids)};Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));
    window.config={action:'intake.submit',role:'sales',userId:window.ids.sales,companyId:window.ids.company,screen:'form',fixed:{},initial:{}};
    window.mount=(patch={})=>{Object.assign(window.config,patch);const c=window.config,context={companyId:c.companyId,userId:c.userId,role:c.role,dealerId:null,companyName:'Synthetic factory',fullName:'Fixture employee',email:'fixture@invalid.test'};
      const screen=c.screen==='record'?<SpecialistRecord view={c.view} detail={c.detail} context={context}/>
        :<div className='rounded-2xl border bg-white p-4'><SpecialistMutationForm key={c.action+':'+c.userId+':'+JSON.stringify(c.fixed)} action={c.action} role={c.role} fixed={c.fixed} initial={c.initial}/></div>;
      root.render(<main className='mx-auto min-w-0 max-w-4xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Specialist fixture</h1><SpecialistActionCenter key={c.companyId+':'+c.userId+':'+c.role} context={context}>{screen}</SpecialistActionCenter></main>)};
    window.loadDetail=async(view,id)=>{const result=await specialistAction({command:'detail',view,id});if(!result.success)throw Error(result.error);window.mount({screen:'record',view,detail:result.data})};
    window.mount({});
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "nov10-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "nov10-boundaries", setup(api) {
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
          return a.actions.specialistAction(input);
        });
        response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ success: false, error: "Synthetic fixture boundary failed: " + error.message })); }
    } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
    else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
    else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Specialist fixture</title><div id="app"></div><script src="/bundle.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { f, base: `http://127.0.0.1:${server.address().port}`, start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()), close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
