import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

const id = (number) => `f1000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const financialBrowserIds = {
  company: id(1), user: id(2), order: id(3), dispatch: id(4), customer: id(5),
  invoiceA: id(6), invoiceB: id(7), payment: id(8), sourceLine: id(9)
};

export async function createFinancialWorkflowReviewBrowserFixture() {
  const ids = financialBrowserIds;
  const bundle = await build({
    stdin: {
      sourcefile: "financial-workflow-review-browser.tsx",
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { FinancialWorkflowReviewClient } from "./components/modules/financials/financial-workflow-review";
        const root=createRoot(document.getElementById("app"));
        root.render(<FinancialWorkflowReviewClient mode={location.pathname.includes("eligibility")?"eligibility":"receipts"}/>);
      `
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "financial-review-browser-boundaries",
      setup(plugin) {
        plugin.onResolve({ filter: /^@\/lib\/actions\/financial-workflow-review$/ }, () => ({ path: "actions", namespace: "fixture" }));
        plugin.onResolve({ filter: /^@\/lib\/utils\/format$/ }, () => ({ path: "format", namespace: "fixture" }));
        plugin.onResolve({ filter: /^@\/components\/ui\/button$/ }, () => ({ path: "button", namespace: "fixture" }));
        plugin.onResolve({ filter: /^@\/components\/ui\/card$/ }, () => ({ path: "card", namespace: "fixture" }));
        plugin.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
        plugin.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
        plugin.onResolve({ filter: /^sonner$/ }, () => ({ path: "sonner", namespace: "fixture" }));
        plugin.onResolve({ filter: /^lucide-react$/ }, () => ({ path: "icons", namespace: "fixture" }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "tsx",
          resolveDir: process.cwd(),
          contents: args.path === "actions" ? `
            const id=n=>"f1000000-0000-4000-8000-"+String(n).padStart(12,"0");
            export async function searchInvoiceEligibilityOrdersAction(input){window.__financial.calls.push({name:"orders",input});return {success:true,rows:[{id:id(3),order_number:"ORD-FIN-03",customer_name:"Kaveri Systems",company_name:"Kaveri Systems",current_stage:"dispatched",order_value:1000}],hasMore:false}}
            export async function searchInvoiceEligibilityDispatchesAction(input){window.__financial.calls.push({name:"dispatches",input});return {success:true,rows:[{id:id(4),order_id:id(3),dispatch_number:"DSP-FIN-04",dispatch_date:"2026-10-28",delivery_status:"delivered",total_weight_kg:10}],hasMore:false}}
            export async function reviewInvoiceDispatchAction(input){window.__financial.calls.push({name:"review",input});return window.__financial.reviewResult}
            export async function searchOpenReceivableInvoicesAction(input){window.__financial.calls.push({name:"receivables",input});return {success:true,data:{rows:window.__financial.invoices,hasMore:false}}}
            export async function postFinancialReceiptAction(input){window.__financial.calls.push({name:"post",input});return window.__financial.postResult}
            export async function importFinancialReceiptCsvAction(input){window.__financial.calls.push({name:"import",input});return window.__financial.importResult}
            export async function previewFinancialCorrectionAction(input){window.__financial.calls.push({name:"correctionPreview",input});return window.__financial.correctionPreview}
            export async function applyFinancialCorrectionAction(input){window.__financial.calls.push({name:"correctionApply",input});return {success:true,data:{payment_id:input.record_id}}}
          ` : args.path === "format" ? `
            export const formatCurrency=value=>"INR "+Number(value??0).toFixed(2);
            export const formatWeight=value=>Number(value??0).toFixed(3)+" kg";
            export const todayIso=()=>"2026-10-29";
          ` : args.path === "button" ? `
            import React from "react";export function Button({children,...props}){return <button {...props}>{children}</button>}
          ` : args.path === "card" ? `
            import React from "react";export const Card=({children,...props})=><section {...props}>{children}</section>;
            export const CardContent=({children,...props})=><div {...props}>{children}</div>;
            export const CardHeader=({children,...props})=><header {...props}>{children}</header>;
          ` : args.path === "link" ? `
            import React from "react";export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}
          ` : args.path === "navigation" ? `
            export const useRouter=()=>({refresh(){window.__financial.refreshes++}});
          ` : args.path === "sonner" ? `
            export const toast={success(message){window.__financial.toasts.push(message)},error(message){window.__financial.toasts.push(message)}};
          ` : `
            import React from "react";const Icon=props=><span aria-hidden="true" {...props}/>;
            export const AlertTriangle=Icon,ArrowRight=Icon,FileSpreadsheet=Icon,ReceiptText=Icon,RotateCcw=Icon,ShieldCheck=Icon;
          `
        }));
      }
    }]
  });

  const browserPath = process.env.CHROME_PATH ?? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ].find(existsSync);
  const state = {
    calls: [], refreshes: 0, toasts: [],
    invoices: [
      { id: ids.invoiceA, invoice_number: "INV-FIN-006", invoice_date: "2026-10-01", due_date: "2026-10-10", grand_total: 118, amount_paid: 0, credited_amount: 0, balance_due: 118, status: "overdue", customer_name: "Kaveri Systems", order_number: "ORD-FIN-03", overdue_days: 19 },
      { id: ids.invoiceB, invoice_number: "INV-FIN-007", invoice_date: "2026-10-20", due_date: "2026-11-19", grand_total: 236, amount_paid: 0, credited_amount: 0, balance_due: 236, status: "generated", customer_name: "Kaveri Systems", order_number: "ORD-FIN-03", overdue_days: 0 }
    ],
    reviewResult: { success: true, data: {
      order_id: ids.order, order_number: "ORD-FIN-03", customer_id: ids.customer, customer_name: "Kaveri Systems",
      dispatch_id: ids.dispatch, dispatch_number: "DSP-FIN-04", dispatch_date: "2026-10-28", delivery_status: "delivered",
      source_fingerprint: "a1".repeat(16), default_gst_percent: 18, subtotal: 1000, tax_total: 180, grand_total: 1180,
      rows: [{ source_line_id: ids.sourceLine, bundle_number: "BND-FIN-09", profile_id: null, description: "Extrusion profile bundle", hsn_code: "760421", quantity_kg: 10, rate_per_kg: 100, line_total: 1000, gst_percent: 18, tax_amount: 180 }]
    } },
    postResult: { success: true, data: { receipt_id: id(20), received_amount: 100, payment_method: "bank_transfer", status: "posted", idempotent_replay: false,
      allocations: [{ invoice_id: ids.invoiceA, payment_id: ids.payment, amount: 60, payment_status: "PAID", balance_due: 58, invoice_status: "partially_paid" },
        { invoice_id: ids.invoiceB, payment_id: id(21), amount: 40, payment_status: "PAID", balance_due: 196, invoice_status: "partially_paid" }] } },
    importResult: { success: true, data: { batch_id: id(22), source_fingerprint: "bb".repeat(32), row_count: 2, posted_count: 1, failed_count: 1, idempotent_replay: false,
      rows: [{ row_number: 2, status: "posted", error: null, receipt_event_id: id(20), payment_id: ids.payment }, { row_number: 3, status: "failed", error: "Invoice number was not found for this company", receipt_event_id: null, payment_id: null }] } },
    correctionPreview: { success: true, data: { record_type: "payment", record_id: ids.payment, fingerprint: "cc".repeat(32), state: "posted receipt", summary: "Reverse this posted receipt with a recorded reason.", route: "reverse_receipt", edit_url: null, adjustment_limit: null } }
  };

  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle.outputFiles[0].contents);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main style="max-width:1280px;margin:auto;padding:16px"><div id="app"></div></main><script>window.__financial=${JSON.stringify(state).replaceAll("</", "<\\/")};window.__financial.invoices=${JSON.stringify(state.invoices)};window.__financial.reviewResult=${JSON.stringify(state.reviewResult)};window.__financial.postResult=${JSON.stringify(state.postResult)};window.__financial.importResult=${JSON.stringify(state.importResult)};window.__financial.correctionPreview=${JSON.stringify(state.correctionPreview)};</script><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
    const context = await browser.newContext();
    const base = `http://127.0.0.1:${server.address().port}`;
    await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    return {
      page, base, errors, ids,
      async open(mode) { await page.goto(`${base}/${mode}`); },
      async close() { await browser.close(); server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    };
  } catch (error) {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    throw error;
  }
}
