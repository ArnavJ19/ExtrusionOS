import type { ConfiguratorWarning } from "./types.ts";

export type WarningCategory = "critical" | "high" | "medium" | "low";

const criticalCodes = new Set(["invalid_dimensions", "missing_panels", "invalid_derived_dimension", "invalid_cut", "formula_error", "glass_formula_error", "hardware_formula_error", "invalid_glass_size", "cut_exceeds_stock", "missing_required_profile"]);
const highCodes = new Set(["missing_profile", "missing_hardware", "missing_beading_profile"]);
const mediumCodes = new Set(["missing_glass", "missing_finish", "missing_rate", "missing_section_weight", "low_margin", "high_wastage"]);

export function categorizeWarning(warning: Pick<ConfiguratorWarning, "code" | "severity">): WarningCategory {
  if (warning.severity === "error" || criticalCodes.has(warning.code)) return "critical";
  if (highCodes.has(warning.code)) return "high";
  if (mediumCodes.has(warning.code)) return "medium";
  return "low";
}

export function hasCriticalWarnings(warnings: Array<Pick<ConfiguratorWarning, "code" | "severity">>) {
  return warnings.some((warning) => categorizeWarning(warning) === "critical");
}
