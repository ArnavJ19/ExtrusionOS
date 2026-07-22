import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

describe("Content Security Policy", () => {
  it("allows React development diagnostics without weakening production", async () => {
    const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

    assert.match(config, /NODE_ENV === ["']development["']/);
    assert.match(config, /\? ["'] 'unsafe-eval'["'] : ["']["']/);
    assert.match(config, /script-src 'self' 'unsafe-inline'/);
  });
});
