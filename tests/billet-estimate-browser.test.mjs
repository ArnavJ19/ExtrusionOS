import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

test("billet estimate displays its source, supports units, and removes invalid results", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "billet-estimate-fixture.tsx", loader: "tsx", contents: `
      import React from "react"; import {createRoot} from "react-dom/client";
      import {BilletWeightEstimate} from "./components/modules/foundry/billet-weight-estimate";
      const root=createRoot(document.getElementById("app"));
      window.mountEstimate=(density=2700)=>root.render(<BilletWeightEstimate lengthMm={5800} diameterMm={152.4} densityKgPerM3={density} count={24} alloy="6063" source="Recorded batch configuration"/>);
      window.mountEstimate();
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  });
  const browserPath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  const browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.setContent('<main id="app"></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await expect(page.getByRole("heading", { name: "Theoretical billet weight" })).toBeVisible();
    await expect(page.getByText(/Recorded batch configuration/)).toContainText("2,700 kg/m3");
    const originalWeights = await page.locator("dd").allTextContents();
    await page.getByRole("combobox", { name: "Display dimensions in" }).selectOption("in");
    await expect(page.getByText(/Length .*; diameter/)).toContainText("diameter 6 in");
    assert.deepEqual(await page.locator("dd").allTextContents(), originalWeights);
    await page.getByText("Show calculation and precision", { exact: true }).click();
    await expect(page.getByText(/Using diameter/)).toContainText("0.1524 m");
    await page.evaluate(() => window.mountEstimate(2800));
    await expect(page.getByText(/Recorded batch configuration/)).toContainText("2,800 kg/m3");
    assert.notDeepEqual(await page.locator("dd").allTextContents(), originalWeights);
    await page.evaluate(() => window.mountEstimate(""));
    await expect(page.getByRole("status")).toContainText("Estimate unavailable");
    await expect(page.locator("dd")).toHaveCount(0);
    await expect(page.getByText(/Actual measured mass is recorded separately/)).toBeVisible();
  } finally { await browser.close(); }
});
