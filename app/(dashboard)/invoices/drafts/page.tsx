import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { InvoiceDraftsClient } from "@/components/modules/order-to-cash/billing";

// AP-046: invoice drafts prepared at gate-out and the unbilled-dispatch report.
export default async function InvoiceDraftsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts"].includes(context.role)) redirect("/invoices");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Invoices</p><h1 className="text-2xl font-black">Drafts to post</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">A draft is ready for every dispatch that left the gate. Review the totals and post in a batch: posting runs the reviewed invoice check and allocates the number.</p></div>
    <InvoiceDraftsClient />
  </div>;
}
