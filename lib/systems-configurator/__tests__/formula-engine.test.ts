import test from "node:test";
import assert from "node:assert/strict";
import { calculateSystemConfiguration, evaluateFormulaExpression, twoTrackSlidingWindowTemplate, validateFormulaExpression, type ComponentRole, type FormulaComponentRule, type HardwareCategory, type SystemConfigurationInput, type SystemType } from "../formula-engine.ts";
import { categorizeWarning, hasCriticalWarnings } from "../warning-categories.ts";

const slidingRules: FormulaComponentRule[] = [
  { componentRole: "outer_frame_top", quantityFormula: "1 * Q", lengthFormula: "W" },
  { componentRole: "outer_frame_bottom", quantityFormula: "1 * Q", lengthFormula: "W" },
  { componentRole: "outer_frame_left", quantityFormula: "1 * Q", lengthFormula: "H" },
  { componentRole: "outer_frame_right", quantityFormula: "1 * Q", lengthFormula: "H" },
  { componentRole: "shutter_vertical", quantityFormula: "2 * shutter_count * Q", lengthFormula: "H - sash_deduction" },
  { componentRole: "shutter_horizontal_top", quantityFormula: "1 * shutter_count * Q", lengthFormula: "(W + overlap_mm) / shutter_count" },
  { componentRole: "shutter_horizontal_bottom", quantityFormula: "1 * shutter_count * Q", lengthFormula: "(W + overlap_mm) / shutter_count" }
];

const frameRules: FormulaComponentRule[] = [
  { componentRole: "outer_frame_top", quantityFormula: "1 * Q", lengthFormula: "W" },
  { componentRole: "outer_frame_bottom", quantityFormula: "1 * Q", lengthFormula: "W" },
  { componentRole: "outer_frame_left", quantityFormula: "1 * Q", lengthFormula: "H" },
  { componentRole: "outer_frame_right", quantityFormula: "1 * Q", lengthFormula: "H" }
];

const profiles = [
  ["outer_frame_top", "FR-T", "Frame Top", 1.1],
  ["outer_frame_bottom", "FR-B", "Frame Bottom", 1.2],
  ["outer_frame_left", "FR-L", "Frame Left", 1.1],
  ["outer_frame_right", "FR-R", "Frame Right", 1.1],
  ["shutter_vertical", "SH-V", "Shutter Vertical", 0.8],
  ["shutter_horizontal_top", "SH-T", "Shutter Top", 0.75],
  ["shutter_horizontal_bottom", "SH-B", "Shutter Bottom", 0.75],
  ["interlock", "INT", "Interlock", 0.65],
  ["glazing_bead_vertical", "BD-V", "Bead Vertical", 0.2],
  ["glazing_bead_horizontal", "BD-H", "Bead Horizontal", 0.2]
].map(([componentRole, profileCode, profileName, sectionWeightKgPerM]) => ({ componentRole: componentRole as ComponentRole, profileCode: String(profileCode), profileName: String(profileName), sectionWeightKgPerM: Number(sectionWeightKgPerM), profileId: String(profileCode), stockLengthMm: 6000 }));

const hardware = [
  ["ROL", "Roller", "roller", "pcs", 150],
  ["LOCK", "Lock", "lock", "set", 350],
  ["HAN", "Handle", "handle", "pcs", 120],
  ["HNG", "Hinge", "hinge", "pcs", 75],
  ["STY", "Stay Arm", "stay_arm", "pcs", 90],
  ["GSK", "EPDM Gasket", "gasket", "m", 18],
  ["WLP", "Wool Pile", "wool_pile", "m", 12],
  ["DRN", "Drainage Cap", "drainage_cap", "pcs", 5],
  ["SCR", "Screw", "screw", "pcs", 2],
  ["CLT", "Corner Cleat", "corner_cleat", "pcs", 20]
].map(([itemCode, itemName, category, unit, rate]) => ({ itemCode: String(itemCode), itemName: String(itemName), category: category as HardwareCategory, unit: String(unit), rate: Number(rate) }));

function panel(index: number, type: "fixed" | "sliding" | "casement" | "door_leaf", widthRatio: number, openingDirection = "fixed") {
  return { index, type, function: "glass" as const, widthRatio, heightRatio: 1, openingDirection: openingDirection as never };
}

function template(systemType: SystemType, profileRules: FormulaComponentRule[], hardwareRules?: SystemConfigurationInput["template"]["hardwareRules"]) {
  return { templateCode: systemType, templateName: systemType, systemType, formulaVersion: 1, requiredComponents: [], profileRules, hardwareRules };
}

const baseInput: SystemConfigurationInput = {
  widthMm: 1500,
  heightMm: 1200,
  quantity: 1,
  systemType: "two_track_sliding_window",
  template: template("two_track_sliding_window", slidingRules),
  panelLayout: { panels: [panel(1, "sliding", 0.5, "sliding_left"), panel(2, "sliding", 0.5, "sliding_right")], mullions: [], transoms: [], mesh: { enabled: false } },
  selectedProfiles: profiles as SystemConfigurationInput["selectedProfiles"],
  selectedHardware: hardware as SystemConfigurationInput["selectedHardware"],
  selectedGlass: { id: "glass-1", glassCode: "GL-5", glassName: "5mm Clear", glassType: "clear", thicknessMm: 5, ratePerSqft: 80, ratePerSqm: 0 },
  selectedFinish: { finishCode: "PC", finishName: "Powder Coating", finishType: "powder_coating", rateType: "per_kg", rate: 45 },
  companySettings: { stockLengthMm: 6000, sawKerfMm: 3, minimumReusableLeftoverMm: 300, defaultWastagePercent: 5 },
  costing: { aluminiumRatePerKg: 280, fabricationLaborRate: 85, installationRate: 45, transportAmount: 0, wastagePercent: 5, marginPercent: 15, gstPercent: 18, discountAmount: 0 },
  options: { sash_deduction: 85, glass_deduction_width: 90, glass_deduction_height: 90, overlap_mm: 40, track_count: 2 }
};

test("safe formula parser supports arithmetic and rejects unsafe expressions", () => {
  assert.equal(evaluateFormulaExpression("max(H - sash_deduction, 0)", { H: 1200, sash_deduction: 85 }), 1115);
  assert.equal(evaluateFormulaExpression("ceil((W + overlap_mm) / shutter_count)", { W: 1500, overlap_mm: 40, shutter_count: 2 }), 770);
  assert.equal(validateFormulaExpression("process.exit()").some((warning) => warning.severity === "error"), true);
  assert.throws(() => evaluateFormulaExpression("unknown + 1", { W: 1 }), /Unknown formula variable/);
});

test("sliding system outputs cuts, glass, beading, hardware, material, costing, optimization", () => {
  const result = calculateSystemConfiguration(baseInput);
  const profileCutWeight = result.profileCuts.reduce((sum, cut) => sum + cut.totalWeightKg, 0);
  const beadingWeight = result.beadingCuts.reduce((sum, cut) => sum + cut.totalWeightKg, 0);
  const aluminiumMaterialWeight = result.materialSummary.filter((item) => item.materialType === "aluminium_profile").reduce((sum, item) => sum + item.totalWeightKg, 0);
  const aluminiumMaterialLength = result.materialSummary.filter((item) => item.materialType === "aluminium_profile").reduce((sum, item) => sum + item.totalLengthM, 0);
  assert.equal(result.errors.length, 0);
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
  assert.equal(result.costingSummary.grandTotal > 0, true);
  assert.equal(result.optimizationSummary.totalStockBars > 0, true);
});

test("production 2-track sliding window template calculates expected sample quantities", () => {
  const result = calculateSystemConfiguration({
    ...baseInput,
    widthMm: 1500,
    heightMm: 1200,
    quantity: 1,
    template: twoTrackSlidingWindowTemplate,
    panelLayout: { panels: [panel(1, "sliding", 0.5, "sliding_left"), panel(2, "sliding", 0.5, "sliding_right")] },
    selectedProfiles: profiles,
    selectedHardware: hardware,
    companySettings: { stockLengthMm: 6000, sawKerfMm: 3, minimumReusableLeftoverMm: 300, defaultWastagePercent: 5 },
    options: {
      panel_count: 2,
      shutter_count: 2,
      track_count: 2,
      overlap_mm: 40,
      frame_deduction_mm: 0,
      sash_height_deduction_mm: 80,
      glass_deduction_width_mm: 90,
      glass_deduction_height_mm: 120,
      screws_per_window: 16
    }
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.some((warning) => warning.code === "cut_exceeds_stock"), false);
  assert.equal(result.profileCuts.every((cut) => cut.cutLengthMm > 0 && cut.quantity > 0 && cut.totalLengthM > 0 && cut.totalWeightKg > 0), true);
  assert.equal(result.glassCuts.every((cut) => cut.widthMm > 0 && cut.heightMm > 0 && cut.quantity > 0), true);
  assert.equal(result.beadingCuts.every((cut) => cut.cutLengthMm > 0 && cut.quantity > 0 && cut.totalLengthM > 0), true);
  assert.equal(result.hardwareBom.every((item) => item.quantity > 0 && item.amount >= 0), true);
  assert.equal(result.materialSummary.every((item) => item.quantity > 0 && item.amount >= 0), true);
  assert.equal(result.costingSummary.grandTotal > 0, true);

  const cut = (role: ComponentRole) => result.profileCuts.find((item) => item.componentRole === role);
  assert.equal(cut("outer_frame_top")?.cutLengthMm, 1500);
  assert.equal(cut("outer_frame_top")?.quantity, 1);
  assert.equal(cut("outer_frame_bottom")?.cutLengthMm, 1500);
  assert.equal(cut("outer_frame_left")?.cutLengthMm, 1200);
  assert.equal(cut("outer_frame_right")?.cutLengthMm, 1200);
  assert.equal(cut("shutter_vertical")?.cutLengthMm, 1120);
  assert.equal(cut("shutter_vertical")?.quantity, 4);
  assert.equal(cut("shutter_horizontal_top")?.cutLengthMm, 770);
  assert.equal(cut("shutter_horizontal_top")?.quantity, 2);
  assert.equal(cut("shutter_horizontal_bottom")?.cutLengthMm, 770);
  assert.equal(cut("shutter_horizontal_bottom")?.quantity, 2);
  assert.equal(cut("interlock")?.cutLengthMm, 1120);
  assert.equal(cut("interlock")?.quantity, 1);
  assert.match(cut("shutter_vertical")?.remarks ?? "", /Formula: shutter_height/);
  assert.equal(cut("shutter_vertical")?.explanation?.variables?.shutter_height, 1120);

  assert.equal(result.glassCuts.length, 2);
  assert.equal(result.glassCuts.reduce((sum, item) => sum + item.quantity, 0), 2);
  assert.equal(result.glassCuts.every((item) => item.widthMm === 680 && item.heightMm === 1000), true);
  assert.match(result.glassCuts[0]?.remarks ?? "", /glass_width/);
  assert.equal(result.beadingCuts.length, 8);
  assert.equal(result.beadingCuts.filter((item) => item.beadPosition === "left" || item.beadPosition === "right").reduce((sum, item) => sum + item.quantity, 0), 4);
  assert.equal(result.beadingCuts.filter((item) => item.beadPosition === "top" || item.beadPosition === "bottom").reduce((sum, item) => sum + item.quantity, 0), 4);

  const hardwareQty = (category: HardwareCategory) => result.hardwareBom.find((item) => item.hardwareCategory === category)?.quantity;
  assert.equal(hardwareQty("roller"), 4);
  assert.equal(hardwareQty("lock"), 1);
  assert.equal(hardwareQty("handle"), 1);
  assert.equal(hardwareQty("wool_pile"), 7.56);
  assert.equal(hardwareQty("gasket"), 6.72);
  assert.equal(hardwareQty("screw"), 16);
  assert.match(result.hardwareBom.find((item) => item.hardwareCategory === "screw")?.remarks ?? "", /screws_per_window/);
});

test("warning categorizer marks quote-blocking calculation issues as critical", () => {
  assert.equal(categorizeWarning({ code: "invalid_glass_size", severity: "error" }), "critical");
  assert.equal(categorizeWarning({ code: "missing_hardware", severity: "warning" }), "high");
  assert.equal(categorizeWarning({ code: "missing_glass", severity: "warning" }), "medium");
  assert.equal(hasCriticalWarnings([{ code: "missing_glass", severity: "warning" }, { code: "cut_exceeds_stock", severity: "warning" }]), true);
});

test("casement system calculates openable hardware", () => {
  const result = calculateSystemConfiguration({ ...baseInput, widthMm: 900, systemType: "casement_window", template: template("casement_window", [...frameRules, { componentRole: "shutter_vertical", quantityFormula: "2 * openable_panel_count * Q", lengthFormula: "H - sash_deduction" }]), panelLayout: { panels: [panel(1, "casement", 1, "right")] }, options: { ...baseInput.options, track_count: 1, sash_deduction: 60, overlap_mm: 0 } });
  assert.equal(result.errors.length, 0);
  assert.equal(result.glassCuts.length, 1);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "hinge" && item.quantity === 2), true);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "stay_arm" && item.quantity === 1), true);
});

test("fixed system excludes openable hardware", () => {
  const result = calculateSystemConfiguration({ ...baseInput, widthMm: 1000, heightMm: 1000, systemType: "fixed_window", template: template("fixed_window", frameRules), panelLayout: { panels: [panel(1, "fixed", 1)] }, options: { ...baseInput.options, track_count: 1, overlap_mm: 0 } });
  assert.equal(result.errors.length, 0);
  assert.equal(result.glassCuts.length, 1);
  assert.equal(result.hardwareBom.some((item) => ["hinge", "handle", "stay_arm"].includes(item.hardwareCategory)), false);
});

test("door system supports configurable hardware rules", () => {
  const result = calculateSystemConfiguration({ ...baseInput, widthMm: 950, heightMm: 2200, systemType: "hinged_door", template: template("hinged_door", frameRules, { hinge: "4 * openable_panel_count * Q", lock: "openable_panel_count * Q", handle: "openable_panel_count * Q" }), panelLayout: { panels: [panel(1, "door_leaf", 1, "right")] }, options: { ...baseInput.options, track_count: 1, overlap_mm: 0 } });
  assert.equal(result.errors.length, 0);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "hinge" && item.quantity === 4), true);
  assert.equal(result.hardwareBom.some((item) => item.hardwareCategory === "lock" && item.quantity === 1), true);
});

test("invalid cut formulas return clear errors and prevent negative cuts", () => {
  const result = calculateSystemConfiguration({ ...baseInput, template: template("two_track_sliding_window", [{ componentRole: "outer_frame_top", quantityFormula: "1", lengthFormula: "W - 9999" }]) });
  assert.equal(result.profileCuts.length, 0);
  assert.equal(result.errors.some((error) => error.code === "invalid_cut" && error.field === "outer_frame_top"), true);
});
