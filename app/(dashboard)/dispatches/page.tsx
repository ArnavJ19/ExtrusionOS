import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { DispatchesDashboard } from "@/components/modules/dashboards/dispatches-dashboard";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DispatchesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dispatches")) redirect("/dashboard");

  const supabase = await createClient();
  const cid = context.companyId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [allDispatches, recentDispatches, monthlyDispatches] = await Promise.all([
    supabase.from("dispatches").select("id, delivery_status, total_weight_kg, dispatch_date, transporter_name", { count: "exact" }).eq("company_id", cid),
    supabase.from("dispatches").select("id, dispatch_number, dispatch_date, delivery_status, total_weight_kg, vehicle_number, transporter_name, orders(order_number, customers(customer_name, company_name))").eq("company_id", cid).order("dispatch_date", { ascending: false }).limit(5),
    supabase.from("dispatches").select("id, total_weight_kg", { count: "exact" }).eq("company_id", cid).gte("dispatch_date", monthStart),
  ]);

  const rows = allDispatches.data ?? [];
  const inTransit = rows.filter((r: any) => r.delivery_status === "in_transit");
  const delivered = rows.filter((r: any) => r.delivery_status === "delivered");
  const pendingPickup = rows.filter((r: any) => r.delivery_status === "dispatched");

  // Status breakdown
  const statusMap: Record<string, number> = {};
  for (const r of rows) { const s = (r as any).delivery_status ?? "dispatched"; statusMap[s] = (statusMap[s] ?? 0) + 1; }
  const statusBreakdown = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

  const monthlyRows = monthlyDispatches.data ?? [];
  const totalWeightMtd = monthlyRows.reduce((sum: number, r: any) => sum + Number(r.total_weight_kg ?? 0), 0);
  const monthlyWeight = totalWeightMtd;

  const weightTrend = rows.filter((d: any) => d.delivery_status !== "cancelled").map((d: any) => ({
    date: d.dispatch_date,
    value: Number(d.total_weight_kg ?? 0)
  }));

  const allDispatchesData = rows.map((d: any) => ({
    transporter_name: d.transporter_name || "Self/Pickup",
    total_weight_kg: Number(d.total_weight_kg ?? 0)
  }));

  return (
    <div className="space-y-2">
      <DispatchesDashboard
        totalDispatches={rows.length}
        inTransitCount={inTransit.length}
        deliveredCount={delivered.length}
        totalWeightMtd={totalWeightMtd}
        pendingPickupCount={pendingPickup.length}
        statusBreakdown={statusBreakdown}
        recentDispatches={(recentDispatches.data ?? []) as any}
        monthlyCount={monthlyDispatches.count ?? 0}
        monthlyWeight={monthlyWeight}
        weightTrend={weightTrend}
        allDispatches={allDispatchesData}
      />
      <ModuleOverviewClient moduleKey="dispatches" context={context} canCreate={can(context.role, "create", "dispatches")} canUpdate={can(context.role, "update", "dispatches")} />
    </div>
  );
}
