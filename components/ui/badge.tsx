import { cn } from "@/lib/utils/cn";
import { labelize } from "@/types/app";

const toneMap: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  dispatched: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  trial: "bg-sky-50 text-sky-700 ring-sky-200",
  normal: "bg-sky-50 text-sky-700 ring-sky-200",
  sent: "bg-sky-50 text-sky-700 ring-sky-200",
  correction: "bg-orange-50 text-orange-700 ring-orange-200",
  high: "bg-orange-50 text-orange-700 ring-orange-200",
  urgent: "bg-red-50 text-red-700 ring-red-200",
  dead: "bg-red-50 text-red-700 ring-red-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  delayed: "bg-red-50 text-red-700 ring-red-200",
  overdue: "bg-red-50 text-red-700 ring-red-200",
  out_of_stock: "bg-red-50 text-red-700 ring-red-200",
  low_stock: "bg-orange-50 text-orange-700 ring-orange-200",
  nitriding: "bg-violet-50 text-violet-700 ring-violet-200",
  draft: "bg-aluminium text-slate-700 ring-slate-300",
  inactive: "bg-aluminium text-slate-600 ring-slate-300",
  low: "bg-aluminium text-slate-600 ring-slate-300",
  converted_to_order: "bg-emerald-50 text-emerald-700 ring-emerald-200"
};

export function Badge({ value, className }: { value: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] ring-1", toneMap[value] ?? "bg-aluminium text-slate-700 ring-slate-300", className)}>{labelize(value)}</span>;
}
