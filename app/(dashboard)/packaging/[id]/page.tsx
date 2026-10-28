import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WorkRequirementsPanel } from "@/components/modules/orders/work-requirements-panel";

export default async function PackagingJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "packaging")) redirect("/dashboard");
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("packaging_jobs")
    .select("status,order_id")
    .eq("company_id", context.companyId)
    .eq("id", id)
    .maybeSingle();
  const terminal = ["completed", "cancelled"].includes(String(job?.status ?? ""));
  return <div className="space-y-6"><RecordDetailClient moduleKey="packaging" context={context} recordId={id} canEdit={!terminal && can(context.role, "update", "packaging")} />{!context.dealerId ? <WorkRequirementsPanel companyId={context.companyId} role={context.role} stage="packing" orderId={job?.order_id} /> : null}</div>;
}
