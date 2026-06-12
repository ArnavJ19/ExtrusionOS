"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { Factory, CalendarDays, Weight, CheckCircle2, Cog, Layers, BarChart3 } from "lucide-react";
import { CardContent, CollapsibleCard, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard, DonutChart, ProgressItem, TaskCard, MiniMetric } from "@/components/modules/dashboard-primitives";
import { TogglableBarChart } from "./togglable-bar-chart";
import { formatDate, formatWeight } from "@/lib/utils/format";

type JobRow = { id: string; job_number: string; status: string; planned_date?: string; planned_quantity_kg: number; actual_quantity_kg?: number; machine?: { machine_name?: string }; order?: { order_number?: string; customers?: { customer_name?: string; company_name?: string } }; profile?: { profile_code?: string } };

type Props = {
  totalJobs: number;
  todayJobCount: number;
  plannedQuantityKg: number;
  completedMtdCount: number;
  overdueCount: number;
  noMachineCount: number;
  statusBreakdown: { status: string; count: number }[];
  recentJobs: JobRow[];
  monthlyCompletedKg: number;
  monthlyCount: number;
  productionTrend: { date: string; value: number }[];
  allJobs: { machine_name: string; planned_quantity_kg: number; actual_quantity_kg: number; status: string }[];
};

const statusColors: Record<string, string> = {
  planned: "#4338CA", in_progress: "#B45309", completed: "#0D9488",
  on_hold: "#6D28D9", cancelled: "#94A3B8",
};

export function ProductionDashboard({
  totalJobs,
  todayJobCount,
  plannedQuantityKg,
  completedMtdCount,
  overdueCount,
  noMachineCount,
  statusBreakdown,
  recentJobs,
  monthlyCompletedKg,
  monthlyCount,
  productionTrend,
  allJobs,
}: Props) {
  const nonEmpty = statusBreakdown.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const total = nonEmpty.reduce((sum, s) => sum + s.count, 0);

  // Machine Workload Share
  const machineShare = useMemo(() => {
    const shareMap: Record<string, number> = {};
    let totalWeight = 0;

    allJobs.forEach((j) => {
      // Use actual weight for completed jobs, else planned weight
      const weight = j.status === "completed" ? j.actual_quantity_kg : j.planned_quantity_kg;
      const name = j.machine_name || "Unassigned";
      shareMap[name] = (shareMap[name] ?? 0) + weight;
      totalWeight += weight;
    });

    const safeTotalWeight = totalWeight || 1;

    return Object.entries(shareMap).map(([name, weight]) => ({
      name,
      weight,
      pct: Math.round((weight / safeTotalWeight) * 100),
    })).sort((a, b) => b.weight - a.weight);
  }, [allJobs]);

  const machineTotalWeight = machineShare.reduce((sum, m) => sum + m.weight, 0);

  return (
    <div className="space-y-6 mb-8">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Factory} label="Total Jobs" rawValue={totalJobs} change={`${monthlyCount} this month`} comparison="Active production jobs" tone="blue" />
        <StatCard icon={CalendarDays} label="Today's Floor" rawValue={todayJobCount} change="Live" comparison="Jobs scheduled for today" tone="purple" />
        <StatCard icon={Weight} label="Planned Qty" rawValue={Math.round(plannedQuantityKg)} change="kg" comparison="Total planned quantity" tone="yellow" />
        <StatCard icon={CheckCircle2} label="Completed (MTD)" rawValue={completedMtdCount} change={`${Math.round(monthlyCompletedKg).toLocaleString("en-IN")} kg`} comparison="Jobs completed this month" tone="green" />
      </div>

      {/* Main Charts Row */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TogglableBarChart
            data={productionTrend}
            title="Production Output Trend"
            subtitle="Completed actual production weight over time (weekly/monthly/yearly)"
            valueType="weight"
            color="#0d9488"
            hoverColor="#14b8a6"
          />
        </div>

        {/* Machine Workload Share */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cog className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Logistics</p>
                <h2 className="section-title mt-1">Machine Workload</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 py-2">
              {machineShare.slice(0, 5).map((item) => (
                <ProgressItem
                  key={item.name}
                  icon={Cog}
                  label={item.name}
                  value={Math.round(item.weight)}
                  total={machineTotalWeight}
                  color="bg-teal-600"
                />
              ))}
              {!machineShare.length && <div className="text-xs text-neutral-400 text-center py-4">No machine workload data.</div>}
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
                <h2 className="section-title mt-1">Jobs by Status</h2>
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

        {/* Output Metrics */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Output</p>
                <h2 className="section-title mt-1">Production Metrics</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 py-2">
              <MiniMetric label="Monthly Jobs" value={monthlyCount} />
              <MiniMetric label="Monthly Output" value={`${Math.round(monthlyCompletedKg).toLocaleString("en-IN")} kg`} />
              <MiniMetric label="Today's Jobs" value={todayJobCount} />
              <MiniMetric label="Planned Qty" value={`${Math.round(plannedQuantityKg).toLocaleString("en-IN")} kg`} />
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
              <TaskCard title="Overdue Jobs" value={overdueCount} href="/production/database" tone={overdueCount > 0 ? "critical" : "ok"} />
              <TaskCard title="No Machine Assigned" value={noMachineCount} href="/production/database" tone={noMachineCount > 0 ? "warning" : "ok"} />
            </div>
          </CardContent>
        </CollapsibleCard>

        {/* Recent Jobs */}
        <CollapsibleCard>
          <CardHeader><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Activity</p><h2 className="section-title mt-1">Recent Jobs</h2></div></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentJobs.length ? recentJobs.map((job) => (
                <Link key={job.id} href={`/production/${job.id}`} className="group flex items-center justify-between gap-4 rounded-2xl border border-neutral-100 bg-white p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-950 group-hover:underline">{job.job_number}</p>
                    <p className="mt-1 truncate text-xs font-medium text-neutral-500">{job.order?.order_number ?? "—"} · {job.machine?.machine_name ?? "No machine"} · {formatDate(job.planned_date)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge value={job.status} />
                    <p className="mt-2 text-sm font-bold text-neutral-950">{formatWeight(job.planned_quantity_kg)}</p>
                  </div>
                </Link>
              )) : <div className="empty-mini">No recent production jobs.</div>}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>
    </div>
  );
}
