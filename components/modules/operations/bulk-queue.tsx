"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bulkQueueAction } from "@/lib/actions/bulk-queue";
import { BULK_LIMIT, expectedFromPreview, outcomeText, summariseOutcome, type BulkChange, type BulkOutcome } from "@/lib/workflow/bulk-queue";

export type BulkRow = { id: string; label: string; detail: string; href: string };
type Option = { value: string; label: string };
type ActionConfig = { action: string; label: string; input: "employee" | "date" | "priority" | "text" };

const tone: Record<string, string> = {
  will_change: "text-emerald-700", changed: "text-emerald-700", unchanged: "text-slate-500", rejected: "text-red-700", unavailable: "text-red-700", duplicate_selection: "text-amber-700"
};

// UPGRADE_EOS feature 13: select, preview every record's outcome, then apply.
export function BulkQueue({ target, rows, actions, employees = [] }: { target: "tasks" | "production_jobs"; rows: BulkRow[]; actions: ActionConfig[]; employees?: Option[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState(actions[0].action);
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<BulkOutcome | null>(null);
  const [result, setResult] = useState<BulkOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);
  const config = actions.find((item) => item.action === action) ?? actions[0];
  const labels = useMemo(() => new Map(rows.map((row) => [row.id, row.label])), [rows]);
  const change = { target, action, value: value.trim() } as BulkChange;

  function reset() { setPreview(null); setResult(null); setError(""); setUncertain(false); requestId.current = null; }
  function toggle(id: string) {
    reset();
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= BULK_LIMIT ? current : [...current, id]);
  }

  async function runPreview() {
    setBusy(true); setError(""); setResult(null);
    const response = await bulkQueueAction({ command: "bulk.preview", change, ids: selected });
    setBusy(false);
    if (!response.success) { setError(response.error); return; }
    setPreview(response.data as BulkOutcome);
    requestId.current = null;
  }

  async function runApply() {
    if (!preview) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true); setError("");
    const response = await bulkQueueAction({ command: "bulk.apply", change, ids: selected, expected: expectedFromPreview(preview), request_id: requestId.current });
    setBusy(false);
    if (!response.success) { setError(response.error); setUncertain(response.uncertain === true); if (!response.uncertain) requestId.current = null; return; }
    setResult(response.data as BulkOutcome); setPreview(null); setUncertain(false); requestId.current = null; setSelected([]);
    router.refresh();
  }

  const counts = preview ? summariseOutcome(preview) : null;
  const shown = result ?? preview;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all on this page" checked={rows.length > 0 && rows.every((row) => selected.includes(row.id))}
                onChange={(event) => { reset(); setSelected(event.target.checked ? [...new Set([...selected, ...rows.map((row) => row.id)])].slice(0, BULK_LIMIT) : selected.filter((id) => !rows.some((row) => row.id === id))); }} /></th>
              <th className="px-4 py-3">Record</th><th className="px-4 py-3">Current</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className={selected.includes(row.id) ? "bg-amber-50" : ""}>
                <td className="px-4 py-3"><input type="checkbox" aria-label={`Select ${row.label}`} checked={selected.includes(row.id)} onChange={() => toggle(row.id)} /></td>
                <td className="px-4 py-3 font-bold"><Link href={row.href} className="underline-offset-2 hover:underline">{row.label}</Link></td>
                <td className="px-4 py-3 text-slate-600">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-bold text-slate-900">{selected.length} selected{selected.length >= BULK_LIMIT ? ` (limit ${BULK_LIMIT})` : ""}</p>
        <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
          <label className="space-y-1"><span className="form-label">Change</span>
            <select className="form-input" value={action} disabled={busy || uncertain} onChange={(event) => { setAction(event.target.value); setValue(""); reset(); }}>
              {actions.map((item) => <option key={item.action} value={item.action}>{item.label}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="form-label">New value</span>
            {config.input === "employee" ? (
              <select className="form-input" value={value} disabled={busy || uncertain} onChange={(event) => { setValue(event.target.value); reset(); }}>
                <option value="">Choose an employee</option>
                {employees.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            ) : config.input === "priority" ? (
              <select className="form-input" value={value} disabled={busy || uncertain} onChange={(event) => { setValue(event.target.value); reset(); }}>
                <option value="">Choose a priority</option>
                {["urgent", "high", "normal", "low"].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            ) : (
              <input className="form-input" type={config.input === "date" ? "date" : "text"} maxLength={20} value={value} disabled={busy || uncertain} onChange={(event) => { setValue(event.target.value); reset(); }} />
            )}
          </label>
          <Button type="button" variant="secondary" disabled={busy || uncertain || !selected.length || !value.trim()} onClick={() => void runPreview()}>{busy && !preview ? "Checking…" : "Preview"}</Button>
        </div>
        {counts ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-bold text-slate-900">{counts.will_change} will change · {counts.unchanged} need no change · {counts.rejected + counts.unavailable} cannot change{counts.duplicate_selection ? ` · ${counts.duplicate_selection} selected twice` : ""}</p>
            <p className="mt-1 text-xs text-slate-600">Each record is rechecked when you apply. Anything changed by someone else since this preview is left as it is and reported.</p>
            <Button type="button" className="mt-2" disabled={busy || counts.will_change === 0} onClick={() => void runApply()}>{busy ? "Applying…" : uncertain ? "Retry the same apply" : `Apply to ${counts.will_change} record${counts.will_change === 1 ? "" : "s"}`}</Button>
          </div>
        ) : null}
        {result ? <p role="status" className="text-sm font-bold text-emerald-800">{result.replayed ? "Already applied earlier: " : ""}{result.changed_count} record{result.changed_count === 1 ? "" : "s"} changed. Every selected record is listed below.</p> : null}
        {shown ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {shown.results.map((row, index) => (
              <li key={`${row.id}-${index}`} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="font-semibold">{row.label ?? labels.get(row.id) ?? row.id}</span>
                <span className={`font-semibold ${tone[row.outcome]}`}>{outcomeText[row.outcome]}: {row.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
      </section>
    </div>
  );
}
