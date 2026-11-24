import { RecordFollow } from "@/components/modules/notifications/record-follow";
import { canFollow } from "@/lib/workflow/subscriptions";
import { WorkRequirementsPanel } from "@/components/modules/orders/work-requirements-panel";
import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ErpControlPanel } from "@/components/modules/erp-control-panel";
import { qualityRejectControls } from "@/lib/workflow/erp-control-panels";
import { InspectionResultsPanel } from "@/components/modules/quality/inspection-plans";
import { canEditPlans, canReadPlans, evaluationSchema } from "@/lib/workflow/inspection-plans";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { QcReversalPanel } from "@/components/modules/orchestration/qc-reversal-panel";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { canReadOrchestration } from "@/lib/workflow/orchestration";

export default async function QualityInspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "quality")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: inspection } = await supabase
    .from("quality_inspections")
    .select("id, status, quantity_checked_kg")
    .eq("company_id", context.companyId)
    .eq("id", id)
    .maybeSingle();
  const terminal = ["approved", "rejected", "rework", "reversed"].includes(String(inspection?.status ?? ""));
  // Orchestration Phase 4: the reversal link is read separately so a database without the upgrade still shows the record.
  const reversalLink = inspection && !context.dealerId && canReadOrchestration(context.role)
    ? await supabase.from("quality_inspections").select("reversal_id").eq("company_id", context.companyId).eq("id", id).maybeSingle() : null;
  const reversalId = (reversalLink?.data as { reversal_id?: string | null } | null)?.reversal_id ?? null;
  const lang = inspection && !context.dealerId ? await getFloorLanguage() : "en";
  const controls = inspection ? qualityRejectControls(context, inspection as any) : [];
  // UPGRADE_EOS feature 54: the applicable approved inspection plan and its recorded results.
  const planResult = inspection && !context.dealerId ? await supabase.rpc("inspection_plan_command", { p_command: "inspection.plan", p_payload: { inspection_id: id } }) : null;
  const evaluation = planResult && !planResult.error ? evaluationSchema.safeParse(planResult.data) : null;
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="quality" context={context} recordId={id} canEdit={!terminal && can(context.role, "update", "quality")} />
    {inspection && !context.dealerId && canReadOrchestration(context.role) && !reversalLink?.error
      ? <QcReversalPanel inspectionId={id} status={String(inspection.status)} reversalId={reversalId} role={context.role} lang={lang} /> : null}
    {!context.dealerId ? <WorkRequirementsPanel companyId={context.companyId} role={context.role} stage="quality" source={{ type: "quality_inspection", id }} /> : null}
    {evaluation?.success ? <InspectionResultsPanel inspectionId={id} initial={evaluation.data} canRecord={canEditPlans(context.role)} contextScope={`${context.companyId}:${context.userId}:${context.role}`} referenceHref={evaluation.data.state !== "no_plan" && canReadPlans(context.role) ? `/quality/plans/${evaluation.data.plan_id}` : undefined} /> : inspection && !context.dealerId ? <QueryErrorNotice messages={["The applicable inspection reference could not be loaded. Refresh before recording observations or assuming no plan applies."]} /> : null}
    {!context.dealerId && canFollow(context.role, "quality_inspection") ? <RecordFollow entityType="quality_inspection" entityId={id} /> : null}
    <ErpControlPanel title="Rejected material" actions={controls} />
  </div>;
}
