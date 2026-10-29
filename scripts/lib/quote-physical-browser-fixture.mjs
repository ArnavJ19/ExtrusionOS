import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadTailwindConfig from "tailwindcss/loadConfig.js";

export const physicalQuoteId = "ad000000-0000-4000-8000-000000000040";
export async function createQuotePhysicalBrowserFixture() {
  const aliases = {
    "@/lib/supabase/browser": `
      export function createClient(){
        const rows={quotes_authorized:[{id:'${physicalQuoteId}',quote_number:'QT-PHYSICAL-480',quote_date:'2026-10-29',customer_id:'customer',revision_number:1,updated_at:'2026-10-29T04:00:00Z',grand_total:231280}],quote_items_authorized:[{id:'line',quote_id:'${physicalQuoteId}',profile_id:'profile',finishing_type:'mill_finish',total_weight_kg:window.physicalFixture.missing?null:480,billing_weight_kg:700}],customers:[{id:'customer',customer_name:'Test customer',company_name:'Physical demand test company'}],aluminium_profiles:[{id:'profile',alloy:'6063',temper:'T6',billet_diameter_required_inch:7}]};
        return {from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},in(){return q},then(resolve,reject){return Promise.resolve({data:rows[table]||[],error:null}).then(resolve,reject)}};return q},async rpc(name,input){if(name==='get_dealer_quote_stock_availability')return {data:0,error:null};window.physicalFixture.posts.push({name,input});return {data:'ad000000-0000-4000-8000-000000000050',error:null}}};
      }
    `,
    "next/navigation": `const params=new URLSearchParams(location.search);export function useSearchParams(){return params}export function useRouter(){return {push(url){window.physicalFixture.navigations.push(url)},refresh(){},back(){}}}`,
    "next/link": `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
    "sonner": `export const toast={error(message){document.getElementById('message').textContent=message},success(message){document.getElementById('message').textContent=message}};`,
  };
  const script = await build({ stdin: { sourcefile: "quote-physical-review.tsx", resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {QuoteOrderFormClient} from './components/modules/orders/quote-order-form-client';
    window.physicalFixture={posts:[],navigations:[],missing:new URLSearchParams(location.search).get('missing')==='1'};
    createRoot(document.getElementById('app')).render(<QuoteOrderFormClient context={{companyId:'company',userId:'operator',role:'owner',dealerId:null}}/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "quote-physical-boundaries", setup(api) {
    for (const specifier of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: specifier, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: specifier }) => ({ contents: aliases[specifier], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const css = (await postcss([tailwindcss(loadTailwindConfig(path.resolve("tailwind.config.ts")))]).process(readFileSync("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1"); response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script.outputFiles[0].text); return; }
    if (url.pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); return; }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExtrusionOS physical quote review</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}#app{max-width:1100px;margin:auto;padding:16px;min-width:0}</style></head><body><p>Isolated actual order form; synthetic transport. No business order is posted.</p><p id="message" role="status"></p><main id="app"></main><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
