import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadTailwindConfig from "tailwindcss/loadConfig.js";
import { createCollaborationActionFixture } from "./collaboration-action-fixture.mjs";
import { ids, id, procedureInput } from "./collaboration-workflow-fixture.mjs";
import { buildEntryAcceptanceBundle } from "./entry-acceptance-browser-fixture.mjs";

export async function createCollaborationBrowserFixture() {
  const f = await createCollaborationActionFixture();
  const controls = { loseNextWrite: false, unavailable: false, failRead: false };
  const aliases = {
    "next/link": `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
    "next/navigation": `export function useRouter(){return {refresh(){window.collaborationFixture.refreshes++},push(url){location.href=url}}}export function useSearchParams(){return new URLSearchParams(location.search)}`
  };
  const bundle = await build({ stdin: { sourcefile: "collaboration-acceptance.tsx", resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {RecordDiscussion,ProcedureDirectory,ProcedureCreate,ProcedureDetail,RoutineDirectory,RoutineDetail} from './components/modules/operations/collaboration-tools';
    window.collaborationFixture={refreshes:0};const role=new URLSearchParams(location.search).get('role')||'owner';const context={companyId:'${ids.company}',userId:'${ids.actor}',role,dealerId:null,fullName:'Mira Sales'};
    const parts=location.pathname.split('/').filter(Boolean),kind=parts[1],target=parts[2];let screen;
    if(kind==='procedures')screen=target==='new'?<ProcedureCreate context={context}/>:target?<ProcedureDetail context={context} procedureId={target}/>:<ProcedureDirectory context={context}/>;
    else if(kind==='routines')screen=target?<RoutineDetail context={context} runId={target}/>:<RoutineDirectory/>;
    else screen=<RecordDiscussion context={context} entityType='order' entityId='${ids.order}'/>;
    createRoot(document.getElementById('app')).render(<React.StrictMode>{screen}</React.StrictMode>);
  ` }, bundle: true, write: false, jsx: "automatic", platform: "browser", format: "iife", plugins: [{ name: "collaboration-boundaries", setup(api) {
    for (const specifier of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: specifier, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: aliases[path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const quoteBundle = await buildEntryAcceptanceBundle();
  const fontCss = [300, 400, 500, 600, 700, 800].map(weight => `@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:${weight};font-display:swap;src:url('/fixture-fonts/${weight}.woff2') format('woff2')}`).join("");
  const css = fontCss + ":root{--font-jakarta:'Plus Jakarta Sans'}" + (await postcss([tailwindcss(loadTailwindConfig(path.resolve("tailwind.config.ts")))]).process(readFileSync("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  let base, queue = Promise.resolve();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, base);
    const send = (status, type, body) => { response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" }); response.end(body); };
    try {
      if (url.pathname === "/fixture.js") return send(200, "text/javascript", bundle.outputFiles[0].text);
      if (url.pathname === "/quote.js") return send(200, "text/javascript", quoteBundle);
      if (url.pathname === "/fixture.css") return send(200, "text/css", css);
      const font = /^\/fixture-fonts\/(300|400|500|600|700|800)\.woff2$/.exec(url.pathname);
      if (font) return send(200, "font/woff2", readFileSync(`node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-${font[1]}-normal.woff2`));
      if (url.pathname === "/api/collaboration-workflows") {
        let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 16000) return send(413, "application/json", '{}'); }
        const payload = JSON.parse(body), ref = new URL(request.headers.referer ?? base);
        const work = async () => {
          Object.assign(f.state, { actor: ids.actor, companyId: ids.company, role: ref.searchParams.get("role") ?? "owner", unavailable: controls.unavailable, rpcError: controls.failRead && /\.(list|people|load)$/.test(payload.command) ? { code: "XX000", message: "Synthetic read failure" } : null });
          if (!/\.(list|people|load)$/.test(payload.command) && controls.loseNextWrite) { f.state.loseConfirmation = true; controls.loseNextWrite = false; }
          const result = await f.post(new Request(`${base}/api/collaboration-workflows`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body }));
          return { status: result.status, body: await result.text() };
        };
        const pending = queue.then(work); queue = pending.catch(() => {});
        const result = await pending; return send(result.status, "application/json", result.body);
      }
      const quote = url.pathname === "/quote";
      return send(200, "text/html", `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExtrusionOS collaboration acceptance</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}.fixture-bar{background:#f3f4f6;padding:14px;font-size:12px}.fixture-nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}#app{max-width:1100px;margin:auto;padding:20px;display:grid;gap:20px;min-width:0}@media(max-width:640px){#app{padding:12px}}</style></head><body><aside class="fixture-bar">Isolated acceptance. Actual components, server actions and migration; synthetic auth and disposable PGlite data. Quotation save is captured without a business write.<nav class="fixture-nav"><a href="/discussion">Internal discussion</a><a href="/tasks/procedures">Process owners</a><a href="/tasks/routines">Daily routines</a><a href="/quote">Quotation</a><button id="fixture-failure" type="button" hidden>Entry failure toggle</button></nav><p id="fixture-message" role="status"></p></aside><main id="app"></main><script>window.process={env:{NODE_ENV:'test',__NEXT_IMAGE_OPTS:{deviceSizes:[],imageSizes:[],path:'/_next/image',loader:'default',remotePatterns:[],unoptimized:true}}};</script><script src="/${quote ? 'quote' : 'fixture'}.js"></script></body></html>`);
    } catch (error) { send(500, "application/json", JSON.stringify({ success: false, error: String(error.message) })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${server.address().port}`;
  async function reset() { await queue; await f.reset(); Object.assign(controls, { loseNextWrite: false, unavailable: false, failRead: false }); Object.assign(f.state, { role: "owner", actor: ids.actor, authenticated: true, dealerId: null, calls: [], paths: [], loseConfirmation: false, unavailable: false, rpcError: null }); }
  async function seed() { await f.command("procedures.create", procedureInput()); await f.command("routines.start", { procedure_id: id(1000), request_id: id(2000) }); }
  return { ...f, base, controls, reset, seed, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await f.close(); } };
}
