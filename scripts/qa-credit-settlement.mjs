import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const Module = require("node:module");
const output = resolve(process.argv[2] ?? "artifacts/qa/credit-settlement");
const staticRoot = resolve(".next/static");
const cssFiles = readdirSync(resolve(staticRoot, "chunks")).filter(name => name.endsWith(".css"));
const styles = cssFiles.map(name => `<link rel="stylesheet" href="/_next/static/chunks/${name}">`).join("");
const fontClasses = [...new Set(cssFiles.flatMap(name => [...readFileSync(resolve(staticRoot, "chunks", name), "utf8")
  .matchAll(/\.([\w-]+)\s*\{[^{}]*--font-jakarta\s*:/g)].map(match => match[1])))].join(" ");
assert.ok(fontClasses);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let values = [], stateIndex = 0;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "react" && /\/(payment-form-client|dispatch-credit-note-client)\.tsx$/.test(parent?.filename.replaceAll("\\", "/") ?? "")) {
    return { ...React, useEffect() {}, useMemo: callback => callback(), useRef: initial => ({ current: initial }),
      useState(initial) { const index = stateIndex++; return [index in values ? values[index] : initial, () => {}]; },
      useTransition: () => [false, () => { throw new Error("Posting is outside isolated render QA"); }] };
  }
  if (request === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {} }) };
  if (request === "@/lib/supabase/browser") return { createClient: () => ({}) };
  if (["@/lib/actions/payments", "@/lib/actions/credit-notes"].includes(request)) return {};
  return originalLoad(request, parent, isMain);
};
let PaymentForm, ReturnCredit;
try {
  PaymentForm = require("../components/modules/financials/payment-form-client.tsx").PaymentFormClient;
  ReturnCredit = require("../components/modules/dispatch-credit-note-client.tsx").DispatchCreditNoteClient;
} finally { Module._load = originalLoad; }

function render(mode) {
  stateIndex = 0;
  if (mode === "return-credit") {
    values = ["Verified return of the full dispatch", ""];
    return ReturnCredit({ dispatchId: id(30), deliveryStatus: "returned", canManage: true, creditNote: null,
      invoice: { id: id(20), invoice_number: "INV-001", grand_total: 1000000, amount_paid: 250000, customer_credit_due: 0, status: "partially_paid" } });
  }
  values = [[{ id: id(20), invoice_number: "INV-001", invoice_date: "2026-01-01", due_date: null,
    grand_total: 1000000, amount_paid: 250000, balance_due: 750000, status: "partially_paid", order_id: id(15),
    customers: { customer_name: "Synthetic Customer" }, orders: { order_number: "ORD-001" } }],
  id(20), "2026-01-01", "25000", mode === "credit-adjustment" ? "credit_note" : "cash", "", "", false, null];
  return PaymentForm({ context: { companyId: id(1), role: "accounts" }, initialInvoiceId: id(20) });
}
const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/_next/static/")) {
      const target = resolve(staticRoot, decodeURIComponent(url.pathname.slice("/_next/static/".length)));
      if (!target.startsWith(staticRoot + sep)) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "Content-Type": extname(target) === ".css" ? "text/css" : "application/octet-stream" }).end(readFileSync(target));
      return;
    }
    const mode = url.searchParams.get("mode") ?? "credit-adjustment";
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      `<!doctype html><html lang="en" class="${fontClasses}"><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head><body><main style="max-width:1280px;margin:0 auto;padding:16px">${renderToStaticMarkup(render(mode))}</main></body></html>`
    );
  } catch { response.writeHead(500).end("Local QA rendering failed"); }
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
    for (const mode of ["credit-adjustment", "cash-receipt", "return-credit"]) {
      await page.goto(`${base}/?mode=${mode}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Plus Jakarta Sans/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} ${mode}: viewport overflow`);
      if (mode === "credit-adjustment") {
        assert.ok(await page.getByRole("heading", { name: "Record Credit Adjustment", exact: true }).isVisible());
        assert.ok(await page.getByText(/Use a standalone adjustment only/).isVisible());
        assert.ok(await page.getByRole("button", { name: "Post Credit Adjustment", exact: true }).isVisible());
      } else if (mode === "cash-receipt") {
        assert.ok(await page.getByRole("heading", { name: "Record Customer Receipt", exact: true }).isVisible());
        assert.ok(await page.getByRole("button", { name: "Post Receipt", exact: true }).isVisible());
        assert.equal(await page.getByText(/Use a standalone adjustment only/).count(), 0);
      } else {
        assert.ok(await page.getByText(/reverse that adjustment from Payments/).isVisible());
        assert.ok(await page.getByRole("button", { name: "Issue full dispatch credit note", exact: true }).isVisible());
      }
      await page.screenshot({ path: resolve(output, `${label}-${mode}.png`), fullPage: true });
      checks.push(`${label} ${mode}: bounded layout and visible posting guidance/control`);
    }
  }
  assert.deepEqual(errors, []);
  const result = { evidence: "Isolated component rendering with synthetic state and local built CSS/font; no Supabase, authentication or business writes. Posting events are covered by component tests, not this static browser check.", checks, errors };
  writeFileSync(resolve(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, output }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
