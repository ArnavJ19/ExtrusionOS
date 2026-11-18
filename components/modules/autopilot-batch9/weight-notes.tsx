"use client";

// AP-075: the customer's weighbridge weight against the invoiced weight. Within the agreed tolerance the outcome is simply
// recorded; outside it a credit note (less received) or debit note (more received) is drafted at the invoice's rate per kg
// with its GST. Accounts approves (not the person who recorded it); the credit note then posts against the invoice.
import { useState } from "react";
import Link from "next/link";
import { WEIGHT_NOTE_STATUS } from "@/lib/autopilot-batch9/commands";
import { fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { CustomerPicker } from "./pickers";

type Note = { tone: "ok" | "error"; text: string } | null;
export type WeightNote = { id: string; invoice_id: string; invoice_number: string | null; customer: string; invoiced_kg: number; reported_kg: number; difference_kg: number; allowed_kg: number;
  tolerance_source: string; outcome: string; rate_per_kg: number | null; gst_rate: number | null; taxable_value: number | null; tax_amount: number | null; total_amount: number | null; status: string;
  customer_reference: string; note: string | null; reported_by_name: string | null; reported_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
  credit_note_number: string | null; debit_note_number: string | null };
const kg = (v: unknown) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`);
const TONE: Record<string, string> = { recorded: "approved", draft: "held", approved: "approved", rejected: "blocked" };

function NoteLine({ n, canDecide, onDone }: { n: WeightNote; canDecide: boolean; onDone: (text: string) => void }) {
  const [reason, setReason] = useState(""); const [message, setMessage] = useState<Note>(null); const [busy, setBusy] = useState(false);
  const label = n.outcome === "credit" ? "Credit note" : n.outcome === "debit" ? "Debit note" : "Within tolerance";
  return <li className="space-y-2 p-3 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0">
      <p><Link className="font-bold underline" href={`/invoices/${n.invoice_id}#weight-difference`}>{n.invoice_number ?? "Invoice"}</Link> · {n.customer} · {label}</p>
      <p className="text-xs text-neutral-600">Customer weighed {kg(n.reported_kg)} (ref {n.customer_reference}) against {kg(n.invoiced_kg)} invoiced: {Number(n.difference_kg) > 0 ? "+" : ""}{kg(n.difference_kg)}; agreed tolerance {kg(n.allowed_kg)} ({n.tolerance_source === "customer" ? "this customer" : "company default"}).</p>
      {n.total_amount !== null ? <p className="text-xs">{kg(Math.abs(Number(n.difference_kg)))} × {inr(n.rate_per_kg)}/kg = {inr(n.taxable_value)} + GST {Number(n.gst_rate)}% {inr(n.tax_amount)} = <b>{inr(n.total_amount)}</b></p> : null}
      <p className="text-xs text-neutral-500">Recorded by {n.reported_by_name ?? "—"} {fmtWhen(n.reported_at)}{n.decided_at ? ` · ${WEIGHT_NOTE_STATUS[n.status]} by ${n.decided_by_name ?? "—"} ${fmtWhen(n.decided_at)}` : ""}{n.credit_note_number ? ` · credit note ${n.credit_note_number}` : ""}{n.debit_note_number ? ` · debit note ${n.debit_note_number}` : ""}</p>
      {n.decision_note ? <p className="text-xs text-neutral-600">{n.decision_note}</p> : null}</div>
      <Pill value={TONE[n.status] ?? "unknown"} label={WEIGHT_NOTE_STATUS[n.status] ?? n.status} /></div>
    {n.status === "draft" && canDecide ? <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs font-bold">Note (needed to reject)<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button type="button" className={buttonClass} disabled={busy} onClick={async () => { setBusy(true); const out = await apWrite("ap_weight_note", "approve", { id: n.id, ...(reason.trim().length >= 3 ? { note: reason.trim() } : {}) }, setMessage); setBusy(false); if (out) onDone(`${label} approved.`); }}>Approve {n.outcome === "credit" ? "credit" : "debit"} note</button>
      <button type="button" className={secondaryClass} disabled={busy || reason.trim().length < 3} onClick={async () => { setBusy(true); const out = await apWrite("ap_weight_note", "reject", { id: n.id, note: reason.trim() }, setMessage); setBusy(false); if (out) onDone("Rejected."); }}>Reject</button>
    </div> : null}
    <Message value={message} />
  </li>;
}

/** Invoice record: record the customer's weight and see each recorded outcome. */
export function InvoiceWeightPanel({ invoiceId, canDecide }: { invoiceId: string; canDecide: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ invoice_number: string | null; status: string; invoiced_kg: number | null; tolerance: { percent: number | null; kg: number | null; source: string } | null; notes: WeightNote[] }>("ap_weight_note", "invoice", { invoice_id: invoiceId }, [key]);
  const [reported, setReported] = useState(""); const [ref, setRef] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const d = data.data;
  return <Section id="weight-difference" title="Customer's receipt weight" description="Record the weight on the customer's weighbridge. A difference beyond the agreed tolerance drafts a credit or debit note for accounts.">
    {data.loading && !d ? <Loading what="the invoice weight" /> : data.error ? <Failure text={data.error} /> : d ? <>
      <p className="text-sm">Invoiced goods weight <b>{kg(d.invoiced_kg)}</b> · agreed tolerance {d.tolerance ? `${d.tolerance.percent !== null ? `${d.tolerance.percent}%` : ""}${d.tolerance.percent !== null && d.tolerance.kg !== null ? " or " : ""}${d.tolerance.kg !== null ? kg(d.tolerance.kg) : ""} (${d.tolerance.source === "customer" ? "this customer" : "company default"}, the larger applies)` : <Link className="font-bold underline" href="/invoices/weight-notes#tolerances">not set: set it first</Link>}</p>
      {d.tolerance ? <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold">Customer&apos;s weight kg<input className={inputClass} inputMode="decimal" value={reported} onChange={e => setReported(e.target.value)} /></label>
        <label className="text-xs font-bold">Their weighbridge slip or GRN<input className={inputClass} value={ref} onChange={e => setRef(e.target.value)} /></label>
        <label className="min-w-0 flex-1 text-xs font-bold">Note (optional)<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={busy || !reported || ref.trim().length < 2} onClick={async () => {
          setBusy(true); const out = await apWrite<WeightNote>("ap_weight_note", "report", { invoice_id: invoiceId, reported_kg: Number(reported), customer_reference: ref.trim(), ...(note.trim().length >= 3 ? { note: note.trim() } : {}) }, setMessage); setBusy(false);
          if (out) { setMessage({ tone: "ok", text: out.outcome === "within_tolerance" ? "Within the agreed tolerance: recorded, no note needed." : `${out.outcome === "credit" ? "Credit" : "Debit"} note of ${inr(out.total_amount)} drafted for accounts.` }); setReported(""); setRef(""); setNote(""); setKey(k => k + 1); }
        }}>Record</button></div> : null}
      <Message value={message} />
      {d.notes.length ? <ul className="divide-y rounded-xl border">{d.notes.map(n => <NoteLine key={n.id} n={n} canDecide={canDecide} onDone={t => { setMessage({ tone: "ok", text: t }); setKey(k => k + 1); }} />)}</ul> : <Empty>No weight difference recorded on this invoice.</Empty>}
    </> : null}
  </Section>;
}

/** Accounts: notes waiting for approval and every recorded outcome. */
export function WeightNotesQueue({ canDecide }: { canDecide: boolean }) {
  const [page, setPage] = useState(1); const [status, setStatus] = useState("draft"); const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ rows: WeightNote[]; total_count: number }>("ap_weight_note", "list", { page, status }, [key]);
  return <Section id="weight-notes" title="Weight differences" description="Ten per page, newest first. Approving a credit note posts it against the invoice.">
    <select aria-label="Status" className={`${inputClass} w-auto`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
      {[["draft", "To approve"], ["approved", "Approved"], ["rejected", "Rejected"], ["recorded", "Within tolerance"], ["all", "All"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    <Message value={message} />
    {data.loading && !data.data ? <Loading what="weight differences" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(n => <NoteLine key={n.id} n={n} canDecide={canDecide} onDone={t => { setMessage({ tone: "ok", text: t }); setKey(k => k + 1); }} />)}</ul>
        : <Empty>{status === "draft" ? "No note is waiting for approval." : "Nothing here."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

export function WeightTolerances({ canSet }: { canSet: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ rows: { id: string; customer_id: string | null; customer: string | null; tolerance_percent: number | null; tolerance_kg: number | null; reason: string; set_at: string }[] }>("ap_weight_note", "tolerances", {}, [key]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null); const [pct, setPct] = useState(""); const [kgs, setKgs] = useState(""); const [reason, setReason] = useState("");
  return <Section id="tolerances" title="Agreed weight tolerances" description="A customer's own tolerance replaces the company default. When both percent and kg are given, the larger allowance applies.">
    {data.loading && !data.data ? <Loading what="tolerances" /> : data.error ? <Failure text={data.error} /> : data.data ? (data.data.rows.length ? <ul className="text-sm">{data.data.rows.map(r => <li key={r.id}>
      <b>{r.customer ?? "Company default"}</b>: {[r.tolerance_percent !== null ? `${r.tolerance_percent}%` : null, r.tolerance_kg !== null ? kg(r.tolerance_kg) : null].filter(Boolean).join(" or ")} · {r.reason}</li>)}</ul>
      : <Empty>No tolerance agreed yet. Set the company default first.</Empty>) : null}
    {canSet ? <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
      <CustomerPicker label="Customer (leave empty for the company default)" value={customer} onChange={setCustomer} />
      <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-bold">Percent<input className={inputClass} inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} placeholder="0.5" /></label>
        <label className="text-xs font-bold">Kg<input className={inputClass} inputMode="decimal" value={kgs} onChange={e => setKgs(e.target.value)} placeholder="2" /></label>
        <label className="min-w-0 flex-1 text-xs font-bold">Basis<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="Agreed in the rate contract" /></label>
        <button type="button" className={buttonClass} disabled={(!pct && !kgs) || reason.trim().length < 5} onClick={async () => {
          if (await apWrite("ap_weight_note", "save_tolerance", { ...(customer ? { customer_id: customer.id } : {}), ...(pct ? { tolerance_percent: Number(pct) } : {}), ...(kgs ? { tolerance_kg: Number(kgs) } : {}), reason: reason.trim() }, setMessage, "Tolerance saved.")) { setKey(k => k + 1); setPct(""); setKgs(""); setReason(""); setCustomer(null); }
        }}>Save tolerance</button></div>
      <Message value={message} />
    </div> : null}
  </Section>;
}
