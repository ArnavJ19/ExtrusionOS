import { RelatedWorkPanel } from "@/components/modules/home-work/related-work-panel";
import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "vendors")) redirect("/dashboard");
  return <div className="space-y-6">
    <RecordDetailClient moduleKey="vendors" context={context} recordId={id} canEdit={can(context.role, "update", "vendors")} />
    {!context.dealerId ? <RelatedWorkPanel kind="vendor" id={id} role={context.role} /> : null}
  </div>;
}
