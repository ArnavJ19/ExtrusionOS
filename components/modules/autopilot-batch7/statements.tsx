"use client";

// AP-079: monthly customer statements. On the first working day of the month the morning job prepares last month's
// statement for every customer with a balance. Accounts reviews each, downloads the PDF or emails it, and records how it
// was sent. Each statement is built from that one customer's invoices, receipts and credit notes.
import { useState } from "react";
import { emailStatementAction } from "@/lib/actions/autopilot-batch7";
import { fmtDay, fmtWhen, inr, whatsappLink } from "@/lib/order-to-cash/commands";
import { SENT_VIA } from "@/lib/autopilot-batch7/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Statement = { id: string; customer_id: string; customer: string; period_start: string; period_end: string; opening_balance: number; invoiced: number; received: number; credited: number;
  closing_balance: number; on_account: number; message: string; phone: string | null; email: string | null; status: "prepared" | "sent" | "skipped" | "superseded";
  copied_at: string | null; sent_via: string | null; sent_at: string | null; sent_by_name: string | null; skip_reason: string | null; skipped_by_name: string | null; prepared_by_name: string };
type Note = { tone: "ok" | "error"; text: string } | null;
const STATUS: Record<string, string> = { prepared: "To send", sent: "Sent", skipped: "Skipped", superseded: "Rebuilt" };
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
/** The month before today's IST month, as YYYY-MM. */
function lastMonth() { const now = new Date(Date.now() + 5.5 * 3600 * 1000); const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); return d.toISOString().slice(0, 7); }

function StatementCard({ s, onChanged }: { s: Statement; onChanged: (text?: string) => void }) {
  const [via, setVia] = useState("whatsapp"); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null); const [busy, setBusy] = useState(false);
  const wa = whatsappLink(s.phone, s.message);
  async function run(command: string, payload: Record<string, unknown>, ok: string) {
    setBusy(true); const out = await apWrite("ap_statement", command, { id: s.id, ...payload }, setNote, ok); setBusy(false); if (out) onChanged(command === "copy" ? undefined : ok);
  }
  return <article className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-bold">{s.customer}</p><p className="text-xs text-neutral-500">{monthLabel(s.period_start)} · {fmtDay(s.period_start)} to {fmtDay(s.period_end)} · prepared by {s.prepared_by_name}</p></div>
      <Pill value={s.status} label={STATUS[s.status]} />
    </div>
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
      {([["Opening", s.opening_balance], ["Invoiced", s.invoiced], ["Received", s.received], ["Credit notes", s.credited], ["Closing", s.closing_balance]] as const).map(([label, value]) =>
        <div key={label} className="rounded-xl bg-neutral-50 p-2"><dt className="text-xs text-neutral-500">{label}</dt><dd className={`font-bold ${label === "Closing" ? "text-neutral-950" : ""}`}>{inr(value)}</dd></div>)}
    </dl>
    {Number(s.on_account) > 0 ? <p className="text-xs text-neutral-600">{inr(s.on_account)} received on account and not yet allocated is shown separately.</p> : null}
    <details className="text-sm"><summary className="min-h-10 cursor-pointer py-2 font-semibold">Message</summary><pre className="whitespace-pre-wrap break-words rounded-xl bg-neutral-50 p-3 font-sans text-sm">{s.message}</pre></details>
    <div className="flex flex-wrap gap-2">
      <a className={`${secondaryClass} inline-flex items-center`} href={`/api/pdf/statement/${s.id}`} target="_blank" rel="noreferrer">Download PDF</a>
      {s.status === "prepared" ? <>
        <button type="button" disabled={busy} className={secondaryClass} onClick={async () => {
          try { await navigator.clipboard.writeText(s.message); } catch { setNote({ tone: "error", text: "The browser blocked copying. Open the message and copy it yourself." }); return; }
          await run("copy", {}, "Copied. Mark it sent once it has gone to the customer.");
        }}>Copy message</button>
        {wa ? <a className={`${secondaryClass} inline-flex items-center`} href={wa} target="_blank" rel="noreferrer" onClick={() => { void apWrite("ap_statement", "copy", { id: s.id }, () => undefined); }}>Open in WhatsApp</a> : null}
        {s.email ? <button type="button" disabled={busy} className={secondaryClass} onClick={async () => {
          setBusy(true); const r = await emailStatementAction(s.id); setBusy(false);
          if (r.success) onChanged(`Emailed to ${s.email} through ${r.data.provider}.`); else setNote({ tone: "error", text: r.error });
        }}>Email to {s.email}</button> : <span className="self-center text-xs text-neutral-500">No email on the customer.</span>}
      </> : null}
    </div>
    {s.status === "prepared" ? <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-sm font-semibold">Sent by<select aria-label="Statement sent by" value={via} onChange={e => setVia(e.target.value)} className={`${inputClass} mt-1 sm:w-44`}>
          <option value="whatsapp">WhatsApp</option><option value="email">Email (sent yourself)</option><option value="post">Post / courier</option><option value="phone_call">Phone call</option><option value="other">Other</option></select></label>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => void run("send", { via }, "Recorded as sent.")}>Mark sent</button>
        <button type="button" disabled={busy} className={secondaryClass} title="Rebuild from the records as they are now (after a correction in the month)" onClick={() => void run("rebuild", {}, "Statement rebuilt from current records.")}>Rebuild</button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm font-semibold">Or skip, with the reason<input aria-label="Reason for skipping the statement" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} className={`${inputClass} mt-1`} placeholder="For example: balance settled in full on the 2nd" /></label>
        <button type="button" disabled={busy || reason.trim().length < 5} className={secondaryClass} onClick={() => void run("skip", { reason: reason.trim() }, "Skipped.")}>Skip</button>
      </div>
    </> : s.status === "sent" ? <p className="text-sm text-emerald-800">Sent by {SENT_VIA[s.sent_via ?? ""] ?? s.sent_via} · {s.sent_by_name ?? "a colleague"} · {fmtWhen(s.sent_at)}</p>
      : s.status === "skipped" ? <p className="text-sm text-neutral-700">Skipped by {s.skipped_by_name ?? "a colleague"}: {s.skip_reason}</p> : null}
    <Message value={note} />
  </article>;
}

export function StatementsClient() {
  const [status, setStatus] = useState("prepared"); const [period, setPeriod] = useState(""); const [search, setSearch] = useState(""); const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1); const [key, setKey] = useState(0); const [note, setNote] = useState<Note>(null); const [prepareFor, setPrepareFor] = useState(lastMonth());
  const queue = useApRead<{ rows: Statement[]; total_count: number; last_period: string | null }>("ap_statement", "queue", { status, page, sort, ...(period ? { period } : {}), ...(search.trim() ? { search: search.trim().slice(0, 80) } : {}) }, [key]);
  const coverage = useApRead<{ period_start: string; with_balance: number; sent: number; prepared: number; skipped: number; missing: number }>("ap_statement", "coverage", { period: period || lastMonth() }, [key]);
  return <div className="space-y-4">
    <Section title="Coverage" description="Every customer with a balance at the month end should receive that month's statement.">
      {coverage.data ? <p className={`text-sm font-semibold ${coverage.data.missing || coverage.data.prepared ? "text-amber-900" : "text-emerald-800"}`}>{monthLabel(coverage.data.period_start)}: {coverage.data.with_balance} customer(s) with a balance · {coverage.data.sent} sent · {coverage.data.prepared} waiting · {coverage.data.skipped} skipped · {coverage.data.missing} not prepared</p>
        : coverage.error ? <Failure text={coverage.error} /> : <Loading what="coverage" />}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-sm font-semibold">Prepare for month<input type="month" aria-label="Prepare statements for month" value={prepareFor} max={lastMonth()} onChange={e => setPrepareFor(e.target.value)} className={`${inputClass} mt-1 sm:w-48`} /></label>
        <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ prepared: number }>("ap_statement", "prepare", { period: prepareFor }, setNote); if (out) { setNote({ tone: "ok", text: `${out.prepared} statement(s) prepared for ${monthLabel(`${prepareFor}-01`)}.` }); setKey(k => k + 1); } }}>Prepare missing statements</button>
      </div>
      <p className="text-xs text-neutral-500">The morning job does this on the first working day of each month; this button only fills gaps.</p>
    </Section>
    <Section title="Statement queue" description="Review each statement, then download, copy, WhatsApp or email it and record how it was sent.">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm font-semibold">Search<input type="search" aria-label="Search statements" value={search} maxLength={80} onChange={e => { setSearch(e.target.value); setPage(1); }} className={`${inputClass} mt-1`} placeholder="Customer" /></label>
        <label className="text-sm font-semibold">Show<select aria-label="Statement status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={`${inputClass} mt-1`}><option value="prepared">To send</option><option value="sent">Sent</option><option value="skipped">Skipped</option><option value="superseded">Rebuilt</option><option value="all">All</option></select></label>
        <label className="text-sm font-semibold">Month<input type="month" aria-label="Statement month" value={period} onChange={e => { setPeriod(e.target.value); setPage(1); }} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold">Sort by<select aria-label="Sort statements" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }} className={`${inputClass} mt-1`}><option value="date">Month, then customer</option><option value="amount">Largest balance</option></select></label>
      </div>
      <Message value={note} />
      {queue.loading && !queue.data ? <Loading what="statements" /> : queue.error ? <Failure text={queue.error} /> : !queue.data?.rows.length ? <Empty>No statements in this list.</Empty>
        : <div className="space-y-3">{queue.data.rows.map(s => <StatementCard key={`${s.id}:${s.status}`} s={s} onChanged={text => { if (text) setNote({ tone: "ok", text }); setKey(k => k + 1); }} />)}</div>}
      {queue.data ? <Pager page={page} total={queue.data.total_count} onPage={setPage} /> : null}
    </Section>
  </div>;
}
