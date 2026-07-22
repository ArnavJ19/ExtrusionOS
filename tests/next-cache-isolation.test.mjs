import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

describe("Next.js output isolation", () => {
  it("keeps the development module graph separate from production builds", async () => {
    const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");

    assert.match(config, /NODE_ENV === "development" \? "\.next-dev" : "\.next"/);
    assert.match(config, /distDir: process\.env\.NEXT_DIST_DIR \|\| defaultDistDir/);
  });

  it("keeps generated Next.js output out of source control", async () => {
    const gitignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

    assert.match(gitignore, /^\.next\/$/m);
    assert.match(gitignore, /^\.next-\*\/$/m);
  });
});
