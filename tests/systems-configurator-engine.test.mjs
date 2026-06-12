import test from "node:test";
import assert from "node:assert/strict";
import { calculateSystemConfiguration, evaluateFormulaExpression, validateFormulaExpression } from "../lib/systems-configurator/formula-engine.ts";
import { validateSystemDraftJsonFields } from "../lib/systems-configurator/draft-validation.ts";

const template = {
  templateCode: "SL2T",
  templateName: "2 Track Sliding",
  systemType: "two_track_sliding_window",
  formulaVersion: 1,
  requiredComponents: [],
  profileRules: [
    { componentRole: "outer_frame_top", quantityFormula: "1 * Q", lengthFormula: "W" },
    { componentRole: "outer_frame_bottom", quantityFormula: "1 * Q", lengthFormula: "W" },
    { componentRole: "outer_frame_left", quantityFormula: "1 * Q", lengthFormula: "H" },
    { componentRole: "outer_frame_right", quantityFormula: "1 * Q", lengthFormula: "H" },
    { componentRole: "shutter_vertical", quantityFormula: "2 * shutter_count * Q", lengthFormula: "H - sash_deduction" },
    { componentRole: "shutter_horizontal_top", quantityFormula: "1 * shutter_count * Q", lengthFormula: "(W + overlap_mm) / shutter_count" },
    { componentRole: "shutter_horizontal_bottom", quantityFormula: "1 * shutter_count * Q", lengthFormula: "(W + overlap_mm) / shutter_count" }
  ]
};

const profiles = [
  ["outer_frame_top", "FR-T", "Frame Top", 1.1],
  ["outer_frame_bottom", "FR-B", "Frame Bottom", 1.2],
  ["outer_frame_left", "FR-L", "Frame Left", 1.1],
  ["outer_frame_right", "FR-R", "Frame Right", 1.1],
  ["shutter_vertical", "SH-V", "Shutter Vertical", 0.8],
  ["shutter_horizontal_top", "SH-T", "Shutter Top", 0.75],
  ["shutter_horizontal_bottom", "SH-B", "Shutter Bottom", 0.75],
  ["glazing_bead_vertical", "BD-V", "Bead Vertical", 0.2],
  ["glazing_bead_horizontal", "BD-H", "Bead Horizontal", 0.2]
].map(([componentRole, profileCode, profileName, sectionWeightKgPerM]) => ({ componentRole, profileCode, profileName, sectionWeightKgPerM, profileId: profileCode, stockLengthMm: 6000 }));

const hardware = [
  ["ROL", "Roller", "roller", "pcs", 150],
  ["LOCK", "Sliding Lock", "lock", "set", 350],
  ["HAN", "Handle", "handle", "pcs", 120],
  ["HNG", "Hinge", "hinge", "pcs", 75],
  ["STY", "Stay Arm", "stay_arm", "pcs", 90],
  ["GSK", "EPDM Gasket", "gasket", "m", 18],
  ["WLP", "Wool Pile", "wool_pile", "m", 12],
  ["DRN", "Drainage Cap", "drainage_cap", "pcs", 5],
  ["SCR", "Screw", "screw", "pcs", 2],
  ["CLT", "Corner Cleat", "corner_cleat", "pcs", 20]
].map(([itemCode, itemName, category, unit, rate]) => ({ itemCode, itemName, category, unit, rate }));

const frameRules = [
  { componentRole: "outer_frame_top", quantityFormula: "1 * Q", lengthFormula: "W" },
  { componentRole: "outer_frame_bottom", quantityFormula: "1 * Q", lengthFormula: "W" },
  { componentRole: "outer_frame_left", quantityFormula: "1 * Q", lengthFormula: "H" },
  { componentRole: "outer_frame_right", quantityFormula: "1 * Q", lengthFormula: "H" }
];

function systemTemplate(systemType, profileRules) {
  return { templateCode: systemType, templateName: systemType, systemType, formulaVersion: 1, requiredComponents: [], profileRules };
}

function panel(index, type, widthRatio, openingDirection = "fixed") {
  return { index, type, function: "glass", widthRatio, heightRatio: 1, openingDirection };
}

function calculateFixture(overrides) {
  return calculateSystemConfiguration({ ...baseInput, ...overrides });
}

const baseInput = {
  widthMm: 1500,
  heightMm: 1200,
  quantity: 1,
  systemType: "two_track_sliding_window",
  template,
  panelLayout: {
    panels: [
      { index: 1, type: "sliding", function: "glass", widthRatio: 0.5, heightRatio: 1, openingDirection: "sliding_left" },
      { index: 2, type: "sliding", function: "glass", widthRatio: 0.5, heightRatio: 1, openingDirection: "sliding_right" }
    ],
    mullions: [],
    transoms: [],
    mesh: { enabled: false }
  },
  selectedProfiles: profiles,
  selectedHardware: hardware,
  selectedGlass: { id: "glass-1", glassCode: "GL-5", glassName: "5mm Clear", glassType: "clear", thicknessMm: 5, ratePerSqft: 80, ratePerSqm: 0 },
  selectedFinish: { finishCode: "PC", finishName: "Powder Coating", finishType: "powder_coating", rateType: "per_kg", rate: 45 },
  companySettings: { stockLengthMm: 6000, sawKerfMm: 3, minimumReusableLeftoverMm: 300, defaultWastagePercent: 5 },
  costing: { aluminiumRatePerKg: 280, fabricationLaborRate: 85, installationRate: 45, transportAmount: 0, wastagePercent: 5, marginPercent: 15, gstPercent: 18, discountAmount: 0 },
  options: { sash_deduction: 85, glass_deduction_width: 90, glass_deduction_height: 90, overlap_mm: 40, track_count: 2 }
};

test("safe formula evaluator supports arithmetic and functions", () => {
  assert.equal(evaluateFormulaExpression("max(H - frame_deduction, 0)", { H: 1200, frame_deduction: 85 }), 1115);
  assert.equal(validateFormulaExpression("process.exit()").some((warning) => warning.severity === "error"), true);
});

test("2-track sliding calculation generates profile cuts, glass, beading, BOM, and costing", () => {
  const result = calculateSystemConfiguration(baseInput);
  const profileCutWeight = result.profileCuts.reduce((sum, cut) => sum + cut.totalWeightKg, 0);
  const beadingWeight = result.beadingCuts.reduce((sum, cut) => sum + cut.totalWeightKg, 0);
  const aluminiumMaterialWeight = result.materialSummary.filter((item) => item.materialType === "aluminium_profile").reduce((sum, item) => sum + item.totalWeightKg, 0);
  const aluminiumMaterialLength = result.materialSummary.filter((item) => item.materialType === "aluminium_profile").reduce((sum, item) => sum + item.totalLengthM, 0);

  assert.equal(result.warnings.some((warning) => warning.severity === "error"), false);
  assert.equal(result.errors.length, 0);
  assert.equal(result.profileCuts.length >= 7, true);
  assert.equal(result.glassCuts.length, 2);
  assert.equal(result.beadingCuts.length, 8);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "roller" && item.quantity === 4), true);
  assert.equal(result.materialSummary.some((item) => item.materialType === "aluminium_profile"), true);
  assert.equal(result.beadingCuts.every((cut) => cut.totalLengthM > 0 && cut.totalWeightKg > 0), true);
  assert.equal(Number(profileCutWeight.toFixed(3)), 11.968);
  assert.equal(Number(beadingWeight.toFixed(3)), 1.416);
  assert.equal(Number(aluminiumMaterialWeight.toFixed(3)), 13.384);
  assert.equal(Number(aluminiumMaterialLength.toFixed(3)), 20.02);
  assert.equal(result.costingSummary.aluminiumCost, 3747.52);
  assert.equal((result.costingSummary?.grandTotal ?? 0) > 0, true);
  assert.equal((result.optimizationSummary?.totalStockBars ?? 0) > 0, true);
});

test("invalid dimensions produce errors and unsafe formulas are rejected", () => {
  const result = calculateSystemConfiguration({ ...baseInput, widthMm: 0 });

  assert.equal(result.warnings.some((warning) => warning.code === "invalid_dimensions" && warning.severity === "error"), true);
  assert.equal(result.errors.some((error) => error.code === "invalid_dimensions"), true);
  assert.throws(() => evaluateFormulaExpression("window.alert(1)", { W: 1 }));
});

test("sliding door fixture calculates profiles, glass, rollers, and costing", () => {
  const result = calculateFixture({
    widthMm: 2400,
    heightMm: 2100,
    systemType: "sliding_door",
    template: systemTemplate("sliding_door", template.profileRules),
    panelLayout: { panels: [panel(1, "sliding", 0.5, "sliding_left"), panel(2, "sliding", 0.5, "sliding_right")], mullions: [], transoms: [], mesh: { enabled: false } }
  });

  assert.equal(result.warnings.some((warning) => warning.severity === "error"), false);
  assert.equal(result.glassCuts.length, 2);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "roller" && item.quantity === 4), true);
  assert.equal((result.costingSummary?.grandTotal ?? 0) > 0, true);
});

test("casement window fixture calculates openable hardware", () => {
  const result = calculateFixture({
    widthMm: 900,
    heightMm: 1200,
    systemType: "casement_window",
    template: systemTemplate("casement_window", [
      ...frameRules,
      { componentRole: "shutter_vertical", quantityFormula: "2 * openable_panel_count * Q", lengthFormula: "H - sash_deduction" },
      { componentRole: "shutter_horizontal_top", quantityFormula: "1 * openable_panel_count * Q", lengthFormula: "W - sash_deduction" },
      { componentRole: "shutter_horizontal_bottom", quantityFormula: "1 * openable_panel_count * Q", lengthFormula: "W - sash_deduction" }
    ]),
    panelLayout: { panels: [panel(1, "casement", 1, "right")], mullions: [], transoms: [], mesh: { enabled: false } },
    options: { ...baseInput.options, track_count: 1, sash_deduction: 60, overlap_mm: 0 }
  });

  assert.equal(result.warnings.some((warning) => warning.severity === "error"), false);
  assert.equal(result.glassCuts.length, 1);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "hinge" && item.quantity === 2), true);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "stay_arm" && item.quantity === 1), true);
});

test("fixed window fixture does not add openable hardware", () => {
  const result = calculateFixture({
    widthMm: 1000,
    heightMm: 1000,
    systemType: "fixed_window",
    template: systemTemplate("fixed_window", frameRules),
    panelLayout: { panels: [panel(1, "fixed", 1, "fixed")], mullions: [], transoms: [], mesh: { enabled: false } },
    options: { ...baseInput.options, track_count: 1, overlap_mm: 0 }
  });

  assert.equal(result.warnings.some((warning) => warning.severity === "error"), false);
  assert.equal(result.glassCuts.length, 1);
  assert.equal(result.hardwareBom.some((item) => ["hinge", "handle", "stay_arm"].includes(item.hardwareCategory)), false);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "gasket"), true);
});

test("hinged door fixture calculates door hardware", () => {
  const result = calculateFixture({
    widthMm: 950,
    heightMm: 2200,
    systemType: "hinged_door",
    template: systemTemplate("hinged_door", [
      ...frameRules,
      { componentRole: "shutter_vertical", quantityFormula: "2 * openable_panel_count * Q", lengthFormula: "H - sash_deduction" },
      { componentRole: "shutter_horizontal_top", quantityFormula: "1 * openable_panel_count * Q", lengthFormula: "W - sash_deduction" },
      { componentRole: "shutter_horizontal_bottom", quantityFormula: "1 * openable_panel_count * Q", lengthFormula: "W - sash_deduction" }
    ]),
    panelLayout: { panels: [panel(1, "door_leaf", 1, "right")], mullions: [], transoms: [], mesh: { enabled: false } },
    options: { ...baseInput.options, track_count: 1, sash_deduction: 70, overlap_mm: 0 }
  });

  assert.equal(result.warnings.some((warning) => warning.severity === "error"), false);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "hinge" && item.quantity === 4), true);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "lock" && item.quantity === 1), true);
});

test("draft JSON validation rejects invalid edit payloads", () => {
  const validLayout = JSON.stringify({ panels: [panel(1, "sliding", 0.5, "sliding_left"), panel(2, "sliding", 0.5, "sliding_right")], mesh: { enabled: false } });
  const validOptions = JSON.stringify({ track_count: 2, panel_count: 2 });

  assert.deepEqual(validateSystemDraftJsonFields(validLayout, validOptions), []);
  assert.equal(validateSystemDraftJsonFields(JSON.stringify({ panels: [] }), validOptions).some((issue) => issue.message === "Panel layout must contain panels"), true);
  assert.equal(validateSystemDraftJsonFields(JSON.stringify({ panels: [panel(1, "sliding", 0.4, "sliding_left"), panel(2, "sliding", 0.4, "sliding_right")] }), validOptions).some((issue) => issue.message === "Panel width ratios must total 1"), true);
  assert.equal(validateSystemDraftJsonFields(validLayout, "not-json").some((issue) => issue.path === "options_json"), true);
});
