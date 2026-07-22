import { InvoiceFormClient } from "@/components/modules/financials/invoice-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewInvoicePage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "financials")) redirect("/invoices");
  return <InvoiceFormClient context={context} />;
}
