import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { CreditHoldsClient } from "@/components/modules/order-to-cash/credit";

// AP-032: orders that confirmed into credit hold, decided by the authorised approver; order-to-cash settings.
export default async function CreditHoldsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts", "sales_manager", "sales"].includes(context.role)) redirect("/orders");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Orders</p><h1 className="text-2xl font-black">Credit holds</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Orders are checked against the customer&apos;s credit limit at confirmation and at every dispatch. Over-limit orders wait here for an approver; a later payment clears the hold by itself.</p></div>
    <CreditHoldsClient />
  </div>;
}
