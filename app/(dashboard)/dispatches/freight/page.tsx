import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { FreightCardsClient } from "@/components/modules/dispatch-autopilot/freight";

// AP-036: transporter rate cards and freight variance.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "dispatch_manager", "dispatch", "factory_manager", "sales_manager", "sales", "accounts"].includes(context.role)) redirect("/dispatches");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Dispatches</p><h1 className="text-2xl font-black">Freight rate cards</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Transporter rates by destination. Quotes, loads and dispatches propose freight from them. Internal only.</p></div>
    <FreightCardsClient />
  </div>;
}
