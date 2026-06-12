import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { OrdersDashboard } from "@/components/modules/dashboards/orders-dashboard";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function OrdersPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "orders")) redirect("/dashboard");

  const supabase = await createClient();
  const cid = context.companyId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const closedStages = ["dispatched", "delivered", "closed", "cancelled"];

  const [allOrders, recentOrders, monthlyOrders, delayedOrders, highPriority] = await Promise.all([
    supabase.from("orders").select("id, current_stage, priority, order_value, order_date, expected_dispatch_date, manufacturing_weight_kg", { count: "exact" }).eq("company_id", cid),
    supabase.from("orders").select("id, order_number, order_value, order_date, expected_dispatch_date, current_stage, priority, manufacturing_weight_kg, dealer_fulfilled_weight_kg, customers(customer_name, company_name)").eq("company_id", cid).order("created_at", { ascending: false }).limit(5),
    supabase.from("orders").select("id, order_value", { count: "exact" }).eq("company_id", cid).gte("order_date", monthStart).neq("current_stage", "cancelled"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", cid).lt("expected_dispatch_date", today).not("current_stage", "in", `(${closedStages.join(",")})`),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", cid).in("priority", ["urgent", "high"]).not("current_stage", "in", `(${closedStages.join(",")})`),
  ]);

  const rows = allOrders.data ?? [];
  const activeOrders = rows.filter((r: any) => !closedStages.includes(r.current_stage));
  const totalOrderValue = activeOrders.reduce((sum: number, r: any) => sum + Number(r.order_value ?? 0), 0);

  // Avg days to dispatch (from active orders with expected_dispatch_date)
  const withDispatch = activeOrders.filter((r: any) => r.order_date && r.expected_dispatch_date);
  const avgDays = withDispatch.length > 0
    ? Math.round(withDispatch.reduce((sum: number, r: any) => sum + Math.max(0, (new Date(r.expected_dispatch_date).getTime() - new Date(r.order_date).getTime()) / 86400000), 0) / withDispatch.length)
    : 0;

  // Stage breakdown
  const stageMap: Record<string, number> = {};
  for (const r of rows) { const s = (r as any).current_stage ?? "order_confirmed"; stageMap[s] = (stageMap[s] ?? 0) + 1; }
  const stageBreakdown = Object.entries(stageMap).map(([status, count]) => ({ status, count }));

  // Priority breakdown
  const priorityMap: Record<string, number> = {};
  for (const r of activeOrders) { const p = (r as any).priority ?? "normal"; priorityMap[p] = (priorityMap[p] ?? 0) + 1; }
  const priorityBreakdown = Object.entries(priorityMap).map(([priority, count]) => ({ priority, count })).sort((a, b) => {
    const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
  });

  const monthlyValue = (monthlyOrders.data ?? []).reduce((sum: number, r: any) => sum + Number(r.order_value ?? 0), 0);
  const blockedFactoryCount = activeOrders.filter((r: any) => Number(r.manufacturing_weight_kg ?? 0) > 0 && Number(r.manufacturing_weight_kg ?? 0) < 700).length;

  const orderTrend = rows.filter((o: any) => o.current_stage !== "cancelled").map((o: any) => ({
    date: o.order_date,
    value: Number(o.order_value ?? 0)
  }));

  const allOrdersData = rows.map((o: any) => ({
    status: o.current_stage,
    grand_total: Number(o.order_value ?? 0)
  }));

  return (
    <div className="space-y-2">
      <OrdersDashboard
        totalOrderValue={totalOrderValue}
        activeOrderCount={activeOrders.length}
        delayedCount={delayedOrders.count ?? 0}
        avgDaysToDispatch={avgDays}
        highPriorityCount={highPriority.count ?? 0}
        blockedFactoryCount={blockedFactoryCount}
        stageBreakdown={stageBreakdown}
        priorityBreakdown={priorityBreakdown}
        recentOrders={(recentOrders.data ?? []) as any}
        monthlyValue={monthlyValue}
        monthlyCount={monthlyOrders.count ?? 0}
        orderTrend={orderTrend}
        allOrders={allOrdersData}
      />
      <ModuleOverviewClient moduleKey="orders" context={context} canCreate={can(context.role, "create", "orders")} canUpdate={can(context.role, "update", "orders")} />
    </div>
  );
}
