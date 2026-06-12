"use client";

import { useMemo } from "react";
import { labelize } from "@/types/app";

/**
 * Clean, sophisticated palette — muted but distinct.
 */
const toneColors: Record<string, string> = {
  // Teal -> Deep Teal
  active: "#0D9488", approved: "#0D9488", delivered: "#0D9488",
  dispatched: "#0D9488", converted_to_order: "#0D9488",
  completed: "#0D9488", paid: "#0D9488",
  // Blue -> Indigo
  trial: "#4338CA", normal: "#4338CA", sent: "#4338CA",
  pending: "#4338CA", planned: "#4338CA", in_transit: "#4338CA",
  // Amber -> Warm Gold
  correction: "#B45309", high: "#B45309",
  partially_paid: "#B45309", rework: "#B45309",
  // Rose -> Soft Crimson
  urgent: "#BE123C", dead: "#BE123C", rejected: "#BE123C",
  delayed: "#BE123C", overdue: "#BE123C",
  out_of_stock: "#BE123C", cancelled: "#BE123C",
  // Violet -> Deep Purple
  nitriding: "#6D28D9",
  // Slate -> Cool Gray
  draft: "#475569", inactive: "#475569", low: "#475569",
};

const fallbackPalette = ["#0284C7", "#E11D48", "#059669", "#7C3AED", "#D97706", "#0D9488", "#DB2777", "#475569"];

function getBarColor(status: string, index: number) {
  return toneColors[status] ?? fallbackPalette[index % fallbackPalette.length];
}

type BarData = { status: string; count: number };

export function StatusDistributionChart({ data, total }: { data: BarData[]; total: number }) {
  const nonEmpty = useMemo(() => data.filter((d) => d.count > 0).sort((a, b) => b.count - a.count), [data]);
  
  const conicGradient = useMemo(() => {
    const stops = nonEmpty.map((item, i) => {
      const start = nonEmpty.slice(0, i).reduce((sum, previous) => sum + (previous.count / total) * 100, 0);
      const end = start + (item.count / total) * 100;
      return `${getBarColor(item.status, i)} ${start}% ${end}%`;
    });
    return stops.join(", ");
  }, [nonEmpty, total]);

  if (total === 0 || nonEmpty.length === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
      <div className="relative shrink-0 flex items-center justify-center h-32 w-32 md:h-36 md:w-36 rounded-full shadow-[inset_0_-2px_10px_rgba(0,0,0,0.05)]" style={{ background: `conic-gradient(${conicGradient})` }}>
        {/* Inner circle to make it a donut */}
        <div className="absolute inset-0 m-auto h-24 w-24 md:h-28 md:w-28 rounded-full bg-white flex flex-col items-center justify-center shadow-[0_2px_10px_rgba(0,0,0,0.05)]">
          <span className="text-3xl font-black tracking-tight text-slate-800">{total}</span>
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total</span>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-3 w-full">
        {nonEmpty.map((item, i) => (
          <div key={item.status} className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: getBarColor(item.status, i) }} />
              <span className="text-xs font-semibold text-slate-600 truncate">{labelize(item.status)}</span>
            </div>
            <div className="pl-4 flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-bold text-slate-900">{item.count}</span>
              <span className="text-[10px] font-medium text-slate-400">({Math.round((item.count / total) * 100)}%)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PriorityBreakdownChart({ records }: { records: Record<string, any>[] }) {
  const priorities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of records) {
      const p = String(r.priority ?? "normal");
      map[p] = (map[p] ?? 0) + 1;
    }
    return Object.entries(map).sort(([a], [b]) => {
      const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      return (rank[a] ?? 9) - (rank[b] ?? 9);
    });
  }, [records]);

  if (priorities.length === 0) return null;
  const max = Math.max(...priorities.map(([, v]) => v), 1);

  return (
    <div className="space-y-4 py-2">
      {priorities.map(([priority, count]) => (
        <div key={priority} className="flex items-center gap-4">
          <span className="w-16 shrink-0 text-right text-xs font-semibold text-slate-600">{labelize(priority)}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${Math.max((count / max) * 100, 2)}%`, backgroundColor: getBarColor(priority, 0) }}
            />
          </div>
          <span className="w-8 shrink-0 text-sm font-bold text-slate-800">{count}</span>
        </div>
      ))}
    </div>
  );
}

export function ValueDistributionChart({ records, valueField = "order_value" }: { records: Record<string, any>[]; valueField?: string }) {
  const ranges = useMemo(() => {
    const buckets = [
      { label: "< ₹1L", min: 0, max: 100000, count: 0 },
      { label: "₹1–5L", min: 100000, max: 500000, count: 0 },
      { label: "₹5–10L", min: 500000, max: 1000000, count: 0 },
      { label: "₹10–25L", min: 1000000, max: 2500000, count: 0 },
      { label: "₹25L+", min: 2500000, max: Infinity, count: 0 },
    ];
    for (const r of records) {
      const v = Number(r[valueField] ?? 0);
      for (const b of buckets) {
        if (v >= b.min && v < b.max) { b.count++; break; }
      }
    }
    return buckets;
  }, [records, valueField]);

  const maxCount = Math.max(...ranges.map((b) => b.count), 1);

  return (
    <div className="space-y-4 py-2">
      {ranges.map((bucket) => (
        <div key={bucket.label} className="flex items-center gap-4">
          <span className="w-14 shrink-0 text-right text-xs font-semibold text-slate-600">{bucket.label}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${Math.max((bucket.count / maxCount) * 100, bucket.count > 0 ? 2 : 0)}%`, backgroundColor: "#f97316", opacity: bucket.count > 0 ? 1 : 0.2 }}
            />
          </div>
          <span className="w-8 shrink-0 text-sm font-bold text-slate-800">{bucket.count}</span>
        </div>
      ))}
    </div>
  );
}
