"use client";

// AP-031: quotation validity on the quote (expired by the nightly job, extended with a reason and approval, or requoted at
// today's rate as a new revision). AP-097: duplicate warnings shown and what people chose, plus a scan for likely pairs.
// AP-098: alerts and tasks the system closed because their condition cleared.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "./ui";

type Validity = { quote_id: string; status: string; valid_until: string | null; days_left: number | null; lapsed: boolean; revision_number: number;
  pending_request: { id: string; requested_valid_until: string; reason: string; requested_by: string; requested_at: string; can_decide: boolean } | null;
  can_extend: boolean; extension_needs_approval: boolean; can_requote: boolean;
  events: Array<{ event: string; old_valid_until: string | null; new_valid_until: string | null; revision_number: number | null; reason: string | null; actor: string | null; created_at: string }> };

export function QuoteValidityPanel({ quoteId, today }: { quoteId: string; today: string }) {
  const router = useRouter();
  const { data, error, loading, reload } = useApRead<Validity>("ap_quotes", "validity", { quote_id: quoteId });
  const [until, setUntil] = useState(""); const [reason, setReason] = useState(""); const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (loading && !data) return <Loading what="validity" />;
  if (error) return <Failure text={error} />;
  if (!data) return null;
  const after = async () => { void reload(); router.refresh(); };
  return <Section id="validity" title="Validity" description="Expired quotations are marked by the nightly job and cannot become orders until they are requoted at today's rate or extended with a reason.">
    <p className="text-sm">{data.valid_until ? `Valid until ${fmtDay(data.valid_until)}` : "No validity date"} · revision {data.revision_number} · {data.lapsed ? <Pill value="rejected" label="validity ended" /> : data.days_left !== null ? `${data.days_left} day(s) left` : ""}</p>
    {data.pending_request ? <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>{data.pending_request.requested_by} asked on {fmtWhen(data.pending_request.requested_at)} to extend to {fmtDay(data.pending_request.requested_valid_until)}: {data.pending_request.reason}</p>
      {data.pending_request.can_decide ? <div className="flex flex-wrap gap-2"><input aria-label="Decision note" value={note} onChange={e => setNote(e.target.value)} className={`${inputClass} flex-1`} placeholder="Note (required to reject)" />
        <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_quotes", "decide_extension", { request_id: data.pending_request!.id, decision: "approve", ...(note.trim() ? { note: note.trim() } : {}) }, setMessage, "Extension approved.")) void after(); }}>Approve</button>
        <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_quotes", "decide_extension", { request_id: data.pending_request!.id, decision: "reject", ...(note.trim() ? { note: note.trim() } : {}) }, setMessage, "Extension rejected.")) void after(); }}>Reject</button></div>
        : <p className="text-neutral-600">Waiting for an approver other than the requester.</p>}</div> : null}
    {data.can_requote ? <button type="button" className={buttonClass} onClick={async () => { const out = await apWrite<{ revision_number: number; lines_repriced: number; valid_until: string }>("ap_quotes", "requote", { quote_id: quoteId }, setMessage);
      if (out) { setMessage({ tone: "ok", text: `Revision ${out.revision_number} prepared at today's rate (${out.lines_repriced} line(s) repriced), valid until ${fmtDay(out.valid_until)}. Review and send it again.` }); void after(); } }}>Requote at today's rate</button> : null}
    {data.can_extend ? <details className="rounded-xl bg-neutral-50 p-3"><summary className="cursor-pointer text-sm font-semibold">Extend validity{data.extension_needs_approval ? " (needs approval)" : ""}</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3"><label className="text-sm font-semibold">New date<input type="date" min={today} value={until} onChange={e => setUntil(e.target.value)} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold sm:col-span-2">Reason<input value={reason} onChange={e => setReason(e.target.value)} className={`${inputClass} mt-1`} placeholder="Why the old rate still holds" /></label></div>
      <button type="button" className={`${buttonClass} mt-2`} onClick={async () => { const out = await apWrite<{ state: string }>("ap_quotes", "extend", { quote_id: quoteId, valid_until: until, reason: reason.trim() }, setMessage);
        if (out) { setMessage({ tone: "ok", text: out.state === "requested" ? "Extension requested; an approver is told." : "Validity extended." }); setReason(""); void after(); } }}>{data.extension_needs_approval ? "Request extension" : "Extend"}</button></details> : null}
    {data.events.length ? <details className="text-sm"><summary className="cursor-pointer font-semibold">Validity history</summary><ul className="mt-1 space-y-1">{data.events.map(e => <li key={e.created_at + e.event}>{fmtWhen(e.created_at)} · {e.event.replaceAll("_", " ")}
      {e.new_valid_until ? ` to ${fmtDay(e.new_valid_until)}` : ""}{e.actor ? ` · ${e.actor}` : " · system"}{e.reason ? ` · ${e.reason}` : ""}</li>)}</ul></details> : null}
    <Message value={message} />
  </Section>;
}

export function QuoteValidityQueue() {
  const [page, setPage] = useState(1); const [rPage, setRPage] = useState(1);
  const lapsed = useApRead<{ total_count: number; rows: Array<{ id: string; quote_number: string; customer: string; status: string; valid_until: string; grand_total: number }> }>("ap_quotes", "lapsed", { page });
  const requests = useApRead<{ total_count: number; rows: Array<{ id: string; quote_id: string; quote_number: string; customer: string; requested_valid_until: string; reason: string; requested_by: string }> }>("ap_quotes", "requests", { page: rPage });
  if (lapsed.error && requests.error) return null;
  return <div className="grid gap-4 lg:grid-cols-2">
    <Section title="Validity ended" description="Requote at today's rate or extend with a reason before converting.">
      {!lapsed.data ? <Loading what="quotations" /> : !lapsed.data.rows.length ? <Empty>No lapsed quotations.</Empty>
        : <ul className="space-y-1 text-sm">{lapsed.data.rows.map(q => <li key={q.id}><Link className="font-semibold underline" href={`/quotes/${q.id}#validity`}>{q.quote_number}</Link> · {q.customer} · {inr(q.grand_total)} · ended {fmtDay(q.valid_until)}</li>)}</ul>}
      {lapsed.data ? <Pager page={page} total={lapsed.data.total_count} onPage={setPage} /> : null}
    </Section>
    <Section title="Extension requests">
      {!requests.data ? <Loading what="requests" /> : !requests.data.rows.length ? <Empty>No extension waiting.</Empty>
        : <ul className="space-y-1 text-sm">{requests.data.rows.map(r => <li key={r.id}><Link className="font-semibold underline" href={`/quotes/${r.quote_id}#validity`}>{r.quote_number}</Link> · {r.customer} · to {fmtDay(r.requested_valid_until)} · {r.requested_by}: {r.reason}</li>)}</ul>}
      {requests.data ? <Pager page={rPage} total={requests.data.total_count} onPage={setRPage} /> : null}
    </Section>
  </div>;
}

export function DuplicatesClient() {
  const [page, setPage] = useState(1); const [kind, setKind] = useState<"order" | "receipt">("order"); const [sPage, setSPage] = useState(1);
  const log = useApRead<{ total_count: number; rows: Array<{ id: string; kind: string; decision: string; note: string | null; created_at: string; actor: string; matches: string[] }> }>("ap_dupes", "log", { page });
  const scan = useApRead<{ total_count: number; rows: Array<{ first_id: string; first: string | null; second_id: string; second: string | null; customer?: string; value?: number; amount?: number; second_created_at: string }> }>("ap_dupes", "scan", { page: sPage, kind });
  return <div className="space-y-4">
    <Section title="Possible duplicates in the last 90 days" description="Pairs entered within three days for the same customer and amount. Review each pair; cancel or reverse the extra one in its module."
      actions={<select aria-label="Record type" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setSPage(1); }} className={`${inputClass} w-36`}><option value="order">Orders</option><option value="receipt">Receipts</option></select>}>
      {scan.error ? <Failure text={scan.error} /> : !scan.data ? <Loading what="scan" /> : !scan.data.rows.length ? <Empty>No likely duplicates found.</Empty>
        : <ul className="space-y-1 text-sm">{scan.data.rows.map(p => <li key={p.first_id + p.second_id}>{kind === "order" ? <><Link className="underline" href={`/orders/${p.first_id}`}>{p.first}</Link> and <Link className="underline" href={`/orders/${p.second_id}`}>{p.second}</Link> · {p.customer} · {inr(p.value)}</>
          : <>{p.first ?? "Receipt"} and {p.second ?? "receipt"} · {inr(p.amount)}</>} · {fmtWhen(p.second_created_at)}</li>)}</ul>}
      {scan.data ? <Pager page={sPage} total={scan.data.total_count} onPage={setSPage} /> : null}
    </Section>
    <Section title="Warnings answered" description="Each time a person saved despite a duplicate warning.">
      {log.error ? <Failure text={log.error} /> : !log.data ? <Loading what="log" /> : !log.data.rows.length ? <Empty>No warning has been overridden.</Empty>
        : <ul className="space-y-1 text-sm">{log.data.rows.map(w => <li key={w.id}>{fmtWhen(w.created_at)} · {w.actor} · {w.kind} · {w.decision.replace("_", " ")}{w.note ? ` · ${w.note}` : ""}</li>)}</ul>}
      {log.data ? <Pager page={page} total={log.data.total_count} onPage={setPage} /> : null}
    </Section>
  </div>;
}

export function AlertResolutionsPanel() {
  const [page, setPage] = useState(1);
  const { data, error } = useApRead<{ total_count: number; open_alerts: number; rows: Array<{ id: string; source_kind: string; outcome: string; note: string; title: string | null; trigger_source: string; resolved_at: string }> }>("ap_dupes", "alerts", { page });
  if (error) return null;
  return <Section title="Closed by the system" description="Alerts, tasks and credit holds re-checked on the business event and hourly; those whose condition cleared are closed with a note. Tasks with a completion checklist are only flagged.">
    {!data ? <Loading what="resolutions" /> : <>
      <p className="text-sm font-semibold">{data.open_alerts} unread alert(s) still open.</p>
      {!data.rows.length ? <Empty>Nothing closed by the system yet.</Empty> : <ul className="space-y-1 text-sm">{data.rows.map(r => <li key={r.id}>{fmtWhen(r.resolved_at)} · {r.source_kind.replace("_", " ")} · {r.title ?? "—"} · <Pill value={r.outcome === "closed" ? "passed" : "held"} label={r.outcome} /> · {r.trigger_source === "event" ? "on the event" : "hourly check"}</li>)}</ul>}
      <Pager page={page} total={data.total_count} onPage={setPage} /></>}
  </Section>;
}

export function OrderToCashAttention() {
  const { data } = useApRead<{ items: Array<{ key: string; label: string; href: string; count: number }> }>("ap_dupes", "attention", {});
  const items = (data?.items ?? []).filter(i => i.count > 0);
  if (!items.length) return null;
  return <ul className="flex flex-wrap gap-2">{items.map(i => <li key={i.key}><Link href={i.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 text-sm font-semibold">
    {i.label}<span className="rounded-full bg-neutral-950 px-2 text-xs text-white">{i.count}</span></Link></li>)}</ul>;
}
