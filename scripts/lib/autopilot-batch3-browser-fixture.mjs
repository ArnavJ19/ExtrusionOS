import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig.js";
import { createCashFixture, cIds } from "./autopilot-batch3-fixture.mjs";
import { createNov7ActionsFixture } from "./nov-batch7-actions-fixture.mjs";

// Mounts the Autopilot batch 3 screens (credit holds and panels, draft jobs, invoice drafts, GST rule, bank matching,
// reminders, receipt allocation, quotation validity, duplicates and system closures). The real gateway server action
// (lib/actions/autopilot.ts) runs against the replayed local SQL as the chosen employee. The file-upload and invoice-posting
// actions (lib/actions/order-to-cash.ts) are stubbed: statements are imported through the same RPC in the tests.
export async function createCashBrowserFixture() {
  const f = await createCashFixture();
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
    "@/lib/actions/autopilot": "export async function autopilotAction(rpc,command,payload={}){window.calls.push({rpc,command});const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rpc,command,payload,actor:window.config.userId})});return response.json()}",
    "@/lib/actions/order-to-cash": "export async function previewBankStatementAction(){return {success:false,error:'Upload is not part of this fixture.'}}export async function importBankStatementAction(){return {success:false,error:'Upload is not part of this fixture.'}}export async function postInvoiceDraftsAction(ids){window.posted=ids;return {success:true,data:ids.map(id=>({id,state:'failed',message:'Posting runs the reviewed invoice save, outside this fixture.'}))}}",
    "@/lib/supabase/browser": "export function createClient(){return {rpc:async(fn,args)=>{const response=await fetch('/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rpc:fn,command:args.p_command,payload:args.p_payload,actor:window.config.userId})});const out=await response.json();return out.success?{data:out.data,error:null}:{data:null,error:{message:out.error}}}}}"
  };
  const entry = `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {CreditHoldsClient,CustomerCreditPanel,OrderCreditPanel} from './components/modules/order-to-cash/credit';
    import {DraftJobsClient,OrderDraftJobsPanel} from './components/modules/order-to-cash/draft-jobs';
    import {InvoiceDraftsClient,GstRulesClient} from './components/modules/order-to-cash/billing';
    import {BankClient} from './components/modules/order-to-cash/bank';
    import {RemindersClient,ReceiptAllocationPanel} from './components/modules/order-to-cash/cash';
    import {QuoteValidityPanel,QuoteValidityQueue,DuplicatesClient,AlertResolutionsPanel,OrderToCashAttention} from './components/modules/order-to-cash/quotes-alerts';
    import {SupplyOverride} from './components/modules/order-to-cash/supply-override';
    window.ids=${JSON.stringify(cIds)};Object.assign(window,{calls:[],refreshes:0,navigations:[]});
    const root=createRoot(document.getElementById('app'));
    window.config={userId:window.ids.owner};
    function Supply(props){const [s,setS]=React.useState(props.chosen||'');return <div><select aria-label='Place of supply' value={s} onChange={e=>setS(e.target.value)}><option value=''>-</option><option value='07'>Delhi</option><option value='27'>Maharashtra</option></select><SupplyOverride orderId={props.orderId} dispatchId={props.dispatchId} chosen={s} onDerived={setS}/></div>}
    window.mount=async(screen,userId,o={})=>{
      window.config.userId=userId;root.render(<p>Loading</p>);let node;
      if(screen==='holds')node=<CreditHoldsClient/>;
      else if(screen==='customer')node=<CustomerCreditPanel customerId={o.customerId}/>;
      else if(screen==='order')node=<><OrderCreditPanel orderId={o.orderId}/><OrderDraftJobsPanel orderId={o.orderId}/></>;
      else if(screen==='drafts')node=<DraftJobsClient/>;
      else if(screen==='invoices')node=<InvoiceDraftsClient/>;
      else if(screen==='gst')node=<GstRulesClient/>;
      else if(screen==='supply')node=<Supply orderId={o.orderId} dispatchId={o.dispatchId} chosen={o.chosen}/>;
      else if(screen==='bank')node=<BankClient today={o.today}/>;
      else if(screen==='reminders')node=<RemindersClient canPrepare={true}/>;
      else if(screen==='receive')node=<ReceiptAllocationPanel today={o.today}/>;
      else if(screen==='quote')node=<QuoteValidityPanel quoteId={o.quoteId} today={o.today}/>;
      else if(screen==='quotes')node=<QuoteValidityQueue/>;
      else if(screen==='audit')node=<><OrderToCashAttention/><DuplicatesClient/><AlertResolutionsPanel/></>;
      root.render(<main key={Date.now()} className='mx-auto min-w-0 max-w-5xl space-y-5 p-4'><h1 className='text-2xl font-bold'>Cash fixture: {screen}</h1>{node}</main>);
    };
  `;
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", sourcefile: "cash-browser.tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" }, plugins: [{ name: "cash-boundaries", setup(api) {
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
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><title>Cash fixture</title>
          <body class="bg-[#f7f7f8]"><div id="app"></div><script src="/bundle.js"></script></body></html>`);
      }
    } catch (error) { json(response, 500, { success: false, error: "Synthetic fixture boundary failed: " + error.message }); }
  });
  await new Promise(resolve => server.listen(Number(process.env.CASH_FIXTURE_PORT ?? 0), "127.0.0.1", resolve));
  return { f, base: `http://127.0.0.1:${server.address().port}`, run: work => serialized(work), start: () => serialized(() => f.start()), rollback: () => serialized(() => f.rollback()),
    close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
