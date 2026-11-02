import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { WorkRequirementsPanel } from "@/components/modules/orders/work-requirements-panel";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function EditPackagingJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "packaging")) redirect(`/packaging/${id}`);
  // NOV-095: the customer's packing requirements sit beside the packing decision.
  const job = context.dealerId ? null : (await (await createClient()).from("packaging_jobs").select("order_id").eq("company_id", context.companyId).eq("id", id).maybeSingle()).data;
  return <div className="space-y-6">
    {job?.order_id ? <WorkRequirementsPanel companyId={context.companyId} role={context.role} stage="packing" orderId={job.order_id} /> : null}
    <RecordFormClient moduleKey="packaging" context={context} recordId={id} />
  </div>;
}
