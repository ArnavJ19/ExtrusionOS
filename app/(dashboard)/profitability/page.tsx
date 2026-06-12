"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, IndianRupee, TrendingDown, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { aggregate, DIMENSIONS, grossMargin, marginPct, totalCost, type AggRow, type CostEntry, type Dimension, type ProfitAlert } from "./data";

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-red-50", text: "text-red-800", border: "border-red-200" },
  warning: { bg: "bg-amber-50", text: "text-amber-800", border: "border-amber-200" },
  info: { bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-200" },
};

function fmt(v: number) { return v >= 100000 ? `Rs ${(v / 100000).toFixed(1)}L` : `Rs ${(v / 1000).toFixed(0)}K`; }
function fmtPct(v: number) { return `${v.toFixed(1)}%`; }

function SortIcon({ col, sortBy, sortDir }: { col: string; sortBy: string; sortDir: "asc" | "desc" }) {
  if (sortBy !== col) return null;
  return <span>{sortDir === "desc" ? "↓" : "↑"}</span>;
}

export default function ProfitabilityPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<CostEntry[]>([]);
  const [alerts, setAlerts] = useState<ProfitAlert[]>([]);
  const [dimension, setDimension] = useState<Dimension>("customer");
  const [sortBy, setSortBy] = useState<"revenue" | "margin" | "marginPct">("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [alertFilter, setAlertFilter] = useState<"all" | "critical" | "warning" | "info">("all");
  const [ackLoadingId, setAckLoadingId] = useState<string | null>(null);

  async function loadProfitability() {
    setLoading(true);
    setError("");
    const [entryRes, alertRes] = await Promise.all([
      supabase.from("order_cost_breakdown").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("profitability_alerts").select("*").order("created_at", { ascending: false }).limit(300)
    ]);
    if (entryRes.error || alertRes.error) {
      setError(entryRes.error?.message || alertRes.error?.message || "Failed to load profitability data");
    }
    setEntries((entryRes.data ?? []) as CostEntry[]);
    setAlerts((alertRes.data ?? []) as ProfitAlert[]);
    setLoading(false);
  }

  useEffect(() => {
    loadProfitability();
  }, []);

  const rows = useMemo(() => {
    const agg = aggregate(entries, dimension);
    return agg.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [entries, dimension, sortBy, sortDir]);

  const totals = useMemo(() => ({
    revenue: entries.reduce((s, e) => s + Number(e.revenue || 0), 0),
    cost: entries.reduce((s, e) => s + Number(totalCost(e) || 0), 0),
    margin: entries.reduce((s, e) => s + Number(grossMargin(e) || 0), 0),
    weight: entries.reduce((s, e) => s + Number(e.total_weight_kg || 0), 0),
    avgMarginPct: entries.length ? entries.reduce((s, e) => s + marginPct(e), 0) / entries.length : 0,
    avgPayDays: entries.length ? Math.round(entries.reduce((s, e) => s + Number(e.payment_days || 0), 0) / entries.length) : 0,
    scrapTotal: entries.reduce((s, e) => s + Number(e.scrap_cost || 0), 0),
    activeAlerts: alerts.filter((a) => !a.is_acknowledged).length
  }), [entries, alerts]);

  const filteredAlerts = useMemo(() => alerts.filter((a) => alertFilter === "all" || a.severity === alertFilter), [alerts, alertFilter]);

  const handleSort = (col: "revenue" | "margin" | "marginPct") => {
    if (sortBy === col) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  async function acknowledgeAlert(alertId: string) {
    setAckLoadingId(alertId);
    const { error: updateError } = await supabase.from("profitability_alerts").update({ is_acknowledged: true }).eq("id", alertId);
    if (updateError) {
      setError(updateError.message);
      setAckLoadingId(null);
      return;
    }
    setAlerts((current) => current.map((item) => item.id === alertId ? { ...item, is_acknowledged: true } : item));
    setAckLoadingId(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Profitability Intelligence" description="Real order-level cost intelligence and margin alerts from live ERP records." />
      <QueryErrorNotice messages={error ? [error] : []} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {[
          { label: "Revenue", value: fmt(totals.revenue), icon: IndianRupee, color: "text-blue-600", accent: "bg-blue-50" },
          { label: "Total Cost", value: fmt(totals.cost), icon: BarChart3, color: "text-slate-600", accent: "bg-slate-50" },
          { label: "Gross Margin", value: fmt(totals.margin), icon: TrendingUp, color: "text-green-600", accent: "bg-green-50" },
          { label: "Avg Margin %", value: fmtPct(totals.avgMarginPct), icon: TrendingUp, color: totals.avgMarginPct >= 20 ? "text-green-600" : "text-amber-600", accent: totals.avgMarginPct >= 20 ? "bg-green-50" : "bg-amber-50" },
          { label: "Total Weight", value: `${(totals.weight / 1000).toFixed(1)}T`, icon: BarChart3, color: "text-indigo-600", accent: "bg-indigo-50" },
          { label: "Avg Pay Days", value: `${totals.avgPayDays}d`, icon: TrendingDown, color: totals.avgPayDays > 60 ? "text-red-600" : "text-slate-600", accent: totals.avgPayDays > 60 ? "bg-red-50" : "bg-slate-50" },
          { label: "Scrap Loss", value: fmt(totals.scrapTotal), icon: AlertTriangle, color: "text-red-600", accent: "bg-red-50" },
          { label: "Active Alerts", value: String(totals.activeAlerts), icon: AlertTriangle, color: "text-amber-600", accent: "bg-amber-50" },
        ].map((item) => (
          <Card key={item.label}><CardContent className="p-3"><div className="mb-1 flex items-center gap-1.5"><div className={`h-6 w-6 ${item.accent} flex items-center justify-center rounded-lg`}><item.icon className={`h-3 w-3 ${item.color}`} /></div><p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{item.label}</p></div><p className="text-lg font-black text-slate-900">{item.value}</p></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase text-slate-500">Analyze by:</span>
        <div className="flex flex-wrap gap-1.5">
          {DIMENSIONS.map((d) => (
            <button key={d} onClick={() => setDimension(d)} className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize transition ${dimension === d ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{d}</button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {loading ? <LoadingState title="Loading profitability" description="Fetching cost breakdown and margin analytics." /> : rows.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 capitalize">{dimension}</th>
                  <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Orders</th>
                  <th className="cursor-pointer select-none px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" onClick={() => handleSort("revenue")}><span className="inline-flex items-center gap-1">Revenue <SortIcon col="revenue" sortBy={sortBy} sortDir={sortDir} /></span></th>
                  <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Cost</th>
                  <th className="cursor-pointer select-none px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" onClick={() => handleSort("margin")}><span className="inline-flex items-center gap-1">Margin <SortIcon col="margin" sortBy={sortBy} sortDir={sortDir} /></span></th>
                  <th className="cursor-pointer select-none px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500" onClick={() => handleSort("marginPct")}><span className="inline-flex items-center gap-1">Margin % <SortIcon col="marginPct" sortBy={sortBy} sortDir={sortDir} /></span></th>
                  <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Scrap</th>
                  <th className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Pay Days</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: AggRow) => (
                  <tr key={row.key} className={`border-b last:border-0 ${row.marginPct < 0 ? "bg-red-50/50" : "hover:bg-slate-50/50"}`}>
                    <td className="px-4 py-3 font-bold text-slate-900">{row.key}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{row.orders}</td>
                    <td className="px-3 py-3 text-right font-bold text-slate-900">{fmt(row.revenue)}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{fmt(row.totalCost)}</td>
                    <td className={`px-3 py-3 text-right font-black ${row.margin >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(row.margin)}</td>
                    <td className={`px-3 py-3 text-right font-bold ${row.marginPct >= 20 ? "text-green-700" : row.marginPct >= 0 ? "text-amber-700" : "text-red-700"}`}>{fmtPct(row.marginPct)}</td>
                    <td className={`px-3 py-3 text-right ${row.revenue > 0 && row.scrapCost / row.revenue > 0.03 ? "font-bold text-red-600" : "text-slate-600"}`}>{fmt(row.scrapCost)}</td>
                    <td className={`px-3 py-3 text-right ${row.avgPayDays > 60 ? "font-bold text-red-600" : "text-slate-600"}`}>{row.avgPayDays}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState title="No profitability records found" description="Start capturing order cost breakdown records to enable real margin analytics." />}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black text-slate-900">Profitability Alerts</h2>
        <div className="flex gap-1">
          {(["all", "critical", "warning", "info"] as const).map((f) => (
            <button key={f} onClick={() => setAlertFilter(f)} className={`rounded-full px-2.5 py-1 text-[10px] font-bold capitalize transition ${alertFilter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{f}</button>
          ))}
        </div>
      </div>

      {loading ? <LoadingState title="Loading alerts" description="Fetching profitability alerts." /> : filteredAlerts.length ? (
        <div className="space-y-2">
          {filteredAlerts.map((alert) => {
            const color = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.info;
            return (
              <div key={alert.id} className={`rounded-xl border p-4 ${color.border} ${color.bg} ${alert.is_acknowledged ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${color.bg} ${color.text} ${color.border}`}>{alert.severity}</span>
                      <span className="text-[10px] font-bold capitalize text-slate-500">{alert.alert_type.replace(/_/g, " ")}</span>
                      <Badge value={alert.entity_type} />
                    </div>
                    <p className={`text-sm font-black ${color.text}`}>{alert.entity_name}</p>
                    <p className="mt-1 text-xs text-slate-600">{alert.description}</p>
                  </div>
                  {alert.is_acknowledged ? (
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <Button onClick={() => acknowledgeAlert(alert.id)} disabled={ackLoadingId === alert.id} variant="ghost">{ackLoadingId === alert.id ? "Saving..." : "Acknowledge"}</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyState title="No alerts found" description="Profitability risk alerts will appear when thresholds are breached." />}
    </div>
  );
}
