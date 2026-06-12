"use client";

import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Wrench } from "lucide-react";
import { NumberTicker, CompactTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils/cn";
import type { LucideIcon } from "lucide-react";

/* ── Stat Card ────────────────────────────────────────────── */

export type StatTone = "green" | "purple" | "blue" | "yellow" | "rose" | "orange";

const toneClasses: Record<StatTone, string> = {
  green: "bg-emerald-50 text-emerald-600",
  purple: "bg-violet-50 text-violet-600",
  blue: "bg-sky-50 text-sky-600",
  yellow: "bg-yellow-50 text-yellow-600",
  rose: "bg-rose-50 text-rose-600",
  orange: "bg-orange-50 text-orange-600",
};

export function StatCard({ icon: Icon, label, rawValue, isCurrency, change, comparison, tone }: { icon: LucideIcon; label: string; rawValue: number; isCurrency?: boolean; change: string; comparison: string; tone: StatTone }) {
  return (
    <div className="group rounded-[20px] border border-[#eaeaea] bg-white p-5 shadow-[0_18px_45px_rgba(17,17,17,0.035)] transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_22px_50px_rgba(17,17,17,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-neutral-100 bg-neutral-50 text-neutral-500"><Icon className="h-4 w-4" /></span>
          <p className="text-sm font-semibold text-neutral-800">{label}</p>
        </div>
        <ChevronDown className="h-4 w-4 text-neutral-300" />
      </div>
      <div className="mt-8 flex items-end gap-3">
        <p className="text-4xl font-bold tracking-tight text-neutral-950">{isCurrency ? <CompactTicker value={rawValue} duration={1000} /> : <NumberTicker value={rawValue} duration={1000} />}</p>
        <span className={cn("mb-1 rounded-full px-2 py-1 text-[11px] font-bold", toneClasses[tone])}>{change}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-neutral-500">{comparison}</p>
    </div>
  );
}

/* ── Section Heading ──────────────────────────────────────── */

export function SectionHeading({ title, action, href }: { title: string; action?: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h3 className="text-base font-bold tracking-tight text-neutral-950">{title}</h3>
      {href ? <Link href={href} className="inline-flex items-center gap-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50">View all <ArrowRight className="h-3.5 w-3.5" /></Link> : null}
      {action ? <span className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700">{action}</span> : null}
    </div>
  );
}

/* ── Donut Chart ──────────────────────────────────────────── */

export function DonutChart({ total, segments, colors }: { total: number; segments: number[]; colors?: string[] }) {
  const safeTotal = Math.max(total, 1);
  const palette = colors ?? ["#8b5cf6", "#eab308", "#60a5fa", "#111111", "#0d9488", "#f43f5e", "#d97706", "#6366f1"];
  const gradient = segments.reduce<{ cursor: number; stops: string[] }>((acc, value, index) => {
    const start = acc.cursor;
    const end = start + (value / safeTotal) * 100;
    return { cursor: end, stops: [...acc.stops, `${palette[index % palette.length]} ${start}% ${end}%`] };
  }, { cursor: 0, stops: [] }).stops.join(", ");

  return (
    <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-full" style={{ background: `conic-gradient(${gradient || "#eeeeee 0% 100%"})` }}>
      <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-white shadow-inner">
        <p className="text-xs font-semibold text-neutral-400">Total</p>
        <p className="text-4xl font-bold tracking-tight text-neutral-950"><NumberTicker value={total} duration={800} /></p>
      </div>
    </div>
  );
}

/* ── Progress Item ────────────────────────────────────────── */

export function ProgressItem({ icon: Icon, label, value, total, color }: { icon: LucideIcon; label: string; value: number; total: number; color: string }) {
  return (
    <div className="grid grid-cols-[32px_1fr_auto] items-center gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-50 text-neutral-500 ring-1 ring-neutral-100"><Icon className="h-4 w-4" /></span>
      <div>
        <div className="h-2 rounded-full bg-neutral-100"><div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.round((value / Math.max(total, 1)) * 100))}%` }} /></div>
        <p className="mt-1 text-xs font-medium text-neutral-500">{label}</p>
      </div>
      <p className="text-sm font-bold text-neutral-950"><NumberTicker value={value} duration={600} /></p>
    </div>
  );
}

/* ── Mini Metric ──────────────────────────────────────────── */

export function MiniMetric({ label, value }: { label: string; value: string | number }) {
  const isNumeric = typeof value === "number";
  return (
    <div className="rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-neutral-950">{isNumeric ? <NumberTicker value={value} /> : value}</p>
    </div>
  );
}

/* ── Task Card ────────────────────────────────────────────── */

export function TaskCard({ title, value, href, tone }: { title: string; value: number; href: string; tone: "critical" | "warning" | "ok" }) {
  const accent = tone === "critical" ? "text-[#f43f5e] bg-rose-50" : tone === "warning" ? "text-[#eab308] bg-yellow-50" : "text-[#22c55e] bg-emerald-50";
  return (
    <Link href={href} className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-100 p-4 transition hover:border-neutral-200 hover:bg-neutral-50">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-2xl", accent)}>{tone === "ok" ? <Check className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}</span>
        <div>
          <p className="text-sm font-semibold text-neutral-950">{title}</p>
          <p className="text-xs font-medium text-neutral-500">Needs review</p>
        </div>
      </div>
      <p className="text-xl font-bold text-neutral-950"><NumberTicker value={value} duration={600} /></p>
    </Link>
  );
}

/* ── Event Item ───────────────────────────────────────────── */

export function EventItem({ time, title, meta, accent }: { time: string; title: string; meta: string; accent: string }) {
  return (
    <div className="relative rounded-2xl border border-neutral-100 bg-white p-4 pl-5 transition hover:border-neutral-200 hover:bg-neutral-50">
      <span className={cn("absolute left-0 top-4 h-10 w-1 rounded-r-full", accent)} />
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-400">{time}</p>
      <p className="mt-2 text-sm font-semibold text-neutral-950">{title}</p>
      <p className="mt-1 text-xs font-medium text-neutral-500">{meta}</p>
    </div>
  );
}

/* ── Activity Grid ────────────────────────────────────────── */

export function ActivityGrid({ title, active }: { title: string; active: number }) {
  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-neutral-700">{title}</p>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 28 }).map((_, index) => (
          <span key={index} className={cn("h-4 rounded-md bg-neutral-100", index < Math.min(active, 28) && (index % 5 === 0 ? "bg-[#60a5fa]" : "bg-[#8b5cf6]"))} />
        ))}
      </div>
    </div>
  );
}
