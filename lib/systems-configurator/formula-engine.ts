import { generateBeadingCuts } from "./beading-engine.ts";
import { calculateSystemCosting } from "./costing-engine.ts";
import { generateGlassCuts } from "./glass-engine.ts";
import { generateHardwareBom } from "./hardware-engine.ts";
import { buildMaterialSummary } from "./material-summary.ts";
import { optimizeProfileCuts } from "./profile-optimization.ts";
import type { ConfiguratorResult, ConfiguratorWarning, FormulaComponentRule, FormulaVariables, ProfileCut, SystemConfigurationInput } from "./types.ts";
import { round } from "./types.ts";

export * from "./types.ts";
export { twoTrackSlidingWindowTemplate } from "./templates.ts";

type FormulaToken = { type: "number" | "identifier" | "operator" | "paren" | "comma"; value: string };

const allowedFunctions = new Set(["min", "max", "round", "ceil", "floor"]);
const unsafeIdentifiers = new Set(["eval", "Function", "window", "document", "global", "globalThis", "process", "require", "import", "constructor", "prototype", "__proto__"]);

function emptyCostingSummary() {
  return { aluminiumCost: 0, finishCost: 0, glassCost: 0, hardwareCost: 0, gasketCost: 0, fabricationCost: 0, installationCost: 0, transportCost: 0, wastageAmount: 0, internalCost: 0, marginAmount: 0, discountAmount: 0, subtotalBeforeGst: 0, gstAmount: 0, grandTotal: 0, pricePerSqft: 0, pricePerSqm: 0, pricePerUnit: 0, profitPercent: 0 };
}

function emptyOptimizationSummary(input: SystemConfigurationInput) {
  return { stockLengthMm: input.companySettings.stockLengthMm, sawKerfMm: input.companySettings.sawKerfMm, minimumReusableLeftoverMm: input.companySettings.minimumReusableLeftoverMm, totalStockBars: 0, totalUsedLengthMm: 0, totalWasteMm: 0, wastePercent: 0, warnings: [], profiles: [] };
}

function optionNumber(input: SystemConfigurationInput, key: string, fallback: number) {
  const value = input.options?.[key];
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  return Number.isFinite(number) ? number : fallback;
}

function defaultProfileRules(input: SystemConfigurationInput): FormulaComponentRule[] {
  return input.selectedProfiles.map((profile) => ({
    componentRole: profile.componentRole,
    profileCode: profile.profileCode,
    quantityFormula: profile.quantityFormula || "1 * Q",
    lengthFormula: profile.lengthFormula || "W",
    deductionMm: profile.deductionMm,
    additionMm: profile.additionMm
  }));
}

function aggregateProfileCuts(cuts: ProfileCut[]) {
  const map = new Map<string, ProfileCut>();
  for (const cut of cuts) {
    const key = [cut.profileId ?? "", cut.componentRole, cut.profileCode, cut.cutLengthMm, cut.angleLeft, cut.angleRight].join("|");
    const existing = map.get(key);
    if (existing) {
      existing.quantity += cut.quantity;
      existing.totalLengthM = round(existing.totalLengthM + cut.totalLengthM);
      existing.totalWeightKg = round(existing.totalWeightKg + cut.totalWeightKg);
    } else {
      map.set(key, { ...cut, totalLengthM: round(cut.totalLengthM), totalWeightKg: round(cut.totalWeightKg) });
    }
  }
  return Array.from(map.values());
}

function variablesUsed(expression: string, variables: FormulaVariables) {
  const identifiers = Array.from(new Set(expression.match(/[A-Za-z_]\w*/g) ?? []));
  return Object.fromEntries(identifiers.filter((identifier) => identifier in variables).map((identifier) => [identifier, variables[identifier]]));
}

function formatExplanation(explanation: NonNullable<ProfileCut["explanation"]>) {
  const variableText = explanation.variables && Object.keys(explanation.variables).length ? ` | Vars: ${Object.entries(explanation.variables).map(([key, value]) => `${key}=${round(value, 3)}`).join(", ")}` : "";
  return `Formula: ${explanation.lengthFormula ?? explanation.widthFormula ?? "-"} | Qty: ${explanation.quantityFormula ?? "-"} = ${explanation.resultQuantity ?? "-"} | Raw: ${round(explanation.rawLengthMm ?? explanation.resultMm ?? 0, 2)}mm | Deduction: ${round(explanation.deductionMm ?? 0, 2)}mm | Addition: ${round(explanation.additionMm ?? 0, 2)}mm | Cut: ${round(explanation.resultMm ?? 0, 2)}mm${variableText}`;
}

export function validateFormulaExpression(expression: string): ConfiguratorWarning[] {
  const warnings: ConfiguratorWarning[] = [];
  const trimmed = expression.trim();

  if (!trimmed) return [{ code: "formula_empty", message: "Formula cannot be empty.", severity: "error" }];
  if (trimmed.length > 300) warnings.push({ code: "formula_too_long", message: "Formula is too long.", severity: "error" });
  if (/[^\d\sA-Za-z_+\-*/().,]/.test(trimmed)) warnings.push({ code: "formula_unsafe_character", message: "Formula contains unsupported characters.", severity: "error" });

  const identifiers = trimmed.match(/[A-Za-z_]\w*/g) ?? [];
  for (const identifier of identifiers) {
    if (unsafeIdentifiers.has(identifier)) warnings.push({ code: "formula_unsafe_identifier", message: `Formula uses unsafe identifier: ${identifier}.`, severity: "error" });
  }

  try {
    tokenizeFormula(trimmed);
  } catch (error) {
    warnings.push({ code: "formula_token_error", message: error instanceof Error ? error.message : "Formula tokenization failed.", severity: "error" });
  }

  return warnings;
}

function tokenizeFormula(expression: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/\d|\./.test(char)) {
      let value = char;
      index += 1;
      while (index < expression.length && /\d|\./.test(expression[index])) {
        value += expression[index];
        index += 1;
      }
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(value)) throw new Error(`Invalid number token: ${value}`);
      tokens.push({ type: "number", value });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let value = char;
      index += 1;
      while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index])) {
        value += expression[index];
        index += 1;
      }
      tokens.push({ type: "identifier", value });
      continue;
    }

    if (["+", "-", "*", "/"].includes(char)) tokens.push({ type: "operator", value: char });
    else if (["(", ")"].includes(char)) tokens.push({ type: "paren", value: char });
    else if (char === ",") tokens.push({ type: "comma", value: char });
    else throw new Error(`Unsupported formula token: ${char}`);
    index += 1;
  }

  return tokens;
}

export function evaluateFormulaExpression(expression: string, variables: FormulaVariables): number {
  const validation = validateFormulaExpression(expression);
  if (validation.some((warning) => warning.severity === "error")) throw new Error(validation.map((warning) => warning.message).join(" "));

  const tokens = tokenizeFormula(expression);
  let position = 0;

  function current() {
    return tokens[position];
  }

  function consume() {
    const token = tokens[position];
    position += 1;
    return token;
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (current()?.type === "operator" && ["+", "-"].includes(current().value)) {
      const operator = consume().value;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (current()?.type === "operator" && ["*", "/"].includes(current().value)) {
      const operator = consume().value;
      const right = parseFactor();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  }

  function parseFunction(name: string) {
    if (!allowedFunctions.has(name)) throw new Error(`Unsupported formula function: ${name}`);
    consume();
    const args: number[] = [];
    while (current() && !(current().type === "paren" && current().value === ")")) {
      args.push(parseExpression());
      if (current()?.type === "comma") consume();
      else if (current() && !(current().type === "paren" && current().value === ")")) throw new Error(`Expected comma in ${name}().`);
    }
    if (current()?.value !== ")") throw new Error(`Missing closing parenthesis for ${name}().`);
    consume();

    if (name === "min") return Math.min(...args);
    if (name === "max") return Math.max(...args);
    if (name === "round") {
      const digits = Math.max(0, Math.min(6, Math.trunc(args[1] ?? 0)));
      return round(args[0] ?? 0, digits);
    }
    if (name === "ceil") return Math.ceil(args[0] ?? 0);
    return Math.floor(args[0] ?? 0);
  }

  function parseFactor(): number {
    const token = consume();
    if (!token) throw new Error("Unexpected end of formula.");

    if (token.type === "operator" && token.value === "-") return -parseFactor();
    if (token.type === "operator" && token.value === "+") return parseFactor();
    if (token.type === "number") return Number(token.value);

    if (token.type === "identifier") {
      if (current()?.type === "paren" && current().value === "(") return parseFunction(token.value);
      if (!(token.value in variables)) throw new Error(`Unknown formula variable: ${token.value}`);
      return variables[token.value];
    }

    if (token.type === "paren" && token.value === "(") {
      const value = parseExpression();
      if (current()?.value !== ")") throw new Error("Missing closing parenthesis.");
      consume();
      return value;
    }

    throw new Error(`Unexpected token in formula: ${token.value}`);
  }

  const result = parseExpression();
  if (position < tokens.length) throw new Error(`Unexpected token in formula: ${tokens[position].value}`);
  if (!Number.isFinite(result)) throw new Error("Formula result is not finite.");
  return result;
}

export function buildBaseFormulaVariables(input: SystemConfigurationInput): FormulaVariables {
  const panels = input.panelLayout.panels;
  const panelCount = panels.length || 1;
  const fixedPanelCount = panels.filter((panel) => panel.type === "fixed").length;
  const slidingPanelCount = panels.filter((panel) => panel.type === "sliding").length;
  const openablePanelCount = panels.filter((panel) => panel.type !== "fixed" && panel.type !== "dummy" && panel.function !== "mesh").length;
  const meshPanelCount = panels.filter((panel) => panel.type === "mesh" || panel.function === "mesh").length || input.panelLayout.mesh?.panelCount || 0;
  const trackCount = optionNumber(input, "track_count", input.systemType === "three_track_sliding_window" ? 3 : input.systemType.includes("sliding") ? 2 : 1);
  const shutterCount = optionNumber(input, "shutter_count", slidingPanelCount || openablePanelCount || panelCount);
  const overlapMm = optionNumber(input, "overlap_mm", 0);
  const frameDeductionMm = optionNumber(input, "frame_deduction_mm", optionNumber(input, "frame_deduction", 0));
  const sashHeightDeductionMm = optionNumber(input, "sash_height_deduction_mm", optionNumber(input, "sash_deduction", 0));
  const glassDeductionWidthMm = optionNumber(input, "glass_deduction_width_mm", optionNumber(input, "glass_deduction_width", 0));
  const glassDeductionHeightMm = optionNumber(input, "glass_deduction_height_mm", optionNumber(input, "glass_deduction_height", 0));
  const shutterWidth = (input.widthMm + overlapMm) / Math.max(shutterCount, 1);
  const shutterHeight = input.heightMm - sashHeightDeductionMm;
  const glassWidth = shutterWidth - glassDeductionWidthMm;
  const glassHeight = shutterHeight - glassDeductionHeightMm;

  return {
    W: input.widthMm,
    H: input.heightMm,
    Q: input.quantity,
    PW: input.widthMm / panelCount,
    PH: input.heightMm,
    CW: input.widthMm,
    CH: input.heightMm,
    panel_count: panelCount,
    track_count: trackCount,
    shutter_count: shutterCount,
    fixed_panel_count: fixedPanelCount,
    sliding_panel_count: slidingPanelCount,
    openable_panel_count: openablePanelCount,
    mesh_panel_count: meshPanelCount,
    overlap_mm: overlapMm,
    frame_deduction: frameDeductionMm,
    frame_deduction_mm: frameDeductionMm,
    sash_deduction: sashHeightDeductionMm,
    sash_height_deduction_mm: sashHeightDeductionMm,
    glass_deduction_width: glassDeductionWidthMm,
    glass_deduction_width_mm: glassDeductionWidthMm,
    glass_deduction_height: glassDeductionHeightMm,
    glass_deduction_height_mm: glassDeductionHeightMm,
    shutter_width: shutterWidth,
    shutter_height: shutterHeight,
    glass_width: glassWidth,
    glass_height: glassHeight,
    bead_deduction: optionNumber(input, "bead_deduction", 0),
    interlock_deduction: optionNumber(input, "interlock_deduction", 0),
    clearance_mm: optionNumber(input, "clearance_mm", 0),
    aluminium_rate_per_kg: input.costing.aluminiumRatePerKg,
    glass_rate_per_sqft: input.selectedGlass?.ratePerSqft ?? 0,
    finish_rate: input.selectedFinish?.rate ?? 0,
    labor_rate: input.costing.fabricationLaborRate,
    installation_rate: input.costing.installationRate,
    margin_percent: input.costing.marginPercent,
    gst_percent: input.costing.gstPercent,
    stock_length_mm: input.companySettings.stockLengthMm,
    saw_kerf_mm: input.companySettings.sawKerfMm,
    screws_per_window: optionNumber(input, "screws_per_window", 0),
    wastage_percent: input.companySettings.defaultWastagePercent
  };
}

function validateDerivedDimensions(input: SystemConfigurationInput, variables: FormulaVariables, warnings: ConfiguratorWarning[]) {
  if (input.systemType !== "two_track_sliding_window") return;
  for (const [field, label] of [["shutter_width", "Shutter width"], ["shutter_height", "Shutter height"], ["glass_width", "Glass width"], ["glass_height", "Glass height"]] as const) {
    if (variables[field] <= 0) warnings.push({ code: "invalid_derived_dimension", message: `${label} must be greater than zero.`, severity: "error", field });
  }
}

function validateRequiredProfiles(input: SystemConfigurationInput, warnings: ConfiguratorWarning[]) {
  const requiredRoles = new Set([...(input.template.requiredComponents ?? []), ...input.selectedProfiles.filter((profile) => profile.isRequired).map((profile) => profile.componentRole)]);
  for (const role of requiredRoles) {
    if (!input.selectedProfiles.some((profile) => profile.componentRole === role)) warnings.push({ code: "missing_required_profile", message: `Required profile is missing for ${role}.`, severity: "warning", field: role });
  }
}

function generateProfileCuts(input: SystemConfigurationInput, variables: FormulaVariables, warnings: ConfiguratorWarning[]) {
  const profileCuts: ProfileCut[] = [];
  const profileRules = input.template.profileRules.length ? input.template.profileRules : defaultProfileRules(input);

  for (const rule of profileRules) {
    const profile = input.selectedProfiles.find((item) => item.componentRole === rule.componentRole || (rule.profileCode && item.profileCode === rule.profileCode));
    if (!profile) {
      warnings.push({ code: "missing_profile", message: `Missing profile for ${rule.componentRole}.`, severity: "warning", field: rule.componentRole });
      continue;
    }

    try {
      const quantity = Math.max(0, Math.round(evaluateFormulaExpression(rule.quantityFormula, variables)));
      const rawLength = evaluateFormulaExpression(rule.lengthFormula, variables);
      const deductionMm = rule.deductionMm ?? profile.deductionMm ?? 0;
      const additionMm = rule.additionMm ?? profile.additionMm ?? 0;
      const cutLengthMm = rawLength - deductionMm + additionMm;

      if (quantity <= 0) continue;
      if (cutLengthMm <= 0) {
        warnings.push({ code: "invalid_cut", message: `Cut length for ${rule.componentRole} is not positive.`, severity: "error", field: rule.componentRole });
        continue;
      }

      if (cutLengthMm > profile.stockLengthMm) warnings.push({ code: "cut_exceeds_stock", message: `${profile.profileCode} cut ${round(cutLengthMm, 2)}mm exceeds stock length ${profile.stockLengthMm}mm.`, severity: "warning", field: rule.componentRole });
      if (profile.sectionWeightKgPerM <= 0) warnings.push({ code: "missing_section_weight", message: `${profile.profileCode} has no section weight; aluminium weight and costing may be incomplete.`, severity: "warning", field: rule.componentRole });

      const totalLengthM = (cutLengthMm * quantity) / 1000;
      const explanation = { quantityFormula: rule.quantityFormula, lengthFormula: rule.lengthFormula, variables: variablesUsed(`${rule.quantityFormula} ${rule.lengthFormula}`, variables), rawLengthMm: rawLength, deductionMm, additionMm, resultMm: cutLengthMm, resultQuantity: quantity };
      profileCuts.push({
        profileId: profile.profileId,
        componentRole: rule.componentRole,
        profileCode: profile.profileCode,
        profileName: profile.profileName,
        cutLengthMm: round(cutLengthMm, 2),
        quantity,
        totalLengthM,
        sectionWeightKgPerM: profile.sectionWeightKgPerM,
        totalWeightKg: totalLengthM * profile.sectionWeightKgPerM,
        angleLeft: rule.angleLeft ?? "90",
        angleRight: rule.angleRight ?? "90",
        deductionMm,
        additionMm,
        stockLengthMm: profile.stockLengthMm,
        wastagePercent: input.companySettings.defaultWastagePercent,
        remarks: rule.remarks ?? formatExplanation(explanation),
        explanation
      });
    } catch (error) {
      warnings.push({ code: "formula_error", message: error instanceof Error ? `${rule.componentRole}: ${error.message}` : `${rule.componentRole}: Formula failed.`, severity: "error", field: rule.componentRole });
    }
  }

  return aggregateProfileCuts(profileCuts);
}

export function calculateSystemConfiguration(input: SystemConfigurationInput): ConfiguratorResult {
  const warnings: ConfiguratorWarning[] = [];

  if (input.widthMm <= 0 || input.heightMm <= 0 || input.quantity <= 0) warnings.push({ code: "invalid_dimensions", message: "Width, height, and quantity must be greater than zero.", severity: "error" });
  if (!input.panelLayout.panels.length) warnings.push({ code: "missing_panels", message: "Panel layout must contain at least one panel.", severity: "error", field: "panelLayout" });

  validateRequiredProfiles(input, warnings);

  const variables = buildBaseFormulaVariables(input);
  validateDerivedDimensions(input, variables, warnings);
  if (input.selectedFinish && input.selectedFinish.rate <= 0) warnings.push({ code: "missing_rate", message: `${input.selectedFinish.finishCode} has no finish rate.`, severity: "warning", field: "finish" });
  const profileCuts = generateProfileCuts(input, variables, warnings);
  const glassCuts = generateGlassCuts(input, warnings, variables, evaluateFormulaExpression);
  const beadingCuts = generateBeadingCuts(input, glassCuts, warnings);
  const hardwareBom = generateHardwareBom(input, warnings, variables, evaluateFormulaExpression);
  const materialSummary = buildMaterialSummary(input, profileCuts, beadingCuts, glassCuts, hardwareBom);
  const totalProfileWeightKg = profileCuts.reduce((sum, cut) => sum + cut.totalWeightKg, 0) + beadingCuts.reduce((sum, cut) => sum + cut.totalWeightKg, 0);
  const totalProfileLengthM = profileCuts.reduce((sum, cut) => sum + cut.totalLengthM, 0) + beadingCuts.reduce((sum, cut) => sum + cut.totalLengthM, 0);
  const totalGlassAreaSqft = glassCuts.reduce((sum, cut) => sum + cut.areaSqft, 0);
  const totalGlassAreaSqm = glassCuts.reduce((sum, cut) => sum + cut.areaSqm, 0);
  const costingSummary = calculateSystemCosting({
    materialSummary,
    totalProfileWeightKg,
    totalProfileLengthM,
    totalGlassAreaSqft,
    totalGlassAreaSqm,
    quantity: input.quantity,
    openingWidthMm: input.widthMm,
    openingHeightMm: input.heightMm,
    aluminiumRatePerKg: input.costing.aluminiumRatePerKg,
    selectedFinish: input.selectedFinish,
    fabrication: { rateType: "per_kg", rate: input.costing.fabricationLaborRate },
    installation: { enabled: input.costing.installationRate > 0, rateType: "per_sqft", rate: input.costing.installationRate },
    transport: { type: "fixed", amount: input.costing.transportAmount },
    aluminiumWastagePercent: input.costing.wastagePercent,
    glassWastagePercent: optionNumber(input, "glass_wastage_percent", 0),
    marginPercent: input.costing.marginPercent,
    discountAmount: input.costing.discountAmount,
    gstPercent: input.costing.gstPercent
  }) ?? emptyCostingSummary();
  const optimizationSummary = profileCuts.length ? optimizeProfileCuts(profileCuts.map((cut) => ({ id: cut.profileId, profileCode: cut.profileCode, profileName: cut.profileName, componentRole: cut.componentRole, cutLengthMm: cut.cutLengthMm, quantity: cut.quantity })), { stockLengthMm: input.companySettings.stockLengthMm, sawKerfMm: input.companySettings.sawKerfMm, minimumReusableLeftoverMm: input.companySettings.minimumReusableLeftoverMm }) : emptyOptimizationSummary(input);
  const errors = warnings.filter((warning) => warning.severity === "error");

  return { profileCuts, glassCuts, beadingCuts, hardwareBom, materialSummary, costingSummary, optimizationSummary, warnings, errors };
}
