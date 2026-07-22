import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

describe("quote overview actions", () => {
  it("removes duplicate header actions while retaining the workspace actions", async () => {
    const [page, overview, dashboard] = await Promise.all([
      readFile(new URL("../app/(dashboard)/quotes/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../components/modules/operations/module-overview-client.tsx", import.meta.url), "utf8"),
      readFile(new URL("../components/modules/dashboards/quotes-dashboard.tsx", import.meta.url), "utf8"),
    ]);

    assert.match(page, /hideHeaderActions=\{true\}/);
    assert.match(overview, /actions=\{hideHeaderActions \? undefined : \(/);
    assert.match(dashboard, /> Create Quote<\/Link>/);
    assert.match(dashboard, /> View Quotes Database<\/Link>/);
  });
});
