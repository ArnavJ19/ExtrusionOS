"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Boxes, AlertTriangle, PackageX, Layers, BarChart3, ShieldAlert } from "lucide-react";
import { CardContent, CollapsibleCard, CardHeader } from "@/components/ui/card";
import { StatCard, DonutChart, TaskCard } from "@/components/modules/dashboard-primitives";
import { NumberTicker } from "@/components/ui/number-ticker";

type InventoryRow = { id: string; item_code: string; item_name: string; item_category: string; current_stock: number; reorder_level: number; unit: string };

type Props = {
  totalItems: number;
  belowReorderCount: number;
  outOfStockCount: number;
  categoriesActive: number;
  categoryBreakdown: { category: string; count: number }[];
  lowStockItems: InventoryRow[];
  healthCounts: { critical: number; low: number; healthy: number };
  allItems: InventoryRow[];
};

const categoryColors: Record<string, string> = {
  billets: "#4338CA", profiles: "#0D9488", hardware: "#B45309",
  packing_material: "#6D28D9", finished_goods: "#059669", scrap: "#BE123C",
  consumables: "#0284C7", tools: "#D97706",
};

export function InventoryDashboard({
  totalItems,
  belowReorderCount,
  outOfStockCount,
  categoriesActive,
  categoryBreakdown,
  lowStockItems,
  healthCounts,
  allItems,
}: Props) {
  const nonEmpty = categoryBreakdown.filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
  const total = nonEmpty.reduce((sum, c) => sum + c.count, 0);
  const healthTotal = healthCounts.critical + healthCounts.low + healthCounts.healthy;

  // Category Risk Profile
  const categoryRiskProfile = useMemo(() => {
    const riskMap: Record<string, { total: number; low: number }> = {};
    allItems.forEach((item) => {
      const cat = item.item_category || "uncategorized";
      if (!riskMap[cat]) riskMap[cat] = { total: 0, low: 0 };
      riskMap[cat].total++;
      if (Number(item.current_stock ?? 0) <= Number(item.reorder_level ?? 0)) {
        riskMap[cat].low++;
      }
    });

    return Object.entries(riskMap).map(([category, stats]) => {
      const pct = Math.round((stats.low / stats.total) * 100);
      return {
        category,
        total: stats.total,
        low: stats.low,
        pct,
        color: pct > 50 ? "bg-rose-500" : pct > 20 ? "bg-amber-500" : "bg-emerald-500",
      };
    }).sort((a, b) => b.pct - a.pct);
  }, [allItems]);

  return (
    <div className="space-y-6 mb-8">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Boxes} label="Total Items" rawValue={totalItems} change={`${categoriesActive} categories`} comparison="Active inventory items" tone="blue" />
        <StatCard icon={AlertTriangle} label="Below Reorder" rawValue={belowReorderCount} change={belowReorderCount > 0 ? "Attention" : "Clear"} comparison="Items below reorder level" tone={belowReorderCount > 0 ? "yellow" : "green"} />
        <StatCard icon={PackageX} label="Out of Stock" rawValue={outOfStockCount} change={outOfStockCount > 0 ? "Critical" : "Clear"} comparison="Zero stock items" tone={outOfStockCount > 0 ? "rose" : "green"} />
        <StatCard icon={Layers} label="Categories" rawValue={categoriesActive} change="Active" comparison="Distinct item categories" tone="purple" />
      </div>

      {/* Visualizations Grid */}
      <div className="grid gap-6 xl:grid-cols-3">
        {/* Category Distribution */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Distribution</p>
                <h2 className="section-title mt-1">Items by Category</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-6 py-2">
              <DonutChart total={total} segments={nonEmpty.map((c) => c.count)} colors={nonEmpty.map((c) => categoryColors[c.category] ?? "#94A3B8")} />
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 w-full mt-2">
                {nonEmpty.slice(0, 6).map((item) => (
                  <div key={item.category} className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: categoryColors[item.category] ?? "#94A3B8" }} />
                      <span className="text-xs font-semibold text-slate-600 truncate">{item.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    </div>
                    <div className="pl-4 flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-sm font-bold text-slate-900">{item.count}</span>
                      <span className="text-[10px] font-medium text-slate-400">({total > 0 ? Math.round((item.count / total) * 100) : 0}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </CollapsibleCard>

        {/* Stock Health */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Health</p>
                <h2 className="section-title mt-1">Stock Health Overview</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6 py-4">
              {[
                { label: "Critical (out of stock)", count: healthCounts.critical, color: "#BE123C" },
                { label: "Low (below reorder)", count: healthCounts.low, color: "#B45309" },
                { label: "Healthy", count: healthCounts.healthy, color: "#0D9488" },
              ].map((item) => (
                <div key={item.label} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-600">{item.label}</span>
                    <span className="text-slate-900 font-bold"><NumberTicker value={item.count} duration={600} /></span>
                  </div>
                  <div className="relative h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out" style={{ width: `${Math.max((item.count / Math.max(healthTotal, 1)) * 100, item.count > 0 ? 2 : 0)}%`, backgroundColor: item.color }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleCard>

        {/* Category Risk Profile */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Alert Rates</p>
                <h2 className="section-title mt-1">Category Stock Risk</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 py-2">
              {categoryRiskProfile.slice(0, 5).map((item) => (
                <div key={item.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-600 truncate max-w-[140px]">{item.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    <span className="text-slate-900 font-bold">{item.pct}% <span className="text-slate-400 font-medium">({item.low}/{item.total} low)</span></span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${item.color}`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
        {/* Alerts */}
        <CollapsibleCard>
          <CardHeader><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Alerts</p><h2 className="section-title mt-1">Needs Attention</h2></div></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <TaskCard title="Out of Stock" value={outOfStockCount} href="/inventory/database" tone={outOfStockCount > 0 ? "critical" : "ok"} />
              <TaskCard title="Below Reorder Level" value={belowReorderCount} href="/inventory/database" tone={belowReorderCount > 0 ? "warning" : "ok"} />
            </div>
          </CardContent>
        </CollapsibleCard>

        {/* Low Stock Watchlist */}
        <CollapsibleCard>
          <CardHeader><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Watchlist</p><h2 className="section-title mt-1">Lowest Stock Items</h2></div></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {lowStockItems.length ? lowStockItems.map((item) => {
                const stockPct = Math.min(100, Math.max(8, (Number(item.current_stock ?? 0) / Math.max(Number(item.reorder_level ?? 1), 1)) * 100));
                const isZero = Number(item.current_stock ?? 0) <= 0;
                return (
                  <Link key={item.id} href={`/inventory/${item.id}`} className="block rounded-2xl border border-neutral-100 p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-950">{item.item_code}</p>
                        <p className="mt-1 truncate text-xs font-medium text-neutral-500">{item.item_name}</p>
                      </div>
                      <Boxes className="h-4 w-4 text-neutral-400 shrink-0" />
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-neutral-100">
                      <div className={`h-full max-w-full rounded-full ${isZero ? "bg-[#f43f5e]" : "bg-[#eab308]"}`} style={{ width: `${stockPct}%` }} />
                    </div>
                    <p className="mt-2 text-xs font-semibold text-neutral-500">{Number(item.current_stock ?? 0).toLocaleString("en-IN")} {item.unit} / reorder {Number(item.reorder_level ?? 0).toLocaleString("en-IN")}</p>
                  </Link>
                );
              }) : <div className="empty-mini">All inventory items are healthy.</div>}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>
    </div>
  );
}
