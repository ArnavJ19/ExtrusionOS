import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { expect, chromium } from "@playwright/test";

let browser;
let page;
let fixtureScript;

test.before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: "data-freshness-fixture.tsx", loader: "tsx",
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { DataFreshness, DataFreshnessSummary } from "./components/ui/data-freshness";
        function Fixture() {
          const [refreshedAt, setRefreshedAt] = useState("2026-10-21T09:00:00.000Z");
          const [refreshing, setRefreshing] = useState(false);
          const [error, setError] = useState(false);
          function refresh() {
            setRefreshing(true);
            setTimeout(() => { setRefreshing(false); setRefreshedAt("2026-10-21T10:00:00.000Z"); }, 10);
          }
          return <main>
            <DataFreshnessSummary refreshedAt={refreshedAt} refreshing={refreshing} onRefresh={refresh} />
            <button type="button" onClick={() => setError(true)}>Fail refresh</button>
            {error ? <p role="alert">Refresh failed. Showing last successful fetch.</p> : null}
            <DataFreshness row={{ current_stock: 840, updated_at: "2024-01-05T08:00:00Z", source_system: "Nightly stock import" }} fetchedAt={refreshedAt} />
            <DataFreshness row={{ current_stock: 0 }} fetchedAt={refreshedAt} />
          </main>;
        }
        createRoot(document.getElementById("app")).render(<Fixture/>);
      `
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }
  });
  fixtureScript = bundle.outputFiles[0].text;
  const browserPath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((candidate) => existsSync(candidate));
  browser = await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) });
  page = await browser.newPage();
});

test.beforeEach(async () => {
  await page.setContent("<!doctype html><html><body><div id=\"app\"></div></body></html>");
  await page.addScriptTag({ content: fixtureScript });
  await page.getByRole("button", { name: /Refresh page/ }).waitFor();
});

test.after(async () => { await browser?.close(); });

test("refreshing an old stock row updates page-fetch time without changing observation evidence", async () => {
  const rowDetails = page.locator("details").first();
  await rowDetails.locator("summary").click();
  await expect(rowDetails).toContainText("2024");
  await expect(rowDetails).toContainText("Not recorded in this data source");
  await expect(rowDetails).toContainText("Nightly stock import");
  await page.getByRole("button", { name: "Refresh page" }).click();
  await expect(page.locator("main")).toContainText("2024");
  await expect(page.locator("time")).toHaveAttribute("datetime", "2026-10-21T10:00:00.000Z");
  await page.getByRole("button", { name: "Fail refresh" }).click();
  await expect(page.getByRole("alert")).toContainText("last successful fetch");
  await expect(page.locator("time")).toHaveAttribute("datetime", "2026-10-21T10:00:00.000Z");
  await rowDetails.locator("summary").click();
  await expect(rowDetails).toContainText("2024");
  await expect(rowDetails).toContainText("Page fetched:");
});

test("missing record timestamps remain unavailable after a successful page read", async () => {
  const details = page.locator("details").nth(1);
  await details.locator("summary").click();
  await expect(details).toContainText("Record created: Not recorded");
  await expect(details).toContainText("Record updated: Not recorded");
  await expect(details).toContainText("Physical observation: Not recorded in this data source");
  await expect(details).toContainText("Data verification: Not recorded in this data source");
});
