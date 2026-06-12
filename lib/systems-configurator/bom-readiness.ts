export type BomReadinessIssue = {
  label: string;
  severity: "critical" | "warning";
  detail: string;
};

export function getSystemBomReadiness(input: {
  materialRows: Record<string, any>[];
  profileCuts: Record<string, any>[];
  glassCuts: Record<string, any>[];
  hardwareRows: Record<string, any>[];
}) {
  const issues: BomReadinessIssue[] = [];

  if (!input.profileCuts.length) issues.push({ label: "Profile cuts missing", severity: "critical", detail: "Calculate the configuration before issuing a production BOM." });
  if (!input.materialRows.length) issues.push({ label: "Material summary missing", severity: "critical", detail: "BOM totals are incomplete until material summary is generated." });
  if (input.profileCuts.some((cut) => !cut.profile_id)) issues.push({ label: "Unlinked profile", severity: "critical", detail: "One or more profile cuts are not linked to the profile master." });
  if (input.profileCuts.some((cut) => Number(cut.section_weight_kg_per_m ?? 0) <= 0)) issues.push({ label: "Kg/m missing", severity: "critical", detail: "Profile section weight is required for costing, stock reservation, and production planning." });
  if (input.profileCuts.some((cut) => Number(cut.cut_length_mm ?? 0) > Number(cut.stock_length_mm ?? 0))) issues.push({ label: "Cut exceeds stock length", severity: "critical", detail: "A required cut is longer than available stock length and cannot be produced as-is." });
  if (input.glassCuts.some((cut) => Number(cut.width_mm ?? 0) <= 0 || Number(cut.height_mm ?? 0) <= 0)) issues.push({ label: "Invalid glass size", severity: "critical", detail: "Glass width and height must be greater than zero." });
  if (input.hardwareRows.some((item) => Number(item.rate ?? 0) <= 0)) issues.push({ label: "Hardware rate missing", severity: "warning", detail: "One or more hardware/accessory items have zero rate and may understate costing." });
  if (!input.hardwareRows.length) issues.push({ label: "Hardware BOM empty", severity: "warning", detail: "Check whether this system needs locks, handles, rollers, hinges, gaskets, screws, or accessories." });

  return {
    ready: !issues.some((issue) => issue.severity === "critical"),
    issues
  };
}
