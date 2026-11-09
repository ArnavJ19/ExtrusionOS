"use client";

// AP-006: go-live import of masters. Download the template (or use Omalco's own sheet), upload, check the column
// mapping (remembered for the same layout), review the rejected rows, then import every valid row in one step.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { MASTER_DEFINITIONS, MASTER_KEYS, type MasterKey } from "@/lib/master-data/import/definitions";
import { fieldGuide } from "@/lib/master-data/import/engine";

type Preview = {
  master: MasterKey; file_name: string; headers: string[]; mapping: Record<string, string | null>; remembered: boolean;
  problems: { missing: string[]; duplicates: string[]; unknown: string[] }; fields: Array<{ key: string; label: string; required: boolean }>;
  total_rows: number; batch_id: string | null; valid_rows: number; rejected_rows: number; rejected: Array<{ row: number; errors: string[] }>; sample: Array<Record<string, unknown>>;
};
type Batch = { id: string; master: MasterKey; file_name: string; status: string; total_rows: number; valid_rows: number; rejected_rows: number; imported_rows: number | null; created_at: string; created_by: string | null; reversal_reason: string | null };

export function ImportClient() {
  const router = useRouter();
  const [master, setMaster] = useState<MasterKey>("customers");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [batches, setBatches] = useState<{ total_count: number; rows: Batch[] } | null>(null);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [reverse, setReverse] = useState<{ id: string; reason: string } | null>(null);
  const definition = MASTER_DEFINITIONS[master];

  const loadBatches = useCallback(async () => {
    const result = await autopilotAction("ap_import", "list", { page });
    if (!result.success) { setBatchesError(result.error); return; }
    setBatchesError(null); setBatches(result.data as { total_count: number; rows: Batch[] });
  }, [page]);
  useEffect(() => { void loadBatches(); }, [loadBatches]);

  async function upload(withMapping?: Record<string, string | null>) {
    if (!file) return setMessage({ text: "Choose the sheet first.", tone: "error" });
    setBusy(true); setMessage(null);
    const body = new FormData();
    body.set("master", master); body.set("file", file);
    if (withMapping) body.set("mapping", JSON.stringify(withMapping));
    try {
      const response = await fetch("/api/master-import/preview", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) { setMessage({ text: data.error ?? "The sheet could not be checked.", tone: "error" }); return; }
      setPreview(data as Preview); setMapping((data as Preview).mapping);
    } catch { setMessage({ text: "The upload did not complete. Check your connection and retry.", tone: "error" }); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview?.batch_id) return;
    setBusy(true);
    const result = await autopilotAction("ap_import", "commit", { batch_id: preview.batch_id });
    setBusy(false);
    if (!result.success) return setMessage({ text: result.error, tone: "error" });
    setMessage({ text: `${(result.data as { imported_rows: number }).imported_rows} ${definition.label.toLowerCase()} imported.`, tone: "ok" });
    setPreview(null); setFile(null); await loadBatches(); router.refresh();
  }
  async function discard() {
    if (preview?.batch_id) await autopilotAction("ap_import", "discard", { batch_id: preview.batch_id });
    setPreview(null); await loadBatches();
  }
  async function doReverse() {
    if (!reverse) return;
    setBusy(true);
    const result = await autopilotAction("ap_import", "reverse", { batch_id: reverse.id, reason: reverse.reason.trim() });
    setBusy(false);
    setMessage(result.success ? { text: `Import reversed: ${(result.data as { removed: number }).removed} record(s) removed.`, tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) { setReverse(null); await loadBatches(); }
  }

  const pages = Math.max(1, Math.ceil((batches?.total_count ?? 0) / 10));
  return <div className="space-y-5">
    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm font-semibold ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}
    <section className="min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-bold">1. Choose what to import</h2>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" role="radiogroup" aria-label="Master to import">
        {MASTER_KEYS.map(key => <button key={key} type="button" role="radio" aria-checked={master === key} onClick={() => { setMaster(key); setPreview(null); }}
          className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${master === key ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-200 bg-white"}`}>{MASTER_DEFINITIONS[key].label}</button>)}
      </div>
      <p className="text-sm text-neutral-600">{definition.description} {master === "dies" ? "Import profiles first: each die must name an existing profile code." : ""}</p>
      <details className="rounded-xl bg-neutral-50 p-3 text-sm"><summary className="cursor-pointer font-semibold">What each column accepts</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">{fieldGuide(definition).map(field => <li key={field.label}><strong>{field.label}</strong>{field.required ? " (required)" : ""}: {field.accepts}{field.defaultValue ? `; blank means ${field.defaultValue}` : ""}{field.hint ? `. ${field.hint}` : ""}</li>)}</ul></details>
      <div className="flex flex-wrap items-end gap-3">
        <a href={`/api/master-import/template/${master}`} className="inline-flex min-h-11 items-center rounded-xl border border-neutral-300 px-4 text-sm font-bold">Download template (.csv)</a>
        <label className="text-sm font-semibold">2. Upload the sheet (.xlsx or .csv, up to 4 MB)
          <input type="file" accept=".xlsx,.csv" className="mt-1 block w-full max-w-xs text-sm" onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} /></label>
        <button type="button" disabled={busy || !file} onClick={() => upload()} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? "Checking…" : "Check the sheet"}</button>
      </div>
    </section>
    {preview ? <section className="min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5" aria-labelledby="import-review">
      <h2 id="import-review" className="text-lg font-bold">3. Review {preview.file_name}</h2>
      <div><h3 className="font-semibold">Columns {preview.remembered ? <span className="text-xs font-normal text-neutral-600">(remembered from your last upload of this layout)</span> : null}</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{preview.headers.map(header => <label key={header} className="block text-xs font-semibold [overflow-wrap:anywhere]">{header}
          <select className="mt-1 block h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm font-normal" value={mapping[header] ?? ""} onChange={event => setMapping({ ...mapping, [header]: event.target.value || null })}>
            <option value="">Ignore this column</option>{preview.fields.map(field => <option key={field.key} value={field.key}>{field.label}{field.required ? " *" : ""}</option>)}</select></label>)}</div>
        {preview.problems.missing.length || preview.problems.duplicates.length ? <p role="alert" className="mt-2 text-sm font-semibold text-rose-700">{preview.problems.missing.length ? `Map these required columns: ${preview.problems.missing.join(", ")}. ` : ""}{preview.problems.duplicates.length ? "Each field may be chosen for one column only." : ""}</p> : null}
        <button type="button" disabled={busy} onClick={() => upload(mapping)} className="mt-2 min-h-10 rounded-lg border border-neutral-300 px-3 text-sm font-bold">Check again with these columns</button></div>
      {preview.batch_id ? <>
        <p className="text-sm"><strong>{preview.valid_rows}</strong> row(s) ready to import · <strong>{preview.rejected_rows}</strong> row(s) rejected of {preview.total_rows}.</p>
        {preview.rejected.length ? <div className="space-y-2"><h3 className="font-semibold">Rejected rows (fix them in the sheet and upload them again)</h3>
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-neutral-200 p-2 text-sm">{preview.rejected.map(row => <li key={row.row}><strong>Row {row.row}:</strong> {row.errors.join("; ")}</li>)}</ul>
          <a href={`/api/master-import/${preview.batch_id}/rejected`} className="inline-flex min-h-10 items-center rounded-lg border border-neutral-300 px-3 text-sm font-bold">Download rejected rows (.csv)</a></div> : null}
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !preview.valid_rows} onClick={commit} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50">Import {preview.valid_rows} valid row(s)</button>
          <button type="button" disabled={busy} onClick={discard} className="min-h-11 rounded-xl border border-neutral-300 px-4 text-sm font-bold">Discard this preview</button></div>
      </> : null}
    </section> : null}
    <section className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-bold">Import history</h2>
      {batchesError ? <p role="alert" className="text-sm font-semibold text-amber-900">{batchesError}</p> : !batches ? <p className="text-sm text-neutral-500">Loading…</p>
        : !batches.rows.length ? <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">Nothing imported yet.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-neutral-500"><th className="py-2 pr-3">Sheet</th><th className="pr-3">Master</th><th className="pr-3">Status</th><th className="pr-3">Rows</th><th className="pr-3">By</th><th>Undo</th></tr></thead>
          <tbody>{batches.rows.map(row => <tr key={row.id} className="border-b align-top"><td className="py-2 pr-3 [overflow-wrap:anywhere]">{row.file_name}<span className="block text-xs text-neutral-500">{new Date(row.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span></td>
            <td className="pr-3">{MASTER_DEFINITIONS[row.master]?.label ?? row.master}</td><td className="pr-3">{row.status}{row.reversal_reason ? <span className="block text-xs">{row.reversal_reason}</span> : null}</td>
            <td className="pr-3">{row.imported_rows ?? row.valid_rows} imported · {row.rejected_rows} rejected{row.rejected_rows ? <a className="block text-xs underline" href={`/api/master-import/${row.id}/rejected`}>Rejected rows</a> : null}</td>
            <td className="pr-3">{row.created_by ?? "-"}</td>
            <td>{row.status === "imported" ? reverse?.id === row.id ? <div className="space-y-1"><input className="h-10 w-full rounded-lg border border-neutral-300 px-2" placeholder="Reason" value={reverse.reason} maxLength={300} onChange={event => setReverse({ ...reverse, reason: event.target.value })} />
              <button type="button" disabled={busy || reverse.reason.trim().length < 10} onClick={doReverse} className="min-h-10 rounded-lg bg-rose-600 px-3 text-sm font-bold text-white disabled:opacity-50">Reverse import</button></div>
              : <button type="button" onClick={() => setReverse({ id: row.id, reason: "" })} className="min-h-10 rounded-lg border px-3 text-sm">Reverse…</button> : "-"}</td></tr>)}</tbody></table></div>}
      <p className="text-xs text-neutral-600">An import can be reversed only while no order, quote, job or other record uses its rows; after that, deactivate the record instead.</p>
      {pages > 1 ? <div className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></div> : null}
    </section>
  </div>;
}
