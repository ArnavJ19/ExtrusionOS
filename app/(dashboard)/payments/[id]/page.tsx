import { PaymentDetailClient } from "@/components/modules/financials/payment-detail-client";
import { RecordHistory } from "@/components/modules/fs-batch4/record-history";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "financials")) redirect("/payments");
  const { id } = await params;
  return <div className="space-y-6">
    <PaymentDetailClient context={context} recordId={id} canReverse={can(context.role, "update", "financials")} />
    {!context.dealerId ? <RecordHistory entityType="payment" entityId={id} /> : null}
  </div>;
}
