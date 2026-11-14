// AP-044: the reporting screens that make up Insights, who may open each, and the feature flag it needs. Each screen keeps
// its own route permission (lib/auth/route-permissions); this list only decides which tabs and cards a person sees.
import type { EnterpriseModuleName } from "@/types/app";

export type InsightsDestination = { href: string; label: string; description: string; roles: readonly string[]; module?: EnterpriseModuleName };

export const INSIGHTS_DESTINATIONS: InsightsDestination[] = [
  { href: "/command-center", label: "Command centre", description: "Today's production, recovery, dispatch, collections and alerts for the owner.", roles: ["owner", "admin"], module: "command_center" },
  { href: "/analytics", label: "Analytics", description: "Monthly trends: order intake, shipped kg, on-time dispatch, attainment and quality.", roles: ["owner", "admin", "sales_manager", "accounts"] },
  { href: "/profitability", label: "Profitability", description: "Margin by order, customer and profile from complete cost records.", roles: ["owner", "admin", "accounts"], module: "profitability_intelligence" },
  { href: "/report-builder", label: "Report builder", description: "Build, save and export your own reports from the same records.", roles: ["owner", "admin", "sales_manager", "accounts"], module: "report_builder" }
];

export function insightsFor(role: string, enabled: (module: EnterpriseModuleName) => boolean) {
  return INSIGHTS_DESTINATIONS.filter(d => d.roles.includes(role) && (!d.module || enabled(d.module)));
}
