import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { PricesClient } from "@/components/modules/autopilot-batch7/prices";
import { PRICE_READERS } from "@/lib/autopilot-batch7/commands";

// AP-057: purchase lines priced above the last purchase price, and the variance threshold.
export default async function PurchasePricesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(PRICE_READERS as readonly string[]).includes(context.role)) redirect("/vendors");
  return <div className="space-y-5">
    <PageHeader title="Purchase price checks" description="Every purchase order line shows the last three prices for the same material. A line priced above the threshold needs a reason before the PO is issued."
      actions={<Link href="/vendors/purchasing" className="text-sm font-bold underline">Back to purchasing</Link>} />
    <PricesClient canSetThreshold={["owner", "admin"].includes(context.role)} />
  </div>;
}
