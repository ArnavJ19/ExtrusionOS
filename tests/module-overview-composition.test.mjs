import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const richModules = [
  { name: "orders", dashboard: "OrdersDashboard" },
  { name: "dispatches", dashboard: "DispatchesDashboard" },
  { name: "inventory", dashboard: "InventoryDashboard" },
  { name: "production", dashboard: "ProductionDashboard" },
  { name: "quotes", dashboard: "QuotesDashboard" },
];

describe("rich module overview composition", () => {
  for (const { name, dashboard } of richModules) {
    it(`renders ${name} with one overview shell and no duplicate generic analytics`, async () => {
      const page = await readFile(new URL(`../app/(dashboard)/${name}/page.tsx`, import.meta.url), "utf8");
      const overviewStart = page.indexOf("<ModuleOverviewClient");
      const overviewEnd = page.indexOf("</ModuleOverviewClient>", overviewStart);
      const dashboardStart = page.indexOf(`<${dashboard}`, overviewStart);
      const openingTagEnd = page.indexOf(">", overviewStart);
      const openingTag = page.slice(overviewStart, openingTagEnd + 1);

      assert.notEqual(overviewStart, -1, `${name} must use the shared overview shell`);
      assert.notEqual(overviewEnd, -1, `${name} overview shell must wrap its dashboard`);
      assert.ok(dashboardStart > overviewStart && dashboardStart < overviewEnd, `${dashboard} must be inside the overview shell`);
      assert.match(openingTag, /hideMetricsAndCharts=\{true\}/);
      assert.equal(page.match(/<ModuleOverviewClient/g)?.length, 1);
    });
  }
});
