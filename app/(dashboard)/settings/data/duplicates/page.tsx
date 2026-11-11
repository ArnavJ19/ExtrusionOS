import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { DuplicatesClient } from "@/components/modules/order-to-cash/quotes-alerts";

// AP-097: duplicate warnings answered and a scan for likely duplicate orders and receipts.
export default async function DuplicatesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts", "sales_manager"].includes(context.role)) redirect("/dashboard");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Settings · Data</p><h1 className="text-2xl font-black">Duplicate entries</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Quotations, orders, receipts and dispatches warn before saving when a similar record was entered shortly before. This page is the audit sample.</p></div>
    <DuplicatesClient />
  </div>;
}
