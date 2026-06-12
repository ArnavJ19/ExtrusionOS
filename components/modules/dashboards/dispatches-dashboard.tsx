"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Truck, PackageCheck, Weight, Ship, Layers, BarChart3 } from "lucide-react";
import { CardContent, CollapsibleCard, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard, DonutChart, ProgressItem, TaskCard, MiniMetric } from "@/components/modules/dashboard-primitives";
import { TogglableBarChart } from "./togglable-bar-chart";
import { formatDate, formatWeight } from "@/lib/utils/format";

type DispatchRow = { id: string; dispatch_number: string; dispatch_date: string; delivery_status: string; total_weight_kg: number; vehicle_number?: string; transporter_name?: string; orders?: { order_number?: string; customers?: { customer_name?: string; company_name?: string } } };

type Props = {
  totalDispatches: number;
  inTransitCount: number;
  deliveredCount: number;
  totalWeightMtd: number;
  pendingPickupCount: number;
  statusBreakdown: { status: string; count: number }[];
  recentDispatches: DispatchRow[];
  monthlyCount: number;
  monthlyWeight: number;
  weightTrend: { date: string; value: number }[];
  allDispatches: { transporter_name: string; total_weight_kg: number }[];
};

const statusColors: Record<string, string> = {
  dispatched: "#4338CA", in_transit: "#B45309", delivered: "#0D9488",
  delayed: "#BE123C", returned: "#F43F5E", cancelled: "#94A3B8",
};

export function DispatchesDashboard({
  totalDispatches,
  inTransitCount,
  deliveredCount,
  totalWeightMtd,
  pendingPickupCount,
  statusBreakdown,
  recentDispatches,
  monthlyCount,
  monthlyWeight,
  weightTrend,
  allDispatches,
}: Props) {
  const nonEmpty = statusBreakdown.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const total = nonEmpty.reduce((sum, s) => sum + s.count, 0);

  // Transporter Share Breakdown
  const transporterShare = useMemo(() => {
    const shareMap: Record<string, number> = {};
    let totalWeight = 0;

    allDispatches.forEach((d) => {
      const name = d.transporter_name || "Self/Pickup";
      shareMap[name] = (shareMap[name] ?? 0) + Number(d.total_weight_kg ?? 0);
      totalWeight += Number(d.total_weight_kg ?? 0);
    });

    const safeTotalWeight = totalWeight || 1;

    return Object.entries(shareMap).map(([name, weight]) => ({
      name,
      weight,
      pct: Math.round((weight / safeTotalWeight) * 100),
    })).sort((a, b) => b.weight - a.weight);
  }, [allDispatches]);

  const transporterTotalWeight = transporterShare.reduce((sum, t) => sum + t.weight, 0);

  return (
    <div className="space-y-6 mb-8">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Truck} label="Total Dispatches" rawValue={totalDispatches} change={`${monthlyCount} this month`} comparison="All-time dispatches" tone="blue" />
        <StatCard icon={Ship} label="In Transit" rawValue={inTransitCount} change="Live" comparison="Currently on the road" tone="yellow" />
        <StatCard icon={PackageCheck} label="Delivered" rawValue={deliveredCount} change="Completed" comparison="Successfully delivered" tone="green" />
        <StatCard icon={Weight} label="Weight Shipped (MTD)" rawValue={Math.round(totalWeightMtd)} change="kg" comparison={`${monthlyCount} shipments this month`} tone="purple" />
      </div>

      {/* Main Charts Row */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TogglableBarChart
            data={weightTrend}
            title="Dispatch Weight Trend"
            subtitle="Total weight dispatched over time (weekly/monthly/yearly)"
            valueType="weight"
            color="#0891b2"
            hoverColor="#06b6d4"
          />
        </div>

        {/* Transporter Share */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Truck className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Logistics</p>
                <h2 className="section-title mt-1">Transporter Share</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 py-2">
              {transporterShare.slice(0, 5).map((item) => (
                <ProgressItem
                  key={item.name}
                  icon={Truck}
                  label={item.name}
                  value={Math.round(item.weight)}
                  total={transporterTotalWeight}
                  color="bg-cyan-600"
                />
              ))}
              {!transporterShare.length && <div className="text-xs text-neutral-400 text-center py-4">No transporter data.</div>}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Status Distribution */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Distribution</p>
                <h2 className="section-title mt-1">Delivery Status Breakdown</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
              <DonutChart total={total} segments={nonEmpty.map((s) => s.count)} colors={nonEmpty.map((s) => statusColors[s.status] ?? "#94A3B8")} />
              <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3 w-full">
                {nonEmpty.map((item) => (
                  <div key={item.status} className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColors[item.status] ?? "#94A3B8" }} />
                      <span className="text-xs font-semibold text-slate-600 truncate">{item.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
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

        {/* Logistics Metrics */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Metrics</p>
                <h2 className="section-title mt-1">Logistics Summary</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 py-2">
              <MiniMetric label="Monthly Shipments" value={monthlyCount} />
              <MiniMetric label="Monthly Weight" value={`${Math.round(monthlyWeight).toLocaleString("en-IN")} kg`} />
              <MiniMetric label="In Transit" value={inTransitCount} />
              <MiniMetric label="Pending Pickup" value={pendingPickupCount} />
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
              <TaskCard title="Pending Pickup" value={pendingPickupCount} href="/dispatches/database?status=dispatched" tone={pendingPickupCount > 0 ? "warning" : "ok"} />
              <TaskCard title="In Transit" value={inTransitCount} href="/dispatches/database?status=in_transit" tone={inTransitCount > 3 ? "warning" : "ok"} />
            </div>
          </CardContent>
        </CollapsibleCard>

        {/* Recent Dispatches */}
        <CollapsibleCard>
          <CardHeader><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Activity</p><h2 className="section-title mt-1">Recent Dispatches</h2></div></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentDispatches.length ? recentDispatches.map((d) => (
                <Link key={d.id} href={`/dispatches/${d.id}`} className="group flex items-center justify-between gap-4 rounded-2xl border border-neutral-100 bg-white p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-950 group-hover:underline">{d.dispatch_number}</p>
                    <p className="mt-1 truncate text-xs font-medium text-neutral-500">{d.orders?.order_number ?? "—"} · {d.vehicle_number || d.transporter_name || "Vehicle TBD"} · {formatDate(d.dispatch_date)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge value={d.delivery_status} />
                    <p className="mt-2 text-sm font-bold text-neutral-950">{formatWeight(d.total_weight_kg)}</p>
                  </div>
                </Link>
              )) : <div className="empty-mini">No recent dispatches.</div>}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>
    </div>
  );
}
