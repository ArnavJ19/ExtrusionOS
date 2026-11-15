import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WeightNotesQueue, WeightTolerances } from "@/components/modules/autopilot-batch9/weight-notes";
import { getSessionContext } from "@/lib/auth";
import { WEIGHT_NOTE_APPROVERS, WEIGHT_NOTE_READERS } from "@/lib/autopilot-batch9/commands";

// AP-075: weight differences between the customer's weighbridge and the invoice.
export default async function WeightNotesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(WEIGHT_NOTE_READERS as readonly string[]).includes(context.role)) redirect("/invoices");
  const approver = (WEIGHT_NOTE_APPROVERS as readonly string[]).includes(context.role);
  return <div className="space-y-5">
    <PageHeader title="Weight differences" description="Customer receipt weights against invoiced weights: credit and debit notes waiting for accounts, and the agreed tolerances." actions={<Link href="/invoices" className="text-sm font-bold underline">Back to invoices</Link>} />
    <WeightNotesQueue canDecide={approver} />
    <WeightTolerances canSet={["owner", "admin", "accounts", "sales_manager"].includes(context.role)} />
  </div>;
}
