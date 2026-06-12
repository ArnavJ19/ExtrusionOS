"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { FileText, CircleDollarSign, Clock, TrendingUp, Filter, BarChart3, Layers, Plus, Database } from "lucide-react";
import { CardContent, CollapsibleCard, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard, DonutChart, TaskCard } from "@/components/modules/dashboard-primitives";
import { TogglableBarChart } from "./togglable-bar-chart";
import { formatCurrency, formatDate } from "@/lib/utils/format";

type QuoteRow = { id: string; quote_number: string; grand_total: number; quote_date: string; valid_until?: string; status: string; customers?: { customer_name?: string; company_name?: string } };

type Props = {
  canCreate: boolean;
  totalPipelineValue: number;
  activeQuoteCount: number;
  convertedCount: number;
  totalQuoteCount: number;
  expiringCount: number;
  pendingApprovalCount: number;
  statusBreakdown: { status: string; count: number }[];
  recentQuotes: QuoteRow[];
  monthlyCount: number;
  salesHistory: { date: string; value: number }[];
  allQuotes: { status: string; grand_total: number }[];
};

const statusColors: Record<string, string> = {
  draft: "#475569", internal_review: "#6D28D9", approved_for_sending: "#4338CA",
  sent: "#0284C7", customer_approved: "#0D9488", customer_rejected: "#BE123C",
  converted_to_order: "#059669", expired: "#94A3B8",
};

export function QuotesDashboard({
  canCreate,
  totalPipelineValue,
  activeQuoteCount,
  convertedCount,
  totalQuoteCount,
  expiringCount,
  pendingApprovalCount,
  statusBreakdown,
  recentQuotes,
  monthlyCount,
  salesHistory,
  allQuotes,
}: Props) {
  const conversionRate = totalQuoteCount > 0 ? Math.round((convertedCount / totalQuoteCount) * 100) : 0;
  const nonEmpty = statusBreakdown.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const total = nonEmpty.reduce((sum, s) => sum + s.count, 0);

  // Conversion Funnel calculation
  const funnel = useMemo(() => {
    const totalQ = allQuotes.length || 1;
    const sent = allQuotes.filter((q) => ["sent", "customer_approved", "converted_to_order"].includes(q.status)).length;
    const approved = allQuotes.filter((q) => ["customer_approved", "converted_to_order"].includes(q.status)).length;
    const converted = allQuotes.filter((q) => q.status === "converted_to_order").length;

    return [
      { stage: "Created", count: allQuotes.length, pct: 100, color: "bg-slate-500" },
      { stage: "Sent to Client", count: sent, pct: Math.round((sent / totalQ) * 100), color: "bg-sky-500" },
      { stage: "Approved", count: approved, pct: Math.round((approved / totalQ) * 100), color: "bg-teal-500" },
      { stage: "Converted to Order", count: converted, pct: Math.round((converted / totalQ) * 100), color: "bg-emerald-600" },
    ];
  }, [allQuotes]);

  // Quote Value Distribution
  const valueDistribution = useMemo(() => {
    const buckets = [
      { label: "< ₹50K", min: 0, max: 50000, count: 0, color: "bg-slate-400" },
      { label: "₹50K - ₹2L", min: 50000, max: 200000, count: 0, color: "bg-blue-400" },
      { label: "₹2L - ₹10L", min: 200000, max: 1000000, count: 0, color: "bg-indigo-400" },
      { label: "₹10L - ₹50L", min: 1000000, max: 5000000, count: 0, color: "bg-purple-400" },
      { label: "₹50L+", min: 5000000, max: Infinity, count: 0, color: "bg-emerald-500" },
    ];

    allQuotes.forEach((q) => {
      const val = q.grand_total;
      for (const b of buckets) {
        if (val >= b.min && val < b.max) {
          b.count++;
          break;
        }
      }
    });

    const totalQ = allQuotes.length || 1;
    return buckets.map((b) => ({ ...b, pct: Math.round((b.count / totalQ) * 100) }));
  }, [allQuotes]);

  return (
    <div className="space-y-6 mb-8">
      <div className="flex flex-col gap-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Quote Workspace</p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Create and manage quotations</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Start a new aluminium quote or open the full searchable quote database.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {canCreate ? <Link href="/quotes/new" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 hover:shadow-md"><Plus className="h-4 w-4" /> Create Quote</Link> : null}
          <Link href="/quotes/database" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"><Database className="h-4 w-4" /> View Quotes Database</Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CircleDollarSign} label="Active Pipeline Value" rawValue={totalPipelineValue} isCurrency change={`${monthlyCount} quotes this month`} comparison="Open quotes only" tone="purple" />
        <StatCard icon={FileText} label="Active Quotes" rawValue={activeQuoteCount} change="Live" comparison="Quotes in progress" tone="blue" />
        <StatCard icon={TrendingUp} label="Conversion Rate" rawValue={conversionRate} change={`${convertedCount} converted`} comparison={`Of ${totalQuoteCount} total quotes`} tone="green" />
        <StatCard icon={Clock} label="Expiring Soon" rawValue={expiringCount} change={expiringCount > 0 ? "Attention" : "Clear"} comparison="Quotes expiring within 7 days" tone={expiringCount > 0 ? "yellow" : "green"} />
      </div>

      {/* Main Charts Row */}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TogglableBarChart
            data={salesHistory}
            title="Sales Performance"
            subtitle="Total value of quotes converted to orders and confirmed"
            valueType="currency"
            color="#059669"
            hoverColor="#10b981"
          />
        </div>

        {/* Quote Conversion Funnel */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Filter className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Funnel Analysis</p>
                <h2 className="section-title mt-1">Quote Conversion Funnel</h2>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 py-2">
              {funnel.map((item) => (
                <div key={item.stage} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-600">{item.stage}</span>
                    <span className="text-slate-900 font-bold">{item.count} <span className="text-slate-400 font-medium">({item.pct}%)</span></span>
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

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Status Distribution */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Layers className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Distribution</p>
                <h2 className="section-title mt-1">Quote Status Breakdown</h2>
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

        {/* Value Distribution */}
        <CollapsibleCard>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4.5 w-4.5 text-slate-500" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Value Bands</p>
                <h2 className="section-title mt-1">Quote Value Distribution</h2>
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
              <TaskCard title="Expiring Quotes" value={expiringCount} href="/quotes/database?status=sent" tone={expiringCount > 0 ? "critical" : "ok"} />
              <TaskCard title="Pending Approval" value={pendingApprovalCount} href="/quotes/database?status=internal_review" tone={pendingApprovalCount > 0 ? "warning" : "ok"} />
            </div>
          </CardContent>
        </CollapsibleCard>

        {/* Recent Quotes */}
        <CollapsibleCard>
          <CardHeader><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Activity</p><h2 className="section-title mt-1">Recent Quotes</h2></div></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentQuotes.length ? recentQuotes.map((quote) => (
                <Link key={quote.id} href={`/quotes/${quote.id}`} className="group flex items-center justify-between gap-4 rounded-2xl border border-neutral-100 bg-white p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-950 group-hover:underline">{quote.quote_number}</p>
                    <p className="mt-1 truncate text-xs font-medium text-neutral-500">{quote.customers?.company_name || quote.customers?.customer_name || "Customer"} · {formatDate(quote.quote_date)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge value={quote.status} />
                    <p className="mt-2 text-sm font-bold text-neutral-950">{formatCurrency(quote.grand_total)}</p>
                  </div>
                </Link>
              )) : <div className="empty-mini">No recent quotes.</div>}
            </div>
          </CardContent>
        </CollapsibleCard>
      </div>
    </div>
  );
}
