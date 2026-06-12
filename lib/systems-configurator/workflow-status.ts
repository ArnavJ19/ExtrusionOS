import type { DataReadinessSummary } from "./data-readiness";
import type { SystemOutputStatus } from "./output-status";
import type { ProductionHandoffReadiness } from "./production-handoff";
import type { ProductionProgressSummary } from "./production-progress";
import type { SystemQuoteReadiness } from "./quote-readiness";

export type ConfiguratorWorkflowStage =
  | "draft"
  | "needs_data"
  | "ready_to_calculate"
  | "calculated"
  | "ready_to_quote"
  | "quoted"
  | "ready_for_production"
  | "in_production"
  | "completed";

export type ConfiguratorWorkflowStatus = {
  stage: ConfiguratorWorkflowStage;
  label: string;
  severity: "neutral" | "warning" | "success";
  nextAction: string;
};

type WorkflowInput = {
  configurationStatus?: string | null;
  quoteId?: string | null;
  dataReadiness: DataReadinessSummary;
  outputStatus: SystemOutputStatus;
  quoteReadiness: SystemQuoteReadiness;
  productionReadiness: ProductionHandoffReadiness;
  productionProgress: ProductionProgressSummary;
};

export function getConfiguratorWorkflowStatus(input: WorkflowInput): ConfiguratorWorkflowStatus {
  if (input.productionProgress.status === "completed" || input.configurationStatus === "completed") return { stage: "completed", label: "Production Complete", severity: "success", nextAction: "Review final reports and close out delivery." };
  if (input.productionProgress.jobCount > 0 || input.configurationStatus === "in_production") return { stage: "in_production", label: "In Production", severity: "success", nextAction: "Track planned vs actual production output." };
  if (input.productionReadiness.ready) return { stage: "ready_for_production", label: "Ready For Production", severity: "success", nextAction: "Create production handoff jobs." };
  if (input.quoteId || input.configurationStatus === "quoted" || input.configurationStatus === "approved" || input.configurationStatus === "converted_to_order") return { stage: "quoted", label: "Quoted", severity: "success", nextAction: "Confirm customer approval and hand off to production." };
  if (input.quoteReadiness.ready) return { stage: "ready_to_quote", label: "Ready To Quote", severity: "success", nextAction: "Convert this configuration to a quote." };
  if (input.outputStatus.productionReady || input.configurationStatus === "calculated") return { stage: "calculated", label: "Calculated", severity: "success", nextAction: "Review outputs, optimize cuts, and resolve quote blockers." };
  if (input.dataReadiness.status === "critical") return { stage: "needs_data", label: "Needs Production Data", severity: "warning", nextAction: "Complete required profile mappings and library data." };
  if (input.dataReadiness.status === "ready" || input.dataReadiness.status === "warning") return { stage: "ready_to_calculate", label: "Ready To Calculate", severity: input.dataReadiness.status === "warning" ? "warning" : "success", nextAction: "Run calculation to generate cutting, glass, BOM, and costing outputs." };
  return { stage: "draft", label: "Draft", severity: "neutral", nextAction: "Complete dimensions, series, template, glass, and finish selections." };
}

export function productionJobMatchesConfiguration(job: { remarks?: string | null; order_id?: string | null }, configuration: { configuration_number?: string | null; order_id?: string | null }) {
  if (!configuration.order_id || job.order_id !== configuration.order_id) return false;
  const token = configuration.configuration_number ? `System configuration ${configuration.configuration_number}` : "System configuration Draft";
  return String(job.remarks ?? "").includes(token);
}
