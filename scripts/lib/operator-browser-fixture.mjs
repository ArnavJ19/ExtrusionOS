import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadTailwindConfig from "tailwindcss/loadConfig.js";
import { createOperatorActionFixture } from "./operator-action-fixture.mjs";
import { workflowIds as ids, workflowId as id } from "./operator-workflow-fixture.mjs";
import { buildEntryAcceptanceBundle, entryFixtureId as entryId } from "./entry-acceptance-browser-fixture.mjs";

export async function createOperatorBrowserFixture() {
  const f = await createOperatorActionFixture();
  await f.db.exec(`insert into companies values('${entryId(1)}');insert into app_users values('${entryId(2)}','${entryId(1)}','owner',true,'Quote operator',null);
    insert into customers values('${entryId(20)}','${entryId(1)}','Quote customer',true,null);
    insert into aluminium_profiles values('${entryId(10)}','${entryId(1)}','AL-101','Window section',true),('${entryId(11)}','${entryId(1)}','AL-202','Door section',true);`);
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const { loadNotificationActions } = require("../../lib/operations/notification-actions.ts");
  const controls = { loseNextWrite: false, unavailable: false, settledInvoice: false, failSource: false, delayAlias: 0 };
  const aliases = {
    "next/link": `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
    "next/navigation": `export function useRouter(){return {refresh(){window.operatorFixture.refreshes++}}}`,
    "@/lib/actions/notifications": `export async function markNotificationReadAction(id){window.operatorFixture.receipts.push(id);return {success:true}}`,
    "sonner": `export const toast={error(message){window.operatorFixture.errors.push(message)}};`
  };
  const bundle = await build({ stdin: { sourcefile: "operator-acceptance.tsx", resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {CustomerAliasManager,CustomerCommitments,LocationGuidance,ProductionExceptions,CustomerCommitmentQueue} from './components/modules/operations/operator-tools';import {NotificationsClient} from './components/modules/notifications-client';
    window.operatorFixture={receipts:[],errors:[],refreshes:0};const root=createRoot(document.getElementById('app'));const role=new URLSearchParams(location.search).get('role')||'owner';const context={companyId:'${ids.company}',userId:'${ids.actor}',role,dealerId:null,fullName:'Mira Sales'};
    window.renderOperator=async(screen=(location.pathname==='/tasks/commitments'?'queue':location.pathname.startsWith('/customers/')?'customer':location.pathname.slice(1)||'customer'))=>{const notifications=screen==='notifications'?await fetch('/fixture-notifications?role='+encodeURIComponent(role)).then(r=>r.json()):[];root.render(<React.StrictMode><React.Fragment key={screen+role}>{screen==='customer'?<><CustomerAliasManager context={context} customerId='${ids.customer}'/><CustomerCommitments context={context} customerId='${ids.customer}' commitmentId={new URLSearchParams(location.search).get('commitment')||undefined}/></>:screen==='queue'?<CustomerCommitmentQueue context={context}/>:screen==='inventory'||screen==='die'?<LocationGuidance context={context} entityType={screen==='die'?'die':'inventory_item'} entityId={screen==='die'?'${ids.die}':'${ids.item}'}/>:screen==='production'?<ProductionExceptions context={context} jobId='${ids.job}'/>:<NotificationsClient notifications={notifications}/>}</React.Fragment></React.StrictMode>);};window.renderOperator();document.getElementById('refresh-screen').onclick=()=>window.renderOperator();
  ` }, bundle: true, write: false, jsx: "automatic", platform: "browser", format: "iife", plugins: [{ name: "operator-boundaries", setup(api) {
    for (const specifier of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: specifier, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const quoteBundle = await buildEntryAcceptanceBundle();
  const css = (await postcss([tailwindcss(loadTailwindConfig(path.resolve("tailwind.config.ts")))]).process(readFileSync("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  let base, queue = Promise.resolve();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, base);
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); };
    try {
      if (url.pathname === "/fixture.js") return send(200, "text/javascript", bundle.outputFiles[0].text);
      if (url.pathname === "/quote.js") return send(200, "text/javascript", quoteBundle);
      if (url.pathname === "/fixture.css") return send(200, "text/css", css);
      if (url.pathname === "/api/operator-workflows") {
        let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 16000) return send(413, "application/json", '{}'); }
        const payload = JSON.parse(body), ref = new URL(request.headers.referer ?? base);
        const work = async () => {
          const quote = ref.pathname === "/quote";
          Object.assign(f.state, { actor: quote ? entryId(2) : ids.actor, companyId: quote ? entryId(1) : ids.company, role: ref.searchParams.get("role") ?? "owner", unavailable: controls.unavailable });
          if (payload.command === "aliases.search" && controls.delayAlias) await new Promise(resolve => setTimeout(resolve, controls.delayAlias));
          const read = /\.(list|load|search|history|queue)$/.test(payload.command);
          if (!read && controls.loseNextWrite) { f.state.loseConfirmation = true; controls.loseNextWrite = false; }
          const result = await f.post(new Request(`${base}/api/operator-workflows`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body }));
          return { status: result.status, body: await result.text() };
        };
        const pending = queue.then(work); queue = pending.catch(() => {});
        const result = await pending; return send(result.status, "application/json", result.body);
      }
      if (url.pathname === "/fixture-notifications") {
        const notification = { id: id(600), title: "Invoice overdue", body: "Recorded overdue invoice alert", notification_type: "overdue_invoice", related_entity_type: "invoice", related_entity_id: id(601), severity: "warning", createdAt: "2026-10-20T04:30:00Z", isRead: false };
        const client = { from() { const q = { select() { return q; }, eq() { return q; }, in() { return q; }, is() { return q; }, async limit() { return { data: [{ id: id(601), status: controls.settledInvoice ? "paid" : "overdue", due_date: "2026-10-01", balance_due: controls.settledInvoice ? 0 : 100 }], error: controls.failSource ? { message: "Synthetic source unavailable" } : null }; } }; return q; } };
        const actions = await loadNotificationActions(client, { role: url.searchParams.get("role") ?? "owner", companyId: ids.company, userId: ids.actor }, [notification], "2026-10-21");
        return send(200, "application/json", JSON.stringify([{ ...notification, action: actions[notification.id] }]));
      }
      const quote = url.pathname === "/quote";
      return send(200, "text/html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExtrusionOS operator acceptance</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}.fixture-bar{background:#f3f4f6;padding:14px;font-size:12px}.fixture-nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}#app{max-width:1100px;margin:auto;padding:20px;display:grid;gap:20px;min-width:0}@media(max-width:640px){#app{padding:12px}}</style></head><body><aside class="fixture-bar">Isolated acceptance. Actual components and server actions; synthetic auth and disposable PGlite data. No hosted business writes.<nav class="fixture-nav">${['customer','inventory','die','production','notifications','quote'].map(screen => `<a href="/${screen}">${screen}</a>`).join('')}<button id="refresh-screen" type="button">Refresh screen</button><button id="fixture-failure" type="button" hidden>Entry fixture failure toggle</button></nav><p id="fixture-message" role="status"></p></aside><main id="app"></main><script>window.process={env:{NODE_ENV:'test',__NEXT_IMAGE_OPTS:{deviceSizes:[],imageSizes:[],path:'/_next/image',loader:'default',remotePatterns:[],unoptimized:true}}};</script><script src="/${quote ? 'quote' : 'fixture'}.js"></script></body></html>`);
    } catch (error) { send(500, "application/json", JSON.stringify({ success: false, error: String(error.message) })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}`;
  async function reset() { await queue; await f.reset(); Object.assign(controls, { loseNextWrite: false, unavailable: false, settledInvoice: false, failSource: false, delayAlias: 0 }); Object.assign(f.state, { calls: [], paths: [], loseConfirmation: false, unavailable: false }); }
  async function seedQuoteAliases() {
    for (const [n, code] of [[800, "AL-101"], [801, "AL-202"]]) await f.command("aliases.create", { customer_id: entryId(20), profile_code: code, alias: "Customer 45", request_id: id(n) }, { actor: entryId(2) });
  }
  return { ...f, base, controls, reset, seedQuoteAliases, close: async () => { await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
