import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemQuoteDescription, buildSystemWhatsAppSummary } from "../lib/systems-configurator/quote-integration.ts";
import { assertSystemQuoteReady, getSystemQuoteReadiness } from "../lib/systems-configurator/quote-readiness.ts";
import { getSystemOutputStatus } from "../lib/systems-configurator/output-status.ts";

const input = {
  configurationNumber: "SC-2026-0001",
  projectName: "Villa Windows",
  designReference: "W01",
  systemType: "two_track_sliding_window",
  widthMm: 1500,
  heightMm: 1200,
  quantity: 2,
  finishName: "Powder Coated Black",
  glassName: "5mm Toughened Glass",
  grandTotal: 45000,
  gstAmount: 6864,
  customerName: "Aarav"
};

test("system quote description is customer readable", () => {
  const description = buildSystemQuoteDescription(input);

  assert.match(description, /Two Track Sliding Window/);
  assert.match(description, /1500mm x 1200mm/);
  assert.match(description, /Powder Coated Black/);
  assert.match(description, /W01/);
});

test("whatsapp summary includes key commercial values", () => {
  const summary = buildSystemWhatsAppSummary(input);

  assert.match(summary, /Hello Aarav/);
  assert.match(summary, /Villa Windows/);
  assert.match(summary, /Quantity: 2/);
  assert.match(summary, /Grand Total: Rs. 45,000/);
});

test("quote readiness blocks draft and incomplete system configurations", () => {
  const readyConfiguration = { status: "calculated", customer_id: "customer-1", grand_total: 45000 };
  const readyCuts = [{ profile_id: "profile-1", total_length_m: 12.5, total_weight_kg: 18.25 }];

  assert.equal(getSystemQuoteReadiness({ ...readyConfiguration, status: "draft" }, readyCuts, true).ready, false);
  assert.match(getSystemQuoteReadiness({ ...readyConfiguration, status: "draft" }, readyCuts, true).reason ?? "", /recalculate/i);
  assert.match(getSystemQuoteReadiness({ ...readyConfiguration, customer_id: null }, readyCuts, true).reason ?? "", /customer/i);
  assert.match(getSystemQuoteReadiness({ ...readyConfiguration, grand_total: 0 }, readyCuts, true).reason ?? "", /Calculate/i);
  assert.match(getSystemQuoteReadiness(readyConfiguration, [], true).reason ?? "", /profile cut/i);
  assert.equal(getSystemQuoteReadiness(readyConfiguration, readyCuts, true).ready, true);
});

test("quote readiness assertion throws the same quote-gating message used by conversion", () => {
  assert.throws(
    () => assertSystemQuoteReady({ status: "draft", customer_id: "customer-1", grand_total: 45000 }, [{ profile_id: "profile-1", total_length_m: 12.5, total_weight_kg: 18.25 }], true),
    /Resolve critical calculation warnings/
  );
});

test("output status reports missing production outputs", () => {
  const incomplete = getSystemOutputStatus({ profileCuts: 2, glassCuts: 1, beadingCuts: 0, hardwareBom: 0, optimizationRuns: 0 });
  assert.equal(incomplete.productionReady, false);
  assert.deepEqual(incomplete.missingOutputs, ["Beading cuts", "Hardware BOM"]);
  assert.equal(incomplete.optimizationReady, false);

  const complete = getSystemOutputStatus({ profileCuts: 2, glassCuts: 1, beadingCuts: 4, hardwareBom: 3, optimizationRuns: 1 });
  assert.equal(complete.productionReady, true);
  assert.equal(complete.optimizationReady, true);
  assert.deepEqual(complete.missingOutputs, []);
});
