import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadTailwindConfig from "tailwindcss/loadConfig.js";
import { chromium, expect } from "@playwright/test";

// UPGRADE_EOS features 89, 91 and 92: actual components with synthetic recorded data.
const evidenceDir = process.env.PRODUCTION_PERFORMANCE_EVIDENCE_DIR;
const stubs = {
  "next/link": "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}",
  "next/navigation": "export function useRouter(){return {refresh(){window.fixture.refreshes++}}}",
  "@/lib/actions/production": "export async function updateProductionJobStatusAction(){return {success:true}}export async function correctCompletedProductionOutputAction(){return {success:true}}",
  "@/lib/actions/production-completion": "export async function completeProductionJobWithScrapAction(input){window.fixture.completions.push(input);return {success:false,error:'Fixture: completion is captured, not written'}}"
};

async function bundle() {
  const result = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "production-performance-fixture.tsx", loader: "tsx", contents: `
      import React from "react"; import {createRoot} from "react-dom/client";
      import {ProductionPerformancePanel} from "./components/modules/production-performance-panel";
      import {ProductionOutputWorkflow} from "./components/modules/production-output-workflow";
      import {BilletPlanNote} from "./components/modules/billet-plan-note";
      import {buildProductionJobEvidence} from "./lib/calculations/production-performance";
      import {OrderProgressPanel} from "./components/modules/orders/order-progress-panel";
      import {FinishingAreaNote} from "./components/modules/finishing-area-note";
      import {buildOrderProgress, buildDispatchProgress} from "./lib/orders/order-progress";
      window.fixture={refreshes:0,completions:[]};
      const root=createRoot(document.getElementById("app"));
      const billets=(n,kg,status="consumed")=>Array.from({length:n},(_,i)=>({status,weight_kg:kg,measured_weight_kg:i===0?kg-0.5:null}));
      window.mountPanel=(job)=>root.render(<ProductionPerformancePanel evidence={buildProductionJobEvidence(job)}/>);
      window.mountWorkflow=(existingScrapKg=0)=>root.render(<ProductionOutputWorkflow canUpdate job={{id:"job-1",job_number:"PJ-0042",status:"in_progress",planned_quantity_kg:900,pieces:null,length_per_piece_m:6,actual_quantity_kg:null,actual_pieces:null,actual_meters:null,finishing_type:"mill_finish",linked_billet_count:40,linked_billet_input_kg:1000,existing_scrap_kg:existingScrapKg}}/>);
      window.mountPlan=(planned,recovery,weights,selectedCount)=>{const list=weights.map((w,i)=>({id:"b"+i,weight_kg:w}));root.render(<BilletPlanNote plannedKg={planned} recoveryPercent={recovery} billets={list} selected={list.slice(0,selectedCount)}/>)};
      window.billets=billets;
      const lines=[{id:"L1",label:"EX-101 casement frame",quantity_kg:1000,quantity_pieces:200,total_meters:1200},{id:"L2",label:"EX-205",quantity_kg:400,quantity_pieces:50,total_meters:300.5}];
      const jobs=[{id:"J1",job_number:"PJ-0041",status:"completed",source_line_id:"L1",planned_quantity_kg:600,actual_quantity_kg:590},{id:"J2",job_number:"PJ-0042",status:"in_progress",source_line_id:"L1",planned_quantity_kg:300},{id:"J3",job_number:"PJ-0043",status:"planned",source_line_id:"L2",planned_quantity_kg:450},{id:"J4",job_number:"PJ-0044",status:"planned",source_line_id:null,planned_quantity_kg:20}];
      window.mountOrder=(mode)=>root.render(<OrderProgressPanel canOpenJobs={mode!=="noLinks"} jobsUnavailable={mode==="jobsDown"} progress={mode==="jobsDown"?null:buildOrderProgress({lines,jobs,fulfillments:[{order_item_id:"L1",fulfilled_weight_kg:60}]})} dispatch={mode==="packingDown"?{status:"unavailable"}:buildDispatchProgress(lines,{pieces:120,lengthM:720.3,weightKg:610.25})}/>);
      window.mountFinish=(perimeter)=>root.render(<div className="grid md:grid-cols-4"><FinishingAreaNote totalMeters={600} perimeterMm={perimeter} ratePerSqft={12} perimeterSource="profile master"/></div>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    plugins: [{ name: "fixture-boundaries", setup(api) {
      for (const specifier of Object.keys(stubs)) api.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "$") }, () => ({ path: specifier, namespace: "stub" }));
      api.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: specifier }) => ({ contents: stubs[specifier], loader: "tsx", resolveDir: process.cwd() }));
    } }]
  });
  return result.outputFiles[0].text;
}

async function styles() {
  const config = loadTailwindConfig(path.resolve("tailwind.config.ts"));
  return (await postcss([tailwindcss(config)]).process(readFileSync("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
}

const completed = (overrides = {}) => ({
  status: "completed", plannedOutputKg: 900, actualOutputKg: 780,
  scrapRecords: [{ id: "s1", weight_kg: 150 }, { id: "s2", weight_kg: 60 }], reversals: [], ...overrides
});

test("production performance, billet plan, order progress and finishing area render honestly at desktop and phone widths", { timeout: 120000 }, async () => {
  const [script, css] = await Promise.all([bundle(), styles()]);
  const browserPath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  const shot = async (page, name) => { if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true }); };
  const noOverflow = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "page scrolls horizontally");
  try {
    for (const viewport of [{ width: 1280, height: 900, tag: "desktop" }, { width: 375, height: 812, tag: "phone" }]) {
      const page = await browser.newPage({ viewport });
      await page.setContent(`<!doctype html><html><head><style>${css}</style><style>body{margin:0;background:#f8fafc}#app{max-width:1100px;margin:auto;padding:16px}</style></head><body><main id="app"></main></body></html>`);
      await page.addScriptTag({ content: script });

      // Feature 91 + 92: 1,000 kg input, 780 kg output, 210 kg scrap leaves 10 kg visible inside tolerance.
      await page.evaluate((job) => window.mountPanel({ ...job, billets: window.billets(40, 25) }), completed());
      const panel = page.getByRole("region", { name: "Performance and material balance" });
      await expect(panel).toContainText("999.500 kg");
      await expect(panel).toContainText("40 billets: 1 measured, 39 nominal weight only.");
      await expect(panel).toContainText("78.04%");
      await expect(panel).toContainText("86.67%");
      await expect(panel).toContainText("9.500 kg unaccounted (within the 9.995 kg completion tolerance)");
      await expect(panel).toContainText("not recorded as scrap automatically");
      await noOverflow(page);
      await shot(page, `panel-unaccounted-${viewport.tag}.png`);

      // Reversed scrap is excluded and the remaining difference is outside tolerance.
      await page.evaluate((job) => window.mountPanel({ ...job, billets: window.billets(40, 25) }), completed({ reversals: [{ scrap_record_id: "s2", reversed_weight_kg: 60 }] }));
      await expect(panel).toContainText("69.500 kg unaccounted (outside the 9.995 kg completion tolerance)");
      await expect(panel).toContainText("Excluded 60.000 kg of reversed scrap postings.");
      await shot(page, `panel-reversed-${viewport.tag}.png`);

      // Manager input exception: no billets means Not captured, never a fabricated 100%.
      await page.evaluate((job) => window.mountPanel({ ...job, billets: [], inputExceptionRecorded: true }), completed());
      await expect(panel).toContainText("a manager input exception is recorded");
      assert.equal(await panel.getByText("Not captured", { exact: true }).count(), 3);
      await expect(panel).toContainText("Issued input is not captured");
      await expect(panel).toContainText("86.67%");
      await shot(page, `panel-input-exception-${viewport.tag}.png`);

      // Open job: no balance claim before final output.
      await page.evaluate((job) => window.mountPanel({ ...job, billets: window.billets(40, 25) }), completed({ status: "in_progress" }));
      await expect(panel).toContainText("calculated from final output after the job is completed");

      // Completion entry preview, including 20 kg scrap posted earlier.
      await page.evaluate(() => window.mountWorkflow(20));
      await page.getByLabel("Good output kg *").fill("780");
      await page.getByLabel("Butt end kg").fill("205");
      const preview = page.getByRole("status");
      await expect(preview).toContainText("5.000 kg more than the linked input, including earlier scrap postings");
      await expect(preview).toContainText("Within the 10.000 kg completion tolerance");
      await page.getByLabel("Butt end kg").fill("150");
      await expect(preview).toContainText("50.000 kg unaccounted");
      await expect(preview).toContainText("completion will be rejected");
      await noOverflow(page);
      await shot(page, `completion-preview-${viewport.tag}.png`);
      await page.getByLabel("Butt end kg").fill("200");
      await expect(preview).toContainText("Input fully accounted.");
      assert.equal(await page.evaluate(() => window.fixture.completions.length), 0, "typing must not submit completion");

      // Feature 89: catalogue example and its honest fallbacks.
      await page.evaluate(() => window.mountPlan(900, 75, Array(45).fill(30), 38));
      await expect(page.getByText(/Billet plan:/)).toContainText("900 kg planned good output / 75% expected recovery = 1,200 kg planned billet input.");
      await expect(page.locator("main")).toContainText("1,200 kg / 30 kg per billet = 40 billets (rounded up).");
      await expect(page.locator("main")).toContainText("Selected billets: 1,140 kg nominal (short of the planned input).");
      await shot(page, `billet-plan-${viewport.tag}.png`);
      await page.evaluate(() => window.mountPlan(45, 75, [30, 31], 2));
      await expect(page.locator("main")).toContainText("Compatible billets have different weights");
      await expect(page.locator("main")).toContainText("covers the planned input");
      await page.evaluate(() => window.mountPlan(900, 0, [30], 0));
      await expect(page.locator("main")).toContainText("Expected recovery must be greater than 0% and at most 100%.");
      await noOverflow(page);

      // Feature 6: connected order progress.
      await page.evaluate(() => window.mountOrder("ok"));
      const order = page.getByRole("region", { name: "Order Progress" });
      await expect(order).toContainText("Dispatched: 120 pcs, 720.30 m, 610.250 kg net");
      await expect(order).toContainText("Remaining: 130 pcs, 780.20 m");
      const firstLine = order.locator("tbody tr").first();
      await expect(firstLine).toContainText("1,000.000 kg");
      await expect(firstLine).toContainText("60.000 kg");
      await expect(firstLine).toContainText("50.000 kg");
      await expect(order.locator("tbody tr").nth(1)).toContainText("Committed beyond the ordered kg");
      await expect(order.getByRole("link", { name: "PJ-0041" })).toHaveAttribute("href", "/production/J1");
      await expect(order).toContainText("Jobs not linked to an order line (not counted above)");
      await noOverflow(page);
      await shot(page, `order-progress-${viewport.tag}.png`);
      await page.evaluate(() => window.mountOrder("noLinks"));
      await expect(order.getByRole("link")).toHaveCount(0);
      await page.evaluate(() => window.mountOrder("jobsDown"));
      await expect(order).toContainText("Line progress is not shown rather than shown as zero.");
      await expect(order.locator("table")).toHaveCount(0);
      await page.evaluate(() => window.mountOrder("packingDown"));
      await expect(order).toContainText("could not be verified");
      await expect(order).not.toContainText("Remaining:");

      // Feature 84: finishing area explanation and its incomplete state.
      await page.evaluate(() => window.mountFinish(250));
      await expect(page.locator("main")).toContainText("600 m x 250 mm coating perimeter / 1,000 = 150 m2 = 1,614.587 sq ft.");
      await expect(page.locator("main")).toContainText("19,375.04");
      await shot(page, `finishing-area-${viewport.tag}.png`);
      await page.evaluate(() => window.mountFinish(null));
      await expect(page.getByRole("alert")).toContainText("finishing charge is incomplete (not zero)");
      await noOverflow(page);
      await page.close();
    }
  } finally { await browser.close(); }
});
