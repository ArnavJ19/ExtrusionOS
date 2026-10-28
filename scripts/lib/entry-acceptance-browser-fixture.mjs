import { build } from "esbuild";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadTailwindConfig from "tailwindcss/loadConfig.js";

export const entryFixtureId = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const entryLongCode = "AL-6063-ANODIZED-SECTION-CUSTOMER-REFERENCE-2026-EXTRA-LONG-IDENTIFIER";

export async function buildEntryAcceptanceBundle() {
  const profile = { id: entryFixtureId(10), company_id: entryFixtureId(1), profile_code: "AL-101", profile_name: "Window section", section_weight_kg_per_m: 0.8, section_perimeter_mm: 120, drawing_revision: "B", drawing_approval_status: "approved", is_active: true };
  const customer = { id: entryFixtureId(20), customer_name: "Mira Shah", company_name: "Mira Aluminium Window Systems", is_active: true };
  const mockAction = (name) => `export async function ${name}(input){window.entryFixture.posts.push({action:${JSON.stringify(name)},input});return {success:false,error:"Synthetic fixture does not post business data"}}`;
  const aliases = {
    "@/lib/supabase/browser": `
      const profiles=[${JSON.stringify(profile)},{...${JSON.stringify(profile)},id:"${entryFixtureId(11)}",profile_code:"AL-202",profile_name:"Door section",section_weight_kg_per_m:1.2}];
      export function createClient(){return {from(table){const call={table,filters:[],limit:null,single:false};const q={select(){return q},eq(key,value){call.filters.push(["eq",key,value]);return q},neq(){return q},is(){return q},order(){return q},limit(n){call.limit=n;return q},or(){return q},ilike(){return q},in(key,value){call.filters.push(["in",key,value]);return q},single(){call.single=true;return q},maybeSingle(){call.single=true;return q},then(resolve,reject){window.entryFixture.reads.push(call);let data=table==="aluminium_profiles"?profiles:table==="customers"?[${JSON.stringify(customer)}]:table==="company_settings_authorized"?[{default_quote_validity_days:15,default_gst_percent:18,default_margin_percent:10,default_conversion_charge_per_kg:30,minimum_margin_percent:8}]:[];data=data.filter(row=>call.filters.every(([kind,key,value])=>kind==="in"?value.includes(row[key]):row[key]===undefined||row[key]===value));return Promise.resolve({data:call.single?data[0]??null:data,error:null}).then(resolve,reject)}};return q},async rpc(name,args){window.entryFixture.rpcCalls.push({name,args});if(window.entryFixture.failRpc)return {data:null,error:{message:"Synthetic page refresh failure"}};const rows=Array.from({length:3},(_,index)=>({id:"${entryFixtureId(100)}".slice(0,-3)+String(index+100).padStart(3,"0"),company_id:"${entryFixtureId(1)}",item_code:index===0?${JSON.stringify(entryLongCode)}:"AL-STOCK-"+(index+1),item_name:"Aluminium section "+(index+1),item_category:"finished_goods",unit:"kg",current_stock:index===0?420.125:100,reorder_level:50,location:"Rack A-12 / packing bay",created_at:index===2?null:"2024-01-01T00:00:00Z",updated_at:index===2?null:"2024-02-01T00:00:00Z",observed_at:index===0?"2024-01-31T04:30:00Z":null,verified_at:null,source_system:index===0?"Legacy spreadsheet import, January 2024 / "+"A".repeat(120):null,internal_note:"INTERNAL-FIXTURE-PRIVATE",supplier_rate:99999}));return {data:{rows,count:23},error:null}}};}
    `,
    "@/lib/actions/quotes-orders": mockAction("saveQuoteAction") + mockAction("saveOrderAction") + mockAction("updateQuoteStatusAction"),
    "@/lib/actions/costing-rates": `export async function costingRateAction(){return {success:false,error:"Approved rates are outside this fixture"}}`,
    "@/lib/actions/repeat-quote": `export async function repeatQuoteAction(){return {success:false,error:"This fixture uses a fresh quotation"}}`,
    "@/lib/actions/in-task-customers": `export async function inTaskCustomerAction(){return {kind:"error",error:"Creation is outside this acceptance fixture"}}`,
    "@/lib/actions/order-stage-age": `export async function orderStageAgeAction(){return {rows:[]}}`,
    "@/lib/actions/dispatches": mockAction("saveDispatchAction"),
    "@/lib/actions/expenses": mockAction("saveManualExpenseAction"),
    "@/lib/actions/foundry": mockAction("saveFoundryBatchAction"),
    "@/lib/actions/packaging": mockAction("savePackagingJobAction"),
    "@/lib/actions/production": mockAction("saveProductionJobAction"),
    "next/navigation": `export function useRouter(){return {push(url){window.entryFixture.navigations.push(url)},refresh(){}}}export function useSearchParams(){return new URLSearchParams(location.search)}`,
    "next/link": `import React from "react";export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
    "sonner": `export const toast={error(text){window.entryFixture.messages.push(String(text));document.getElementById("fixture-message").textContent=text},success(text){document.getElementById("fixture-message").textContent=text},warning(){}};`,
  };
  const result = await build({ stdin: { sourcefile: "entry-acceptance.tsx", resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from "react";import {createRoot} from "react-dom/client";import {QuotesClient} from "./components/modules/quotes-client";import {ModuleDatabaseClient} from "./components/modules/operations/module-database-client";import {RecordFormClient} from "./components/modules/operations/record-form-client";
    const context={companyId:"${entryFixtureId(1)}",userId:"${entryFixtureId(2)}",role:"owner",dealerId:null};
    window.entryFixture={reads:[],posts:[],rpcCalls:[],messages:[],navigations:[],failRpc:false};const root=createRoot(document.getElementById("app"));
    window.renderEntry=screen=>{root.render(<React.Fragment key={screen}>{screen==="quote"?<QuotesClient context={context} mode="form"/>:screen==="foundry"?<RecordFormClient moduleKey="foundry" context={context}/>:<ModuleDatabaseClient moduleKey="inventory" context={context} canCreate={false}/>}</React.Fragment>);};
    const screen=new URLSearchParams(location.search).get("screen")||(location.pathname.startsWith("/inventory")?"database":"quote");window.renderEntry(screen);
    document.querySelectorAll("[data-entry-screen]").forEach(button=>button.addEventListener("click",()=>{location.href=button.dataset.entryScreen==="database"?"/inventory/database?page=2&search=AL":"/?screen="+button.dataset.entryScreen}));
    document.getElementById("fixture-failure").addEventListener("click",event=>{window.entryFixture.failRpc=!window.entryFixture.failRpc;event.currentTarget.textContent=window.entryFixture.failRpc?"Restore page responses":"Fail next page refresh"});
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "entry-acceptance-boundaries", setup(api) {
    for (const specifier of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: specifier, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  return result.outputFiles[0].text;
}

export async function createEntryAcceptanceServer({ styled = true, compileStyles = false } = {}) {
  const staticRoot = path.resolve(".next/static");
  const cssFiles = styled ? readdirSync(staticRoot, { recursive: true }).filter((name) => name.endsWith(".css")) : [];
  const fontVariable = cssFiles.map((name) => readFileSync(path.join(staticRoot, name), "utf8")).join("\n").match(/--font-jakarta\s*:[^;}]+/)?.[0] ?? "";
  const script = await buildEntryAcceptanceBundle();
  let sourceCss = null;
  if (compileStyles) {
    const config = loadTailwindConfig(path.resolve("tailwind.config.ts"));
    const css = readFileSync("app/globals.css", "utf8");
    sourceCss = (await postcss([tailwindcss(config)]).process(css, { from: path.resolve("app/globals.css") })).css;
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExtrusionOS entry and preview acceptance</title>${cssFiles.map((name) => `<link rel="stylesheet" href="/_next/static/${name.replaceAll("\\", "/")}">`).join("")}${sourceCss ? '<link rel="stylesheet" href="/fixture.css">' : ""}<style>:root{${fontVariable}}body{margin:0}.fixture-bar{padding:12px 20px;background:#f5f5f5;border-bottom:1px solid #ddd;font-size:12px}.fixture-nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.fixture-nav button{padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:white;font-weight:700}#app{max-width:1440px;margin:auto;padding:24px;min-width:0}@media(max-width:640px){#app{padding:12px}}</style></head><body><aside class="fixture-bar">Isolated acceptance: actual forms and tables; synthetic responses; no business records are saved.<nav class="fixture-nav" aria-label="Acceptance screens"><button data-entry-screen="quote">Quotation entry</button><button data-entry-screen="database">Inventory database</button><button data-entry-screen="foundry">Foundry entry</button><button id="fixture-failure">Fail next page refresh</button></nav><p id="fixture-message" role="status"></p></aside><main id="app"></main><script>window.process={env:{NODE_ENV:"test",__NEXT_IMAGE_OPTS:{deviceSizes:[],imageSizes:[],path:"/_next/image",loader:"default",remotePatterns:[],unoptimized:true}}};</script><script src="/fixture.js"></script></body></html>`;
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      response.setHeader("Cache-Control", "no-store");
      if (sourceCss && url.pathname === "/fixture.css") { response.setHeader("Content-Type", "text/css; charset=utf-8"); response.end(sourceCss); return; }
      if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(script); return; }
      if (styled && url.pathname.startsWith("/_next/static/")) {
        const file = path.resolve(staticRoot, decodeURIComponent(url.pathname.slice("/_next/static/".length)));
        if (!file.startsWith(staticRoot + path.sep) || !existsSync(file)) { response.writeHead(404).end(); return; }
        response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "font/woff2"); response.end(readFileSync(file)); return;
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
    } catch { response.writeHead(500).end("Fixture asset unavailable"); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise((done) => server.close(done)); } };
}
