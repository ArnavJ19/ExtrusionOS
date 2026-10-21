import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

export const allocationId = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const allocationContext = { companyId: allocationId(1), userId: allocationId(2), role: "owner", dealerId: null };
export const allocationBillet = (overrides = {}) => ({
  id: allocationId(3), company_id: allocationContext.companyId, billet_code: "BILLET-A", alloy: "6063", temper: "T6",
  billet_diameter_inch: 5, status: "cast", order_id: null, production_job_id: null, ...overrides,
});
export const allocationRequirement = (overrides = {}) => ({
  id: allocationId(4), company_id: allocationContext.companyId, order_id: allocationId(5), alloy: "6063",
  billet_diameter_inch: 5, billets_required: 2, billets_allocated: 0, billets_short: 2, status: "pending",
  orders: { order_number: "ORDER-A", priority: "normal", current_stage: "order_confirmed" }, ...overrides,
});

export async function createBilletAllocationBrowserFixture({ styled = false } = {}) {
  const staticRoot = resolve(".next/static");
  let styles = "", fonts = "";
  if (styled) {
    const files = readdirSync(resolve(staticRoot, "chunks")).filter(name => name.endsWith(".css"));
    styles = files.map(name => `<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
    fonts = [...new Set(files.flatMap(name => [...readFileSync(resolve(staticRoot, "chunks", name), "utf8")
      .matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match => match[1])))].join(" ");
    if (!fonts) throw new Error("Build the application before styled allocation QA");
  }
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "billet-allocation-fixture.tsx", loader: "tsx", contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {BilletAllocationClient} from './components/modules/foundry/billet-allocation-client';
      window.__allocation = {reads: [], saves: [], notices: []};
      function Fixture() {
        const [billetId, setBilletId] = useState('${allocationId(3)}');
        const [context, setContext] = useState(${JSON.stringify(allocationContext)});
        const [mounted, setMounted] = useState(true);
        // A controlled unmount must commit before a test resolves an obsolete request.
        Object.assign(window.__allocation, {setBilletId, setContext, setMounted: value => flushSync(() => setMounted(value))});
        return mounted ? <BilletAllocationClient context={context} billetId={billetId}/> : <p>Panel unmounted</p>;
      }
      createRoot(document.getElementById('app')).render(<Fixture/>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "controlled-allocation-transport", setup(plugin) {
      for (const [filter, path] of [[/^@\/lib\/supabase\/browser$/, "client"], [/^@\/lib\/actions\/production$/, "actions"], [/^sonner$/, "toasts"]]) {
        plugin.onResolve({ filter }, () => ({ path, namespace: "fixture" }));
      }
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path === "client" ? `
        export function createClient() { return {from(table) {
          const call = {table, filters: []};
          let promise;
          const run = () => promise ||= new Promise((resolve, reject) => {
            Object.assign(call, {resolve, reject}); window.__allocation.reads.push(call);
          });
          const query = {select(columns) {call.columns = columns; return query},
            eq(key, value) {call.filters.push(['eq', key, value]); return query},
            in(key, value) {call.filters.push(['in', key, value]); return query},
            ilike(key, value) {call.filters.push(['ilike', key, value]); return query},
            gt(key, value) {call.filters.push(['gt', key, value]); return query},
            order(key, options) {call.order = [key, options]; return query},
            single() {return run()}, then(yes, no) {return run().then(yes, no)}};
          return query;
        }, rpc(name, args) {return new Promise((resolve, reject) => window.__allocation.reads.push({kind:'rpc',name,args,resolve,reject}));}}};
      ` : args.path === "actions" ? `
        const save = (name, input) => new Promise((resolve, reject) => window.__allocation.saves.push({name, input, resolve, reject}));
        export const allocateBilletToOrderAction = input => save('allocate', input);
        export const reallocateBilletToOrderAction = input => save('reallocate', input);
      ` : `export const toast = {error: text => window.__allocation.notices.push({kind:'error', text}), success: text => window.__allocation.notices.push({kind:'success', text})};` }));
    } }],
  });
  const server = createServer((request, response) => {
    try {
      if (request.url === "/fixture.js") {
        response.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle.outputFiles[0].contents);
      } else if (styled && request.url.startsWith("/_next/static/")) {
        const target = resolve(staticRoot, decodeURIComponent(request.url.slice("/_next/static/".length)));
        if (!target.startsWith(staticRoot + sep)) { response.writeHead(404).end(); return; }
        response.writeHead(200, { "Content-Type": extname(target) === ".css" ? "text/css" : "application/octet-stream" }).end(readFileSync(target));
      } else {
        response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html lang="en" class="${fonts}"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><main style="max-width:1280px;margin:auto;padding:16px"><div id="app"></div></main><script src="/fixture.js"></script></body></html>`);
      }
    } catch { response.writeHead(500).end("Allocation fixture unavailable"); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(), base = `http://127.0.0.1:${server.address().port}`;
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    return {
      page, errors,
      async open() { errors.length = 0; await page.goto(base); await page.waitForFunction(() => window.__allocation?.reads.length === 1); },
      async read(index, result, { reject = false } = {}) {
        await page.waitForFunction(index => Boolean(window.__allocation.reads[index]), index);
        await page.evaluate(({ index, result, reject }) => {
          const call = window.__allocation.reads[index];
          if (reject) { call.reject(new Error(result)); return; }
          // Older lifecycle cases supply synthetic requirement rows. Keep their
          // controlled transport while exercising the real new response parser.
          if (call.kind === "rpc" && Array.isArray(result?.data)) {
            const prior = window.__allocation.reads.slice(0, index).reverse().find(row => row.table === "foundry_billets" && row.result?.data?.id === call.args.p_billet_id)?.result.data;
            const billet = { ...prior, temper: prior?.temper ?? null, production_job_id: prior?.production_job_id ?? null,
              billet_diameter_inch: prior?.billet_diameter_inch == null ? null : Number(prior.billet_diameter_inch) };
            const items = result.data.map(row => row === null ? null : ({ company_id: row.company_id, order_id: row.order_id,
              order_number: row.orders?.order_number ?? "Order", priority: row.orders?.priority ?? "normal", current_stage: row.orders?.current_stage ?? "order_confirmed",
              requirement_count: 1, billets_required: row.billets_required, billets_allocated: row.billets_allocated, billets_short: row.billets_short }));
            result = { ...result, data: { company_id: billet.company_id, billet, search: call.args.p_search, page: 1, page_size: 10, total_count: items.length, items } };
          }
          call.result = result;
          call.resolve(result);
        }, { index, result, reject });
      },
      async ready({ billet = allocationBillet(), requirements = [allocationRequirement()], start = 0 } = {}) {
        await this.read(start, { data: { ...billet, billet_diameter_inch: billet.billet_diameter_inch == null ? null : Number(billet.billet_diameter_inch) }, error: null });
        if (["cast", "allocated"].includes(billet.status) && !billet.production_job_id) await this.read(start + 1, { data: requirements, error: null });
        await page.getByRole("heading", { name: "Manual Order Allocation" }).waitFor();
        await page.waitForFunction(() => !document.body.innerText.includes("Loading billet allocation"));
      },
      async selectOrder(name = "ORDER-A") { await page.getByPlaceholder("Select order").click(); await page.getByRole("button", { name: new RegExp(`^${name} -`) }).click(); },
      async save(index, result, { reject = false } = {}) {
        await page.waitForFunction(index => Boolean(window.__allocation.saves[index]), index);
        await page.evaluate(({ index, result, reject }) => {
          const call = window.__allocation.saves[index];
          if (reject) call.reject(new Error(result)); else call.resolve(result);
        }, { index, result, reject });
      },
      async close() { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); },
    };
  } catch (error) {
    if (browser) await browser.close();
    server.closeAllConnections(); await new Promise(done => server.close(done)); throw error;
  }
}
