"use client";

// FS-77: every dictionary KPI for a period, from the one SQL path (public.fs_kpi), each with its definition one tap
// away. "Not captured" and "not measurable" are said in words, never shown as zero.
import { useState } from "react";
import { Info } from "lucide-react";
import { METRICS, type MetricDefinition } from "@/lib/insights/metrics";
import { businessToday } from "@/lib/utils/business-date";
import { Failure, Loading, Pill, Section, inputClass, useB4Read } from "./shared";

export type KpiItem = { value: number | null; numerator: number | null; denominator: number | null; unit: string; status: "measured" | "not_captured" | "not_measurable"; note: string | null };
type Values = Record<string, KpiItem> & { _period?: unknown };

export function kpiText(item: KpiItem | undefined) {
  if (!item) return "—";
  if (item.status === "not_measurable") return "Not measurable yet";
  if (item.status === "not_captured" || item.value === null) return "Not captured";
  const v = Number(item.value);
  if (item.unit === "INR") return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  if (item.unit === "%") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
  if (item.unit === "kg") return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
  return `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${item.unit}`;
}

/** The "i" beside a number: the dictionary definition and what it excludes. */
export function KpiInfo({ metric }: { metric: MetricDefinition }) {
  return <details className="group inline-block align-middle">
    <summary aria-label={`How ${metric.label} is calculated`} className="inline-flex min-h-8 min-w-8 cursor-pointer list-none items-center justify-center rounded-full text-neutral-500 hover:text-neutral-900"><Info size={15} /></summary>
    <div className="absolute z-10 mt-1 max-w-xs rounded-xl border border-neutral-200 bg-white p-3 text-xs font-normal text-neutral-700 shadow-lg">
      <p className="font-bold text-neutral-950">{metric.label}</p><p className="mt-1">{metric.definition}</p>
      {metric.excludes && metric.excludes !== "—" ? <p className="mt-1 text-neutral-500">Excludes: {metric.excludes}</p> : null}
    </div>
  </details>;
}

const ORDER = ["shipped_kg", "on_time_dispatch", "otif", "production_planned_kg", "production_completed_kg", "recovery", "process_scrap_percent", "scrap_kg", "qc_rejected_kg",
  "oee_quality", "oee_availability", "oee_performance", "oee", "kwh_per_tonne", "die_life_kg", "quote_win_rate", "order_intake", "collections", "receivables_outstanding",
  "receivables_overdue", "dso_days", "conversion_cost_per_tonne"];

export function KpiValues() {
  const today = businessToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const { data, error, loading } = useB4Read<Values>("fs_kpi", "values", { from, to }, [from, to]);
  const metricFor = (key: string) => Object.values(METRICS).find(m => (m as MetricDefinition).kpiKey === key) as MetricDefinition | undefined;
  return <Section title="KPI values" description="One definition per number, computed in one place. The same figures appear on Command Center and analytics."
    actions={<div className="flex flex-wrap gap-2">
      <label className="text-xs font-semibold">From<input type="date" className={inputClass} value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
      <label className="text-xs font-semibold">To<input type="date" className={inputClass} value={to} max={today} onChange={e => e.target.value && setTo(e.target.value)} /></label>
    </div>}>
    {loading && !data ? <Loading what="KPI values" /> : null}
    {error ? <Failure text={error} /> : null}
    {data ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {ORDER.filter(k => k in data).map(k => {
        const item = data[k] as KpiItem, metric = metricFor(k);
        return <div key={k} className="relative rounded-xl border border-neutral-200 p-3">
          <p className="flex items-center gap-1 text-xs font-bold uppercase text-neutral-500">{metric?.label ?? k.replaceAll("_", " ")}{metric ? <KpiInfo metric={metric} /> : null}</p>
          <p className="mt-1 text-xl font-black tabular-nums">{kpiText(item)}</p>
          {item.status !== "measured" ? <p className="mt-1"><Pill value={item.status === "not_measurable" ? "unknown" : "held"} label={item.status.replace("_", " ")} /></p> : null}
          {item.note ? <p className="mt-1 text-xs text-neutral-600">{item.note}</p> : null}
        </div>;
      })}
    </div> : null}
  </Section>;
}
