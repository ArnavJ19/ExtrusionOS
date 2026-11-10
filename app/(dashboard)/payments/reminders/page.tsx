import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { RemindersClient } from "@/components/modules/order-to-cash/cash";

// AP-084: the daily payment reminder queue.
export default async function RemindersPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts"].includes(context.role)) redirect("/payments");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Payments</p><h1 className="text-2xl font-black">Payment reminders</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Messages are prepared each morning at 08:00. Nothing goes to a customer until you send it and mark it sent.</p></div>
    <RemindersClient canPrepare />
  </div>;
}
