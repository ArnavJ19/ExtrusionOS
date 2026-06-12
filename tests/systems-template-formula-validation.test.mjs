import test from "node:test";
import assert from "node:assert/strict";
import { assertValidTemplateFormulaJson, getFormulaIdentifiers, validateTemplateFormulaJson } from "../lib/systems-configurator/template-formula-validation.ts";

const validFormulaJson = {
  requiredComponents: ["outer_frame_top", "outer_frame_bottom"],
  profileRules: [
    { componentRole: "outer_frame_top", quantityFormula: "1 * Q", lengthFormula: "W" },
    { componentRole: "shutter_vertical", quantityFormula: "2 * shutter_count * Q", lengthFormula: "shutter_height" }
  ],
  glassRules: { widthFormula: "glass_width", heightFormula: "glass_height", quantityFormula: "Q" },
  hardwareRules: {
    roller: { quantityFormula: "2 * shutter_count * Q" },
    screw: { quantityFormula: "screws_per_window * Q" }
  }
};

test("template formula validator summarizes safe formula JSON", () => {
  const summary = validateTemplateFormulaJson(validFormulaJson);

  assert.equal(summary.errors.length, 0);
  assert.equal(summary.formulaCount, 9);
  assert.equal(summary.profileRuleCount, 2);
  assert.equal(summary.glassRuleCount, 1);
  assert.equal(summary.hardwareRuleCount, 2);
  assert.equal(summary.variables.includes("shutter_height"), true);
});

test("template formula validator blocks unsafe and malformed formulas", () => {
  const summary = validateTemplateFormulaJson({
    profileRules: [{ componentRole: "outer_frame_top", quantityFormula: "1 * Q", lengthFormula: "process.exit()" }],
    glassRules: "invalid"
  });

  assert.equal(summary.errors.some((issue) => issue.path === "profileRules.0.lengthFormula"), true);
  assert.equal(summary.errors.some((issue) => issue.path === "glassRules"), true);
  assert.throws(() => assertValidTemplateFormulaJson({ profileRules: [{ componentRole: "outer_frame_top", quantityFormula: "1", lengthFormula: "eval(1)" }] }), /Invalid formula JSON/);
});

test("template formula validator warns for custom runtime variables", () => {
  const summary = validateTemplateFormulaJson({ profileRules: [{ componentRole: "custom", quantityFormula: "custom_option * Q", lengthFormula: "W" }] });

  assert.equal(summary.errors.length, 0);
  assert.equal(summary.warnings.some((issue) => issue.message.includes("custom_option")), true);
  assert.deepEqual(getFormulaIdentifiers("round(custom_option + W, 2)"), ["custom_option", "W"]);
});
