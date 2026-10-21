import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildWorkflowBrowserBundle } from "./lib/workflow-browser-bundle.mjs";

const staticRoot = path.resolve(".next/static");
if (!existsSync(staticRoot)) throw new Error("Build the intended checkout before starting this visual fixture.");
const cssFiles = readdirSync(staticRoot, { recursive: true }).filter((name) => name.endsWith(".css"));
const fontVariable = cssFiles.map((name) => readFileSync(path.join(staticRoot, name), "utf8")).join("\n").match(/--font-jakarta\s*:[^;}]+/)?.[0] ?? "";
const script = await buildWorkflowBrowserBundle();
const imageOptions = { deviceSizes: [640, 750, 1080], imageSizes: [32, 64], path: "/_next/image", loader: "default", remotePatterns: [], unoptimized: true };
const screens = [["search", "Find records"], ["quote-detail", "Quote details"], ["repeat", "Repeat quotation"], ["dispatch", "Dispatch review"], ["stage", "Stage waiting"]];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExtrusionOS workflow upgrade visual acceptance</title>${cssFiles.map((name) => `<link rel="stylesheet" href="/_next/static/${name.replaceAll("\\", "/")}">`).join("")}<style>:root{${fontVariable}}body{margin:0}.fixture-bar{padding:12px 20px;background:#f5f5f5;border-bottom:1px solid #ddd;font-size:12px}.fixture-nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.fixture-nav button{padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:white;font-weight:700}#app{max-width:1440px;margin:auto;padding:24px}@media(max-width:640px){#app{padding:12px}}</style></head><body><aside class="fixture-bar">Isolated visual acceptance. Real components and built application styles; synthetic data and in-memory posting only.<nav class="fixture-nav" aria-label="Visual fixture screens">${screens.map(([screen, label]) => `<button data-workflow-screen="${screen}">${label}</button>`).join("")}</nav><p id="fixture-message" role="status"></p></aside><main id="app"></main><script>window.process={env:{NODE_ENV:"test",__NEXT_IMAGE_OPTS:${JSON.stringify(imageOptions)}}};</script><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(script); return; }
    if (url.pathname.startsWith("/_next/static/")) {
      const file = path.resolve(staticRoot, decodeURIComponent(url.pathname.slice("/_next/static/".length)));
      if (!file.startsWith(`${staticRoot}${path.sep}`) || !existsSync(file)) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "font/woff2"); response.end(readFileSync(file)); return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
  } catch { response.writeHead(500).end("Fixture asset unavailable"); }
});
server.listen(0, "127.0.0.1", () => console.log(`Workflow visual fixture: http://127.0.0.1:${server.address().port}/`));
process.stdin.resume();
process.stdin.on("data", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
