import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ScrapOffers } from "@/components/modules/autopilot-batch9/scrap-sales";
import { getSessionContext } from "@/lib/auth";
import { SCRAP_MANAGERS, SCRAP_READERS } from "@/lib/autopilot-batch9/commands";

// AP-074: scrap stock by grade, buyer offers and scrap sales.
export default async function ScrapSalesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(SCRAP_READERS as readonly string[]).includes(context.role)) redirect("/foundry");
  return <div className="space-y-5">
    <PageHeader title="Scrap sales" description="Surplus scrap by grade: offers from buyers, the weighbridge weight and the GST invoice. Scrap sent to the foundry and scrap sold are kept apart." actions={<Link href="/foundry" className="text-sm font-bold underline">Back to foundry</Link>} />
    <ScrapOffers canManage={(SCRAP_MANAGERS as readonly string[]).includes(context.role)} />
  </div>;
}
