import { PaymentDetailClient } from "@/components/modules/financials/payment-detail-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function ReversePaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "payments", context.permissions)) redirect(`/payments/${id}`);
  return <PaymentDetailClient context={context} recordId={id} reversalMode canReverse />;
}
