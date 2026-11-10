import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ScrapStandardsClient } from "@/components/modules/press/scrap-standards-client";

// AP-013: owner-approved engineering scrap standards and the monthly scrap reconciliation.
export default async function ScrapStandardsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "factory_manager", "production_manager", "production", "inventory_manager"].includes(context.role)) redirect("/production");
  const supabase = await createClient();
  const { data } = await supabase.from("machines").select("id, machine_name").eq("company_id", context.companyId).eq("machine_type", "extrusion_press").eq("is_active", true).order("machine_name").limit(50);
  const presses = (data ?? []).map((row: { id: string; machine_name: string | null }) => ({ id: row.id, name: row.machine_name ?? "Press" }));
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Production</p><h1 className="text-2xl font-black">Scrap standards</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">Butt end, crops, saw kerf and cut-off are calculated from these approved standards on every push, so operators record only rejects and recovery % needs no typed scrap.</p></div>
    <ScrapStandardsClient presses={presses} canWeigh={["owner", "admin", "factory_manager", "production_manager", "inventory_manager"].includes(context.role)} />
  </div>;
}
