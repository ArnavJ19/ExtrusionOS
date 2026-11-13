"use client";

// AP-081: e-way bills for a day's dispatches in one upload. Select the dispatches, enter the distance once per
// destination PIN (remembered), download the portal's bulk JSON, upload it on the portal, then paste the generated EWB
// numbers back. No portal login is stored or used here.
import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { exportEwayAction, type EwayExportResult } from "@/lib/actions/dispatch-autopilot";
import { parseEwbPaste } from "@/lib/compliance/eway-bill";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Row = { dispatch_id: string; dispatch_number: string; dispatch_date: string; order_number: string; customer: string; vehicle_number: string | null; eway_bill_number: string | null; value: number | null;
  required: boolean; invoice_number: string | null; distance_km: number | null; distance_saved: boolean; last_export: string | null; gate_out: boolean };

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DistanceInput({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const [value, setValue] = useState(row.distance_km === null ? "" : String(row.distance_km));
  const [message, setMessage] = useState<Note>(null);
  return <span className="inline-flex flex-wrap items-center gap-1"><input aria-label={`Distance for ${row.dispatch_number}`} inputMode="numeric" className="h-9 w-20 rounded-lg border border-neutral-300 px-2 text-sm" value={value} onChange={e => setValue(e.target.value.replace(/\D/g, ""))} />km
    {value !== "" && (!row.distance_saved || String(row.distance_km) !== value) ? <button type="button" className="underline" onClick={async () => { if (await apWrite("ap_eway", "save_inputs", { dispatch_id: row.dispatch_id, distance_km: Number(value) }, setMessage)) onSaved(); }}>{row.distance_saved ? "Save" : "Confirm"}</button> : null}
    <Message value={message} /></span>;
}

export function EwayClient() {
  const [page, setPage] = useState(1); const [ePage, setEPage] = useState(1); const [key, setKey] = useState(0); const [search, setSearch] = useState(""); const [show, setShow] = useState<"missing" | "all">("missing");
  const queue = useApRead<{ rows: Row[]; total_count: number; threshold: number }>("ap_eway", "queue", { page, show, ...(search.trim() ? { search: search.trim() } : {}) }, [key]);
  const exports = useApRead<{ rows: Array<{ id: string; schema_version: string; bill_count: number; generated_at: string; generated_by: string; recorded: number; docs: Array<{ doc_no: string; status: string; ewb: string | null }> }>; total_count: number }>("ap_eway", "exports", { page: ePage }, [key]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<EwayExportResult | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteResult, setPasteResult] = useState<Array<{ doc: string; state: string; message?: string; dispatch_number?: string }> | null>(null);
  const [message, setMessage] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  async function exportSelected() {
    setBusy(true); setMessage(null); setResult(null);
    const r = await exportEwayAction([...selected]);
    setBusy(false);
    if (!r.success) { setMessage({ tone: "error", text: r.error }); return; }
    setResult(r.data);
    if (r.data.json) { download(r.data.filename, r.data.json, "application/json"); setMessage({ tone: "ok", text: `${r.data.included.length} e-way bill(s) in the file. Upload it on the portal, then paste the numbers below.` }); setSelected(new Set()); setKey(k => k + 1); }
    else setMessage({ tone: "error", text: "No selected dispatch is ready; fix the items listed." });
  }
  const entries = parseEwbPaste(paste);
  return <div className="space-y-4">
    <Section title="Dispatches needing an e-way bill" description={queue.data ? `Loaded in the last 30 days. Required above ${inr(queue.data.threshold)} (and when the value is unknown).` : undefined}
      actions={<span className="flex flex-wrap gap-2"><input aria-label="Search dispatches" placeholder="Dispatch, order, vehicle" className={`${inputClass} w-56`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Show" className={`${inputClass} w-40`} value={show} onChange={e => { setShow(e.target.value as typeof show); setPage(1); }}><option value="missing">Without EWB</option><option value="all">All loaded</option></select></span>}>
      {queue.loading && !queue.data ? <Loading what="dispatches" /> : queue.error ? <Failure text={queue.error} /> : !queue.data?.rows.length ? <Empty>No loaded dispatch is waiting for an e-way bill.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1" /><th>Dispatch</th><th>Customer</th><th>Invoice</th><th>Value</th><th>Vehicle</th><th>Distance</th><th>E-way bill</th></tr></thead>
          <tbody>{queue.data.rows.map(r => <tr key={r.dispatch_id} className="border-t border-neutral-100 align-top">
            <td className="py-2"><input type="checkbox" aria-label={`Select ${r.dispatch_number}`} disabled={Boolean(r.eway_bill_number)} checked={selected.has(r.dispatch_id)} onChange={e => setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(r.dispatch_id); else n.delete(r.dispatch_id); return n; })} /></td>
            <td><Link className="font-bold underline" href={`/dispatches/${r.dispatch_id}`}>{r.dispatch_number}</Link><span className="block text-xs text-neutral-500">{fmtDay(r.dispatch_date)}{r.gate_out ? " · left the gate" : ""}</span></td>
            <td>{r.customer}<span className="block text-xs text-neutral-500">{r.order_number}</span></td>
            <td>{r.invoice_number ?? <Link className="text-amber-900 underline" href="/invoices/drafts">Post the invoice</Link>}</td>
            <td>{r.value === null ? "Not priced" : inr(r.value)}{r.required ? "" : <span className="block text-xs text-neutral-500">below threshold</span>}</td>
            <td className="font-mono">{r.vehicle_number ?? "—"}</td><td><DistanceInput row={r} onSaved={() => setKey(k => k + 1)} /></td>
            <td>{r.eway_bill_number ? <Pill value="approved" label={r.eway_bill_number} /> : r.last_export ? <span className="text-xs">Exported {fmtWhen(r.last_export)}</span> : "—"}</td></tr>)}</tbody></table></div>}
      {queue.data ? <Pager page={page} total={queue.data.total_count} onPage={setPage} /> : null}
      <button type="button" disabled={busy || !selected.size} className={`${buttonClass} inline-flex items-center gap-2`} onClick={exportSelected}><Download className="h-4 w-4" aria-hidden="true" />Download e-way bill file ({selected.size})</button>
      <Message value={message} />
      {result?.skipped.length ? <div role="alert" className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Left out of the file until fixed:</p>
        {result.skipped.map(s => <p key={s.dispatch_number}><b>{s.dispatch_number}</b>: {s.issues.map(i => i.message).join(" ")}</p>)}</div> : null}
    </Section>
    <Section title="Record the e-way bill numbers" description="Paste the portal's result (document number and EWB number per line, or the downloaded list). Only blank dispatches are filled; a recorded number is never overwritten.">
      <textarea aria-label="Portal result" className="min-h-28 w-full rounded-xl border border-neutral-300 p-2 font-mono text-sm" value={paste} onChange={e => { setPaste(e.target.value); setPasteResult(null); }} placeholder={"OMX/26-27/0201\t341000001234"} />
      <p className="text-sm text-neutral-600">{entries.length} pair(s) read.</p>
      <button type="button" disabled={!entries.length} className={secondaryClass} onClick={async () => {
        const r = await apWrite<{ recorded: number; results: Array<{ doc: string; state: string; message?: string; dispatch_number?: string }> }>("ap_eway", "record_ewb", { entries }, setMessage);
        if (r) { setPasteResult(r.results); setMessage({ tone: "ok", text: `${r.recorded} e-way bill number(s) recorded.` }); setKey(k => k + 1); if (r.recorded) setPaste(""); }
      }}>Record numbers</button>
      {pasteResult ? <ul className="text-sm">{pasteResult.map((r, i) => <li key={i}><b>{r.doc}</b>: {r.state === "recorded" ? `recorded on ${r.dispatch_number}` : r.state === "same" ? "already recorded" : r.message ?? r.state}</li>)}</ul> : null}
    </Section>
    <Section title="Exports">
      {exports.loading && !exports.data ? <Loading what="exports" /> : exports.error ? <Failure text={exports.error} /> : !exports.data?.rows.length ? <Empty>No export yet.</Empty> :
        <ul className="space-y-1 text-sm">{exports.data.rows.map(e => <li key={e.id}>{fmtWhen(e.generated_at)} by {e.generated_by} · {e.bill_count} bill(s), {e.recorded} with EWB · {e.schema_version}
          <span className="block text-xs text-neutral-500">{e.docs.map(d => `${d.doc_no}${d.ewb ? ` → ${d.ewb}` : ` (${d.status})`}`).join(" · ")}</span></li>)}</ul>}
      {exports.data ? <Pager page={ePage} total={exports.data.total_count} onPage={setEPage} /> : null}
    </Section>
  </div>;
}
