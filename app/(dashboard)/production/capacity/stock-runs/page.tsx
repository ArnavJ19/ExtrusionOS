import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StockRunsClient } from "@/components/modules/autopilot-batch10/stock-runs";
import { getSessionContext } from "@/lib/auth";
import { STOCK_RUN_ROLES } from "@/lib/autopilot-batch10/commands";

// AP-068: make-to-stock suggestions for idle press capacity.
export default async function StockRunsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(STOCK_RUN_ROLES as readonly string[]).includes(context.role)) redirect("/production/capacity");
  return <div className="space-y-5">
    <PageHeader title="Make-to-stock runs" description="When presses have free capacity, fast-moving profiles below their target stock are suggested. The owner or planner approves." actions={<Link href="/production/capacity" className="text-sm font-bold underline">Back to capacity</Link>} />
    <StockRunsClient />
  </div>;
}
