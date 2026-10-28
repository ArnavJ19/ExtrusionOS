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
import { canEditPlans, evaluationSchema } from "@/lib/workflow/inspection-plans";

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
  const terminal = ["approved", "rejected", "rework"].includes(String(inspection?.status ?? ""));
  const controls = inspection ? qualityRejectControls(context, inspection as any) : [];
  // UPGRADE_EOS feature 54: the applicable approved inspection plan and its recorded results.
  const planResult = inspection && !context.dealerId ? await supabase.rpc("inspection_plan_command", { p_command: "inspection.plan", p_payload: { inspection_id: id } }) : null;
  const evaluation = planResult && !planResult.error ? evaluationSchema.safeParse(planResult.data) : null;
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="quality" context={context} recordId={id} canEdit={!terminal && can(context.role, "update", "quality")} />
    {!context.dealerId ? <WorkRequirementsPanel companyId={context.companyId} role={context.role} stage="quality" source={{ type: "quality_inspection", id }} /> : null}
    {evaluation?.success ? <InspectionResultsPanel inspectionId={id} initial={evaluation.data} canRecord={canEditPlans(context.role)} /> : null}
    {!context.dealerId && canFollow(context.role, "quality_inspection") ? <RecordFollow entityType="quality_inspection" entityId={id} /> : null}
    <ErpControlPanel title="Rejected material" actions={controls} />
  </div>;
}
