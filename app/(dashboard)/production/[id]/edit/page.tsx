import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { WorkRequirementsPanel } from "@/components/modules/orders/work-requirements-panel";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function EditProductionJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "production")) redirect(`/production/${id}`);
  // NOV-095: the approved customer requirements for this stage sit with the inputs they govern.
  const job = context.dealerId ? null : (await (await createClient()).from("production_jobs").select("order_id").eq("company_id", context.companyId).eq("id", id).maybeSingle()).data;
  return <div className="space-y-6">
    {job?.order_id ? <WorkRequirementsPanel companyId={context.companyId} role={context.role} stage="production" orderId={job.order_id} /> : null}
    <RecordFormClient moduleKey="production" context={context} recordId={id} />
  </div>;
}
