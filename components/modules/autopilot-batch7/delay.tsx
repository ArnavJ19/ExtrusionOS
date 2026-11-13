"use client";

// AP-064: when the morning prediction (AP-063) turns an order line red, a customer notice is drafted with the new expected
// date. Sales edits it, sends it by copy or WhatsApp, and records that it was sent. Nothing is sent automatically.
import { useState } from "react";
import Link from "next/link";
import { fmtDay, fmtWhen, whatsappLink } from "@/lib/order-to-cash/commands";
import { DELAY_STATUS, SENT_VIA } from "@/lib/autopilot-batch7/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Line = { order_item_id: string; profile: string | null; ordered_kg: number | null; due_date: string | null; estimated_date: string | null; blocker: string; customer_status: string };
export type DelayNotice = { id: string; order_id: string; order_number: string; customer: string; prepared_on: string; lines: Line[]; new_date: string | null; message: string;
  phone: string | null; email: string | null; status: "prepared" | "sent" | "skipped" | "superseded"; copied_at: string | null; sent_via: string | null; sent_at: string | null;
  sent_by_name: string | null; skip_reason: string | null; skipped_by_name: string | null; edited_at: string | null; edited_by_name: string | null; closed_note: string | null; needs_date: boolean };
type Note = { tone: "ok" | "error"; text: string } | null;

export function DelayNoticeCard({ notice, canSend, onChanged }: { notice: DelayNotice; canSend: boolean; onChanged: (text?: string) => void }) {
  const [message, setMessage] = useState(notice.message); const [date, setDate] = useState(notice.new_date ?? "");
  const [via, setVia] = useState("whatsapp"); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null); const [busy, setBusy] = useState(false);
  const dirty = message !== notice.message || (date || null) !== notice.new_date;
  const open = notice.status === "prepared" && canSend;
  const wa = whatsappLink(notice.phone, message);
  async function run<T>(command: string, payload: Record<string, unknown>, ok: string) {
    setBusy(true); const out = await apWrite<T>("ap_delay", command, { id: notice.id, ...payload }, setNote, ok); setBusy(false);
    // A copy keeps the card on screen, so its note stays on the card; other changes remount it and report to the list.
    if (out) onChanged(command === "copy" ? undefined : ok); return out;
  }
  async function save() { return run("edit", { message, ...(date ? { new_date: date } : {}) }, "Notice updated."); }
  async function copy() {
    if (dirty && !(await save())) return;
    try { await navigator.clipboard.writeText(message); } catch { setNote({ tone: "error", text: "The browser blocked copying. Select the message and copy it yourself." }); return; }
    await run("copy", {}, "Copied. Mark it sent once it has gone to the customer.");
  }
  return <article className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-bold"><Link className="underline" href={`/orders/${notice.order_id}`}>{notice.order_number}</Link> · {notice.customer}</p>
        <p className="text-xs text-neutral-500">Prepared {fmtDay(notice.prepared_on)}{notice.edited_at ? ` · edited by ${notice.edited_by_name ?? "a colleague"} ${fmtWhen(notice.edited_at)}` : ""}{notice.copied_at ? ` · copied ${fmtWhen(notice.copied_at)}` : ""}</p></div>
      <Pill value={notice.status} label={DELAY_STATUS[notice.status]} />
    </div>
    <ul className="space-y-1 text-sm">{notice.lines.map(l => <li key={l.order_item_id} className="break-words">{l.profile ?? "Line"}{l.ordered_kg !== null ? ` (${l.ordered_kg} kg)` : ""}: due {fmtDay(l.due_date)}, expected {l.estimated_date ? fmtDay(l.estimated_date) : <b className="text-amber-800">not yet known</b>} · <span className="text-neutral-600">internally: {l.blocker}</span></li>)}</ul>
    {open ? <>
      <label className="block text-sm font-semibold">Message to the customer<textarea aria-label="Delay notice message" rows={6} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} className="mt-1 block w-full rounded-xl border border-neutral-300 p-3 text-sm font-normal" /></label>
      <label className="block text-sm font-semibold">New expected date{notice.needs_date ? " (required before sending: the estimate is not yet known)" : ""}<input type="date" aria-label="New expected date" value={date} onChange={e => setDate(e.target.value)} className={`${inputClass} mt-1 sm:w-52`} /></label>
      {notice.needs_date && date ? <p className="text-xs text-amber-800">Also write the date into the message text before sending.</p> : null}
      <div className="flex flex-wrap gap-2">
        {dirty ? <button type="button" disabled={busy} className={secondaryClass} onClick={() => void save()}>Save changes</button> : null}
        <button type="button" disabled={busy} className={secondaryClass} onClick={() => void copy()}>Copy message</button>
        {wa ? <a className={`${secondaryClass} inline-flex items-center`} href={wa} target="_blank" rel="noreferrer" onClick={() => { void apWrite("ap_delay", "copy", { id: notice.id }, () => undefined); }}>Open in WhatsApp</a> : <span className="self-center text-xs text-neutral-500">No Indian mobile number on the customer for WhatsApp.</span>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-sm font-semibold">Sent by<select aria-label="Sent by" value={via} onChange={e => setVia(e.target.value)} className={`${inputClass} mt-1 sm:w-40`}><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="phone_call">Phone call</option><option value="other">Other</option></select></label>
        <button type="button" disabled={busy || dirty} title={dirty ? "Save the changes first" : undefined} className={buttonClass} onClick={() => void run("send", { via }, "Recorded as sent.")}>Mark sent</button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm font-semibold">Or skip, with the reason<input aria-label="Reason for skipping" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} className={`${inputClass} mt-1`} placeholder="For example: told the customer on a call today" /></label>
        <button type="button" disabled={busy || reason.trim().length < 5} className={secondaryClass} onClick={() => void run("skip", { reason: reason.trim() }, "Skipped.")}>Skip</button>
      </div>
    </> : <div className="space-y-1 text-sm">
      <pre className="whitespace-pre-wrap break-words rounded-xl bg-neutral-50 p-3 font-sans text-sm">{notice.message}</pre>
      {notice.status === "sent" ? <p className="text-emerald-800">Sent by {SENT_VIA[notice.sent_via ?? ""] ?? notice.sent_via} · {notice.sent_by_name ?? "a colleague"} · {fmtWhen(notice.sent_at)}</p> : null}
      {notice.status === "skipped" ? <p className="text-neutral-700">Skipped by {notice.skipped_by_name ?? "a colleague"}: {notice.skip_reason}</p> : null}
      {notice.status === "superseded" ? <p className="text-neutral-600">{notice.closed_note ?? "Replaced by a newer notice."}</p> : null}
    </div>}
    <Message value={note} />
  </article>;
}

export function DelayQueueClient({ canSend, canPrepare }: { canSend: boolean; canPrepare: boolean }) {
  const [status, setStatus] = useState("prepared"); const [search, setSearch] = useState(""); const [sort, setSort] = useState("date"); const [page, setPage] = useState(1); const [key, setKey] = useState(0);
  const [note, setNote] = useState<Note>(null);
  const queue = useApRead<{ rows: DelayNotice[]; total_count: number }>("ap_delay", "list", { status, page, sort, ...(search.trim() ? { search: search.trim().slice(0, 80) } : {}) }, [key]);
  const coverage = useApRead<{ red_lines: number; sent: number; skipped: number; waiting: number; without_communication: number }>("ap_delay", "coverage", {}, [key]);
  return <div className="space-y-4">
    <Section title="Late lines and customer communication" description="Every line predicted late today, and whether the customer has been told in the last 30 days.">
      {coverage.data ? <p className={`text-sm font-semibold ${coverage.data.without_communication ? "text-rose-800" : "text-emerald-800"}`}>{coverage.data.red_lines} late line(s) · {coverage.data.sent} told · {coverage.data.skipped} skipped with a reason · {coverage.data.waiting} drafted, not yet sent · {coverage.data.without_communication} without a recorded communication</p>
        : coverage.error ? <Failure text={coverage.error} /> : <Loading what="coverage" />}
    </Section>
    <Section title="Delay notices" description="Drafted each night when a line turns red. Nothing reaches a customer until you send it and mark it sent."
      actions={canPrepare ? <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ prepared: number }>("ap_delay", "prepare", {}, setNote); if (out) { setNote({ tone: "ok", text: `${out.prepared} notice(s) drafted from today's prediction.` }); setKey(k => k + 1); } }}>Draft from today&apos;s prediction</button> : undefined}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Search<input type="search" aria-label="Search notices" value={search} maxLength={80} onChange={e => { setSearch(e.target.value); setPage(1); }} className={`${inputClass} mt-1`} placeholder="Order or customer" /></label>
        <label className="text-sm font-semibold">Show<select aria-label="Notice status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={`${inputClass} mt-1`}><option value="prepared">To send</option><option value="sent">Sent</option><option value="skipped">Skipped</option><option value="superseded">Replaced</option><option value="all">All</option></select></label>
        <label className="text-sm font-semibold">Sort by<select aria-label="Sort notices" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }} className={`${inputClass} mt-1`}><option value="date">Newest first</option><option value="name">Customer</option></select></label>
      </div>
      <Message value={note} />
      {queue.loading && !queue.data ? <Loading what="delay notices" /> : queue.error ? <Failure text={queue.error} /> : !queue.data?.rows.length ? <Empty>No notices in this list.</Empty>
        : <div className="space-y-3">{queue.data.rows.map(n => <DelayNoticeCard key={`${n.id}:${n.status}:${n.edited_at ?? ""}`} notice={n} canSend={canSend} onChanged={text => { if (text) setNote({ tone: "ok", text }); setKey(k => k + 1); }} />)}</div>}
      {queue.data ? <Pager page={page} total={queue.data.total_count} onPage={setPage} /> : null}
    </Section>
  </div>;
}

/** On the order record: its delay notices (newest first) and today's red lines. */
export function OrderDelayPanel({ orderId }: { orderId: string }) {
  const [key, setKey] = useState(0); const [note, setNote] = useState<Note>(null);
  const { data, error, loading } = useApRead<{ notices: DelayNotice[]; red_lines: number; can_send: boolean }>("ap_delay", "order", { order_id: orderId }, [key]);
  if (loading && !data) return null;
  if (error || !data) return error ? <Failure text={error} /> : null;
  if (!data.notices.length && !data.red_lines) return null;
  return <Section id="delay-notices" title="Customer delay notices" description={`${data.red_lines} line(s) predicted late today. Notices are drafted for you to edit and send.`}
    actions={<Link className="text-sm font-semibold underline" href="/orders/delay-notices">All notices</Link>}>
    {data.notices.length ? <div className="space-y-3">{data.notices.slice(0, 3).map(n => <DelayNoticeCard key={`${n.id}:${n.status}:${n.edited_at ?? ""}`} notice={n} canSend={data.can_send} onChanged={text => { if (text) setNote({ tone: "ok", text }); setKey(k => k + 1); }} />)}</div>
      : <Empty>Late lines found today; the notice is drafted with the next prediction run.</Empty>}
    <Message value={note} />
  </Section>;
}
