import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { WorkRequirementsPanel } from "@/components/modules/orders/work-requirements-panel";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditQualityInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "quality")) redirect(`/quality/${id}`);
  // NOV-095: the customer's quality requirements sit beside the inspection result being recorded.
  return <div className="space-y-6">
    {!context.dealerId ? <WorkRequirementsPanel companyId={context.companyId} role={context.role} stage="quality" source={{ type: "quality_inspection", id }} /> : null}
    <RecordFormClient moduleKey="quality" context={context} recordId={id} />
  </div>;
}
