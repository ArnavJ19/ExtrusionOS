import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { EinvoiceClient } from "@/components/modules/autopilot-batch6/einvoice";
import { FINANCE_ROLES } from "@/lib/autopilot-batch6/commands";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

export default async function EinvoicePage() {
  const context = await getSessionContext();
  if (context.dealerId || !(FINANCE_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="E-invoices" description="Export issued invoices as IRP JSON and record the IRN and signed QR they return." actions={<Link href="/invoices" className="text-sm font-bold underline">Back to invoices</Link>} />
    <EinvoiceClient today={getBusinessDateBoundaries().today} /></div>;
}
