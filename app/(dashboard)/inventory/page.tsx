import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { InventoryDashboard } from "@/components/modules/dashboards/inventory-dashboard";
import { ModuleDisabled } from "@/components/ui/module-disabled";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { DealerInventoryEntryClient } from "@/components/modules/dealer-inventory-entry-client";

export default async function InventoryPage() {
  const context = await getSessionContext();
  const supabase = await createClient();
  const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
  if (!isFeatureEnabled(flags, "advanced_inventory")) return <ModuleDisabled moduleName="advanced_inventory" title="Inventory" />;
  if (!can(context.role, "read", "inventory")) redirect("/dashboard");

  if (context.dealerId) {
    const [profiles, stock] = await Promise.all([
      supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m").eq("company_id", context.companyId).eq("is_active", true).order("profile_code").limit(500),
      supabase.from("profile_stock_batches").select("id, finish, length_m, quantity_pieces, total_weight_kg, bundle_number, location, status, aluminium_profiles(profile_code, profile_name)").eq("company_id", context.companyId).eq("dealer_id", context.dealerId).order("created_at", { ascending: false }).limit(100)
    ]);

    return (
      <div className="space-y-6">
        <PageHeader title="My Inventory" description="Dealer-scoped profile stock. Manual entries are saved only under your dealership and are not visible to other dealers." />
        <DealerInventoryEntryClient profiles={(profiles.data ?? []) as any} stock={(stock.data ?? []) as any} />
      </div>
    );
  }

  const cid = context.companyId;

  const [allItems, lowStockItems, reservations] = await Promise.all([
    supabase.from("inventory_items").select("id, item_code, item_name, item_category, current_stock, reorder_level, unit", { count: "exact" }).eq("company_id", cid),
    supabase.from("inventory_items").select("id, item_code, item_name, item_category, current_stock, reorder_level, unit").eq("company_id", cid).or("current_stock.lte.reorder_level").order("current_stock", { ascending: true }).limit(5),
    supabase.from("profile_stock_reservations").select("id", { count: "exact", head: true }).eq("company_id", cid).eq("status", "active"),
  ]);

  const rows = allItems.data ?? [];
  const totalItems = rows.length;
  const outOfStock = rows.filter((r: any) => Number(r.current_stock ?? 0) <= 0);
  const belowReorder = rows.filter((r: any) => Number(r.current_stock ?? 0) > 0 && Number(r.current_stock ?? 0) <= Number(r.reorder_level ?? 0));
  const healthy = rows.filter((r: any) => Number(r.current_stock ?? 0) > Number(r.reorder_level ?? 0));

  // Category breakdown
  const catMap: Record<string, number> = {};
  for (const r of rows) { const c = (r as any).item_category ?? "uncategorized"; catMap[c] = (catMap[c] ?? 0) + 1; }
  const categoryBreakdown = Object.entries(catMap).map(([category, count]) => ({ category, count }));

  const allItemsData = rows.map((r: any) => ({
    id: r.id,
    item_code: r.item_code,
    item_name: r.item_name,
    item_category: r.item_category,
    current_stock: Number(r.current_stock ?? 0),
    reorder_level: Number(r.reorder_level ?? 0),
    unit: r.unit
  }));

  return (
    <div className="space-y-2">
      <ModuleOverviewClient moduleKey="inventory" context={context} canCreate={can(context.role, "create", "inventory")} hideMetricsAndCharts={true}>
        <InventoryDashboard
          totalItems={totalItems}
          belowReorderCount={belowReorder.length}
          outOfStockCount={outOfStock.length}
          categoriesActive={Object.keys(catMap).length}
          categoryBreakdown={categoryBreakdown}
          lowStockItems={(lowStockItems.data ?? []) as any}
          healthCounts={{ critical: outOfStock.length, low: belowReorder.length, healthy: healthy.length }}
          allItems={allItemsData}
        />
      </ModuleOverviewClient>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Reservation Ledger</p><h2 className="section-title mt-1">Reserved Profile Stock</h2><p className="mt-1 text-sm font-medium text-slate-500">{reservations.count ?? 0} active stock reservation{(reservations.count ?? 0) === 1 ? "" : "s"} are holding profile stock against customer orders.</p></div>
          <Link href="/inventory/reservations" className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">Open Reservations</Link>
        </div>
      </div>
    </div>
  );
}
