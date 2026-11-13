import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { FloorsClient } from "@/components/modules/quote-sales/quote-sales";

// AP-072: floor conversion charges by alloy, finish and quantity band (internal only).
export default async function QuoteFloorsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "sales_manager", "sales"].includes(context.role)) redirect("/quotes");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Quotations</p><h1 className="text-2xl font-black">Floor prices</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">A quotation with a line below its floor cannot be approved for sending or sent until the owner approves those lines. Never shown to customers.</p></div>
    <FloorsClient canDecide={["owner", "admin"].includes(context.role)} />
  </div>;
}
