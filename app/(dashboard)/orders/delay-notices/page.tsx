import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { DelayQueueClient } from "@/components/modules/autopilot-batch7/delay";
import { DELAY_READERS, DELAY_SENDERS } from "@/lib/autopilot-batch7/commands";

// AP-064: customer delay notices drafted from the morning late-line prediction.
export default async function DelayNoticesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(DELAY_READERS as readonly string[]).includes(context.role)) redirect("/orders");
  return <div className="space-y-5">
    <PageHeader title="Customer delay notices" description="When a line is predicted late, a notice with the new expected date is drafted. Sales edits it, sends it and records that it was sent."
      actions={<span className="flex gap-3"><Link href="/orders/at-risk" className="text-sm font-bold underline">Order red list</Link><Link href="/orders" className="text-sm font-bold underline">Back to orders</Link></span>} />
    <DelayQueueClient canSend={(DELAY_SENDERS as readonly string[]).includes(context.role)} canPrepare={["owner", "admin", "sales_manager"].includes(context.role)} />
  </div>;
}
