import test from "node:test";
import assert from "node:assert/strict";
import { optimizeProfileCuts } from "../lib/systems-configurator/profile-optimization.ts";
import { generateHardwareBom } from "../lib/systems-configurator/hardware-engine.ts";
import { generateGlassCuts } from "../lib/systems-configurator/glass-engine.ts";
import { evaluateFormulaExpression } from "../lib/systems-configurator/formula-engine.ts";
import { can } from "../lib/auth/permissions.ts";

test("configurator write controls follow database manager roles", () => {
  for (const role of ["sales", "viewer", "production"]) {
    assert.equal(can(role, "create", "systems_configurator"), false);
    assert.equal(can(role, "update", "systems_configurator"), false);
  }
  for (const role of ["owner", "admin", "sales_manager"]) assert.equal(can(role, "update", "systems_configurator"), true);
});

test("mixed stock lengths govern placement and weighted waste totals", () => {
  const result = optimizeProfileCuts([
    { profileCode: "A", profileName: "A", componentRole: "frame", cutLengthMm: 2500, quantity: 2, stockLengthMm: 3000 },
    { profileCode: "B", profileName: "B", componentRole: "frame", cutLengthMm: 5000, quantity: 1, stockLengthMm: 6000 },
    { profileCode: "A", profileName: "A", componentRole: "frame", cutLengthMm: 3500, quantity: 1, stockLengthMm: 3000 },
  ], { stockLengthMm: 6000, sawKerfMm: 3, minimumReusableLeftoverMm: 2000 });
  assert.equal(result.totalStockBars, 3);
  assert.equal(result.profiles[0].unplacedCuts.length, 1);
  assert.deepEqual(result.profiles.map(p => p.stockLengthMm), [3000, 6000]);
  assert.equal(result.totalWasteMm, 2000);
  assert.equal(result.wastePercent, 16.667);
  assert.equal(result.totalUsedLengthMm + result.totalWasteMm, 12000);
});

test("same profile with distinct stock lengths is not combined into incompatible bars", () => {
  const result = optimizeProfileCuts([3000, 6000].map(stockLengthMm => ({ profileCode: "A", profileName: "A", componentRole: "frame", cutLengthMm: 2500, quantity: 1, stockLengthMm })), { stockLengthMm: 6000, sawKerfMm: 3, minimumReusableLeftoverMm: 300 });
  assert.equal(result.profiles.length, 2);
  assert.deepEqual(result.profiles.map(p => p.bars[0].stockLengthMm), [3000, 6000]);
});

const input = {
  widthMm: 1000, heightMm: 1000, quantity: 1, systemType: "sliding_window",
  template: { glassRules: { widthFormula: "1000", heightFormula: "1000", quantityFormula: "Q" } },
  panelLayout: { panels: [{ index: 1, type: "sliding", function: "glass", widthRatio: 1, heightRatio: 1 }] },
  selectedGlass: { id: "glass", glassCode: "G", ratePerSqft: 10 },
  selectedHardware: ["gasket", "wool_pile"].map(category => ({ id: category, itemCode: category, category, unit: "m", rate: 10 })),
  options: {},
};
test("default gasket and wool pile follow custom glass cuts, including quantity", () => {
  for (const [quantity, expected] of [[1, 4.2], [3, 12.6]]) {
    const configured = { ...input, quantity };
    const cuts = generateGlassCuts(configured, [], { Q: quantity }, evaluateFormulaExpression);
    const bom = generateHardwareBom(configured, [], { Q: quantity }, evaluateFormulaExpression, cuts);
    assert.equal(bom.find(x => x.hardwareCategory === "gasket").quantity, expected);
    assert.equal(bom.find(x => x.hardwareCategory === "wool_pile").quantity, expected);
  }
});
test("failed glass formulas do not generate default perimeter hardware", () => {
  const configured = { ...input, template: { glassRules: { widthFormula: "unknown", heightFormula: "1000" } } };
  const warnings = [];
  const bom = generateHardwareBom(configured, warnings, { Q: 1 }, evaluateFormulaExpression);
  assert.equal(bom.length, 0);
  assert.ok(warnings.some(w => w.code === "glass_formula_error"));
});
