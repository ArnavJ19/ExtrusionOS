"use client";

// AP-056: chase list for finishing vendors. Material past its expected return (sent date + the finish's lead time in
// factory working days), or received with weight unaccounted, is grouped per vendor with a prepared message. Copying
// the message is recorded as copied, not sent; the vendor's promised date takes the job off the list until it passes.
import { useState } from "react";
import Link from "next/link";
import { autopilotAction } from "@/lib/actions/autopilot";
import { fmtDay, fmtWhen, whatsappLink } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Line = { job_id: string; order_id: string; order_number: string; order_due: string | null; job_number: string | null; finishing_type: string; shade: string | null; status: string;
  sent_date: string; expected_back: string | null; lead_days: number | null; outstanding_kg: number; days_at_vendor: number; overdue_days: number; promised_date: string | null;
  last_copied_at: string | null; needs_chase: boolean; reason: string };
type Vendor = { vendor_id: string; vendor: string; phone: string | null; outstanding_kg: number; worst_overdue_days: number; jobs: number; lines: Line[]; message: string };
type Chase = { rows: Vendor[]; total_count: number; coverage: { late: number; late_without_followup: number; no_lead_time: number } };

export const PROMISE_CHANNELS = { phone_call: "Phone call", whatsapp: "WhatsApp", email: "Email", visit: "Visit", other: "Other" } as const;

function VendorCard({ v, canRecord, onChanged }: { v: Vendor; canRecord: boolean; onChanged: (text: string) => void }) {
  const chase = v.lines.filter(l => l.needs_chase);
  const [selected, setSelected] = useState<Set<string>>(new Set(chase.map(l => l.job_id)));
  const [date, setDate] = useState(""); const [channel, setChannel] = useState<keyof typeof PROMISE_CHANNELS>("phone_call"); const [note, setNote] = useState("");
  const [message, setMessage] = useState<Note>(null);
  const ids = [...selected];
  const wa = whatsappLink(v.phone, v.message);
  async function copied() {
    try { await navigator.clipboard.writeText(v.message); } catch { /* the text stays visible to copy by hand */ }
    if (canRecord && chase.length) await apWrite("ap_finishing", "copied", { job_ids: chase.map(l => l.job_id) }, setMessage, "Copied. It is not marked sent: record the vendor's date once they reply.");
    else setMessage({ tone: "ok", text: "Copied." });
  }
  return <article className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-black">{v.vendor}</h3>
      <p className="text-sm">{Number(v.outstanding_kg).toLocaleString("en-IN")} kg with them · {v.jobs} job(s){v.worst_overdue_days > 0 ? ` · up to ${v.worst_overdue_days} day(s) late` : ""}{v.phone ? ` · ${v.phone}` : " · no phone on record"}</p></div>
    <ul className="space-y-1 text-sm">{v.lines.map(l => <li key={l.job_id} className="flex flex-wrap items-start gap-2">
      {canRecord ? <input type="checkbox" className="mt-1 h-5 w-5" aria-label={`Select ${l.job_number ?? l.order_number}`} checked={selected.has(l.job_id)} onChange={e => setSelected(s => { const n = new Set(s); if (e.target.checked) n.add(l.job_id); else n.delete(l.job_id); return n; })} /> : null}
      <span className="min-w-0 flex-1"><b>{l.job_number ?? "Job"}</b> · <Link className="underline" href={`/orders/${l.order_id}`}>{l.order_number}</Link> · {l.finishing_type.replaceAll("_", " ")}{l.shade ? ` ${l.shade}` : ""} · {Number(l.outstanding_kg).toLocaleString("en-IN")} kg
        <span className="block text-neutral-600">Sent {fmtDay(l.sent_date)} ({l.days_at_vendor} days){l.expected_back ? ` · expected ${fmtDay(l.expected_back)}` : ""} · order due {fmtDay(l.order_due)}{l.promised_date ? ` · promised ${fmtDay(l.promised_date)}` : ""}{l.last_copied_at ? ` · message copied ${fmtWhen(l.last_copied_at)}` : ""}</span></span>
      <Pill value={l.needs_chase ? "held" : l.overdue_days > 0 ? "approved" : "cleared"} label={l.needs_chase ? l.reason : l.promised_date ? "Promised" : l.reason} />
    </li>)}</ul>
    <details><summary className="cursor-pointer text-sm font-semibold">Prepared message</summary><pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-2 font-sans text-sm">{v.message}</pre></details>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={secondaryClass} onClick={copied}>Copy message</button>
      {wa ? <a className={`${secondaryClass} inline-flex items-center`} href={wa} target="_blank" rel="noreferrer" onClick={() => { if (canRecord && chase.length) void autopilotAction("ap_finishing", "copied", { job_ids: chase.map(l => l.job_id) }); }}>Open WhatsApp</a> : null}
    </div>
    {canRecord ? <div className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr_auto]">
      <label className="text-sm font-semibold">Promised date<input type="date" className={`${inputClass} mt-1`} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="text-sm font-semibold">How<select className={`${inputClass} mt-1`} value={channel} onChange={e => setChannel(e.target.value as keyof typeof PROMISE_CHANNELS)}>{Object.entries(PROMISE_CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="text-sm font-semibold">Note<input className={`${inputClass} mt-1`} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" /></label>
      <div className="flex items-end"><button type="button" disabled={!ids.length || !date} className={buttonClass} onClick={async () => {
        const payload: Record<string, unknown> = { job_ids: ids, promised_date: date, channel };
        if (note.trim()) payload.note = note.trim();
        if (await apWrite("ap_finishing", "promise", payload, setMessage)) onChanged(`Promise from ${v.vendor} recorded for ${ids.length} job(s).`);
      }}>Record promise ({ids.length})</button></div>
    </div> : null}
    <Message value={message} />
  </article>;
}

export function VendorChaseClient({ canRecord }: { canRecord: boolean }) {
  const [page, setPage] = useState(1); const [show, setShow] = useState<"chase" | "all">("chase"); const [key, setKey] = useState(0);
  const data = useApRead<Chase>("ap_finishing", "chase", { page, show }, [key]);
  const [message, setMessage] = useState<Note>(null);
  const c = data.data?.coverage;
  return <Section title="Chase finishing vendors" description={c ? `${c.late} late or unaccounted job(s); ${c.late_without_followup} without a current promise.${c.no_lead_time ? ` ${c.no_lead_time} job(s) have a finish without a lead time, so they cannot be judged late; set it in factory planning.` : ""}` : "Material at anodizing and coating vendors beyond its expected return."}
    actions={<select aria-label="Show" className={`${inputClass} w-44`} value={show} onChange={e => { setShow(e.target.value as typeof show); setPage(1); }}><option value="chase">Needs a chase</option><option value="all">All with vendors</option></select>}>
    <Message value={message} />
    {data.loading && !data.data ? <Loading what="vendor material" /> : data.error ? <Failure text={data.error} /> : !data.data?.rows.length ? <Empty>{show === "chase" ? "No vendor-held material needs a chase today." : "No material is with a finishing vendor."}</Empty> :
      <div className="space-y-3">{data.data.rows.map(v => <VendorCard key={`${v.vendor_id}:${key}`} v={v} canRecord={canRecord} onChanged={text => { setMessage({ tone: "ok", text }); setKey(k => k + 1); }} />)}</div>}
    {data.data ? <Pager page={page} total={data.data.total_count} onPage={setPage} /> : null}
  </Section>;
}
