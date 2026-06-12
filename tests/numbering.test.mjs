import test from "node:test";
import assert from "node:assert/strict";
import { makeBusinessNumber, nextBusinessNumber } from "../lib/utils/numbering.ts";

test("business number pads yearly sequences", () => {
  assert.equal(makeBusinessNumber("Q", 2026, 7), "Q-2026-0007");
});

test("next business number ignores other years and prefixes", () => {
  const next = nextBusinessNumber("Q", ["Q-2026-0001", "Q-2025-0099", "O-2026-0008", "Q-2026-0004"], new Date("2026-05-11"));

  assert.equal(next, "Q-2026-0005");
});
