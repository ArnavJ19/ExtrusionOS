export type DataReadinessSeverity = "ready" | "warning" | "critical";

export type DataReadinessIssue = {
  code: string;
  area: "series" | "profiles" | "hardware" | "glass" | "finish" | "rates";
  message: string;
  severity: Exclude<DataReadinessSeverity, "ready">;
};

export type DataReadinessSummary = {
  status: DataReadinessSeverity;
  issues: DataReadinessIssue[];
  criticalCount: number;
  warningCount: number;
};

type ReadinessInput = {
  seriesId?: string | null;
  template?: Record<string, unknown> | null;
  systemProfiles: Array<Record<string, any>>;
  hardwareItems: Array<Record<string, any>>;
  glassItems: Array<Record<string, any>>;
  finishOptions: Array<Record<string, any>>;
  glassId?: string | null;
  finishId?: string | null;
};

function formulaJson(template?: Record<string, unknown> | null) {
  const value = template?.formula_json;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function getTemplateRequiredRoles(template?: Record<string, unknown> | null) {
  const formula = formulaJson(template);
  const required = Array.isArray(formula.requiredComponents) ? formula.requiredComponents : [];
  const rules = Array.isArray(formula.profileRules) ? formula.profileRules : [];
  return Array.from(new Set([...required, ...rules.map((rule: any) => rule.componentRole ?? rule.component_role)].filter(Boolean))) as string[];
}

export function getTemplateHardwareCategories(template?: Record<string, unknown> | null) {
  const rules = formulaJson(template).hardwareRules;
  if (Array.isArray(rules)) return Array.from(new Set(rules.map((rule: any) => rule.category).filter(Boolean))) as string[];
  if (rules && typeof rules === "object") return Object.keys(rules);
  return [];
}

function activeRows(rows: Array<Record<string, any>>) {
  return rows.filter((row) => row.is_active !== false);
}

function addIssue(issues: DataReadinessIssue[], issue: DataReadinessIssue) {
  issues.push(issue);
}

export function getConfigurationDataReadiness(input: ReadinessInput): DataReadinessSummary {
  const issues: DataReadinessIssue[] = [];
  const profiles = activeRows(input.systemProfiles).filter((profile) => !input.seriesId || profile.series_id === input.seriesId);
  const hardwareItems = activeRows(input.hardwareItems);
  const glassItems = activeRows(input.glassItems);
  const finishOptions = activeRows(input.finishOptions);
  const requiredRoles = getTemplateRequiredRoles(input.template);
  const requiredHardwareCategories = getTemplateHardwareCategories(input.template);

  if (!input.seriesId) addIssue(issues, { code: "missing_series", area: "series", message: "Select a system series before calculation.", severity: "critical" });
  if (!profiles.length) addIssue(issues, { code: "missing_profile_mappings", area: "profiles", message: "Selected series has no active profile-role mappings.", severity: "critical" });

  const profileRoles = new Set(profiles.map((profile) => profile.component_role));
  for (const role of requiredRoles) {
    if (!profileRoles.has(role)) addIssue(issues, { code: "missing_required_profile_role", area: "profiles", message: `Required profile role is missing: ${role}.`, severity: "critical" });
  }

  for (const profile of profiles) {
    const profileInfo = Array.isArray(profile.aluminium_profiles) ? profile.aluminium_profiles[0] : profile.aluminium_profiles;
    if (!profile.profile_id && !profileInfo?.profile_code) addIssue(issues, { code: "profile_mapping_without_profile", area: "profiles", message: `${profile.display_name ?? profile.component_role} is not linked to an aluminium profile.`, severity: "critical" });
    if (Number(profileInfo?.section_weight_kg_per_m ?? 0) <= 0) addIssue(issues, { code: "missing_section_weight", area: "profiles", message: `${profileInfo?.profile_code ?? profile.display_name ?? profile.component_role} has no section weight.`, severity: "warning" });
  }

  if (!hardwareItems.length) addIssue(issues, { code: "missing_hardware_library", area: "hardware", message: "No active hardware items are available for BOM calculation.", severity: "warning" });
  const hardwareCategories = new Set(hardwareItems.map((item) => item.hardware_category ?? item.category));
  for (const category of requiredHardwareCategories) {
    if (!hardwareCategories.has(category)) addIssue(issues, { code: "missing_hardware_category", area: "hardware", message: `No active hardware item exists for ${category}.`, severity: "warning" });
  }
  for (const item of hardwareItems) {
    if (Number(item.default_rate ?? item.rate ?? 0) <= 0) addIssue(issues, { code: "missing_hardware_rate", area: "rates", message: `${item.item_code ?? item.itemName ?? "Hardware"} has no rate.`, severity: "warning" });
  }

  if (!glassItems.length) addIssue(issues, { code: "missing_glass_library", area: "glass", message: "No active glass items are configured.", severity: "warning" });
  if (!input.glassId) addIssue(issues, { code: "missing_selected_glass", area: "glass", message: "Select glass before final calculation for glass cutting and costing.", severity: "warning" });
  const selectedGlass = glassItems.find((item) => item.id === input.glassId);
  if (input.glassId && !selectedGlass) addIssue(issues, { code: "inactive_selected_glass", area: "glass", message: "Selected glass is inactive or missing from the library.", severity: "warning" });
  if (selectedGlass && Number(selectedGlass.rate_per_sqft ?? 0) <= 0 && Number(selectedGlass.rate_per_sqm ?? 0) <= 0) addIssue(issues, { code: "missing_glass_rate", area: "rates", message: `${selectedGlass.glass_code ?? "Selected glass"} has no sqft/sqm rate.`, severity: "warning" });

  if (!finishOptions.length) addIssue(issues, { code: "missing_finish_library", area: "finish", message: "No active finish options are configured.", severity: "warning" });
  if (!input.finishId) addIssue(issues, { code: "missing_selected_finish", area: "finish", message: "Select finish before final costing.", severity: "warning" });
  const selectedFinish = finishOptions.find((item) => item.id === input.finishId);
  if (input.finishId && !selectedFinish) addIssue(issues, { code: "inactive_selected_finish", area: "finish", message: "Selected finish is inactive or missing from the library.", severity: "warning" });
  if (selectedFinish && Number(selectedFinish.rate ?? 0) <= 0) addIssue(issues, { code: "missing_finish_rate", area: "rates", message: `${selectedFinish.finish_code ?? "Selected finish"} has no rate.`, severity: "warning" });

  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  return { status: criticalCount ? "critical" : warningCount ? "warning" : "ready", issues, criticalCount, warningCount };
}

export function getLibraryReadiness(input: Omit<ReadinessInput, "seriesId" | "template" | "glassId" | "finishId">): DataReadinessSummary {
  const issues: DataReadinessIssue[] = [];
  const profiles = activeRows(input.systemProfiles);
  const hardwareItems = activeRows(input.hardwareItems);
  const glassItems = activeRows(input.glassItems);
  const finishOptions = activeRows(input.finishOptions);

  if (!profiles.length) addIssue(issues, { code: "missing_profile_mappings", area: "profiles", message: "No active profile-role mappings are configured.", severity: "critical" });
  if (!hardwareItems.length) addIssue(issues, { code: "missing_hardware_library", area: "hardware", message: "No active hardware items are configured.", severity: "warning" });
  if (!glassItems.length) addIssue(issues, { code: "missing_glass_library", area: "glass", message: "No active glass items are configured.", severity: "warning" });
  if (!finishOptions.length) addIssue(issues, { code: "missing_finish_library", area: "finish", message: "No active finish options are configured.", severity: "warning" });

  for (const profile of profiles) {
    const profileInfo = Array.isArray(profile.aluminium_profiles) ? profile.aluminium_profiles[0] : profile.aluminium_profiles;
    if (Number(profileInfo?.section_weight_kg_per_m ?? 0) <= 0) addIssue(issues, { code: "missing_section_weight", area: "profiles", message: `${profileInfo?.profile_code ?? profile.display_name ?? profile.component_role} has no section weight.`, severity: "warning" });
  }
  for (const item of hardwareItems) {
    if (Number(item.default_rate ?? item.rate ?? 0) <= 0) addIssue(issues, { code: "missing_hardware_rate", area: "rates", message: `${item.item_code ?? item.itemName ?? "Hardware"} has no rate.`, severity: "warning" });
  }
  for (const item of glassItems) {
    if (Number(item.rate_per_sqft ?? 0) <= 0 && Number(item.rate_per_sqm ?? 0) <= 0) addIssue(issues, { code: "missing_glass_rate", area: "rates", message: `${item.glass_code ?? "Glass"} has no sqft/sqm rate.`, severity: "warning" });
  }
  for (const item of finishOptions) {
    if (Number(item.rate ?? 0) <= 0) addIssue(issues, { code: "missing_finish_rate", area: "rates", message: `${item.finish_code ?? "Finish"} has no rate.`, severity: "warning" });
  }

  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  return { status: criticalCount ? "critical" : warningCount ? "warning" : "ready", issues, criticalCount, warningCount };
}
