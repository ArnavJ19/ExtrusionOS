import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PackagingJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "packaging")) redirect("/dashboard");
  return <RecordDetailClient moduleKey="packaging" context={context} recordId={id} canEdit={can(context.role, "update", "packaging")} />;
}
