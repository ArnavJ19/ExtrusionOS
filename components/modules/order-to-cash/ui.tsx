"use client";

// Shared pieces for the order-to-cash screens (Autopilot batch 3): a loader for one gateway read, a 10-row pager, status
// pills and the section frame. Every read and write goes through the allow-listed gateway (lib/actions/autopilot).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { autopilotAction } from "@/lib/actions/autopilot";

export function useApRead<T>(rpc: string, command: string, payload: Record<string, unknown>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(payload);
  const depKey = JSON.stringify(deps);
  const reload = useCallback(async () => {
    setLoading(true);
    const result = await autopilotAction(rpc, command, JSON.parse(key));
    setLoading(false);
    if (!result.success) { setError(result.error); return; }
    setError(null); setData(result.data as T);
  }, [rpc, command, key, depKey]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

/** Runs one write and reports its message; returns the data on success. */
export async function apWrite<T = unknown>(rpc: string, command: string, payload: Record<string, unknown>, setMessage: (m: { tone: "ok" | "error"; text: string } | null) => void, ok?: string) {
  const result = await autopilotAction(rpc, command, payload);
  if (!result.success) { setMessage({ tone: "error", text: result.error }); return null; }
  if (ok) setMessage({ tone: "ok", text: ok });
  return result.data as T;
}

export function Message({ value }: { value: { tone: "ok" | "error"; text: string } | null }) {
  if (!value) return null;
  return <p role={value.tone === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm font-semibold ${value.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{value.text}</p>;
}

export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 10));
  if (total <= 10) return <p className="text-xs text-neutral-500">{total} record{total === 1 ? "" : "s"}</p>;
  return <div className="flex items-center justify-between gap-2 text-sm">
    <span className="text-neutral-600">Page {page} of {pages} · {total} records</span>
    <div className="flex gap-1">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="min-h-10 rounded-lg border border-neutral-300 bg-white px-2 disabled:opacity-40"><ChevronLeft size={16} /></button>
      <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="min-h-10 rounded-lg border border-neutral-300 bg-white px-2 disabled:opacity-40"><ChevronRight size={16} /></button>
    </div>
  </div>;
}

const TONES: Record<string, string> = {
  held: "bg-amber-50 text-amber-900", approved: "bg-emerald-50 text-emerald-800", rejected: "bg-rose-50 text-rose-800", cleared: "bg-neutral-100 text-neutral-700",
  open: "bg-sky-50 text-sky-900", blocked: "bg-rose-50 text-rose-800", posted: "bg-emerald-50 text-emerald-800", cancelled: "bg-neutral-100 text-neutral-700",
  released: "bg-emerald-50 text-emerald-800", covered: "bg-neutral-100 text-neutral-700", removed: "bg-neutral-100 text-neutral-700",
  exact: "bg-emerald-50 text-emerald-800", likely: "bg-amber-50 text-amber-900", unknown: "bg-neutral-100 text-neutral-700",
  unmatched: "bg-neutral-100 text-neutral-700", proposed: "bg-sky-50 text-sky-900", receipted: "bg-emerald-50 text-emerald-800", ignored: "bg-neutral-100 text-neutral-700",
  prepared: "bg-sky-50 text-sky-900", sent: "bg-emerald-50 text-emerald-800", skipped: "bg-neutral-100 text-neutral-700", superseded: "bg-neutral-100 text-neutral-700",
  passed: "bg-emerald-50 text-emerald-800", not_checked: "bg-neutral-100 text-neutral-700", approved_cover: "bg-emerald-50 text-emerald-800"
};
export function Pill({ value, label }: { value: string; label?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${TONES[value] ?? "bg-neutral-100 text-neutral-700"}`}>{label ?? value.replaceAll("_", " ")}</span>;
}

export function Section({ id, title, description, actions, children }: { id?: string; title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <section id={id} className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h2 className="text-base font-black">{title}</h2>{description ? <p className="mt-0.5 text-sm text-neutral-600">{description}</p> : null}</div>
      {actions}
    </div>
    {children}
  </section>;
}

export const inputClass = "min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-sm";
export const buttonClass = "min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50";
export const secondaryClass = "min-h-11 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold disabled:opacity-50";

export function Loading({ what }: { what: string }) { return <p role="status" className="text-sm text-neutral-600">Loading {what}…</p>; }
export function Empty({ children }: { children: ReactNode }) { return <p className="rounded-xl bg-neutral-50 px-3 py-4 text-sm text-neutral-600">{children}</p>; }
export function Failure({ text }: { text: string }) { return <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{text}</p>; }
