import type { ConfiguratorWarning, FormulaVariables, GlassCut, GlassRule, SystemConfigurationInput } from "./types.ts";
import { optionNumber, round } from "./types.ts";

type FormulaEvaluator = (expression: string, variables: FormulaVariables) => number;

function getGlassRule(input: SystemConfigurationInput): GlassRule | null {
  const rules = input.template.glassRules;
  if (!rules || Array.isArray(rules) || typeof rules !== "object") return null;
  if (typeof rules.widthFormula === "string" && typeof rules.heightFormula === "string") return rules as GlassRule;
  return null;
}

function variablesUsed(expression: string, variables: FormulaVariables) {
  const identifiers = Array.from(new Set(expression.match(/[A-Za-z_]\w*/g) ?? []));
  return Object.fromEntries(identifiers.filter((identifier) => identifier in variables).map((identifier) => [identifier, variables[identifier]]));
}

export function generateGlassCuts(input: SystemConfigurationInput, warnings: ConfiguratorWarning[], variables?: FormulaVariables, evaluateFormula?: FormulaEvaluator) {
  const glassCuts: GlassCut[] = [];
  if (!input.selectedGlass) {
    if (input.panelLayout.panels.some((panel) => panel.function === "glass")) warnings.push({ code: "missing_glass", message: "Glass panels exist but no glass item is selected.", severity: "warning" });
    return glassCuts;
  }

  const glassRule = getGlassRule(input);
  const glassDeductionWidth = optionNumber(input, "glass_deduction_width_mm", optionNumber(input, "glass_deduction_width", 90));
  const glassDeductionHeight = optionNumber(input, "glass_deduction_height_mm", optionNumber(input, "glass_deduction_height", 90));

  for (const panel of input.panelLayout.panels) {
    if (panel.function !== "glass") continue;
    const panelVariables = { ...(variables ?? {}), panel_index: panel.index, panel_width: input.widthMm * panel.widthRatio, panel_height: input.heightMm * panel.heightRatio };
    let widthMm = panelVariables.panel_width - glassDeductionWidth;
    let heightMm = panelVariables.panel_height - glassDeductionHeight;
    let quantity = input.quantity;
    try {
      if (glassRule && evaluateFormula) {
        widthMm = evaluateFormula(glassRule.widthFormula, panelVariables);
        heightMm = evaluateFormula(glassRule.heightFormula, panelVariables);
        quantity = Math.max(0, Math.round(evaluateFormula(glassRule.quantityFormula ?? "Q", panelVariables)));
      }
    } catch (error) {
      warnings.push({ code: "glass_formula_error", message: error instanceof Error ? error.message : "Glass formula failed.", severity: "error", field: `panel_${panel.index}` });
      continue;
    }
    if (widthMm <= 0 || heightMm <= 0) {
      warnings.push({ code: "invalid_glass_size", message: `Glass size for panel ${panel.index} is not positive.`, severity: "error", field: `panel_${panel.index}` });
      continue;
    }
    if (quantity <= 0) continue;
    const areaSqm = (widthMm * heightMm * quantity) / 1_000_000;
    const areaSqft = areaSqm * 10.7639;
    const rate = input.selectedGlass.ratePerSqft || input.selectedGlass.ratePerSqm / 10.7639 || 0;
    if (rate <= 0) warnings.push({ code: "missing_rate", message: `${input.selectedGlass.glassCode} has no glass rate.`, severity: "warning", field: "glass" });
    const explanation = glassRule ? { widthFormula: glassRule.widthFormula, heightFormula: glassRule.heightFormula, quantityFormula: glassRule.quantityFormula ?? "Q", variables: variablesUsed(`${glassRule.widthFormula} ${glassRule.heightFormula} ${glassRule.quantityFormula ?? "Q"}`, panelVariables), resultMm: widthMm, resultQuantity: quantity, note: `Glass ${round(widthMm, 2)} x ${round(heightMm, 2)} mm` } : { widthFormula: "panel_width - glass_deduction_width", heightFormula: "panel_height - glass_deduction_height", quantityFormula: "Q", variables: variablesUsed("panel_width panel_height glass_deduction_width glass_deduction_height Q", panelVariables), resultQuantity: quantity, note: `Glass ${round(widthMm, 2)} x ${round(heightMm, 2)} mm` };
    glassCuts.push({
      glassId: input.selectedGlass.id,
      panelIndex: panel.index,
      glassLabel: `${glassRule?.labelPrefix ?? "P"}${glassRule?.labelPrefix ? ` ${panel.index}` : panel.index}`,
      widthMm: round(widthMm, 2),
      heightMm: round(heightMm, 2),
      quantity,
      areaSqft: round(areaSqft),
      areaSqm: round(areaSqm),
      glassType: input.selectedGlass.glassType,
      thicknessMm: input.selectedGlass.thicknessMm,
      rate,
      amount: round(areaSqft * rate, 2),
      deductionWidthMm: glassDeductionWidth,
      deductionHeightMm: glassDeductionHeight,
      remarks: glassRule?.remarks ?? `${explanation.widthFormula} / ${explanation.heightFormula} | ${explanation.note}`,
      explanation
    });
  }

  return glassCuts;
}
