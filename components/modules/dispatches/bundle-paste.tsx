"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseBundlePaste, type BundleLine, type PastedBundleRow } from "@/lib/forms/line-paste";
import type { DispatchPreparationSource } from "@/lib/dispatches/preparation";

// NOV-011: paste bundle rows copied from Excel, review every row, then add only the rows that are
// valid or explicitly resolved. Invalid rows stay in the paste box with their reasons.
export function BundlePaste({ sources, existingTags, disabled, onAdd }: { sources: DispatchPreparationSource[]; existingTags: string[]; disabled?: boolean; onAdd: (rows: BundleLine[]) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PastedBundleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const label = (id: string) => { const source = sources.find(item => item.id === id); return source ? `${source.profileLabel} · ${source.sourceLabel}${source.stockBatchLabel ? ` · ${source.stockBatchLabel}` : ""}` : "Unknown source"; };
  function check(value = text) {
    const result = parseBundlePaste(value, sources.map(source => ({ id: source.id, labels: [source.sourceLabel, source.stockBatchLabel ?? ""].filter(Boolean) })), existingTags);
    setRows(result.error ? null : result.rows); setError(result.error); setChoices({});
  }
  const ready = (rows ?? []).filter(row => row.status === "valid" || (row.status === "ambiguous" && choices[row.sourceRow]));
  function add() {
    if (!rows || !ready.length) return;
    onAdd(ready.map(row => ({ ...row.values, source_line_id: row.status === "valid" ? row.values.source_line_id : choices[row.sourceRow] })));
    // Rows that were not added stay in the box for correction.
    const header = text.replace(/^﻿/, "").split(/\r?\n/).find(line => line.trim()) ?? "";
    const remaining = rows.filter(row => !ready.includes(row)).map(row => text.replace(/^﻿/, "").split(/\r?\n/).filter(line => line.trim())[row.sourceRow - 1]);
    const next = remaining.length ? [header, ...remaining].join("\n") : "";
    setText(next); if (next) check(next); else { setRows(null); setChoices({}); }
  }
  return <details className="rounded-2xl border border-slate-200 bg-white p-4">
    <summary className="cursor-pointer py-1 text-sm font-bold text-slate-800">Paste bundles from Excel</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-slate-600">Columns: Bundle, Source (job or stock batch as shown below; optional when there is one source), Pieces, Metres, Gross kg, Tare kg. Up to 60 rows. Formulas are refused; units must be metres and kg.</p>
      <textarea aria-label="Pasted bundle rows" className="form-input min-h-28 font-mono text-xs" value={text} disabled={disabled} onChange={event => { setText(event.target.value); setRows(null); setError(null); }} placeholder={"Bundle\tSource\tPieces\tMetres\tGross kg\tTare kg"} />
      <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={disabled || !text.trim()} onClick={() => check()}>Check pasted rows</Button>
        {rows ? <Button type="button" disabled={disabled || !ready.length} onClick={add}>Add {ready.length} checked row{ready.length === 1 ? "" : "s"}</Button> : null}</div>
      {error ? <p role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
      {rows ? <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><caption className="sr-only">Pasted bundle review</caption>
        <thead><tr className="border-b"><th scope="col" className="py-2 pr-2">Row</th><th scope="col" className="py-2 pr-2">Bundle</th><th scope="col" className="py-2 pr-2">Source</th><th scope="col" className="py-2 pr-2">Pieces</th><th scope="col" className="py-2 pr-2">Metres</th><th scope="col" className="py-2 pr-2">Gross / tare kg</th><th scope="col" className="py-2">Check</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.sourceRow} className="border-b align-top last:border-0">
          <td className="py-2 pr-2">{row.sourceRow}</td><td className="py-2 pr-2 font-mono font-bold">{row.values.bundle_number || "—"}</td>
          <td className="py-2 pr-2">{row.status === "ambiguous" ? <select aria-label={`Source for pasted row ${row.sourceRow}`} className="form-input min-h-9 py-1 text-xs" value={choices[row.sourceRow] ?? ""} onChange={event => setChoices(current => ({ ...current, [row.sourceRow]: event.target.value }))}>
              <option value="">Choose the source</option>{row.candidates.map(id => <option key={id} value={id}>{label(id)}</option>)}</select> : row.values.source_line_id ? label(row.values.source_line_id) : row.sourceText || "—"}</td>
          <td className="py-2 pr-2">{row.values.number_of_pieces}</td><td className="py-2 pr-2">{row.values.net_length_m}</td><td className="py-2 pr-2">{row.values.gross_weight_kg} / {row.values.tare_weight_kg}</td>
          <td className={`py-2 font-semibold ${row.status === "invalid" ? "text-red-800" : row.status === "ambiguous" && !choices[row.sourceRow] ? "text-amber-900" : "text-emerald-800"}`}>
            {row.status === "invalid" ? row.errors.join(" ") : row.status === "ambiguous" ? (choices[row.sourceRow] ? "Ready" : "Choose which source this bundle came from") : "Ready"}</td></tr>)}</tbody></table></div> : null}
      <p className="text-xs text-slate-500">Added rows are still checked against current sources when you review the dispatch. Nothing is recorded until the dispatch is confirmed.</p>
    </div>
  </details>;
}
