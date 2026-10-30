import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

export async function createFactoryPlanningBrowser({ component, props = {}, results = {} } = {}) {
  const components = {
    FactoryPlanning: "components/modules/production/factory-planning",
    FactoryDeliveryForecast: "components/modules/production/factory-planning",
    VehicleLoads: "components/modules/dispatches/vehicle-loads"
  };
  if (!components[component]) throw new Error("Unknown factory-planning browser component");
  const rendered = component === "FactoryDeliveryForecast" ? "FactoryDeliveryForecast" : component;
  const exports = ["getFactoryPlanningSnapshotAction", "saveFactoryShiftCapacityAction", "createFactoryMaintenanceBlockAction", "saveFactoryFinishingLeadTimeAction", "moveFactoryProductionJobAction", "getFactoryDeliveryProposalAction", "getFactoryVehicleLoadSnapshotAction", "saveFactoryVehicleAction", "saveFactoryVehicleLoadAction","releaseFactoryVehicleLoadBundlesAction"];
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {Toaster} from 'sonner';import {${rendered}} from './${components[component]}';window.__factory={calls:[],results:${JSON.stringify(results)}};createRoot(document.getElementById('app')).render(<><${rendered} {...${JSON.stringify(props)}}/><Toaster/></>);`,
      sourcefile: "factory-planning-browser.tsx", resolveDir: process.cwd(), loader: "tsx"
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "factory-planning-boundaries", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/actions\/factory-planning$/ }, () => ({ path: "factory-planning-actions", namespace: "actions" }));
      plugin.onLoad({ filter: /.*/, namespace: "actions" }, () => ({
        loader: "js",
        contents: exports.map(name => `export async function ${name}(input){window.__factory.calls.push({name:${JSON.stringify(name)},input});const result=window.__factory.results[${JSON.stringify(name)}];if(result?.throw)throw new Error('Fixture transport failure');return result??{success:false,error:'No fixture result configured'};}`).join("\n")
      }));
      plugin.onResolve({ filter: /^next\/navigation$/ }, args => ({ path: args.path, namespace: "next" }));
      plugin.onLoad({ filter: /.*/, namespace: "next" }, () => ({ loader: "js", contents: "export function useRouter(){return {refresh(){},push(){}}}" }));
    } }]
  });

  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" }).end(bundle.outputFiles[0].contents);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body><main style=\"max-width:1280px;margin:auto;padding:16px\"><div id=\"app\"></div></main><script src=\"/fixture.js\"></script></body></html>");
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const base = `http://127.0.0.1:${server.address().port}`;
    const network = [];
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      network.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    return {
      page, errors, network,
      async reset() { errors.length = 0; network.length = 0; await page.goto(base); await page.locator("#app > *").first().waitFor(); },
      async close() { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
    };
  } catch (error) {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    throw error;
  }
}
