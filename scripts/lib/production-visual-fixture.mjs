import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadTailwindConfig from "tailwindcss/loadConfig.js";

export async function createProductionVisualFixture() {
  const aliases = {
    "next/link": "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}",
    "next/navigation": "export function useRouter(){return {refresh(){window.fixture.refreshes++}}}",
    "@/lib/actions/production": "export async function updateProductionJobStatusAction(){return {success:false,error:'Isolated visual fixture'}}export async function correctCompletedProductionOutputAction(){return {success:false,error:'Isolated visual fixture'}}",
    "@/lib/actions/production-completion": "export async function completeProductionJobWithScrapAction(input){window.fixture.completions.push(input);return {success:false,error:'Isolated fixture: no production posting'}}",
  };
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "production-visual.tsx", loader: "tsx", contents: `
      import React from "react";import {createRoot} from "react-dom/client";
      import {ProductionPerformancePanel} from "./components/modules/production-performance-panel";
      import {ProductionOutputWorkflow} from "./components/modules/production-output-workflow";
      import {BilletPlanNote} from "./components/modules/billet-plan-note";
      import {buildProductionJobEvidence} from "./lib/calculations/production-performance";
      import {OrderProgressPanel} from "./components/modules/orders/order-progress-panel";
      import {FinishingAreaNote} from "./components/modules/finishing-area-note";
      import {buildOrderProgress,buildDispatchProgress} from "./lib/orders/order-progress";
      const root=createRoot(document.getElementById("app"));window.fixture={refreshes:0,completions:[]};
      const lines=[{id:"L1",label:"EX-101 casement frame",quantity_kg:1000,quantity_pieces:200,total_meters:1200},{id:"L2",label:"EX-205",quantity_kg:400,quantity_pieces:50,total_meters:300.5}];
      const jobs=[{id:"J1",job_number:"PJ-0041",status:"completed",source_line_id:"L1",planned_quantity_kg:600,actual_quantity_kg:590},{id:"J2",job_number:"PJ-0042",status:"in_progress",source_line_id:"L1",planned_quantity_kg:300},{id:"J3",job_number:"PJ-0043",status:"planned",source_line_id:"L2",planned_quantity_kg:450},{id:"J4",job_number:"PJ-0044",status:"planned",source_line_id:null,planned_quantity_kg:20}];
      const billets=Array.from({length:40},(_,i)=>({id:"B"+i,status:"consumed",weight_kg:25,measured_weight_kg:i===0?24.5:null}));
      function render(screen){
        const job={status:"completed",plannedOutputKg:900,actualOutputKg:screen==="zero"?0:780,billets:screen==="missing"?[]:billets,inputExceptionRecorded:screen==="missing",scrapRecords:[{id:"s1",weight_kg:150},{id:"s2",weight_kg:60}],reversals:screen==="reversed"?[{scrap_record_id:"s2",reversed_weight_kg:60}]:[]};
        let content;
        if(screen==="order")content=<OrderProgressPanel canOpenJobs jobsUnavailable={false} progress={buildOrderProgress({lines,jobs,fulfillments:[{order_item_id:"L1",fulfilled_weight_kg:60}]})} dispatch={buildDispatchProgress(lines,{pieces:120,lengthM:720.3,weightKg:610.25})}/>;
        else if(screen==="finishing"||screen==="perimeter-missing")content=<FinishingAreaNote totalMeters={600} perimeterMm={screen==="perimeter-missing"?null:250} ratePerSqft={12} perimeterSource="profile master"/>;
        else if(screen==="billets"||screen==="recovery-invalid")content=<BilletPlanNote plannedKg={900} recoveryPercent={screen==="recovery-invalid"?0:75} billets={Array.from({length:45},(_,i)=>({id:"P"+i,weight_kg:30}))} selected={Array.from({length:38},(_,i)=>({id:"P"+i,weight_kg:30}))}/>;
        else if(screen==="completion")content=<ProductionOutputWorkflow canUpdate job={{id:"job-1",job_number:"PJ-0042",status:"in_progress",planned_quantity_kg:900,pieces:null,length_per_piece_m:6,actual_quantity_kg:null,actual_pieces:null,actual_meters:null,finishing_type:"mill_finish",linked_billet_count:40,linked_billet_input_kg:1000,existing_scrap_kg:20}}/>;
        else content=<ProductionPerformancePanel evidence={buildProductionJobEvidence(job)}/>;
        root.render(content);
      }
      document.querySelectorAll("[data-screen]").forEach(button=>button.onclick=()=>{history.replaceState(null,"","?screen="+button.dataset.screen);render(button.dataset.screen)});
      render(new URLSearchParams(location.search).get("screen")||"performance");
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    plugins: [{ name: "production-visual-boundaries", setup(api) {
      for (const specifier of Object.keys(aliases)) api.onResolve({ filter: new RegExp("^" + specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }, () => ({ path: specifier, namespace: "fixture" }));
      api.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: specifier }) => ({ contents: aliases[specifier], loader: "tsx", resolveDir: process.cwd() }));
    } }],
  });
  const css = (await postcss([tailwindcss(loadTailwindConfig(path.resolve("tailwind.config.ts")))]).process(readFileSync("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  const screens = { order: "6: Order progress", finishing: "84: Finishing area", "perimeter-missing": "84: Missing perimeter", billets: "89: Billet plan", "recovery-invalid": "89: Invalid recovery", performance: "91/92: Recorded performance", missing: "91: Missing input", zero: "91: Recorded zero", reversed: "92: Reversed scrap", completion: "92: Completion preview" };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExtrusionOS production acceptance</title><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f8fafc}.fixture-bar{padding:12px;font-size:12px;background:#fff;border-bottom:1px solid #ddd}nav{display:flex;gap:10px;flex-wrap:wrap}nav button{padding:8px;border:1px solid #ddd;border-radius:8px}#app{max-width:1100px;margin:auto;padding:16px;min-width:0}</style></head><body><aside class="fixture-bar">Actual components; synthetic recorded data. No authenticated database or physical factory acceptance.<nav>${Object.entries(screens).map(([key,label]) => `<button data-screen="${key}">${label}</button>`).join("")}</nav></aside><main id="app"></main><script src="/fixture.js"></script></body></html>`;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("Cache-Control", "no-store");
    const isScript = url.pathname === "/fixture.js", isCss = url.pathname === "/fixture.css";
    response.setHeader("Content-Type", isScript ? "text/javascript" : isCss ? "text/css" : "text/html");
    response.end(isScript ? bundle.outputFiles[0].text : isCss ? css : html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
