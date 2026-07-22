import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const overview = readFileSync("app/(dashboard)/foundry/billets/page.tsx", "utf8");
const detail = readFileSync("app/(dashboard)/foundry/billets/[id]/page.tsx", "utf8");
const edit = readFileSync("app/(dashboard)/foundry/billets/[id]/edit/page.tsx", "utf8");

describe("foundry billet lifecycle ownership", () => {
  it("does not expose generic edit controls for workflow-owned billets", () => {
    assert.match(overview, /canUpdate=\{false\}/);
    assert.match(detail, /canEdit=\{false\}/);
  });

  it("redirects direct edit URLs to the billet workflow detail", () => {
    assert.doesNotMatch(edit, /RecordFormClient/);
    assert.match(edit, /redirect\(`\/foundry\/billets\/\$\{params\.id\}`\)/);
  });
});
