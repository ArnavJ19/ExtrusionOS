import { PaymentFormClient } from "@/components/modules/financials/payment-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewPaymentPage({
  searchParams
}: {
  searchParams: Promise<{ invoice_id?: string }>;
}) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "payments", context.permissions)) redirect("/payments");
  const params = await searchParams;
  return <PaymentFormClient context={context} initialInvoiceId={params.invoice_id ?? ""} />;
}
