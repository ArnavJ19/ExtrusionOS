import { PaymentDetailClient } from "@/components/modules/financials/payment-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "read", "payments", context.permissions)) redirect("/payments");
  const { id } = await params;
  return <PaymentDetailClient context={context} recordId={id} canReverse={can(context.role, "update", "payments", context.permissions)} />;
}
