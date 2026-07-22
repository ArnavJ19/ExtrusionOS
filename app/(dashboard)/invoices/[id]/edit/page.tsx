import { InvoiceFormClient } from "@/components/modules/financials/invoice-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "financials")) redirect(`/invoices/${id}`);
  return <InvoiceFormClient context={context} recordId={id} />;
}
