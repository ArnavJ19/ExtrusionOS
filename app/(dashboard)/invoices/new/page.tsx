import { InvoiceFormClient } from "@/components/modules/financials/invoice-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewInvoicePage({ searchParams = Promise.resolve({}) }: {
  searchParams?: Promise<{ order_id?: string; dispatch_id?: string; source_fingerprint?: string }>;
} = {}) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "financials")) redirect("/invoices");
  const params = await searchParams;
  const reviewedSource = params.order_id && params.dispatch_id && /^[0-9a-f]{32}$/.test(params.source_fingerprint ?? "")
    ? { orderId: params.order_id, dispatchId: params.dispatch_id, fingerprint: params.source_fingerprint! }
    : undefined;
  return <InvoiceFormClient context={context} reviewedSource={reviewedSource} />;
}
