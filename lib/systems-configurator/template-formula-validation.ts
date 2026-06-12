import { validateFormulaExpression } from "./formula-engine.ts";

export type TemplateFormulaValidationIssue = {
  path: string;
  message: string;
  severity: "error" | "warning";
};

export type TemplateFormulaValidationSummary = {
  errors: TemplateFormulaValidationIssue[];
  warnings: TemplateFormulaValidationIssue[];
  formulaCount: number;
  profileRuleCount: number;
  hardwareRuleCount: number;
  glassRuleCount: number;
  variables: string[];
};

export const knownFormulaVariables = [
  "W",
  "H",
  "Q",
  "PW",
  "PH",
  "CW",
  "CH",
  "panel_count",
  "track_count",
  "shutter_count",
  "fixed_panel_count",
  "sliding_panel_count",
  "openable_panel_count",
  "mesh_panel_count",
  "overlap_mm",
  "frame_deduction",
  "frame_deduction_mm",
  "sash_deduction",
  "sash_height_deduction_mm",
  "glass_deduction_width",
  "glass_deduction_width_mm",
  "glass_deduction_height",
  "glass_deduction_height_mm",
  "shutter_width",
  "shutter_height",
  "glass_width",
  "glass_height",
  "bead_deduction",
  "interlock_deduction",
  "clearance_mm",
  "aluminium_rate_per_kg",
  "glass_rate_per_sqft",
  "finish_rate",
  "labor_rate",
  "installation_rate",
  "margin_percent",
  "gst_percent",
  "stock_length_mm",
  "saw_kerf_mm",
  "screws_per_window",
  "wastage_percent"
] as const;

const formulaFunctions = new Set(["min", "max", "round", "ceil", "floor"]);
const knownVariableSet = new Set<string>(knownFormulaVariables);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getFormulaIdentifiers(expression: string) {
  return Array.from(new Set(expression.match(/[A-Za-z_]\w*/g) ?? [])).filter((identifier) => !formulaFunctions.has(identifier));
}

function addFormulaIssue(summary: TemplateFormulaValidationSummary, path: string, expression: string) {
  summary.formulaCount += 1;
  for (const identifier of getFormulaIdentifiers(expression)) {
    if (!summary.variables.includes(identifier)) summary.variables.push(identifier);
    if (!knownVariableSet.has(identifier)) summary.warnings.push({ path, message: `Unknown variable '${identifier}' will require a matching runtime option or alias.`, severity: "warning" });
  }

  for (const warning of validateFormulaExpression(expression)) {
    if (warning.severity === "error") summary.errors.push({ path, message: warning.message, severity: "error" });
  }
}

function validateFormulaValue(summary: TemplateFormulaValidationSummary, node: unknown, path: string) {
  if (typeof node === "string") {
    addFormulaIssue(summary, path, node);
    return;
  }
  summary.errors.push({ path, message: "Formula value must be a string.", severity: "error" });
}

export function validateTemplateFormulaJson(value: unknown): TemplateFormulaValidationSummary {
  const summary: TemplateFormulaValidationSummary = { errors: [], warnings: [], formulaCount: 0, profileRuleCount: 0, hardwareRuleCount: 0, glassRuleCount: 0, variables: [] };
  if (!isRecord(value)) {
    summary.errors.push({ path: "formula_json", message: "Formula JSON must be an object.", severity: "error" });
    return summary;
  }

  const requiredComponents = value.requiredComponents;
  if (requiredComponents !== undefined && !Array.isArray(requiredComponents)) summary.errors.push({ path: "requiredComponents", message: "requiredComponents must be an array.", severity: "error" });

  const profileRules = value.profileRules;
  if (profileRules !== undefined && !Array.isArray(profileRules)) {
    summary.errors.push({ path: "profileRules", message: "profileRules must be an array.", severity: "error" });
  } else if (Array.isArray(profileRules)) {
    summary.profileRuleCount = profileRules.length;
    profileRules.forEach((rule, index) => {
      const path = `profileRules.${index}`;
      if (!isRecord(rule)) {
        summary.errors.push({ path, message: "Profile rule must be an object.", severity: "error" });
        return;
      }
      if (typeof (rule.componentRole ?? rule.component_role) !== "string") summary.errors.push({ path: `${path}.componentRole`, message: "componentRole is required.", severity: "error" });
      validateFormulaValue(summary, rule.quantityFormula ?? rule.quantity_formula, `${path}.quantityFormula`);
      validateFormulaValue(summary, rule.lengthFormula ?? rule.length_formula, `${path}.lengthFormula`);
    });
  }

  const glassRules = value.glassRules;
  if (glassRules !== undefined) {
    if (!isRecord(glassRules)) {
      summary.errors.push({ path: "glassRules", message: "glassRules must be an object.", severity: "error" });
    } else if (Object.keys(glassRules).length) {
      summary.glassRuleCount = 1;
      validateFormulaValue(summary, glassRules.widthFormula ?? glassRules.width_formula, "glassRules.widthFormula");
      validateFormulaValue(summary, glassRules.heightFormula ?? glassRules.height_formula, "glassRules.heightFormula");
      if (glassRules.quantityFormula !== undefined || glassRules.quantity_formula !== undefined) validateFormulaValue(summary, glassRules.quantityFormula ?? glassRules.quantity_formula, "glassRules.quantityFormula");
    }
  }

  const hardwareRules = value.hardwareRules;
  if (hardwareRules !== undefined) {
    if (Array.isArray(hardwareRules)) {
      summary.hardwareRuleCount = hardwareRules.length;
      hardwareRules.forEach((rule, index) => {
        const path = `hardwareRules.${index}`;
        if (!isRecord(rule)) {
          summary.errors.push({ path, message: "Hardware rule must be an object.", severity: "error" });
          return;
        }
        if (typeof rule.category !== "string") summary.errors.push({ path: `${path}.category`, message: "category is required.", severity: "error" });
        validateFormulaValue(summary, rule.quantityFormula ?? rule.quantity_formula, `${path}.quantityFormula`);
      });
    } else if (isRecord(hardwareRules)) {
      const entries = Object.entries(hardwareRules);
      summary.hardwareRuleCount = entries.length;
      entries.forEach(([category, rule]) => {
        const path = `hardwareRules.${category}`;
        if (typeof rule === "string") validateFormulaValue(summary, rule, path);
        else if (isRecord(rule)) validateFormulaValue(summary, rule.quantityFormula ?? rule.quantity_formula, `${path}.quantityFormula`);
        else summary.errors.push({ path, message: "Hardware rule must be a formula string or object.", severity: "error" });
      });
    } else {
      summary.errors.push({ path: "hardwareRules", message: "hardwareRules must be an object or array.", severity: "error" });
    }
  }

  summary.variables.sort();
  return summary;
}

export function assertValidTemplateFormulaJson(value: unknown) {
  const summary = validateTemplateFormulaJson(value);
  if (summary.errors.length) throw new Error(`Invalid formula JSON: ${summary.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
}
