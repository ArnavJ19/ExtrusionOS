"use client";

import { useRef, useState, type ReactNode } from "react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { buttonClass, inputClass, secondaryClass } from "../order-to-cash/ui";

export type Note = { tone: "ok" | "error"; text: string } | null;
export type Queue<T> = { rows: T[]; page: number; total_count: number };

export const kg = (v: unknown, unit = "kg") => v === null || v === undefined || v === "" ? "Unknown" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`;
export const num = (v: unknown, digits = 3) => v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: digits });
export const pct = (v: unknown) => v === null || v === undefined || v === "" ? "—" : `${Number(v) > 0 ? "+" : ""}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

/** One write, with its result shown in the note. Returns the data on success. */
export async function write<T = unknown>(rpc: string, command: string, payload: Record<string, unknown>, set: (v: Note) => void, success: string): Promise<T | null> {
  const result = await autopilotAction(rpc, command, payload);
  set(result.success ? { tone: "ok", text: success } : { tone: "error", text: result.error });
  return result.success ? result.data as T : null;
}

export function Action({ children, run, disabled = false, secondary = false, label }: { children: ReactNode; run: () => Promise<void>; disabled?: boolean; secondary?: boolean; label?: string }) {
  const lock = useRef(false); const [busy, setBusy] = useState(false);
  return <button type="button" aria-label={label} className={secondary ? secondaryClass : buttonClass} disabled={busy || disabled} onClick={async () => {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await run(); } finally { lock.current = false; setBusy(false); }
  }}>{busy ? "Saving..." : children}</button>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block min-w-0 text-sm font-semibold">{label}<div className="mt-1">{children}</div>{hint ? <span className="mt-1 block text-xs font-normal text-neutral-500">{hint}</span> : null}</label>;
}
export function NumberInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input inputMode="decimal" className={inputClass} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />;
}
/** Text from an input as a number, or undefined when blank (blank stays blank, never zero). */
export const optional = (value: string) => value.trim() === "" ? undefined : Number(value);

export function Why({ value, title = "Calculation and source evidence" }: { value: unknown; title?: string }) {
  return <details className="text-xs text-neutral-600"><summary className="min-h-10 cursor-pointer py-2 font-semibold">{title}</summary><div className="max-h-72 overflow-auto break-words rounded-xl bg-neutral-50 p-3"><Evidence value={value} /></div></details>;
}
function Evidence({ value }: { value: unknown }) {
  if (value == null) return <span>Not recorded</span>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-2">{value.map((v, index) => <li key={index} className="border-l border-neutral-200 pl-2"><Evidence value={v} /></li>)}</ul> : <span>None</span>;
  if (typeof value === "object") return <dl className="space-y-1">{Object.entries(value).map(([k, v]) => <div key={k}><dt className="font-semibold capitalize">{k.replaceAll("_", " ")}</dt><dd className="ml-2"><Evidence value={v} /></dd></div>)}</dl>;
  return <span>{typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</span>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "bad" | "warn" | "ok" }) {
  const colour = tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-800" : tone === "ok" ? "text-emerald-700" : "text-neutral-950";
  return <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-3"><p className="text-xs font-semibold text-neutral-500">{label}</p><p className={`mt-1 break-words text-lg font-bold ${colour}`}>{value}</p></div>;
}

export function Filters({ search, setSearch, show, setShow, options = [["attention", "Needs attention"], ["all", "All"]], sort, setSort }: {
  search: string; setSearch: (v: string) => void; show: string; setShow: (v: string) => void; options?: [string, string][]; sort?: string; setSort?: (v: string) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-3">
    <Field label="Search"><input type="search" className={inputClass} value={search} maxLength={80} onChange={e => setSearch(e.target.value)} /></Field>
    <Field label="Show"><select className={inputClass} value={show} onChange={e => setShow(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
    {setSort ? <Field label="Sort by"><select className={inputClass} value={sort} onChange={e => setSort(e.target.value)}><option value="date">Priority</option><option value="name">Name</option></select></Field> : null}
  </div>;
}

/** Saves text as a downloaded file in the browser. */
export function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
