import { RecordDetailClient } from "@/components/modules/operations/record-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/payments");
  const { id } = await params;
  return <RecordDetailClient moduleKey="payments" recordId={id} context={context} canEdit={can(context.role, "update", "financials")} />;
}
