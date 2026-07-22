import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

describe("status board usability", () => {
  it("starts every status group collapsed and caps its preview at five records", async () => {
    const [board, column] = await Promise.all([
      source("../components/status-board/status-board.tsx"),
      source("../components/status-board/status-column.tsx"),
    ]);

    assert.match(board, /STATUS_BOARD_PREVIEW_LIMIT = 5/);
    assert.match(board, /slice\(0, STATUS_BOARD_PREVIEW_LIMIT\)/);
    assert.match(board, /defaultExpanded=\{false\}/);
    assert.match(column, /defaultExpanded = false/);
  });

  it("offers View More only when the total exceeds the five-record preview", async () => {
    const [board, column] = await Promise.all([
      source("../components/status-board/status-board.tsx"),
      source("../components/status-board/status-column.tsx"),
    ]);

    assert.match(board, /total > STATUS_BOARD_PREVIEW_LIMIT/);
    assert.match(column, /viewMoreHref \? <ViewMoreButton/);
    assert.doesNotMatch(column, /count > 10/);
  });

  it("uses the shared behavior for generic modules, dies, and dealer orders", async () => {
    const [overview, dies, dealerOrdersPage, dealerOrdersBoard] = await Promise.all([
      source("../components/modules/operations/module-overview-client.tsx"),
      source("../components/modules/dies/dies-overview-client.tsx"),
      source("../app/(dashboard)/dealer-orders/page.tsx"),
      source("../components/modules/dealer-orders-overview-board.tsx"),
    ]);

    assert.match(overview, /<StatusBoard/);
    assert.match(overview, /Showing up to 5 records per group/);
    assert.match(dies, /<StatusBoard/);
    assert.match(dies, /Showing up to 5 dies per status/);
    assert.match(dealerOrdersPage, /<DealerOrdersOverviewBoard statuses=\{statuses\} records=\{rows\}/);
    assert.doesNotMatch(dealerOrdersPage, /getStatus=|getCount=|sortRecords=|renderCard=/);
    assert.match(dealerOrdersBoard, /^"use client";/);
    assert.match(dealerOrdersBoard, /<StatusBoard/);
    assert.match(dealerOrdersBoard, /getViewMoreHref/);
    assert.doesNotMatch(dealerOrdersPage, /rows\.filter\(\(order\) => order\.status === status\)\.slice\(0, 10\)/);
  });
});
