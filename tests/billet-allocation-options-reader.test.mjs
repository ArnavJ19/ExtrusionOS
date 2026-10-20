import assert from "node:assert/strict";
import test from "node:test";
import { parseAllocationOptions } from "../lib/workflow/billet-allocation-options.ts";
import { allocationBillet, allocationContext, allocationId as id } from "../scripts/lib/billet-allocation-browser-fixture.mjs";

const expected = { companyId: allocationContext.companyId, billetId: id(3), search: "", page: 1 };
const valid = () => ({ company_id: expected.companyId, billet: allocationBillet(), search: "", page: 1, page_size: 10, total_count: 1,
  items: [{ company_id: expected.companyId, order_id: id(5), order_number: "ORDER-A", priority: "normal", current_stage: "order_confirmed", requirement_count: 1, billets_required: 3, billets_allocated: 1, billets_short: 2 }] });

test("allocation reader preserves complete validated response fields", () => { const value = valid(); assert.deepEqual(parseAllocationOptions(value, expected), value); });
for (const [name, change] of [
  ["foreign company", value => { value.company_id = id(9); }], ["foreign billet", value => { value.billet.id = id(9); }],
  ["foreign billet company", value => { value.billet.company_id = id(9); }], ["stale search", value => { value.search = "obsolete"; }],
  ["wrong page size", value => { value.page_size = 1000; }], ["missing page", value => { delete value.page; }],
  ["string count", value => { value.total_count = "1"; }], ["truncated rows", value => { value.total_count = 2; }],
  ["non-array rows", value => { value.items = {}; }], ["foreign option", value => { value.items[0].company_id = id(9); }],
  ["invalid order id", value => { value.items[0].order_id = "wrong"; }], ["terminal order", value => { value.items[0].current_stage = "cancelled"; }],
  ["missing order label", value => { value.items[0].order_number = null; }], ["fractional requirement count", value => { value.items[0].requirement_count = 1.5; }],
  ["negative allocated count", value => { value.items[0].billets_allocated = -1; }], ["inconsistent shortage", value => { value.items[0].billets_short = 3; }],
  ["fully allocated option", value => { value.items[0].billets_allocated = 3; value.items[0].billets_short = 0; }],
  ["duplicate orders", value => { value.items.push({ ...value.items[0] }); value.total_count = 2; }],
  ["linked production", value => { value.billet.production_job_id = id(8); }], ["non-finite diameter", value => { value.billet.billet_diameter_inch = Infinity; }],
  ["invalid current order", value => { value.billet.order_id = "wrong"; }], ["unsafe numeric count", value => { value.total_count = Number.MAX_SAFE_INTEGER + 1; }],
]) test(`allocation reader rejects ${name}`, () => { const value = valid(); change(value); assert.throws(() => parseAllocationOptions(value, expected), /could not be verified/); });

test("verified empty and clamped pages stay distinct from unavailable payloads", () => {
  const value = valid(); value.total_count = 0; value.items = []; assert.equal(parseAllocationOptions(value, { ...expected, page: 99 }).page, 1);
  assert.throws(() => parseAllocationOptions(null, expected), /could not be verified/);
  const last = valid(); last.total_count = 11; last.page = 2; assert.equal(parseAllocationOptions(last, { ...expected, page: 99 }).page, 2);
});
