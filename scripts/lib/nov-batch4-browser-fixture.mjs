import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createNov4Fixture, nids } from "./nov-batch4-fixture.mjs";
import { createNov4ActionsFixture } from "./nov-batch4-actions-fixture.mjs";

// Mount production control components against the real server action and replayed local SQL, and the
// real draft hook against browser storage. Session, network, router and cache boundaries are synthetic.
export async function createNov4BrowserFixture() {
  const f = await createNov4Fixture();
  const a = createNov4ActionsFixture();
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++;if(window.config.screen==='record')void window.loadDetail(window.config.view,window.config.detail.row.id)},push:href=>window.navigations.push(href)});"
  };
  const actions = `async function call(name,input){window.calls.push(structuredClone(input));const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,input,actor:window.config.userId})});const result=await response.json();if(window.lostCommand===input.command){window.lostCommand=null;throw Error('Synthetic response lost after server execution')}return result}
    export const controlAction=input=>call('control',input);export const orderLedgerAction=input=>call('ledger',input);`;
  const entry = `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ControlActionCenter} from './components/modules/control/action-center';
    import {ControlMutationForm} from './components/modules/control/mutation-form';
    import {ControlRecord} from './components/modules/control/record';
    import {FormDraftRecovery,useFormDraft} from './components/forms/form-draft-recovery';
    import {draftDefinition} from './lib/forms/form-draft';
    import {controlAction} from '@/lib/actions/operations-control';
    window.ids=${JSON.stringify(nids)};window.calls=[];window.refreshes=0;window.navigations=[];window.lostCommand=null;window.saved=[];
    const root=createRoot(document.getElementById('app'));
    const definition=draftDefinition('record_quality',['batch_number','quantity_checked_kg','notes','unit_rate']);
    function DraftHarness({context}){
      const [values,setValues]=useState({batch_number:'',quantity_checked_kg:'',notes:'',unit_rate:''});
      const draft=useFormDraft(definition,{companyId:context.companyId,userId:context.userId},values,payload=>setValues(current=>({...current,...payload})));
      return <form className='space-y-3 rounded-2xl border bg-white p-4' onSubmit={async event=>{event.preventDefault();if(window.saveFails){window.saved.push('uncertain');return;}window.saved.push(values);await draft.confirmed();}}>
        <FormDraftRecovery draft={draft}/>
        {Object.keys(values).map(key=><label key={key} className='block'><span className='form-label'>{key}</span><input className='form-input' value={values[key]} onChange={event=>setValues(current=>({...current,[key]:event.target.value}))}/></label>)}
        <button type='submit' className='rounded-xl bg-slate-950 px-4 py-3 font-bold text-white'>Save inspection</button></form>;
    }
    window.config={action:'wip.observe',role:'production',userId:window.ids.production,companyId:window.ids.company,screen:'form',fixed:{job_id:window.ids.job3},initial:{}};
    window.mount=(patch={})=>{Object.assign(window.config,patch);const c=window.config,context={companyId:c.companyId,userId:c.userId,role:c.role,dealerId:null,companyName:'Synthetic factory',fullName:'Fixture employee',email:'fixture@invalid.test'};
      root.render(<main className='mx-auto min-w-0 max-w-4xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Operational control fixture</h1>{c.screen==='draft'?<DraftHarness key={c.companyId+':'+c.userId} context={context}/>:<ControlActionCenter key={c.companyId+':'+c.userId+':'+c.role} context={context}>
        {c.screen==='record'?<ControlRecord view={c.view} detail={c.detail} context={context}/>:<div className='rounded-2xl border bg-white p-4'><ControlMutationForm key={c.action+':'+c.userId+':'+JSON.stringify(c.fixed)} action={c.action} role={c.role} fixed={c.fixed} initial={c.initial}/></div>}
      </ControlActionCenter>}</main>)};
    window.loadDetail=async(view,id)=>{const result=await controlAction({command:'detail',view,id});if(!result.success)throw Error(result.error);window.mount({screen:'record',view,detail:result.data})};
    window.mount(new URLSearchParams(location.search).get('screen')==='draft'?{screen:'draft'}:{});
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "nov4-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "nov4-boundaries", setup(api) {
    api.onResolve({ filter: /^@\/lib\/actions\/operations-control$/ }, ({ path }) => ({ path, namespace: "actions" }));
    api.onLoad({ filter: /.*/, namespace: "actions" }, () => ({ contents: actions, loader: "js" }));
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
        const { name, input, actor } = JSON.parse(raw);
        const result = await serialized(async () => {
          const user = (await f.db.query("select company_id,role,is_active from app_users where id=$1", [actor])).rows[0];
          a.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: null }; a.state.authenticated = !!user?.is_active;
          a.state.rpcHandler = async (rpc, payload) => {
            try {
              if (rpc === "order_fulfilment_ledger") return { data: (await f.asUser("select public.order_fulfilment_ledger($1) data", [payload.p_order_id], actor))[0].data, error: null };
              return { data: await f.command(payload.p_command, payload.p_payload, actor), error: null };
            } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
          };
          return name === "ledger" ? a.ledger(input) : a.action(input);
        });
        response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ success: false, error: "Synthetic fixture boundary failed: " + error.message })); }
    } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
    else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
    else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Synthetic November control fixture</title><div id="app"></div><script src="/bundle.js"></script></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { f, base: `http://127.0.0.1:${server.address().port}`, start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()), close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
