import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

// Local visual fixture: real editor and built application CSS, synthetic data only.
const root = process.cwd();
const staticRoot = path.resolve(root, ".next/static");
if (!existsSync(staticRoot)) throw new Error("Run npm run build in the intended checkout first.");
const cssPaths = readdirSync(staticRoot, { recursive: true }).filter((name) => name.endsWith(".css"));
const css = cssPaths.map((name) => readFileSync(path.join(staticRoot, name), "utf8")).join("\n");
const fontVariable = css.match(/--font-jakarta\s*:[^;}]+/)?.[0] ?? "";
const fixtureCustomers = [
  { id: "30000000-0000-4000-8000-000000000002", customer_name: "Mira Shah", company_name: "Mira Fabrication and Aluminium Window Systems", customer_type: "fabricator", phone: "+91 98765 43210", email: null, gst_number: "27ABCDE1234F1Z5", billing_address: "Fixture billing address", shipping_address: null, city: "Pune", is_active: true },
  { id: "30000000-0000-4000-8000-000000000003", customer_name: "Mira Shah Works", company_name: "Mira Fabrication - old inactive account", customer_type: "fabricator", phone: "9876543210", email: null, gst_number: null, billing_address: null, shipping_address: null, city: "Pune", is_active: false },
];
const mocks = {
  "@/lib/supabase/browser": `
    const customers=${JSON.stringify(fixtureCustomers)};
    const profile={id:"profile-a",profile_code:"AL-101",profile_name:"Window section",section_weight_kg_per_m:0.8,section_perimeter_mm:120,drawing_revision:"A",drawing_approval_status:"approved"};
    export function createClient(){return {from(table){const q={select(){return this},eq(){return this},is(){return this},order(){return this},limit(){return this},or(){return this},ilike(){return this},in(){return this},maybeSingle(){return this},then(resolve,reject){let data=[];if(table==="customers")data=customers.filter(c=>c.is_active);else if(table==="aluminium_profiles")data=[profile];else if(table==="company_settings_authorized")data={default_conversion_charge_per_kg:30,default_packing_charge:20,default_transport_charge:10,default_margin_percent:10,minimum_margin_percent:8,default_gst_percent:18};return Promise.resolve({data,error:null}).then(resolve,reject)}};return q}}}
  `,
  "@/lib/actions/in-task-customers": `
    const customers=${JSON.stringify(fixtureCustomers)};const created=new Map();let writes=0;
    const updateCount=()=>document.getElementById("master-writes").textContent=String(writes);
    export async function inTaskCustomerAction(request){
      if(request.intent==="select"){const customer=customers.find(c=>c.id===request.customer_id&&c.is_active);return customer?{kind:"selected",customer}:{kind:"error",error:"That customer is no longer available."}}
      if(request.intent==="create"&&created.has(request.request_id))return {kind:"created",customer:created.get(request.request_id)};
      const text=[request.customer.customer_name,request.customer.company_name].join(" ").toLowerCase();
      const matches=text.includes("mira")?customers.map(({id,customer_name,company_name,phone,gst_number,is_active})=>({id,customer_name,company_name,phone,gst_number,is_active,matched_on:["customer name"]})):[];
      if(request.intent==="check")return {kind:"checked",matches,hasMore:false};
      if(matches.length&&!request.acknowledge_similar)return {kind:"similar",matches,hasMore:false};
      const customer={...request.customer,id:request.request_id,is_active:true};created.set(request.request_id,customer);writes++;updateCount();
      if(text.includes("retry"))return {kind:"error",error:"Fixture: confirmation was lost after the customer was saved. Check the saved result.",uncertain:true};
      return {kind:"created",customer};
    }
  `,
  "@/lib/actions/quotes-orders": `export async function saveQuoteAction(){document.getElementById("quote-writes").textContent=String(Number(document.getElementById("quote-writes").textContent)+1);return {success:true}} export async function updateQuoteStatusAction(){return {error:"Workflow writes are outside this visual fixture"}}`,
  "sonner": `export const toast={error(message){document.getElementById("fixture-message").textContent=message},success(message){document.getElementById("fixture-message").textContent=message},warning(){}};`,
};
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "visual-in-task-customer.tsx", loader: "tsx", contents: `
    import React from "react";import {createRoot} from "react-dom/client";
    import {QuotesClient} from "./components/modules/quotes-client";
    createRoot(document.getElementById("app")).render(<QuotesClient context={{companyId:"10000000-0000-4000-8000-000000000001",userId:"20000000-0000-4000-8000-000000000001",role:"owner"}} mode="form"/>);
  ` },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  plugins: [{ name: "synthetic-customer-boundaries", setup(api) {
    api.onResolve({ filter: /^(?:sonner|@\/lib\/supabase\/browser|@\/lib\/actions\/(?:quotes-orders|in-task-customers))$/ }, ({ path: name }) => ({ path: name, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({ contents: mocks[name], loader: "tsx", resolveDir: root }));
  } }],
});
const imageOptions = { deviceSizes: [640, 750, 1080], imageSizes: [32, 64], path: "/_next/image", loader: "default", domains: [], disableStaticImages: false, minimumCacheTTL: 60, formats: [], dangerouslyAllowSVG: false, contentSecurityPolicy: "", contentDispositionType: "attachment", remotePatterns: [], unoptimized: true };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExtrusionOS customer creation visual fixture</title>${cssPaths.map((name) => `<link rel="stylesheet" href="/_next/static/${name.replaceAll("\\", "/")}">`).join("")}<style>:root{${fontVariable}}body{margin:0}.fixture-banner{padding:12px 20px;border-bottom:1px solid #d4d4d4;background:#f5f5f5;font-size:12px}#app{max-width:1440px;margin:auto;padding:24px}@media(max-width:640px){#app{padding:12px}}</style></head><body><aside class="fixture-banner">Isolated visual fixture. Synthetic customer data. Customer records created: <b id="master-writes">0</b>. Quotations saved: <b id="quote-writes">0</b>. <span id="fixture-message" role="status"></span></aside><main id="app"></main><script>window.process={env:{NODE_ENV:"test",__NEXT_IMAGE_OPTS:${JSON.stringify(imageOptions)}}};</script><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
  if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(bundle.outputFiles[0].contents); return; }
  if (url.pathname.startsWith("/_next/static/")) {
    const file = path.resolve(staticRoot, decodeURIComponent(url.pathname.slice("/_next/static/".length)));
    if (file.startsWith(`${staticRoot}${path.sep}`) && existsSync(file)) {
      response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "font/woff2"); response.end(readFileSync(file)); return;
    }
  }
  response.statusCode = 404; response.end("Not found");
});
server.listen(0, "127.0.0.1", () => console.log(`Visual fixture: http://127.0.0.1:${server.address().port}/`));
process.stdin.resume();
process.stdin.on("data", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
