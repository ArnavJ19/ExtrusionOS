import { FactoryLoadConsolidationClient } from "@/components/modules/factory-load-consolidation-client";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function FactoryLoadConsolidationPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "production")) redirect("/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("factory_load_consolidations")
    .select("id, manufacturing_weight_kg, minimum_weight_kg, compatibility_signature, compatibility_label, created_at, orders(order_number, priority, customers(company_name, customer_name))")
    .eq("company_id", context.companyId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const canRelease = ["owner", "admin", "factory_manager", "production_manager"].includes(context.role);
  return <div className="space-y-6"><PageHeader title="Factory Load Consolidation" description="Combine sub-700 kg manufacturing orders or release a documented manager exception before press work starts." />{error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error.message}</div> : <FactoryLoadConsolidationClient rows={(data ?? []) as any} canRelease={canRelease} />}</div>;
}
