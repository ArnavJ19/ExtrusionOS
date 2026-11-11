import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { DraftJobsClient } from "@/components/modules/order-to-cash/draft-jobs";

// AP-045: draft production jobs prepared from confirmed orders, released by the planner.
export default async function DraftJobsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "production_manager", "factory_manager", "sales_manager"].includes(context.role)) redirect("/production");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Production</p><h1 className="text-2xl font-black">Draft jobs</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Every confirmed order line that still needs the press after stock and existing jobs. Review and release; no job is typed from scratch.</p></div>
    <DraftJobsClient />
  </div>;
}
