import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { allocationBillet as billet, allocationId as id, createBilletAllocationBrowserFixture } from "./lib/billet-allocation-browser-fixture.mjs";

const output = resolve(process.argv[2] ?? "test-results/billet-allocation-panel/responsive");
mkdirSync(output, { recursive: true });
const fixture = await createBilletAllocationBrowserFixture({ styled: true }), results = [];
try {
  for (const width of [1440, 820, 390, 320]) {
    await fixture.page.setViewportSize({ width, height: 1000 });
    for (const state of ["ready", "recorded", "unavailable", "unconfirmed"]) {
      await fixture.open();
      if (state === "unavailable") {
        await fixture.read(0, { data: null, error: { message: "Allocation details are temporarily unavailable. Retry loading to review the billet." } });
        await expect(fixture.page.getByRole("alert")).toBeVisible();
      } else {
        await fixture.ready({ billet: billet({ billet_code: `BILLET-${"LONG-CODE".repeat(8)}` }) });
        await fixture.selectOrder();
        if (state !== "ready") {
          await fixture.page.getByRole("button", { name: "Allocate Billet", exact: true }).click();
          if (state === "recorded") {
            await fixture.save(0, { success: true, requirementId: id(4) });
            await fixture.ready({ start: 2, billet: billet({ status: "allocated", order_id: id(5) }), requirements: [] });
            await expect(fixture.page.getByRole("link", { name: "View allocated order" })).toHaveAttribute("href", `/orders/${id(5)}`);
          } else {
            await fixture.save(0, "Synthetic lost confirmation", { reject: true });
            await expect(fixture.page.getByRole("alert")).toBeVisible();
          }
        }
      }
      await fixture.page.evaluate(() => document.fonts.ready);
      const layout = await fixture.page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert.ok(layout.scrollWidth <= layout.width, `Document overflow at ${width}px in ${state}: ${JSON.stringify(layout)}`);
      assert.deepEqual(fixture.errors, []);
      const screenshot = resolve(output, `${width}-${state}.png`);
      await fixture.page.screenshot({ path: screenshot, fullPage: true });
      results.push({ width, state, ...layout, screenshot, pageErrors: [...fixture.errors] });
    }
  }
  writeFileSync(resolve(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify({ cases: results.length, pageErrors: 0, documentOverflow: 0, output }));
} finally { await fixture.close(); }
