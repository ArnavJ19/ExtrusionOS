import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canSaveQuoteDraft, duplicateQuoteDraftLine, getQuoteFormShortcut, runWithInFlightGuard } from "../lib/forms/keyboard-entry.ts";

const quoteClient = readFileSync("components/modules/quotes-client.tsx", "utf8");

function key(key, overrides = {}) {
  return getQuoteFormShortcut({ key, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, ...overrides });
}

test("quote shortcuts map only the visible task-scoped commands", () => {
  assert.equal(key("a"), "add-line");
  assert.equal(key("D"), "duplicate-line");
  assert.equal(key("s"), "save-draft");
  assert.equal(key("s", { repeat: true }), null);
  assert.equal(key("Enter"), null);
  assert.equal(getQuoteFormShortcut({ key: "a", ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }), "add-line");
});

test("save guard skips simultaneous calls and releases after rejection so retry can proceed", async () => {
  const guard = { current: false };
  let calls = 0;
  let releaseFirst;
  const first = runWithInFlightGuard(guard, async () => {
    calls += 1;
    return new Promise((resolve) => { releaseFirst = resolve; });
  });

  assert.equal(guard.current, true);
  assert.equal(await runWithInFlightGuard(guard, async () => { calls += 1; }), undefined);
  assert.equal(calls, 1);
  releaseFirst("saved");
  assert.equal(await first, "saved");
  assert.equal(guard.current, false);

  await assert.rejects(runWithInFlightGuard(guard, async () => {
    calls += 1;
    throw new Error("temporary failure");
  }), /temporary failure/);
  assert.equal(guard.current, false);
  assert.equal(await runWithInFlightGuard(guard, async () => { calls += 1; return "retried"; }), "retried");
  assert.equal(calls, 3);
});

test("shortcut handling yields to IME, browser modifiers, and editable content", () => {
  assert.equal(key("a", { isComposing: true }), null);
  assert.equal(key("a", { defaultPrevented: true }), null);
  assert.equal(key("a", { targetIsContentEditable: true }), null);
  assert.equal(key("a", { altKey: false }), null);
  assert.equal(key("a", { metaKey: true }), null);
  assert.equal(key("a", { shiftKey: true }), null);
});

test("duplicating a draft line preserves entered values and strips row identity", () => {
  const source = { id: "line-1", quote_id: "quote-1", company_id: "company-1", created_at: "old", updated_at: "old", profile_id: "p-1", quantity_pieces: 8, length_per_piece_m: 5.8, item_description: "Cut to size" };
  const copy = duplicateQuoteDraftLine(source);
  assert.deepEqual(copy, { profile_id: "p-1", quantity_pieces: 8, length_per_piece_m: 5.8, item_description: "Cut to size" });
  assert.deepEqual(source, { id: "line-1", quote_id: "quote-1", company_id: "company-1", created_at: "old", updated_at: "old", profile_id: "p-1", quantity_pieces: 8, length_per_piece_m: 5.8, item_description: "Cut to size" });
});

test("draft shortcut never downgrades workflow states outside the guarded revision path", () => {
  assert.equal(canSaveQuoteDraft("draft", true), true);
  assert.equal(canSaveQuoteDraft("sent", true), true);
  assert.equal(canSaveQuoteDraft("customer_approved", true), true);
  assert.equal(canSaveQuoteDraft("internal_review", true), false);
  assert.equal(canSaveQuoteDraft("converted_to_order", true), false);
  assert.equal(canSaveQuoteDraft("converted_to_order", false), true);
});

test("shortcuts stay inside the quote editor and use guarded draft saving", () => {
  assert.match(quoteClient, /onKeyDown=\{handleQuoteEditorKeyDown\}/);
  assert.match(quoteClient, /shortcut === "save-draft"\)[\s\S]*?void saveQuote\(\)/);
  assert.match(quoteClient, /saveQuoteAction\(\{ \.\.\.parsed\.data, editing_id: editingId \}\)/);
  assert.match(quoteClient, /runWithInFlightGuard\(saveGuard\.current, async \(\) => \{/);
  assert.match(quoteClient, /finally \{\s*setSaving\(false\)/);
  assert.match(quoteClient, /onClick=\{saveQuote\}/);
  assert.match(quoteClient, /shortcut === "save-draft"\)[\s\S]*?void saveQuote\(\)/);
  assert.match(quoteClient, /setFocusLineIndex\(insertAt\)/);
  assert.match(quoteClient, /querySelector<HTMLElement>\(`\[data-quote-line=/);
  assert.doesNotMatch(quoteClient, /onKeyDown=\{[^}]*submit/);
});
