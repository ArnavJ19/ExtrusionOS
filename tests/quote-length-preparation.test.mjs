import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fc from "fast-check";
const require = createRequire(import.meta.url); require("tsx/cjs");
const { parseLengthInput, displayLength } = require("../lib/calculations/length-units.ts");
const { quotePreparationIssues, quoteConfirmationStages } = require("../lib/workflow/quote-preparation.ts");

test("engineering length inputs produce canonical metres at the existing database precision", () => {
  for (const [input, unit, metres] of [["6000", "mm", 6], ["20", "ft", 6.096], ["240", "in", 6.096], ["6.096", "m", 6.096], [".5", "m", 0.5], ["1", "in", 0.0254], ["0.000000001", "mm", 0.000000000001]]) assert.deepEqual(parseLengthInput(input, unit), { metres });
});
test("invalid units, ambiguous decimal syntax, nonpositive lengths and excessive lengths are rejected", () => {
  for (const input of ["", "0", "-1", "1e3", "1,000", ".", "NaN", "Infinity", "1.0000000000001", "1000.000000000001"]) assert.ok(parseLengthInput(input, "m").error, input);
  assert.ok(parseLengthInput("6", "yard").error); assert.ok(parseLengthInput("0.000000000001", "mm").error);
  assert.equal(displayLength(Infinity, "m"), "");
});
test("display conversion round trips common shop lengths without accumulating metres drift", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 1000000 }), fc.constantFrom("m", "mm", "ft", "in"), (millimetres, unit) => {
    const metres = millimetres / 1000, converted = parseLengthInput(displayLength(metres, unit), unit);
    assert.ok(!converted.error); assert.ok(Math.abs(converted.metres - metres) <= 1.1e-12);
  }), { numRuns: 500 });
});
test("confirmation stages require verified item costing and report specific incomplete lines", () => {
  assert.deepEqual(quoteConfirmationStages, ["approved_for_sending", "sent", "customer_approved"]);
  assert.ok(quotePreparationIssues([]).length); assert.equal(quotePreparationIssues([{ costing_complete: true }]).length, 0);
  assert.match(quotePreparationIssues([{ costing_complete: true }, { costing_complete: false }])[0], /2/);
  assert.ok(quotePreparationIssues([{ costing_complete: null }]).length);
});
