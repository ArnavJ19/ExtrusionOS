"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ShoppingCart, CircleDollarSign, Clock, AlertTriangle, Zap, BarChart3, Layers } from "lucide-react";
import { CardContent, CollapsibleCard, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard, DonutChart, ProgressItem, TaskCard } from "@/components/modules/dashboard-primitives";
import { TogglableBarChart } from "./togglable-bar-chart";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";

type OrderRow = { id: string; order_number: string; order_value: number; order_date: string; expected_dispatch_date?: string; current_stage: string; priority: string; manufacturing_weight_kg?: number; dealer_fulfilled_weight_kg?: number; customers?: { customer_name?: string; company_name?: string } };

type Props = {
  totalOrderValue: number;
  activeOrderCount: number;
  delayedCount: number;
  avgDaysToDispatch: number;
  highPriorityCount: number;
  blockedFactoryCount: number;
  stageBreakdown: { status: string; count: number }[];
  priorityBreakdown: { priority: string; count: number }[];
  recentOrders: OrderRow[];
  monthlyValue: number;
  monthlyCount: number;
  orderTrend: { date: string; value: number }[];
  allOrders: { status: string; grand_total: number }[];
};

const stageColors: Record<string, string> = {
  order_confirmed: "#4338CA", die_ready: "#6D28D9", billet_ready: "#7C3AED",
  billet_heating: "#B45309", extrusion_planned: "#0284C7", extruded: "#0D9488",
  stretching: "#059669", cutting: "#0891B2", aging: "#D97706",
  surface_treatment: "#8B5CF6", finishing: "#6366F1", packing: "#EAB308",
  payment_pending: "#F43F5E", dispatched: "#10B981", delivered: "#0D9488",
  closed: "#475569", cancelled: "#94A3B8",
};

export function OrdersDashboard({
  totalOrderValue,
  activeOrderCount,
  delayedCount,
  avgDaysToDispatch,
  highPriorityCount,
  blockedFactoryCount,
  stageBreakdown,
  priorityBreakdown,
  recentOrders,
  monthlyCount,
  orderTrend,
  allOrders,
}: Props) {
  const nonEmpty = stageBreakdown.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const total = nonEmpty.reduce((sum, s) => sum + s.count, 0);
  const priorityTotal = priorityBreakdown.reduce((sum, p) => sum + p.count, 0);

  // Order Value Distribution
  const valueDistribution = useMemo(() => {
    const buckets = [
      { label: "< ₹1L", min: 0, max: 100000, count: 0, color: "bg-slate-400" },
      { label: "₹1L - ₹5L", min: 100000, max: 500000, count: 0, color: "bg-blue-400" },
      { label: "₹5L - ₹15L", min: 500000, max: 1500000, count: 0, color: "bg-indigo-400" },
      { label: "₹15L - ₹50L", min: 1500000, max: 5000000, count: 0, color: "bg-purple-400" },
      { label: "₹50L+", min: 5000000, max: Infinity, count: 0, color: "bg-emerald-500" },
    ];

    allOrders.forEach((o) => {
      const val = o.grand_total;
      for (const b of buckets) {
        if (val >= b.min && val < b.max) {
          b.count++;
          break;
        }
      }
    });

    const totalO = allOrders.length || 1;
    return buckets.map((b) => ({ ...b, pct: Math.round((b.count / totalO) * 100) }));
  }, [allOrders]);

  return (
    <div className="space-y-6 mb-8">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CircleDollarSign} label="Booked Revenue" rawValue={totalOrderValue} isCurrency change={`${monthlyCount} this month`} comparison="Total active order value" tone="green" />
        <StatCard icon={ShoppingCart} label="Active Orders" rawValue={activeOrderCount} change="Live" comparison="Orders in pipeline" tone="blue" />
        <StatCard icon={Clock} label="Avg Days to Dispatch" rawValue={avgDaysToDispatch} change="days" comparison="Average from order to dispatch" tone="purple" />
        <StatCard icon={AlertTriangle} label="Delayed Orders" rawValue={delayedCount} change={delayedCount > 0 ? "Attention" : "Clear"} comparison="Past expected dispatch date" tone={delayedCount > 0 ? "rose" : "green"} />
      </div>

      {/* Main Charts Row */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TogglableBarChart
            data={orderTrend}
            title="Revenue Booking Trend"
            subtitle="Value of confirmed orders booked over time"
            valueType="currency"
            color="#4338ca"
            hoverColor="#4f46e5"
          />
        </div>

        {/* Priority Mix */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Priority</p>
                <h2 className="section-title mt-1">Priority Mix</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 py-2">
              {priorityBreakdown.map((item) => (
                <ProgressItem key={item.priority} icon={Zap} label={item.priority.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} value={item.count} total={priorityTotal} color={item.priority === "urgent" ? "bg-rose-600" : item.priority === "high" ? "bg-amber-500" : item.priority === "normal" ? "bg-indigo-600" : "bg-slate-400"} />
              ))}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Stage Distribution Donut */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Stages</p>
                <h2 className="section-title mt-1">Orders by Stage</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
              <DonutChart total={total} segments={nonEmpty.map((s) => s.count)} colors={nonEmpty.map((s) => stageColors[s.status] ?? "#94A3B8")} />
              <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3 w-full">
                {nonEmpty.slice(0, 8).map((item) => (
                  <div key={item.status} className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: stageColors[item.status] ?? "#94A3B8" }} />
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

        {/* Order Value Distribution */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Bands</p>
                <h2 className="section-title mt-1">Order Value Distribution</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 py-2">
              {valueDistribution.map((item) => (
                <div key={item.label} className="grid grid-cols-[80px_1fr_40px] items-center gap-3">
                  <span className="text-xs font-semibold text-slate-600">{item.label}</span>
                  <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${item.color}`} style={{ width: `${item.pct}%` }} />
                  </div>
                  <span className="text-right text-xs font-bold text-slate-900">{item.count}</span>
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
              <TaskCard title="Delayed Orders" value={delayedCount} href="/orders/database" tone={delayedCount > 0 ? "critical" : "ok"} />
              <TaskCard title="High Priority" value={highPriorityCount} href="/orders/database?status=order_confirmed" tone={highPriorityCount > 0 ? "warning" : "ok"} />
              <TaskCard title="Below Factory Minimum" value={blockedFactoryCount} href="/orders/database" tone={blockedFactoryCount > 0 ? "critical" : "ok"} />
            </div>
          </CardContent>
        </CollapsibleCard>

        {/* Recent Orders */}
        <CollapsibleCard>
          <CardHeader><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Activity</p><h2 className="section-title mt-1">Recent Orders</h2></div></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentOrders.length ? recentOrders.map((order) => (
                <Link key={order.id} href={`/orders/${order.id}`} className="group flex items-center justify-between gap-4 rounded-2xl border border-neutral-100 bg-white p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-950 group-hover:underline">{order.order_number}</p>
                    <p className="mt-1 truncate text-xs font-medium text-neutral-500">{order.customers?.company_name || order.customers?.customer_name || "Customer"} · Dispatch {formatDate(order.expected_dispatch_date)}</p>
                    <p className="mt-1 text-[10px] font-bold text-neutral-400">Factory {formatWeight(order.manufacturing_weight_kg ?? 0)} · Dealer fulfilled {formatWeight(order.dealer_fulfilled_weight_kg ?? 0)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge value={order.current_stage} />
                    <p className="mt-2 text-sm font-bold text-neutral-950">{formatCurrency(order.order_value)}</p>
                  </div>
                </Link>
              )) : <div className="empty-mini">No recent orders.</div>}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>
    </div>
  );
}
