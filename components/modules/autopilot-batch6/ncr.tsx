"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, inputClass, useApRead } from "../order-to-cash/ui";
import { Action, Field, Filters, NumberInput, Stat, Why, num, optional, write, type Note, type Queue } from "./shared";

type Ncr = { id: string; ncr_number: string; status: "draft" | "open" | "closed" | "dismissed"; source_kind: "job" | "receipt" | "complaint"; title: string; description: string | null; cause: string | null; action: string | null;
  rejected_qty: number | null; checked_qty: number | null; reject_percent: number | null; unit: string | null; threshold: Record<string, unknown> | null; evidence: Record<string, unknown>;
  job_number: string | null; die_number: string | null; profile_code: string | null; order_number: string | null; customer: string | null; complaint: string | null;
  production_job_id: string | null; die_id: string | null; order_id: string | null; created_at: string; created_by_name: string; confirmed_by_name: string | null; confirmed_at: string | null;
  closed_by_name: string | null; closed_at: string | null; dismissed_by_name: string | null; dismissed_at: string | null; dismiss_reason: string | null };
const SOURCE: Record<string, string> = { job: "Production rejections", receipt: "Receipt rejections", complaint: "Customer complaint" };

export function NcrClient({ canDecide, canSetThresholds }: { canDecide: boolean; canSetThresholds: boolean }) {
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("attention"); const [page, setPage] = useState(1); const [rev, setRev] = useState(0); const [note, setNote] = useState<Note>(null);
  const read = useApRead<Queue<Ncr>>("ap_ncr", "list", { page, search, status }, [rev]);
  const coverage = useApRead<{ thresholds_set: boolean; jobs_above: number; jobs_covered: number; drafts: number; open: number; dismissed: number; complaints_30d: number }>("ap_ncr", "coverage", {}, [rev]);
  return <div className="space-y-5">
    <Section title="Non-conformance reports" description="Drafted by the system when rejections exceed QC's thresholds or a complaint is logged. QC confirms, records cause and action, or dismisses with a reason.">
      {coverage.data ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="Drafts to confirm" value={coverage.data.drafts} tone={coverage.data.drafts ? "warn" : undefined} />
        <Stat label="Open" value={coverage.data.open} /><Stat label="Jobs above threshold (60 days)" value={coverage.data.jobs_above} />
        <Stat label="Thresholds" value={coverage.data.thresholds_set ? "Set" : "Not set"} tone={coverage.data.thresholds_set ? "ok" : "bad"} /></div> : null}
      <Filters search={search} setSearch={v => { setSearch(v); setPage(1); }} show={status} setShow={v => { setStatus(v); setPage(1); }}
        options={[["attention", "Drafts and open"], ["draft", "Drafts"], ["open", "Open"], ["closed", "Closed"], ["dismissed", "Dismissed"], ["all", "All"]]} />
      <Message value={note} />
      {canDecide ? <Action secondary run={async () => { await write("ap_ncr", "detect", {}, setNote, "Checked. Rejections above threshold have a draft NCR."); setRev(v => v + 1); }}>Check rejections now</Action> : null}
      {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="NCRs" /> : read.data ? <>
        {!read.data.rows.length ? <Empty>No NCR matches.</Empty> : <ul className="divide-y">{read.data.rows.map(n => <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
          <div className="min-w-0"><Link className="font-bold underline" href={`/quality/ncrs/${n.id}`}>{n.ncr_number}</Link> <span className="text-sm">{n.title}</span>
            <p className="text-xs text-neutral-600">{SOURCE[n.source_kind]}{n.job_number ? ` · job ${n.job_number}` : ""}{n.die_number ? ` · die ${n.die_number}` : ""}{n.customer ? ` · ${n.customer}` : ""}
              {n.reject_percent != null ? ` · ${num(n.rejected_qty)} of ${num(n.checked_qty)} ${n.unit ?? ""} rejected (${num(n.reject_percent, 2)}%)` : ""} · {fmtWhen(n.created_at)}</p></div>
          <Pill value={n.status === "closed" ? "approved" : n.status === "dismissed" ? "cancelled" : n.status === "draft" ? "pending" : "open"} label={n.status} /></li>)}</ul>}
        <Pager page={page} total={read.data.total_count} onPage={setPage} />
      </> : null}
    </Section>
    {canSetThresholds ? <NcrThresholds onSaved={() => setRev(v => v + 1)} /> : null}
  </div>;
}

function NcrThresholds({ onSaved }: { onSaved: () => void }) {
  const read = useApRead<{ job_reject_percent?: number | null; job_reject_kg?: number | null; receipt_reject_percent?: number | null; updated_by_name?: string; updated_at?: string }>("ap_ncr", "settings", {});
  const [p, setP] = useState<string | null>(null); const [k, setK] = useState<string | null>(null); const [r, setR] = useState<string | null>(null); const [note, setNote] = useState<Note>(null);
  const v = read.data; const s = (x: number | null | undefined) => x == null ? "" : String(x);
  return <Section title="NCR thresholds" description="Set by the QC head. A job or receipt above any threshold gets a draft NCR. Leave blank to switch a rule off.">
    {!v ? <Loading what="thresholds" /> : <><div className="grid gap-3 sm:grid-cols-3">
      <Field label="Job rejection above (%)"><NumberInput value={p ?? s(v.job_reject_percent)} onChange={setP} /></Field>
      <Field label="Job rejection above (kg)"><NumberInput value={k ?? s(v.job_reject_kg)} onChange={setK} /></Field>
      <Field label="Receipt rejection above (%)"><NumberInput value={r ?? s(v.receipt_reject_percent)} onChange={setR} /></Field></div>
      {v.updated_at ? <p className="text-xs text-neutral-500">Last set by {v.updated_by_name ?? "—"} {fmtWhen(v.updated_at)}</p> : null}
      <Message value={note} />
      <Action run={async () => { const payload: Record<string, number> = {}; for (const [key, val] of [["job_reject_percent", p ?? s(v.job_reject_percent)], ["job_reject_kg", k ?? s(v.job_reject_kg)], ["receipt_reject_percent", r ?? s(v.receipt_reject_percent)]] as const) { const n = optional(val); if (n !== undefined) payload[key] = n; }
        if (await write("ap_ncr", "save_settings", payload, setNote, "Thresholds saved.")) onSaved(); }}>Save thresholds</Action></>}
  </Section>;
}

export function NcrRecord({ id, canDecide }: { id: string; canDecide: boolean }) {
  const [rev, setRev] = useState(0); const [note, setNote] = useState<Note>(null);
  const read = useApRead<Ncr>("ap_ncr", "get", { id }, [rev]);
  const [cause, setCause] = useState<string | null>(null); const [action, setAction] = useState<string | null>(null); const [reason, setReason] = useState("");
  const n = read.data;
  if (read.error) return <Failure text={read.error} />;
  if (!n) return <Loading what="NCR" />;
  const save = async (command: string, payload: Record<string, unknown>, ok: string) => { if (await write("ap_ncr", command, { id, ...payload }, setNote, ok)) setRev(v => v + 1); };
  return <div className="space-y-5">
    <Section title={`${n.ncr_number}: ${n.title}`} description={`${SOURCE[n.source_kind]} · raised by ${n.created_by_name} ${fmtWhen(n.created_at)}`}>
      <div className="flex flex-wrap gap-2"><Pill value={n.status === "closed" ? "approved" : n.status === "dismissed" ? "cancelled" : n.status === "draft" ? "pending" : "open"} label={n.status} /></div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {n.job_number ? <div><dt className="font-semibold">Job</dt><dd><Link className="underline" href={`/production/${n.production_job_id}`}>{n.job_number}</Link></dd></div> : null}
        {n.die_number ? <div><dt className="font-semibold">Die</dt><dd><Link className="underline" href={`/dies/${n.die_id}`}>{n.die_number}</Link></dd></div> : null}
        {n.profile_code ? <div><dt className="font-semibold">Profile</dt><dd>{n.profile_code}</dd></div> : null}
        {n.order_number ? <div><dt className="font-semibold">Order</dt><dd><Link className="underline" href={`/orders/${n.order_id}`}>{n.order_number}</Link></dd></div> : null}
        {n.customer ? <div><dt className="font-semibold">Customer</dt><dd>{n.customer}</dd></div> : null}
        {n.reject_percent != null ? <div><dt className="font-semibold">Rejected</dt><dd>{num(n.rejected_qty)} of {num(n.checked_qty)} {n.unit ?? ""} ({num(n.reject_percent, 2)}%)</dd></div> : null}
      </dl>
      {n.complaint ? <p className="rounded-xl bg-neutral-50 p-3 text-sm">Complaint: {n.complaint}</p> : n.description ? <p className="text-sm">{n.description}</p> : null}
      <Why value={{ threshold: n.threshold, ...n.evidence }} title="Linked billet lots, readings and thresholds" />
      <Message value={note} />
      {canDecide && n.status === "draft" ? <div className="space-y-3 border-t pt-3">
        <div className="flex flex-wrap gap-2"><Action run={() => save("confirm", {}, "NCR confirmed. Record the cause and corrective action.")}>Confirm NCR</Action></div>
        <Field label="Reason to dismiss"><input className={inputClass} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="For example: rejection already covered by NCR on the previous job" /></Field>
        <Action secondary disabled={reason.trim().length < 10} run={() => save("dismiss", { reason: reason.trim() }, "Dismissed with the reason recorded.")}>Dismiss draft</Action>
      </div> : null}
      {canDecide && n.status === "open" ? <div className="space-y-3 border-t pt-3">
        <Field label="Cause"><textarea className={`${inputClass} min-h-20 py-2`} value={cause ?? n.cause ?? ""} maxLength={2000} onChange={e => setCause(e.target.value)} /></Field>
        <Field label="Corrective action"><textarea className={`${inputClass} min-h-20 py-2`} value={action ?? n.action ?? ""} maxLength={2000} onChange={e => setAction(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2"><Action secondary run={() => save("update", { ...(cause?.trim() ? { cause: cause.trim() } : {}), ...(action?.trim() ? { action: action.trim() } : {}) }, "Saved.")}>Save cause and action</Action>
          <Action disabled={!(n.cause || cause?.trim()) || !(n.action || action?.trim())} run={() => save("close", {}, "NCR closed.")}>Close NCR</Action></div>
      </div> : null}
      {n.status === "closed" || n.status === "open" ? <dl className="grid gap-2 text-sm">{n.cause ? <div><dt className="font-semibold">Cause</dt><dd className="whitespace-pre-wrap">{n.cause}</dd></div> : null}{n.action ? <div><dt className="font-semibold">Corrective action</dt><dd className="whitespace-pre-wrap">{n.action}</dd></div> : null}</dl> : null}
      {n.status === "dismissed" ? <p className="text-sm">Dismissed by {n.dismissed_by_name} {fmtWhen(n.dismissed_at)}: {n.dismiss_reason}</p> : null}
      {n.confirmed_at ? <p className="text-xs text-neutral-500">Confirmed by {n.confirmed_by_name} {fmtWhen(n.confirmed_at)}{n.closed_at ? ` · closed by ${n.closed_by_name} ${fmtWhen(n.closed_at)}` : ""}</p> : null}
    </Section>
  </div>;
}

/** Logged on the customer or order; drafts an NCR for QC at once. Internal only. */
export function ComplaintForm({ customerId, orderId, dispatchId }: { customerId: string; orderId?: string; dispatchId?: string }) {
  const [text, setText] = useState(""); const [note, setNote] = useState<Note>(null); const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [ncr, setNcr] = useState<string | null>(null);
  return <Section title="Log a customer complaint" description="QC receives a draft NCR linked to this customer and order.">
    <Field label="What the customer reported"><textarea className={`${inputClass} min-h-20 py-2`} value={text} maxLength={1000} onChange={e => setText(e.target.value)} /></Field>
    <Message value={note} />
    <Action disabled={text.trim().length < 10} run={async () => {
      const data = await write<{ ncr_id: string }>("ap_ncr", "log_complaint", { request_id: requestId, customer_id: customerId, ...(orderId ? { order_id: orderId } : {}), ...(dispatchId ? { dispatch_id: dispatchId } : {}), description: text.trim() }, setNote, "Complaint logged. QC has a draft NCR.");
      if (data) { setNcr(data.ncr_id); setText(""); setRequestId(crypto.randomUUID()); }
    }}>Log complaint</Action>
    {ncr ? <Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`/quality/ncrs/${ncr}`}>Open the draft NCR</Link> : null}
  </Section>;
}
