import type { ConfiguratorWarning, FormulaVariables, HardwareBomItem, HardwareCategory, HardwareRule, SystemConfigurationInput } from "./types.ts";
import { round } from "./types.ts";

type FormulaEvaluator = (expression: string, variables: FormulaVariables) => number;

const hardwareCategories = new Set<HardwareCategory>(["lock", "handle", "roller", "hinge", "stay_arm", "tower_bolt", "fastener", "screw", "gasket", "wool_pile", "weather_strip", "silicone", "drainage_cap", "corner_cleat", "connector", "accessory", "other"]);

function hardwareByRule(input: SystemConfigurationInput, rule: Pick<HardwareRule, "category" | "itemCode">) {
  return input.selectedHardware.find((item) => (rule.itemCode ? item.itemCode === rule.itemCode : item.category === rule.category));
}

function addHardware(input: SystemConfigurationInput, warnings: ConfiguratorWarning[], bom: HardwareBomItem[], category: HardwareCategory, quantity: number, fallbackName: string, remarks?: string, itemCode?: string, explanation?: HardwareBomItem["explanation"]) {
  if (!Number.isFinite(quantity)) {
    warnings.push({ code: "invalid_hardware_quantity", message: `Invalid hardware quantity for ${itemCode ?? category}.`, severity: "error", field: category });
    return;
  }
  if (quantity <= 0) return;
  const item = hardwareByRule(input, { category, itemCode });
  if (!item) {
    warnings.push({ code: "missing_hardware", message: `Missing hardware item for ${itemCode ?? category}.`, severity: "warning", field: category });
    return;
  }
  if (item.rate <= 0) warnings.push({ code: "missing_rate", message: `${item.itemCode} has no hardware rate.`, severity: "warning", field: category });
  bom.push({ hardwareItemId: item.id, itemCode: item.itemCode, itemName: item.itemName || fallbackName, hardwareCategory: category, quantity: round(quantity), unit: item.unit, rate: item.rate, amount: round(quantity * item.rate, 2), remarks, explanation });
}

function aggregateHardwareBom(bom: HardwareBomItem[]) {
  const map = new Map<string, HardwareBomItem>();
  for (const item of bom) {
    const key = [item.hardwareItemId ?? "", item.itemCode, item.hardwareCategory, item.unit, item.rate].join("|");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, quantity: round(item.quantity), amount: round(item.amount, 2) });
      continue;
    }
    existing.quantity = round(existing.quantity + item.quantity);
    existing.amount = round(existing.quantity * existing.rate, 2);
    if (item.remarks && !existing.remarks?.includes(item.remarks)) {
      existing.remarks = existing.remarks ? `${existing.remarks} | ${item.remarks}` : item.remarks;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.hardwareCategory.localeCompare(b.hardwareCategory) || a.itemCode.localeCompare(b.itemCode));
}

function variablesUsed(expression: string, variables: FormulaVariables) {
  const identifiers = Array.from(new Set(expression.match(/[A-Za-z_]\w*/g) ?? []));
  return Object.fromEntries(identifiers.filter((identifier) => identifier in variables).map((identifier) => [identifier, variables[identifier]]));
}

function normalizeHardwareRules(input: SystemConfigurationInput): HardwareRule[] {
  const rules = input.template.hardwareRules;
  if (Array.isArray(rules)) return rules.filter((rule) => hardwareCategories.has(rule.category) && Boolean(rule.quantityFormula));

  if (rules && typeof rules === "object") {
    return Object.entries(rules).flatMap(([category, value]) => {
      if (!hardwareCategories.has(category as HardwareCategory)) return [];
      if (typeof value === "string") return [{ category: category as HardwareCategory, quantityFormula: value }];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const quantityFormula = value.quantityFormula ?? value.quantity_formula;
        if (typeof quantityFormula !== "string") return [];
        return [{ category: category as HardwareCategory, itemCode: typeof value.itemCode === "string" ? value.itemCode : typeof value.item_code === "string" ? value.item_code : undefined, quantityFormula, remarks: typeof value.remarks === "string" ? value.remarks : undefined }];
      }
      return [];
    });
  }

  return input.selectedHardware.filter((item) => item.quantityFormula).map((item) => ({ category: item.category, itemCode: item.itemCode, quantityFormula: item.quantityFormula ?? "0" }));
}

function generateDefaultHardwareBom(input: SystemConfigurationInput, warnings: ConfiguratorWarning[], glassPerimeterM: number) {
  const bom: HardwareBomItem[] = [];
  const slidingCount = input.panelLayout.panels.filter((panel) => panel.type === "sliding").length;
  const openableCount = input.panelLayout.panels.filter((panel) => panel.type !== "fixed" && panel.type !== "dummy" && panel.function !== "mesh").length;
  const isDoor = input.systemType.includes("door");
  const isSliding = input.systemType.includes("sliding");

  if (isSliding) {
    addHardware(input, warnings, bom, "roller", slidingCount * 2 * input.quantity, "Roller", "2 rollers per sliding shutter");
    addHardware(input, warnings, bom, "lock", Math.max(1, Math.ceil(slidingCount / 2)) * input.quantity, "Sliding lock");
    addHardware(input, warnings, bom, "handle", slidingCount * input.quantity, "Sliding handle");
    addHardware(input, warnings, bom, "wool_pile", round(glassPerimeterM * 1.05), "Wool pile", "Glass perimeter plus 5% allowance");
    addHardware(input, warnings, bom, "drainage_cap", input.panelLayout.panels.length * 2 * input.quantity, "Drainage cap");
  } else if (isDoor) {
    addHardware(input, warnings, bom, "hinge", (input.heightMm > 2100 ? 4 : 3) * openableCount * input.quantity, "Door hinge");
    addHardware(input, warnings, bom, "lock", openableCount * input.quantity, "Door lock");
    addHardware(input, warnings, bom, "handle", openableCount * input.quantity, "Handle set");
  } else {
    addHardware(input, warnings, bom, "hinge", (input.heightMm > 1200 ? 3 : 2) * openableCount * input.quantity, "Window hinge");
    addHardware(input, warnings, bom, "handle", openableCount * input.quantity, "Window handle");
    addHardware(input, warnings, bom, "stay_arm", openableCount * input.quantity, "Stay arm");
  }

  addHardware(input, warnings, bom, "gasket", glassPerimeterM * 1.05, "Glazing gasket", "Glass perimeter plus 5% allowance");
  addHardware(input, warnings, bom, "screw", Math.ceil((input.widthMm + input.heightMm) / 300) * input.quantity, "Fastener screws");
  addHardware(input, warnings, bom, "corner_cleat", (4 + input.panelLayout.panels.length * 4) * input.quantity, "Corner cleat");
  return aggregateHardwareBom(bom);
}

export function generateHardwareBom(input: SystemConfigurationInput, warnings: ConfiguratorWarning[], variables: FormulaVariables, evaluateFormula: FormulaEvaluator) {
  const glassPerimeterM = input.panelLayout.panels
    .filter((panel) => panel.function === "glass")
    .reduce((sum, panel) => sum + (((input.widthMm * panel.widthRatio) - Number(input.options?.glass_deduction_width ?? 90) + (input.heightMm * panel.heightRatio) - Number(input.options?.glass_deduction_height ?? 90)) * 2 * input.quantity) / 1000, 0);
  const rules = normalizeHardwareRules(input);
  if (!rules.length) return generateDefaultHardwareBom(input, warnings, glassPerimeterM);

  const bom: HardwareBomItem[] = [];
  for (const rule of rules) {
    try {
      const quantity = evaluateFormula(rule.quantityFormula, variables);
      const explanation = { quantityFormula: rule.quantityFormula, variables: variablesUsed(rule.quantityFormula, variables), resultQuantity: quantity, note: `${rule.category} quantity from template rule` };
      const formulaRemarks = `Formula: ${rule.quantityFormula} = ${round(quantity, 3)}`;
      addHardware(input, warnings, bom, rule.category, quantity, rule.category, rule.remarks ? `${rule.remarks} | ${formulaRemarks}` : formulaRemarks, rule.itemCode, explanation);
    } catch (error) {
      warnings.push({ code: "hardware_formula_error", message: error instanceof Error ? error.message : "Hardware formula failed.", severity: "error", field: rule.category });
    }
  }
  return aggregateHardwareBom(bom);
}
