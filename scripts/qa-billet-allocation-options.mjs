import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { createBilletAllocationBrowserFixture } from "./lib/billet-allocation-browser-fixture.mjs";
import { createAllocationOptionsFixture, mountSqlAllocation, answerSqlAllocationReads } from "./lib/billet-allocation-options-fixture.mjs";

const output = resolve(process.argv[2] ?? "test-results/billet-allocation-options/responsive");
mkdirSync(output, { recursive: true });
const browser = await createBilletAllocationBrowserFixture({ styled: true }), sql = await createAllocationOptionsFixture(), results = [];
try {
  await sql.reset(); let last;
  for (let index = 0; index < 11; index++) last = await sql.createOrder();
  await sql.insertBillet({ temper: "T6" });
  const number = (await sql.db.query("select order_number from orders where id=$1", [last])).rows[0].order_number;
  for (const width of [1440, 820, 390, 320]) {
    await browser.page.setViewportSize({ width, height: 1000 });
    for (const state of ["first-page", "last-page", "global-search", "unavailable"]) {
      await mountSqlAllocation(browser, sql);
      if (state === "last-page") {
        await browser.page.getByRole("button", { name: "Next orders", exact: true }).click(); await answerSqlAllocationReads(browser, sql, 3);
        assert.match(await browser.page.locator("body").innerText(), /Page 2 of 2 \/ 13 compatible orders/);
      } else if (state === "global-search") {
        await browser.page.getByLabel("Find compatible orders", { exact: true }).fill(number); await answerSqlAllocationReads(browser, sql, 3);
        assert.match(await browser.page.locator("body").innerText(), /Page 1 of 1 \/ 1 compatible orders/);
      } else if (state === "unavailable") {
        await browser.page.getByRole("button", { name: "Refresh allocation options", exact: true }).click();
        await browser.page.waitForFunction(() => window.__allocation.reads[3]);
        const call = await browser.page.evaluate(() => { const { table, columns, filters } = window.__allocation.reads[3]; return { table, columns, filters }; });
        await browser.read(3, await sql.browserRead(call));
        await browser.read(4, { data: null, error: { code: "PGRST202", message: "Synthetic missing RPC" } });
        await expect(browser.page.getByRole("alert")).toContainText("database update is ready");
      }
      if (state !== "unavailable") {
        await browser.page.getByPlaceholder("Select order").click(); await browser.page.getByRole("button", { name: /^O-.* -/ }).first().click();
      }
      await browser.page.evaluate(() => document.fonts.ready);
      const layout = await browser.page.evaluate(() => ({ viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert.ok(layout.scrollWidth <= layout.viewport, `${state} overflows at ${width}px`); assert.deepEqual(browser.errors, []);
      const screenshot = resolve(output, `${width}-${state}.png`); await browser.page.screenshot({ path: screenshot, fullPage: true });
      results.push({ width, state, ...layout, screenshot, pageErrors: [] });
    }
  }
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify({ cases: results.length, pageErrors: 0, documentOverflow: 0, output }));
} finally { await browser.close(); await sql.close(); }
