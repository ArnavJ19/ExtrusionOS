"use client";

// Scrap receipts: the paginated register, one receipt with everything recorded at each step, the factory manager's
// decision on a request to leave, and the accounts bill (vendor, bill, rate, GST, freight, discount and the bill file).
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FILE_KINDS, FINANCE_FILE_KINDS, FINANCE_STATUS, PROCESSING_STEPS, QUALITY_ISSUES, READINESS, RECEIPT_QUALITIES, RECEIPT_STATUS, VISUAL_CHECKS, VISUAL_CHECK_KEYS,
  type FileKind, type ReceiptDetail
} from "@/lib/foundry/scrap-receiving";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../../order-to-cash/ui";
import { BillForm, FileAttach, FileList, kgText, labelClass, type Note } from "./shared";

type Row = { id: string; receipt_number: string; status: string; started_at: string; completed_at: string | null; started_by: string; vehicle_number: string | null;
  net_kg: number | null; accepted_kg: number | null; rejected_kg: number | null; quality_ok: boolean | null; scrap_type: string | null; alloy: string | null;
  finance_status: string; abort_attempts: number; exit_requested: boolean; request_number: string | null };

const STATUS_TONE: Record<string, string> = { inspection: "open", details: "open", completed: "approved", exited: "cancelled" };
const FILTERS = [["in_progress", "In progress"], ["exit_requested", "Exit requested"], ["completed", "Received"], ["finance_pending", "Bill pending"], ["exited", "Left with approval"], ["all", "All"]] as const;

export function ReceiptStatus({ status, exitRequested }: { status: string; exitRequested?: boolean }) {
  if (exitRequested && (status === "inspection" || status === "details")) return <Pill value="blocked" label="Exit requested" />;
  return <Pill value={STATUS_TONE[status] ?? "unknown"} label={RECEIPT_STATUS[status] ?? status} />;
}

export function ReceiptRegister({ initialStatus = "all" }: { initialStatus?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus); const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [term, setTerm] = useState("");
  const list = useApRead<{ rows: Row[]; total: number }>("ap_scrap_receipt", "receipts", { page, status, ...(term ? { search: term } : {}) }, [page, status, term]);
  return <Section title="Scrap receipts" description="Every load received through the guided procedure, newest first. Ten per page.">
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="Receipt status">{FILTERS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={status === key}
      className={`min-h-9 rounded-full border px-3 text-xs font-bold ${status === key ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white"}`} onClick={() => { setStatus(key); setPage(1); }}>{label}</button>)}</div>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); setPage(1); }}>
      <input className={inputClass} aria-label="Search receipts" placeholder="Receipt no., vehicle or weighbridge slip" value={search} maxLength={60} onChange={(e) => setSearch(e.target.value)} />
      <button type="submit" className={secondaryClass}>Search</button></form>
    {list.loading && !list.data ? <Loading what="receipts" /> : list.error ? <Failure text={list.error} /> : !list.data?.rows.length ? <Empty>No receipts here.</Empty> : <>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Receipt</th><th className="p-2">Status</th><th className="p-2">Material</th>
          <th className="p-2 text-right">Net</th><th className="p-2 text-right">Accepted</th><th className="p-2">Accounts</th><th className="p-2">Received by</th></tr></thead>
        <tbody>{list.data.rows.map((row) => <tr key={row.id} className="cursor-pointer border-t hover:bg-neutral-50" onClick={() => router.push(`/foundry/scrap/receipts/${row.id}`)}>
          <td className="p-2"><Link className="font-bold underline" href={`/foundry/scrap/receipts/${row.id}`} onClick={(e) => e.stopPropagation()}>{row.receipt_number}</Link>
            <span className="block text-xs text-neutral-500">{fmtWhen(row.started_at)}{row.vehicle_number ? ` · ${row.vehicle_number}` : ""}</span></td>
          <td className="p-2"><ReceiptStatus status={row.status} exitRequested={row.exit_requested} />{row.quality_ok === false ? <span className="ml-1"><Pill value="rejected" label="Quality issue" /></span> : null}</td>
          <td className="p-2">{row.scrap_type ?? "—"}{row.alloy ? <span className="block text-xs text-neutral-500">{row.alloy}{row.request_number ? ` · ${row.request_number}` : ""}</span> : null}</td>
          <td className="p-2 text-right tabular-nums">{kgText(row.net_kg)}</td><td className="p-2 text-right tabular-nums">{kgText(row.accepted_kg)}</td>
          <td className="p-2">{row.finance_status === "not_ready" ? "—" : <Pill value={row.finance_status === "completed" ? "posted" : "held"} label={FINANCE_STATUS[row.finance_status]} />}</td>
          <td className="p-2">{row.started_by}</td></tr>)}</tbody>
      </table></div>
      <Pager page={page} total={list.data.total} onPage={setPage} />
    </>}
  </Section>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs font-bold uppercase tracking-wide text-neutral-500">{label}</dt><dd className="text-sm font-semibold">{value ?? "—"}</dd></div>;
}

export function ReceiptView({ companyId, id }: { companyId: string; id: string }) {
  const receipt = useApRead<ReceiptDetail>("ap_scrap_receipt", "get", { id }, []);
  const r = receipt.data;
  if (receipt.loading && !r) return <Loading what="the receipt" />;
  if (receipt.error || !r) return <Failure text={receipt.error ?? "The receipt could not be loaded."} />;
  const inProgress = r.status === "inspection" || r.status === "details";
  return <div className="space-y-4">
    <Section title={r.receipt_number} description={`Started ${fmtWhen(r.started_at)} by ${r.started_by}`} actions={<ReceiptStatus status={r.status} exitRequested={Boolean(r.exit_requested_at)} />}>
      {inProgress && r.is_receiver ? <Link className={`${buttonClass} inline-flex items-center`} href="/foundry/scrap/receive">Continue receiving</Link> : null}
      <dl className="grid gap-3 sm:grid-cols-4">
        <Fact label="Net weight" value={kgText(r.net_kg)} /><Fact label="Into stock" value={kgText(r.accepted_kg)} />
        <Fact label="Not of quality" value={kgText(r.rejected_kg)} /><Fact label="Request" value={r.request ? `${r.request.request_number} · ${r.request.scrap_type} · ${kgText(r.request.quantity_kg)}` : "Unplanned"} />
      </dl>
      {r.accepted_lot || r.rejected_lot ? <p className="text-sm">Scrap lots: {r.accepted_lot ? <Link className="font-bold underline" href={`/foundry/scrap/${r.accepted_lot.id}`}>{r.accepted_lot.scrap_number} (available {kgText(r.accepted_lot.available_weight_kg)})</Link> : null}
        {r.accepted_lot && r.rejected_lot ? " · " : null}{r.rejected_lot ? <Link className="font-bold underline" href={`/foundry/scrap/${r.rejected_lot.id}`}>{r.rejected_lot.scrap_number} (rejected: return or debit note through Lot disposition)</Link> : null}</p> : null}
    </Section>

    <ExitPanel receipt={r} onChange={receipt.reload} />

    <Section title="Step 1 · Presence at the site">
      <p className="text-sm">{r.receiver_present ? `${r.started_by} was at the receiving site.` : <>Received on behalf of {r.started_by} by <b>{r.proxy_name}</b> ({r.proxy_phone}). Reason: {r.proxy_reason}</>}</p>
    </Section>

    <Section title="Step 2 · Visual verification" description={r.inspected_at ? `Recorded ${fmtWhen(r.inspected_at)}` : "Not recorded yet."}>
      <dl className="grid gap-3 sm:grid-cols-4">
        <Fact label="Vehicle" value={r.vehicle_number} /><Fact label="Weighbridge slip" value={r.weighbridge_reference} /><Fact label="Challan" value={r.challan_number} />
        <Fact label="Gross / tare" value={r.gross_kg !== null ? `${kgText(r.gross_kg)} / ${kgText(r.tare_kg)}` : null} />
      </dl>
      {r.quality_ok !== null ? <p className="text-sm font-bold">{r.quality_ok ? "Scrap of the expected quality." : `Not of quality: ${r.rejection_scope === "all" ? "all of the load" : `a portion of ${kgText(r.rejected_kg)}`}.`}</p> : null}
      {r.quality_ok === false ? <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900"><p><b>Problems:</b> {r.issues.map((x) => QUALITY_ISSUES[x] ?? x).join(", ")}</p><p className="mt-1"><b>Reason:</b> {r.rejection_reason}</p></div> : null}
      {Object.keys(r.checklist ?? {}).length ? <ul className="grid gap-1 text-sm sm:grid-cols-2">{VISUAL_CHECK_KEYS.map((key) => <li key={key} className="flex items-start gap-2">
        <span aria-hidden className={r.checklist[key] ? "text-emerald-700" : "text-rose-700"}>{r.checklist[key] ? "✓" : "✗"}</span><span>{VISUAL_CHECKS[key]}<span className="sr-only">: {r.checklist[key] ? "yes" : "no"}</span></span></li>)}</ul> : null}
      {r.inspection_notes ? <p className="text-sm text-neutral-700">{r.inspection_notes}</p> : null}
      <FileList files={r.files} kinds={["inspection_photo", "rejection_photo", "weighbridge_slip"]} empty="No photos." />
    </Section>

    <Section title="Step 3 · Material details" description={r.completed_at ? `Completed ${fmtWhen(r.completed_at)} by ${r.completed_by}` : "Not recorded yet."}>
      <dl className="grid gap-3 sm:grid-cols-4">
        <Fact label="Scrap type" value={r.scrap_type} /><Fact label="Alloy" value={r.alloy} />
        <Fact label="Readiness" value={r.readiness ? READINESS[r.readiness] : null} /><Fact label="Quality grade" value={r.scrap_quality ? RECEIPT_QUALITIES[r.scrap_quality as keyof typeof RECEIPT_QUALITIES] ?? r.scrap_quality : null} />
      </dl>
      {r.processing_steps.length ? <p className="text-sm"><b>Processing needed:</b> {r.processing_steps.map((x) => PROCESSING_STEPS[x] ?? x).join(", ")}</p> : null}
      {r.detail_notes ? <p className="text-sm text-neutral-700">{r.detail_notes}</p> : null}
    </Section>

    {r.can_finance || r.finance ? <FinancePanel companyId={companyId} receipt={r} onChange={receipt.reload} /> : r.status === "completed"
      ? <Section title="Accounts"><p className="text-sm">{r.finance_status === "completed" ? "Bill recorded by accounts." : "Bill pending: accounts enter the vendor, bill, rate and tax."}</p></Section> : null}
  </div>;
}

function ExitPanel({ receipt, onChange }: { receipt: ReceiptDetail; onChange: () => void }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  const pending = Boolean(receipt.exit_requested_at) && (receipt.status === "inspection" || receipt.status === "details");
  if (!receipt.abort_attempts && !receipt.exit_decision) return null;
  async function decide(decision: "approved" | "declined") {
    setBusy(true);
    const out = await apWrite("ap_scrap_receipt", "decide_exit", { receipt_id: receipt.id, decision, reason: reason.trim() }, setMessage);
    setBusy(false);
    if (out) { setReason(""); onChange(); }
  }
  return <Section title="Exit attempts" description={`${receipt.abort_attempts} attempt(s) to leave after step 1${receipt.escalated_at ? `; factory manager alerted ${fmtWhen(receipt.escalated_at)}` : ""}.`}>
    {receipt.exit_request_reason ? <p className="text-sm"><b>Receiver&apos;s reason:</b> {receipt.exit_request_reason}</p> : null}
    {receipt.exit_decision ? <p className="text-sm"><b>{receipt.exit_decision === "approved" ? "Allowed" : "Refused"}</b> by {receipt.exit_decided_by} {fmtWhen(receipt.exit_decided_at)}: {receipt.exit_decision_reason}</p> : null}
    {pending && receipt.can_decide_exit ? <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-bold text-amber-900">Only you can let the receiver leave this receipt. If you allow it, no scrap is recorded.</p>
      <label className={labelClass}>Your reason (required)<textarea className={`${inputClass} min-h-16 py-2`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="At least 10 characters" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy || reason.trim().length < 10} onClick={() => decide("approved")}>Allow them to leave</button>
        <button type="button" className={secondaryClass} disabled={busy || reason.trim().length < 10} onClick={() => decide("declined")}>Ask them to finish receiving</button>
      </div>
      <Message value={message} />
    </div> : null}
  </Section>;
}

function FinancePanel({ companyId, receipt, onChange }: { companyId: string; receipt: ReceiptDetail; onChange: () => void }) {
  const [kind, setKind] = useState<FileKind>("bill");
  const f = receipt.finance;
  const hasBill = receipt.files.some((x) => x.kind === "bill");
  return <Section title="Accounts · bill and vendor" description={receipt.accepted_kg ? `Charged on the ${kgText(receipt.accepted_kg)} taken into stock${receipt.rejected_kg ? `; the ${kgText(receipt.rejected_kg)} not of quality is for return or a debit note` : ""}.` : "Nothing was taken into stock; record the bill for the return or debit note."}
    actions={<Pill value={receipt.finance_status === "completed" ? "posted" : "held"} label={FINANCE_STATUS[receipt.finance_status]} />}>
    {f?.expense ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Expense <Link className="font-bold underline" href={`/expenses/${f.expense.id}`}>{f.expense.expense_number}</Link> · {inr(f.expense.total_amount)} · {f.expense.approval_status.replaceAll("_", " ")} · {f.expense.payment_status.replaceAll("_", " ")}</p> : null}
    {f?.completed_at ? <p className="text-xs text-neutral-500">Last saved by {f.completed_by} {fmtWhen(f.completed_at)}{f.invoice_date ? ` · bill dated ${fmtDay(f.invoice_date)}` : ""}</p> : null}
    {receipt.can_finance ? <>
      <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
        <label className={labelClass}>Document<select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>{FINANCE_FILE_KINDS.map((k) => <option key={k} value={k}>{FILE_KINDS[k]}</option>)}</select></label>
        <FileAttach key={kind} companyId={companyId} parent={receipt.id} parentKey="receipt_id" kind={kind} label={`Attach the ${FILE_KINDS[kind].toLowerCase()}`} onAdded={onChange} />
      </div>
      <FileList files={receipt.files} kinds={FINANCE_FILE_KINDS} empty="No bill attached yet." />
      <BillForm command="finance_save" idKey="receipt_id" id={receipt.id} kg={Number(receipt.accepted_kg ?? 0)} initial={f} hasBill={hasBill} onSaved={onChange} />
    </> : <FileList files={receipt.files} kinds={FINANCE_FILE_KINDS} />}
  </Section>;
}
