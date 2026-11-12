import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { PackingClient } from "@/components/modules/dispatch-autopilot/packing";

// AP-035: packing standard and deviations.
export default async function Page() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "sales_manager", "quality", "production_manager"].includes(context.role)) redirect("/dispatches");
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Dispatches</p><h1 className="text-2xl font-black">Packing standard</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Bundle limits and packaging per customer, deviations from the standard, and packaging material used against standard.</p></div>
    <PackingClient canEditSpec={["owner", "admin", "sales_manager", "dispatch_manager", "factory_manager", "quality"].includes(context.role)} />
  </div>;
}
