import { z } from "zod";
import type { ConfiguratorResult } from "@/lib/systems-configurator/types";
import { validateTemplateFormulaJson } from "../systems-configurator/template-formula-validation.ts";

const uuid = z.string().uuid();
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const releaseReadiness = z.enum(["blocked", "estimated", "ready"]);
const releaseStatus = z.enum(["not_calculated", "blocked", "estimated", "pending_approval", "approved", "stale", "handed_off"]);

export const configurationReleaseActionInputSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("release.load"), payload: z.object({ configuration_id: uuid }).strict() }).strict(),
  z.object({ command: z.literal("release.approve"), payload: z.object({
    snapshot_id: uuid,
    output_fingerprint: fingerprint,
    request_id: uuid,
    note: z.string().trim().max(1000).default("")
  }).strict() }).strict()
]);
export type ConfigurationReleaseActionInput = z.input<typeof configurationReleaseActionInputSchema>;

export const configurationReleaseSourceSchema = z.object({
  kind: z.literal("release_source"),
  configuration_id: uuid,
  input_snapshot: z.record(z.unknown()),
  input_fingerprint: fingerprint,
  rules_snapshot: z.record(z.unknown()),
  rules_fingerprint: fingerprint,
  rules_revision: z.coerce.number().int().nonnegative(),
  output_revision: z.coerce.number().int().nonnegative()
}).strict();
export type ConfigurationReleaseSource = z.infer<typeof configurationReleaseSourceSchema>;

const releaseSnapshotSchema = z.object({
  id: uuid,
  revision: z.number().int().positive(),
  author_id: uuid,
  created_at: z.string(),
  input_fingerprint: fingerprint,
  rules_fingerprint: fingerprint,
  output_fingerprint: fingerprint,
  rules_revision: z.number().int().nonnegative(),
  output_revision: z.number().int().nonnegative(),
  readiness: releaseReadiness,
  release_status: releaseStatus,
  unresolved_reasons: z.array(z.string().max(500)).max(100),
  estimated_fields: z.array(z.string().max(120)).max(100),
  approved_by: uuid.nullable(),
  approved_at: z.string().nullable(),
  approval_note: z.string().nullable(),
  handoff_order_id: uuid.nullable(),
  handed_off_at: z.string().nullable()
}).strict();

export const configurationReleaseResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("release_state"),
    configuration_id: uuid,
    status: releaseStatus,
    current_rules_revision: z.number().int().nonnegative(),
    current_output_revision: z.number().int().nonnegative(),
    latest: releaseSnapshotSchema.nullable(),
    unresolved_reasons: z.array(z.string().max(500)).max(100)
  }).strict(),
  z.object({
    kind: z.literal("release_reviewed"),
    snapshot_id: uuid,
    approved_by: uuid,
    approved_at: z.string(),
    idempotent_replay: z.boolean()
  }).strict()
]);
export type ConfigurationReleaseResult = z.infer<typeof configurationReleaseResultSchema>;

export type ReleaseReconciliation = {
  checks: Array<{
    name: string;
    status: "pass" | "fail" | "estimate";
    message: string;
    expected: number | null;
    actual: number | null;
    unit: string;
  }>;
  profile_weight_kg: number;
  profile_length_m: number;
  material_profile_weight_kg: number;
  material_profile_length_m: number;
  glass_area_sqft: number;
  material_glass_area_sqft: number;
  glass_cost: number;
  material_glass_cost: number;
  bom_cost: number;
  material_bom_cost: number;
  waste_used_mm: number;
  waste_reported_used_mm: number;
  waste_capacity_mm: number;
  waste_reported_mm: number;
};

type JsonRecord = Record<string, any>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function closeEnough(a: number, b: number, tolerance = 0.02) {
  return Math.abs(a - b) <= tolerance;
}

function sum(rows: unknown[], selector: (row: JsonRecord) => unknown) {
  return rows.reduce<number>((total, row) => total + (isRecord(row) ? finite(selector(row)) ?? 0 : 0), 0);
}

function reconciliation(result: ConfiguratorResult): ReleaseReconciliation {
  const checks: ReleaseReconciliation["checks"] = [];
  const profiles = result.profileCuts as unknown as JsonRecord[];
  const beading = result.beadingCuts as unknown as JsonRecord[];
  const glass = result.glassCuts as unknown as JsonRecord[];
  const bom = result.hardwareBom as unknown as JsonRecord[];
  const materials = result.materialSummary as unknown as JsonRecord[];
  const profileWeightKg = sum([...profiles, ...beading], (row) => row.totalWeightKg);
  const profileLengthM = sum([...profiles, ...beading], (row) => row.totalLengthM);
  const materialProfiles = materials.filter((row) => row.materialType === "aluminium_profile");
  const materialProfileWeightKg = sum(materialProfiles, (row) => row.totalWeightKg);
  const materialProfileLengthM = sum(materialProfiles, (row) => row.totalLengthM);
  const addCheck = (name: string, expected: number, actual: number, unit: string, tolerance = 0.02) => {
    const passes = closeEnough(expected, actual, tolerance);
    checks.push({ name, status: passes ? "pass" : "fail", message: passes ? `${name} reconciles.` : `${name} does not reconcile; recalculate and inspect the source rules.`, expected, actual, unit });
  };

  addCheck("Profile and beading weight", profileWeightKg, materialProfileWeightKg, "kg", 0.01);
  addCheck("Profile and beading length", profileLengthM, materialProfileLengthM, "m", 0.01);

  let glassAreaSqft = 0;
  let glassAreaSqm = 0;
  let glassCost = 0;
  for (const row of glass) {
    const width = finite(row.widthMm) ?? 0;
    const height = finite(row.heightMm) ?? 0;
    const quantity = finite(row.quantity) ?? 0;
    const expectedSqm = width * height * quantity / 1_000_000;
    const expectedSqft = expectedSqm * 10.7639;
    const actualSqm = finite(row.areaSqm) ?? 0;
    const actualSqft = finite(row.areaSqft) ?? 0;
    const expectedAmount = actualSqft * (finite(row.rate) ?? 0);
    const amount = finite(row.amount) ?? 0;
    glassAreaSqm += actualSqm;
    glassAreaSqft += actualSqft;
    glassCost += amount;
    addCheck(`Glass panel ${String(row.panelIndex ?? "?")} area`, expectedSqm, actualSqm, "sqm", 0.00051);
    addCheck(`Glass panel ${String(row.panelIndex ?? "?")} sqft conversion`, expectedSqft, actualSqft, "sqft", 0.006);
    addCheck(`Glass panel ${String(row.panelIndex ?? "?")} cost`, expectedAmount, amount, "INR", 0.02);
  }
  const materialGlass = materials.filter((row) => row.materialType === "glass");
  const materialGlassAreaSqft = sum(materialGlass, (row) => row.totalAreaSqft);
  const materialGlassAreaSqm = sum(materialGlass, (row) => row.totalAreaSqm);
  const materialGlassCost = sum(materialGlass, (row) => row.amount);
  addCheck("Glass area in material summary", glassAreaSqft, materialGlassAreaSqft, "sqft", 0.02);
  addCheck("Glass sqm in material summary", glassAreaSqm, materialGlassAreaSqm, "sqm", 0.002);
  addCheck("Glass material cost", glassCost, materialGlassCost, "INR", 0.05);
  addCheck("Costing glass total", materialGlassCost, result.costingSummary.glassCost, "INR", 0.05);

  let bomCost = 0;
  for (const row of bom) {
    const expectedAmount = (finite(row.quantity) ?? 0) * (finite(row.rate) ?? 0);
    const amount = finite(row.amount) ?? 0;
    bomCost += amount;
    addCheck(`BOM ${String(row.itemCode ?? "item")} cost`, expectedAmount, amount, "INR", 0.02);
  }
  const materialBom = materials.filter((row) => row.materialType === "hardware" || row.materialType === "gasket");
  const materialBomCost = sum(materialBom, (row) => row.amount);
  addCheck("Hardware and gasket material cost", bomCost, materialBomCost, "INR", 0.05);
  addCheck("Costing hardware total", sum(materials.filter((row) => row.materialType === "hardware"), (row) => row.amount), result.costingSummary.hardwareCost, "INR", 0.05);
  addCheck("Costing gasket total", sum(materials.filter((row) => row.materialType === "gasket"), (row) => row.amount), result.costingSummary.gasketCost, "INR", 0.05);
  const costing = result.costingSummary;
  const finiteCosting = Object.values(costing).every(value => typeof value === "number" && Number.isFinite(value));
  checks.push({name:"Finite costing values",status:finiteCosting?"pass":"fail",message:finiteCosting?"All costing values are finite.":"Costing contains a missing or nonfinite value.",expected:null,actual:null,unit:"INR"});
  addCheck("Costing subtotal",costing.internalCost+costing.marginAmount-costing.discountAmount,costing.subtotalBeforeGst,"INR",0.05);
  addCheck("Costing grand total",costing.subtotalBeforeGst+costing.gstAmount,costing.grandTotal,"INR",0.02);

  const optimization = result.optimizationSummary;
  const wasteUsedMm = profiles.reduce((total, row) => total + (finite(row.cutLengthMm) ?? 0) * (finite(row.quantity) ?? 0), 0);
  const wasteReportedUsedMm = finite(optimization.totalUsedLengthMm) ?? 0;
  const wasteCapacityMm = (finite(optimization.totalStockBars) ?? 0) * (finite(optimization.stockLengthMm) ?? 0);
  const wasteReportedMm = finite(optimization.totalWasteMm) ?? 0;
  addCheck("Optimizer used length", wasteUsedMm, wasteReportedUsedMm, "mm", Math.max(1, profiles.length * 0.05));
  const wasteConsistent = wasteCapacityMm >= 0 && wasteReportedMm >= 0 && wasteReportedUsedMm + wasteReportedMm <= wasteCapacityMm + 1;
  checks.push({ name: "Optimizer stock and waste", status: wasteConsistent ? "pass" : "fail", message: wasteConsistent ? "Reported stock capacity contains used length and waste." : "Reported stock capacity is below used length plus waste.", expected: wasteCapacityMm, actual: wasteReportedUsedMm + wasteReportedMm, unit: "mm" });

  return {
    checks,
    profile_weight_kg: profileWeightKg,
    profile_length_m: profileLengthM,
    material_profile_weight_kg: materialProfileWeightKg,
    material_profile_length_m: materialProfileLengthM,
    glass_area_sqft: glassAreaSqft,
    material_glass_area_sqft: materialGlassAreaSqft,
    glass_cost: glassCost,
    material_glass_cost: materialGlassCost,
    bom_cost: bomCost,
    material_bom_cost: materialBomCost,
    waste_used_mm: wasteUsedMm,
    waste_reported_used_mm: wasteReportedUsedMm,
    waste_capacity_mm: wasteCapacityMm,
    waste_reported_mm: wasteReportedMm
  };
}

export type ConfigurationReleaseAssessment = {
  readiness: "blocked" | "estimated" | "ready";
  unresolvedReasons: string[];
  estimatedFields: string[];
  reconciliation: ReleaseReconciliation;
};

export function assessConfigurationRelease(input: {
  configuration: JsonRecord;
  series: JsonRecord | null;
  template: JsonRecord | null;
  systemProfiles: JsonRecord[];
  hardwareItems: JsonRecord[];
  glassItem: JsonRecord | null;
  finishOption: JsonRecord | null;
  companySettings: JsonRecord | null;
  result: ConfiguratorResult;
}): ConfigurationReleaseAssessment {
  const reasons = new Set<string>();
  const estimated = new Set<string>();
  const { configuration, series, template, result } = input;
  const width = finite(configuration.width_mm);
  const height = finite(configuration.height_mm);
  const count = finite(configuration.quantity);
  const systemType = String(configuration.system_type ?? "");
  if (width == null || height == null || width <= 0 || height <= 0 || width > 30000 || height > 30000 || count == null || count <= 0 || count > 10000) {
    reasons.add("Opening dimensions and quantity must be finite and within supported limits.");
  }
  if (!configuration.customer_id) reasons.add("Link a customer before fabrication release.");

  const layout = isRecord(configuration.panel_layout_json) ? configuration.panel_layout_json : {};
  const panels = Array.isArray(layout.panels) ? layout.panels as JsonRecord[] : [];
  if (panels.length < 1 || panels.length > 50) reasons.add("A valid panel layout with 1 to 50 panels is required.");
  const indices = new Set<number>();
  let occupiedAreaRatio = 0;
  for (const [position, panel] of panels.entries()) {
    const index = finite(panel.index);
    const panelWidthRatio = finite(panel.widthRatio);
    const panelHeightRatio = finite(panel.heightRatio);
    if (index == null || !Number.isInteger(index) || indices.has(index) || panelWidthRatio == null || panelHeightRatio == null || panelWidthRatio <= 0 || panelHeightRatio <= 0 || panelWidthRatio > 1 || panelHeightRatio > 1) {
      reasons.add(`Panel ${position + 1} has an invalid or duplicate index or invalid layout proportions.`);
    } else {
      indices.add(index);
      occupiedAreaRatio += panelWidthRatio * panelHeightRatio;
    }
    if (!new Set(["fixed", "sliding", "casement", "top_hung", "mesh", "door_leaf", "dummy", "custom"]).has(String(panel.type))
      || !new Set(["glass", "mesh", "solid", "louver", "dummy", "custom"]).has(String(panel.function))) {
      reasons.add(`Panel ${position + 1} has an unsupported type or function.`);
    }
  }
  if (occupiedAreaRatio > 1.01 || occupiedAreaRatio < 0.99) reasons.add("Panel layout proportions must cover the opening without overlap or gaps.");
  if (finite(configuration.no_of_panels) !== panels.length) reasons.add("Declared panel count must match the approved layout.");
  for (const error of result.errors) reasons.add(error.message);

  if (!series || series.is_active === false || String(series.id ?? "") !== String(configuration.series_id ?? "")) reasons.add("Select an active system series belonging to this configuration.");
  if (!template || template.is_active === false || String(template.id ?? "") !== String(configuration.template_id ?? "")) reasons.add("An active, versioned system template is required for fabrication release.");
  if (template && (!Number.isInteger(Number(template.formula_version)) || Number(template.formula_version) < 1)) reasons.add("System template must have a positive formula version.");
  if (template && String(template.system_type) !== systemType) reasons.add("Template system type does not match the configuration.");
  if (template?.series_id && String(template.series_id) !== String(configuration.series_id ?? "")) reasons.add("Template is assigned to a different system series.");

  const formula = isRecord(template?.formula_json) ? template.formula_json : {};
  const profileRules = Array.isArray(formula.profileRules) ? formula.profileRules as JsonRecord[] : [];
  const requiredComponents = Array.isArray(formula.requiredComponents) ? formula.requiredComponents.map(String) : [];
  if (!profileRules.length) reasons.add("The template needs explicit, versioned profile cutting rules; engine defaults are estimate-only.");
  if (template) {
    const validation = validateTemplateFormulaJson(formula);
    for (const issue of validation.errors) reasons.add(`Invalid template rule ${issue.path}: ${issue.message}`);
  }
  const profileRoles = new Set(input.systemProfiles.filter((profile) => profile.is_active !== false).map((profile) => String(profile.component_role)));
  for (const role of [...requiredComponents, ...profileRules.map((rule) => String(rule.componentRole ?? rule.component_role ?? ""))]) {
    if (!role || !profileRoles.has(role)) reasons.add(`Required active profile mapping is missing: ${role || "unknown role"}.`);
  }
  for (const profile of input.systemProfiles.filter((row) => row.is_active !== false)) {
    const applicableTypes = Array.isArray(profile.applies_to_system_types) ? profile.applies_to_system_types.map(String) : [];
    if (applicableTypes.length && !applicableTypes.includes(systemType)) continue;
    const profileInfo = Array.isArray(profile.aluminium_profiles) ? profile.aluminium_profiles[0] : profile.aluminium_profiles;
    const weight = finite(profileInfo?.section_weight_kg_per_m);
    if (!profile.profile_id || profileInfo?.is_active === false) reasons.add(`${profile.display_name ?? profile.component_role} is not linked to an active aluminium profile.`);
    if (weight == null || weight <= 0) reasons.add(`${profileInfo?.profile_code ?? profile.display_name ?? profile.component_role} needs a verified positive section weight.`);
  }
  for (const rule of profileRules) {
    const role = String(rule.componentRole ?? rule.component_role ?? "");
    const matching = input.systemProfiles.filter((profile) => profile.is_active !== false
      && (String(profile.component_role) === role || (rule.profileCode && String((Array.isArray(profile.aluminium_profiles) ? profile.aluminium_profiles[0] : profile.aluminium_profiles)?.profile_code) === String(rule.profileCode))));
    if (matching.length !== 1) reasons.add(`Profile rule ${role || "unknown role"} must resolve to exactly one compatible active profile mapping.`);
    const compatible = matching[0] && Array.isArray(matching[0].applies_to_system_types) ? matching[0].applies_to_system_types.map(String) : [];
    if (compatible.length && !compatible.includes(systemType)) reasons.add(`Profile rule ${role} maps to a profile incompatible with ${systemType}.`);
  }

  const hasGlassPanels = panels.some((panel) => panel.function === "glass");
  if (hasGlassPanels) {
    const glassRules = isRecord(formula.glassRules) ? formula.glassRules : {};
    if (typeof (glassRules.widthFormula ?? glassRules.width_formula) !== "string" || typeof (glassRules.heightFormula ?? glassRules.height_formula) !== "string") {
      reasons.add("Glass panels need explicit width and height rules; fallback deductions are estimate-only.");
    }
    if (!input.glassItem || input.glassItem.is_active === false || String(input.glassItem.id ?? "") !== String(configuration.glass_id ?? "")) reasons.add("Select an active glass item for the glass panels.");
    if (input.glassItem && (finite(input.glassItem.rate_per_sqft) ?? 0) <= 0 && (finite(input.glassItem.rate_per_sqm) ?? 0) <= 0) estimated.add("glass_rate");
    const beadingRules = isRecord(formula.beadingRules) ? formula.beadingRules : {};
    if (Number(beadingRules.version) !== 1 || beadingRules.method !== "all_four_edges") reasons.add("Glass panels need version 1 beading rules declaring the supported all-four-edges scheme.");
    for (const role of ["glazing_bead_vertical", "glazing_bead_horizontal"]) {
      const match = input.systemProfiles.filter((profile) => profile.is_active !== false && String(profile.component_role) === role);
      if (match.length !== 1) reasons.add(`Glass panels need exactly one active ${role.replaceAll("_", " ")} profile.`);
      const profileInfo = Array.isArray(match[0]?.aluminium_profiles) ? match[0].aluminium_profiles[0] : match[0]?.aluminium_profiles;
      if (match.length && (finite(profileInfo?.section_weight_kg_per_m) ?? 0) <= 0) reasons.add(`${role.replaceAll("_", " ")} needs a verified section weight.`);
    }
  }

  const hardwareRules = formula.hardwareRules;
  const explicitHardwareRules: JsonRecord[] = Array.isArray(hardwareRules)
    ? hardwareRules.filter(isRecord)
    : isRecord(hardwareRules) ? Object.entries(hardwareRules).map(([category, rule]): JsonRecord => ({ category, ...(isRecord(rule) ? rule : { quantityFormula: rule }) })) : [];
  if (!explicitHardwareRules.length) reasons.add("The template needs explicit hardware quantity rules; default BOM formulas are estimate-only.");
  for (const rule of explicitHardwareRules) {
    const category = String(rule.category ?? "");
    const itemCode = String(rule.itemCode ?? rule.item_code ?? "");
    const matching = input.hardwareItems.filter((item) => item.is_active !== false && (itemCode
      ? String(item.item_code) === itemCode
      : String(item.hardware_category) === category));
    if (matching.length !== 1) reasons.add(`Hardware rule ${itemCode || category || "unknown category"} must resolve to exactly one active item.`);
    if (matching.length && (finite(matching[0].default_rate) ?? 0) <= 0) estimated.add(`hardware_rate:${matching[0].item_code}`);
  }
  for (const warning of result.warnings) {
    if (warning.severity === "error" || ["missing_profile", "missing_required_profile", "missing_section_weight", "missing_beading_profile", "invalid_cut", "cut_exceeds_stock", "invalid_glass_size", "missing_hardware"].includes(warning.code)) {
      reasons.add(warning.message);
    } else if (warning.code === "missing_rate") {
      estimated.add(warning.field ?? "material_rate");
    }
  }
  for (const check of reconciliation(result).checks) if (check.status === "fail") reasons.add(check.message);

  if (!input.finishOption || input.finishOption.is_active === false || String(input.finishOption.id ?? "") !== String(configuration.finish_id ?? "")) reasons.add("Select an active finish option before fabrication release.");
  else if ((finite(input.finishOption.rate) ?? 0) <= 0) estimated.add("finish_rate");

  const options = isRecord(configuration.options_json) ? configuration.options_json : {};
  for (const name of ["aluminium_rate_per_kg","fabrication_labor_rate","installation_rate","transport_amount","wastage_percent","margin_percent","gst_percent","discount_amount"]) {
    if (options[name] != null && (finite(options[name]) == null || Number(options[name]) < 0)) reasons.add(`${name.replaceAll("_"," ")} must be a finite nonnegative value.`);
  }
  const settings = input.companySettings ?? {};
  if (!(finite(options.aluminium_rate_per_kg) ?? 0)) estimated.add("aluminium_rate_per_kg");
  if (!(finite(options.fabrication_labor_rate) ?? finite(settings.default_conversion_charge_per_kg) ?? 0)) estimated.add("fabrication_labor_rate");
  if (!(finite(options.installation_rate) ?? 0)) estimated.add("installation_rate");
  if (options.transport_amount == null && !(finite(settings.default_transport_charge) ?? 0)) estimated.add("transport_amount");
  if (options.wastage_percent == null && (finite(series?.wastage_percent_default) ?? 0) <= 0) estimated.add("wastage_percent");
  if (options.margin_percent == null && (finite(configuration.margin_percent) ?? finite(settings.default_margin_percent) ?? 0) <= 0) estimated.add("margin_percent");
  if (options.gst_percent == null && (finite(configuration.gst_percent) ?? finite(settings.default_gst_percent) ?? 0) <= 0) estimated.add("gst_percent");

  const readiness = reasons.size ? "blocked" : estimated.size ? "estimated" : "ready";
  return { readiness, unresolvedReasons: [...reasons].sort(), estimatedFields: [...estimated].sort(), reconciliation: reconciliation(result) };
}

export function configurationReleaseInputSnapshot(configuration: JsonRecord) {
  return {
    configuration_id: String(configuration.id),
    company_id: String(configuration.company_id),
    customer_id: configuration.customer_id == null ? null : String(configuration.customer_id),
    series_id: String(configuration.series_id),
    template_id: configuration.template_id == null ? null : String(configuration.template_id),
    system_type: configuration.system_type == null ? null : String(configuration.system_type),
    project_name: String(configuration.project_name ?? ""),
    design_reference: configuration.design_reference == null ? null : String(configuration.design_reference),
    location_label: configuration.location_label == null ? null : String(configuration.location_label),
    width_mm: finite(configuration.width_mm),
    height_mm: finite(configuration.height_mm),
    no_of_panels: finite(configuration.no_of_panels),
    quantity: finite(configuration.quantity),
    measurement_type: String(configuration.measurement_type ?? ""),
    view_direction: String(configuration.view_direction ?? ""),
    panel_layout_json: configuration.panel_layout_json ?? {},
    options_json: configuration.options_json ?? {},
    finish_id: configuration.finish_id == null ? null : String(configuration.finish_id),
    glass_id: configuration.glass_id == null ? null : String(configuration.glass_id)
  };
}

export function canonicalJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function persistedOutputSnapshot(
  rows: Record<string, unknown[]>,
  result: ConfiguratorResult,
  assessment: ConfigurationReleaseAssessment,
  configurationTotals: Record<string, number>
) {
  return {
    persisted_rows: rows,
    engine_result: result,
    reconciliation: assessment.reconciliation,
    configuration_totals: configurationTotals,
    readiness: assessment.readiness,
    unresolved_reasons: assessment.unresolvedReasons,
    estimated_fields: assessment.estimatedFields
  };
}
