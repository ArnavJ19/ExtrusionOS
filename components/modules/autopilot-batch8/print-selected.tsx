"use client";

// AP-091: select rows on a database page and print their documents as one PDF. Selection is kept across pages (up to
// 50). On the dispatch database a single-day date filter offers that day's challans in one action. The server authorises
// every record; if any cannot be printed, nothing is merged and the reasons are shown.
import { useState } from "react";
import { Printer } from "lucide-react";

export type PrintKind = "invoice" | "quote" | "challan" | "job_card";
export const PRINT_LABEL: Record<PrintKind, { one: string; many: string }> = {
  invoice: { one: "invoice", many: "invoices" }, quote: { one: "quotation", many: "quotations" }, challan: { one: "challan", many: "challans" }, job_card: { one: "job card", many: "job cards" }
};
export const MAX_PRINT = 50;

export function usePrintSelection() {
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const toggle = (id: string, label: string) => setSelected(current => {
    const next = new Map(current);
    if (next.has(id)) next.delete(id); else if (next.size < MAX_PRINT) next.set(id, label);
    return next;
  });
  const setMany = (rows: { id: string; label: string }[], on: boolean) => setSelected(current => {
    const next = new Map(current);
    for (const row of rows) { if (!on) next.delete(row.id); else if (next.size < MAX_PRINT) next.set(row.id, row.label); }
    return next;
  });
  return { selected, toggle, setMany, clear: () => setSelected(new Map()) };
}

async function openPdf(body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string; problems?: string[] }> {
  // Opened before the request so the browser does not block it as a pop-up.
  const tab = window.open("", "_blank");
  try {
    const response = await fetch("/api/pdf/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      tab?.close();
      const data = await response.json().catch(() => ({})) as { error?: string; problems?: string[] };
      return { ok: false, error: data.error ?? "The documents could not be printed.", problems: data.problems };
    }
    const url = URL.createObjectURL(await response.blob());
    if (tab) tab.location.href = url; else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { ok: true };
  } catch {
    tab?.close();
    return { ok: false, error: "The documents could not be printed. Check your connection and retry." };
  }
}

export function PrintSelectedBar({ kind, selection, pageRows, singleDay }: { kind: PrintKind; selection: ReturnType<typeof usePrintSelection>; pageRows: { id: string; label: string }[]; singleDay?: string | null }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<{ text: string; problems?: string[] } | null>(null);
  const count = selection.selected.size;
  const allOnPage = pageRows.length > 0 && pageRows.every(row => selection.selected.has(row.id));
  async function print(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const result = await openPdf(body);
    setBusy(false);
    if (!result.ok) setError({ text: result.error, problems: result.problems });
  }
  const dayLabel = singleDay ? new Date(`${singleDay}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }) : null;
  return <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm" aria-label={`Print ${PRINT_LABEL[kind].many}`}>
    <label className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3"><input type="checkbox" checked={allOnPage} disabled={!pageRows.length} onChange={e => selection.setMany(pageRows, e.target.checked)} /> Select this page</label>
    <button type="button" disabled={busy || !count} onClick={() => void print({ kind, ids: [...selection.selected.keys()] })} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-neutral-950 px-3 font-semibold text-white disabled:opacity-50">
      <Printer className="h-4 w-4" />{busy ? "Preparing…" : `Print selected${count ? ` (${count})` : ""}`}</button>
    {count ? <button type="button" onClick={selection.clear} className="min-h-10 rounded-xl border border-neutral-200 bg-white px-3 font-semibold">Clear selection</button> : null}
    {kind === "challan" && singleDay ? <button type="button" disabled={busy} onClick={() => void print({ kind, date: singleDay })} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 font-semibold disabled:opacity-50">
      <Printer className="h-4 w-4" />Print all challans for {dayLabel}</button> : null}
    {count >= MAX_PRINT ? <span className="text-xs text-amber-800">Up to {MAX_PRINT} at a time.</span> : null}
    {error ? <div role="alert" className="w-full rounded-xl bg-amber-50 px-3 py-2 text-amber-900"><p className="font-semibold">{error.text}</p>{error.problems?.length ? <ul className="mt-1 list-disc pl-5 text-xs">{error.problems.map(p => <li key={p}>{p}</li>)}</ul> : null}</div> : null}
  </div>;
}

export function SelectCheckbox({ id, label, selection }: { id: string; label: string; selection: ReturnType<typeof usePrintSelection> }) {
  const checked = selection.selected.has(id);
  return <input type="checkbox" className="h-5 w-5" aria-label={`Select ${label} for printing`} checked={checked} disabled={!checked && selection.selected.size >= MAX_PRINT}
    onClick={event => event.stopPropagation()} onChange={() => selection.toggle(id, label)} />;
}
