import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { FollowupQueueClient } from "@/components/modules/quote-sales/quote-sales";

// AP-071: quotation follow-ups due today and upcoming.
export default async function QuoteFollowupsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "sales_manager", "sales", "accounts"].includes(context.role)) redirect("/quotes");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Quotations</p><h1 className="text-2xl font-black">Follow-ups</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Sent quotations are followed up on a schedule. Each morning the due ones become your tasks with a prepared message; record what the customer said.</p></div>
    <FollowupQueueClient canSettings={["owner", "admin", "sales_manager"].includes(context.role)} />
  </div>;
}
