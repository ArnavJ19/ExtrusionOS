import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createBatch4Fixture, ids } from "./fs-batch4-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the foundry scrap receiving screens. The real gateway action (lib/actions/autopilot.ts) runs against the
// replayed local SQL as the chosen employee. Uploads land in synthetic storage and in storage.objects, so the gateway's
// "the uploaded file exists" check is the real one. The vendor search reads through /pick. Synthetic data only.
export async function createScrapReceivingBrowserFixture() {
  const f = await createBatch4Fixture();
  const autopilot = createNov7ActionsFixture("../../lib/actions/autopilot.ts");
  const storage = {};
  let queue = Promise.resolve();
  const serialized = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const rpcFor = actor => async (name, body) => {
    try { return { data: await f.call(name, body.p_command, body.p_payload, actor), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  async function as(actor) {
    const user = (await f.db.query("select company_id,role,is_active,dealer_id,full_name from app_users where id=$1", [actor])).rows[0];
    autopilot.state.context = { companyId: user?.company_id, userId: actor, role: user?.role, dealerId: user?.dealer_id ?? null, fullName: user?.full_name };
    autopilot.state.authenticated = !!user?.is_active; autopilot.state.rpcHandler = rpcFor(actor);
  }
  const aliases = {
    "next/link": "import React from 'react';export default function Link({href,children,onClick,prefetch,...props}){return <a href={href} onClick={event=>{event.preventDefault();onClick?.(event);window.navigations.push(href)}} {...props}>{children}</a>}",
    "next/navigation": "export const useRouter=()=>({refresh:()=>{window.refreshes++},push:href=>window.navigations.push(href),replace:href=>window.navigations.push(href)});export const usePathname=()=>window.pathname||'/';",
    "@/lib/actions/autopilot": "export const autopilotAction=async(rpc,command,payload={})=>{window.calls.push({rpc,command});const r=await fetch('/call',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:[rpc,command,payload],actor:window.config.userId})});return r.json()};",
    "@/lib/utils/files": "export async function uploadTenantFile(bucket,companyId,folder,file){const path=companyId+'/'+folder+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'-');const r=await fetch('/upload?bucket='+bucket+'&path='+encodeURIComponent(path),{method:'POST',body:await file.arrayBuffer()});if(!r.ok)throw Error('upload');window.uploads.push(path);return path}export async function getSignedFileUrl(bucket,path){return '/files/'+encodeURIComponent(bucket+'/'+path)}",
    "@/lib/supabase/browser": "export function createClient(){return {from(table){const q={table,term:''};const b={select(){return b},eq(){return b},is(){return b},order(){return b},limit(){return b},ilike(f,v){q.term=String(v).replace(/%/g,'');return b},then(res,rej){return fetch('/pick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(q)}).then(r=>r.json()).then(res,rej)}};return b}}}"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ReceiveWizard} from './components/modules/foundry/scrap-receiving/receive-wizard';
    import {ReceiptRegister,ReceiptView} from './components/modules/foundry/scrap-receiving/scrap-receipts';
    import {RequestsWorkspace,ScrapTypesManager} from './components/modules/foundry/scrap-receiving/scrap-requests';
    import {MetalFinanceQueue} from './components/modules/foundry/scrap-receiving/metal-finance';
    window.ids=${JSON.stringify(ids)};Object.assign(window,{calls:[],refreshes:0,navigations:[],uploads:[]});
    const root=createRoot(document.getElementById('app'));window.config={userId:window.ids.owner};
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;window.pathname='/'+screen;let node;const company=window.ids.company;
      if(screen==='receive')node=<ReceiveWizard companyId={company} initialReceiptId={o.receipt||null} initialRequestId={o.request||null}/>;
      else if(screen==='receipts')node=<ReceiptRegister initialStatus={o.status||'all'}/>;
      else if(screen==='receipt')node=<ReceiptView companyId={company} id={o.id}/>;
      else if(screen==='requests')node=<RequestsWorkspace canRequest={o.canRequest!=='false'}/>;
      else if(screen==='types')node=<ScrapTypesManager canAdd={true} canManage={o.canManage==='true'}/>;
      else if(screen==='finance')node=<MetalFinanceQueue companyId={company}/>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-5xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Scrap receiving fixture: {screen}</h1>{node}</main>);
    };
    const qs=new URLSearchParams(location.search);
    const go=()=>window.mount(qs.get('screen'),qs.get('user')||window.ids.owner,Object.fromEntries([...qs.entries()].filter(([k])=>!['screen','user'].includes(k))));
    window.remount=go;
    if(qs.get('screen'))go();
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "scrap-receiving-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "scrap-receiving-boundaries", setup(api) {
      for (const key of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: key, namespace: "boundary" }));
      api.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const config = loadConfig(process.cwd() + "/tailwind.config.ts");
  const css = await postcss([tailwindcss({ ...config, content: [...(Array.isArray(config.content) ? config.content : []), { raw: entry, extension: "tsx" }] })]).process(readFileSync("app/globals.css", "utf8"), { from: undefined });
  const json = (response, status, body) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname;
    const chunks = []; for await (const part of request) chunks.push(part);
    const body = Buffer.concat(chunks);
    try {
      if (path === "/call") {
        const { args, actor } = JSON.parse(body.toString("utf8"));
        json(response, 200, await serialized(async () => { await as(actor); return autopilot.actions.autopilotAction(...args); }));
      } else if (path === "/pick") {
        const { term } = JSON.parse(body.toString("utf8"));
        const rows = await serialized(async () => (await f.db.query("select id, vendor_name, vendor_type, city from vendors where company_id=$1 and is_active and lower(vendor_name) like $2 order by vendor_name limit 10", [ids.company, `%${String(term ?? "").toLowerCase()}%`])).rows);
        json(response, 200, { data: rows, error: null });
      } else if (path === "/upload") {
        const bucket = url.searchParams.get("bucket"), name = url.searchParams.get("path");
        storage[`${bucket}/${name}`] = new Uint8Array(body);
        await serialized(() => f.db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [bucket, name]));
        json(response, 200, { ok: true });
      } else if (path.startsWith("/files/")) {
        const key = decodeURIComponent(path.slice("/files/".length)); const bytes = storage[key];
        if (!bytes) { response.statusCode = 404; response.end(); return; }
        response.setHeader("content-type", key.endsWith(".png") ? "image/png" : key.endsWith(".pdf") ? "application/pdf" : "image/jpeg"); response.end(Buffer.from(bytes));
      } else if (path === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
      else if (path === "/style.css") { response.setHeader("content-type", "text/css"); response.end(css.css); }
      else {
        response.setHeader("content-type", "text/html");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Scrap receiving fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.SCRAP_RECEIVING_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, ids, base: `http://127.0.0.1:${server.address().port}`, storage, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
