import test from "node:test";
import assert from "node:assert/strict";
import { optimizeProfileCuts } from "../lib/systems-configurator/profile-optimization.ts";

test("first-fit decreasing optimizes cuts by profile code", () => {
  const result = optimizeProfileCuts([
    { profileCode: "SL-2001", profileName: "Sliding Frame", componentRole: "outer_frame_top", cutLengthMm: 2100, quantity: 2 },
    { profileCode: "SL-2001", profileName: "Sliding Frame", componentRole: "outer_frame_left", cutLengthMm: 1500, quantity: 2 },
    { profileCode: "SL-2001", profileName: "Sliding Frame", componentRole: "mullion", cutLengthMm: 1200, quantity: 2 },
    { profileCode: "SH-3001", profileName: "Shutter", componentRole: "shutter_vertical", cutLengthMm: 1000, quantity: 3 }
  ], { stockLengthMm: 6000, sawKerfMm: 3, minimumReusableLeftoverMm: 300 });

  assert.equal(result.totalStockBars > 0, true);
  assert.equal(result.profiles.length, 2);
  assert.equal(result.profiles[0].profileCode, "SH-3001");
  assert.equal(result.profiles[1].profileCode, "SL-2001");
  assert.equal(result.profiles[1].bars[0].cuts[0].cutLengthMm, 2100);
  assert.equal(result.wastePercent >= 0, true);
});

test("optimization accounts for saw kerf and reusable leftovers", () => {
  const result = optimizeProfileCuts([
    { profileCode: "A", profileName: "A", componentRole: "test", cutLengthMm: 2000, quantity: 2 }
  ], { stockLengthMm: 5000, sawKerfMm: 5, minimumReusableLeftoverMm: 300 });

  assert.equal(result.profiles[0].totalStockBars, 1);
  assert.equal(result.profiles[0].bars[0].usedLengthMm, 4005);
  assert.equal(result.profiles[0].bars[0].wasteMm, 995);
  assert.deepEqual(result.profiles[0].reusableLeftoversMm, [995]);
});

test("optimization warns when a cut exceeds stock length", () => {
  const result = optimizeProfileCuts([
    { profileCode: "A", profileName: "A", componentRole: "test", cutLengthMm: 6100, quantity: 1 }
  ], { stockLengthMm: 6000, sawKerfMm: 3, minimumReusableLeftoverMm: 300 });

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /exceeds stock length/);
});
