import assert from "node:assert/strict";
import test from "node:test";
import { dataFreshnessQueryKey, describeDataFreshness, formatFreshnessTimestamp, freshnessStatusLabel } from "../lib/workflow/data-freshness.ts";

const now = Date.parse("2026-10-21T10:00:00.000Z");

test("refreshing an old stock row never turns its record timestamp into a new observation", () => {
  const result = describeDataFreshness({ current_stock: 840, updated_at: "2024-01-05T08:00:00Z" }, { now });
  assert.equal(result.recordTime.status, "stale");
  assert.equal(result.recordTime.value, "2024-01-05T08:00:00.000Z");
  assert.equal(result.observation.status, "missing");
  assert.equal(result.source, null);
});

test("explicit observation timestamps and source metadata are reported independently", () => {
  const result = describeDataFreshness({ updated_at: "2026-10-20T08:00:00Z", last_counted_at: "2026-10-21T09:00:00Z", verified_at: "2026-10-21T09:30:00Z", source_system: "Warehouse import" }, { now });
  assert.equal(result.recordTime.label, "Record updated");
  assert.equal(result.recordTime.status, "recent");
  assert.equal(result.observation.status, "recent");
  assert.equal(result.verification.status, "recent");
  assert.equal(result.source, "Warehouse import");
  assert.match(freshnessStatusLabel("stale"), /30-day record threshold/);
});

test("missing, invalid, and future timestamps stay explicit and do not appear recent", () => {
  assert.equal(describeDataFreshness({}, { now }).recordTime.status, "missing");
  assert.equal(describeDataFreshness({ updated_at: "not a date" }, { now }).recordTime.status, "invalid");
  assert.equal(describeDataFreshness({ updated_at: 1e300 }, { now }).recordTime.status, "invalid");
  assert.equal(describeDataFreshness({ updated_at: "2026-10-22T10:00:00Z" }, { now }).recordTime.status, "future");
  assert.match(freshnessStatusLabel("future"), /review/);
  assert.equal(formatFreshnessTimestamp(null), "Not recorded");
});

test("query freshness scope changes with tenant and page context", () => {
  const query = { search: "", status: "", secondary: "", dateFrom: "", dateTo: "", page: 1, sortColumn: "updated_at", sortDirection: "desc", relationFilters: [] };
  const key = (companyId, userId, page) => dataFreshnessQueryKey(JSON.stringify([companyId, userId, "owner"]), "inventory", { ...query, page });
  assert.notEqual(key("company-a", "user-a", 1), key("company-b", "user-a", 1));
  assert.notEqual(key("company-a", "user-a", 1), key("company-a", "user-b", 1));
  assert.notEqual(key("company-a", "user-a", 1), key("company-a", "user-a", 2));
});
