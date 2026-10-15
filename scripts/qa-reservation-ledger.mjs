import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const output = resolve(process.argv[2] ?? "artifacts/qa/reservation-ledger");
const staticRoot = resolve(".next/static");
const cssFiles = readdirSync(resolve(staticRoot, "chunks")).filter(name => name.endsWith(".css"));
const styles = cssFiles.map(name => `<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
const fontClasses = [...new Set(cssFiles.flatMap(name => [...readFileSync(resolve(staticRoot, "chunks", name), "utf8")
  .matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match => match[1])))].join(" ");
assert.ok(fontClasses, "The built application font variable must be present in isolated page QA");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let mode = "verified";
function snapshot(page) {
  const rows = Array.from({ length: 10 }, (_, n) => ({
    id: id((page - 1) * 10 + n + 10), order_id: id(2), profile_code: "P-001", profile_name: "Sliding Track",
    order_number: "O-001", customer_name: "Synthetic Customer", bundle_number: `B-${n + 1}`, location: "Rack A",
    status: "active", created_at: "2026-10-15T00:00:00Z", released_at: null, notes: "Synthetic QA fixture",
    reserved_weight_kg: 2000, consumed_weight_kg: 1501, open_weight_kg: 499, released_weight_kg: 0,
    reserved_length_m: 1000, consumed_length_m: 750.5, open_length_m: 249.5, released_length_m: 0,
    reserved_pieces: 2000, consumed_pieces: 1501, open_pieces: 499, released_pieces: 0
  }));
  return { page, page_size: 10, total_count: 1001, integrity_ok: true,
    summary: { active_count: 1001, open_weight_kg: 499499, consumed_weight_kg: 1502501, released_weight_kg: 0 }, rows };
}
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/auth") return { getSessionContext: async () => ({ companyId: id(1), role: "inventory_manager" }) };
  if (request === "@/lib/supabase/server") return { createClient: async () => {
    const currentMode = mode;
    return { rpc: async (name, args) => {
      assert.equal(name, "get_profile_stock_reservation_ledger_page");
      return currentMode === "unavailable" ? { data: null, error: new Error("Synthetic transport unavailable") }
        : { data: snapshot(args.p_page), error: null };
    } };
  } };
  return originalLoad(request, parent, isMain);
};
let Page;
try { Page = require("../app/(dashboard)/inventory/reservations/page.tsx").default; }
finally { Module._load = originalLoad; }

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/_next/static/")) {
      const target = resolve(staticRoot, decodeURIComponent(url.pathname.slice("/_next/static/".length)));
      if (!target.startsWith(staticRoot + sep)) { response.writeHead(404).end(); return; }
      const contentType = extname(target) === ".css" ? "text/css" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType }).end(readFileSync(target));
      return;
    }
    mode = url.searchParams.get("mode") === "unavailable" ? "unavailable" : "verified";
    const tree = await Page({ searchParams: Promise.resolve(Object.fromEntries(url.searchParams)) });
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      `<!doctype html><html lang="en" class="${fontClasses}"><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body><main style="max-width:1280px;margin:0 auto;padding:16px">${renderToStaticMarkup(tree)}</main></body></html>`
    );
  } catch {
    response.writeHead(500).end("Local QA rendering failed");
  }
});

let browser;
try {
  await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  mkdirSync(output, { recursive: true });
  const checks = [];
  for (const [label, width, height] of [["desktop", 1440, 1000], ["tablet", 820, 1180], ["mobile", 390, 844], ["compact-mobile", 320, 720]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + "/inventory/reservations", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Plus Jakarta Sans/);
    assert.equal(await page.locator("tbody tr").count(), 10);
    assert.ok(await page.getByRole("navigation", { name: "Reservation pages" }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: viewport overflow`);
    const consumedValue = page.getByText("Consumed stock", { exact: true }).locator("..").locator("p").nth(1);
    assert.ok(await consumedValue.evaluate(value => value.scrollWidth <= value.clientWidth + 1), `${label}: quantity text overflow`);
    if (width < 768) assert.ok(await page.locator("table").evaluate(table => table.parentElement.scrollWidth > table.parentElement.clientWidth));
    await page.screenshot({ path: resolve(output, `${label}-verified.png`), fullPage: true });
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await page.waitForURL(/page=2/);
    assert.match(await page.getByRole("navigation", { name: "Reservation pages" }).innerText(), /Page 2/);
    await page.goto(base + "/inventory/reservations?mode=unavailable", { waitUntil: "networkidle" });
    assert.ok(await page.getByText("Reservation ledger is unavailable", { exact: true }).isVisible());
    assert.equal(await page.locator("table").count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: resolve(output, `${label}-unavailable.png`), fullPage: true });
    checks.push(`${label}: ten rows, bounded layout, local table scrolling, next page and unavailable state`);
  }
  assert.deepEqual(errors, []);
  const result = { evidence: "Synthetic server-rendered page with built CSS and isolated browser; no Supabase connection, migrations, real login or business writes", checks, errors };
  writeFileSync(resolve(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, output }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
