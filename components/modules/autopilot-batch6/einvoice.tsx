"use client";

import { useState } from "react";
import Link from "next/link";
import { exportEinvoiceAction, importIrnAction, type EinvoiceExportResult, type IrnImportResult } from "@/lib/actions/autopilot-batch6";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, inputClass, useApRead } from "../order-to-cash/ui";
import { Action, Field, download, write, type Note, type Queue } from "./shared";

type Settings = { applicable: boolean | null; applicable_from?: string | null; reason?: string; confirmed_by_name?: string; confirmed_at?: string };
type Row = { id: string; invoice_number: string; invoice_date: string; grand_total: number; customer: string | null; buyer_gstin: string | null; irn: string | null; ack_no: string | null; ack_date: string | null; exported_at: string | null };

export function EinvoiceClient({ today }: { today: string }) {
  const [rev, setRev] = useState(0);
  const settings = useApRead<Settings>("ap_einvoice", "settings", {}, [rev]);
  return <div className="space-y-5">
    <EinvoiceSettings value={settings.data} today={today} onSaved={() => setRev(v => v + 1)} />
    {settings.data?.applicable ? <><EinvoiceQueue rev={rev} onChanged={() => setRev(v => v + 1)} /><IrnImport onImported={() => setRev(v => v + 1)} /></> : null}
  </div>;
}

function EinvoiceSettings({ value, today, onSaved }: { value: Settings | null; today: string; onSaved: () => void }) {
  const [applicable, setApplicable] = useState<string | null>(null); const [from, setFrom] = useState<string | null>(null); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null);
  if (!value) return <Loading what="e-invoice settings" />;
  const on = (applicable ?? (value.applicable === null ? "" : String(value.applicable))) === "true";
  return <Section title="E-invoicing applicability" description="Confirmed by accounts from Omalco's aggregate turnover. The system does not decide whether e-invoicing applies.">
    <p className="text-sm">{value.applicable === null ? "Not confirmed yet." : value.applicable ? `Applies to invoices from ${fmtDay(value.applicable_from)}.` : "Confirmed as not applicable."}{value.confirmed_at ? ` Confirmed by ${value.confirmed_by_name ?? "—"} ${fmtWhen(value.confirmed_at)}.` : ""}</p>
    <div className="grid gap-3 sm:grid-cols-3"><Field label="E-invoicing applies"><select className={inputClass} value={applicable ?? (value.applicable === null ? "" : String(value.applicable))} onChange={e => setApplicable(e.target.value)}><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select></Field>
      {on ? <Field label="From invoice date"><input type="date" className={inputClass} value={from ?? value.applicable_from ?? today} onChange={e => setFrom(e.target.value)} /></Field> : null}
      <Field label="Basis (turnover, notification)"><input className={inputClass} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></Field></div>
    <Message value={note} />
    <Action disabled={reason.trim().length < 10 || (applicable ?? "") === ""} run={async () => { if (await write("ap_einvoice", "save_settings", { applicable: on, ...(on ? { applicable_from: from ?? value.applicable_from ?? today } : {}), reason: reason.trim() }, setNote, "Applicability recorded.")) { setReason(""); onSaved(); } }}>Record applicability</Action>
  </Section>;
}

function EinvoiceQueue({ rev, onChanged }: { rev: number; onChanged: () => void }) {
  const [page, setPage] = useState(1); const [show, setShow] = useState("pending"); const [search, setSearch] = useState(""); const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<Note>(null); const [result, setResult] = useState<EinvoiceExportResult | null>(null);
  const read = useApRead<Queue<Row> & { applicable_from: string }>("ap_einvoice", "queue", { page, show, search }, [rev]);
  return <Section title="Invoices for the IRP" description="Issued B2B invoices without an IRN. Export them as e-invoice JSON for the IRP or your GSP tool.">
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Search"><input type="search" className={inputClass} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></Field>
      <Field label="Show"><select className={inputClass} value={show} onChange={e => { setShow(e.target.value); setPage(1); }}><option value="pending">Without IRN</option><option value="with_irn">With IRN</option><option value="all">All</option></select></Field></div>
    <Message value={note} />
    {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="invoices" /> : read.data ? <>
      {!read.data.rows.length ? <Empty>No invoice matches.</Empty> : <ul className="divide-y">{read.data.rows.map(r => <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
        <label className="flex min-w-0 items-start gap-2">{!r.irn ? <input type="checkbox" className="mt-1" checked={picked.has(r.id)} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /> : null}
          <span className="min-w-0"><Link className="font-semibold underline" href={`/invoices/${r.id}`}>{r.invoice_number}</Link> · {fmtDay(r.invoice_date)} · {r.customer ?? ""} · {inr(r.grand_total)}
            <span className="block break-all text-xs text-neutral-500">{r.irn ? `IRN ${r.irn} · Ack ${r.ack_no} · ${fmtWhen(r.ack_date)}` : r.exported_at ? `Exported ${fmtWhen(r.exported_at)}; waiting for the IRN` : r.buyer_gstin ? `Buyer GSTIN ${r.buyer_gstin}` : "Buyer unregistered (B2C)"}</span></span></label>
        <Pill value={r.irn ? "approved" : "pending"} label={r.irn ? "IRN recorded" : "No IRN"} /></li>)}</ul>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
      <Action disabled={!picked.size} run={async () => {
        const r = await exportEinvoiceAction([...picked]);
        if (!r.success) { setNote({ tone: "error", text: r.error }); return; }
        setResult(r.data);
        if (r.data.json) { download(r.data.filename, r.data.json); setNote({ tone: "ok", text: `${r.data.included.length} invoice(s) exported. Upload the file to the IRP, then import the response.` }); setPicked(new Set()); onChanged(); }
        else setNote({ tone: "error", text: "No selected invoice could be exported. Fix the listed problems." });
      }}>Export {picked.size} invoice(s)</Action>
      {result?.skipped.length ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Not exported:</p><ul className="list-disc pl-5">{result.skipped.map(s => <li key={s.invoice_number}>{s.invoice_number}: {s.issues.map(i => i.message).join(" ")}</li>)}</ul></div> : null}
    </> : null}
  </Section>;
}

function IrnImport({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState(""); const [note, setNote] = useState<Note>(null); const [result, setResult] = useState<IrnImportResult | null>(null);
  return <Section title="Import IRN and signed QR" description="Paste or choose the IRP/GSP response JSON. Each IRN is checked against its signed QR and the invoice number before it is saved.">
    <input type="file" accept=".json,application/json" aria-label="IRN response file" className="block w-full text-sm" onChange={async e => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ""; }} />
    <Field label="Response JSON"><textarea className={`${inputClass} min-h-28 py-2 font-mono text-xs`} value={text} onChange={e => setText(e.target.value)} /></Field>
    <Message value={note} />
    <Action disabled={text.trim().length < 2} run={async () => {
      const r = await importIrnAction(text);
      if (!r.success) { setNote({ tone: "error", text: r.error }); return; }
      setResult(r.data); setNote({ tone: r.data.recorded ? "ok" : "error", text: `${r.data.recorded} IRN(s) recorded. They print on the invoice PDF.` });
      if (r.data.recorded) { setText(""); onImported(); }
    }}>Import response</Action>
    {result ? <ul className="list-disc pl-5 text-sm">{[...result.problems.map(p => `Entry ${p.index}: ${p.message}`), ...result.results.filter(x => x.state !== "recorded").map(x => `${x.doc_no}: ${x.message ?? x.state}`)].map(t => <li key={t}>{t}</li>)}</ul> : null}
  </Section>;
}
