"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { autopilotAction } from "@/lib/actions/autopilot";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { ProposalCards } from "../autopilot/proposal-cards";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Filters = { page: number; search: string; sort: "date" | "name"; show: "attention" | "all" };
type Queue<T> = { rows: T[]; page: number; total_count: number };
const initialFilters: Filters = { page: 1, search: "", sort: "date", show: "attention" };
const kg = (v: number | null | undefined) => v == null ? "Unknown" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;

function FiltersBar({ value, set }: { value: Filters; set: (v: Filters) => void }) {
  return <div className="grid gap-3 sm:grid-cols-3">
    <label className="text-sm font-semibold">Search<input type="search" className={`${inputClass} mt-1`} value={value.search} maxLength={80} onChange={e => set({ ...value, page: 1, search: e.target.value })} /></label>
    <label className="text-sm font-semibold">Show<select className={`${inputClass} mt-1`} value={value.show} onChange={e => set({ ...value, page: 1, show: e.target.value as Filters["show"] })}><option value="attention">Needs attention</option><option value="all">All</option></select></label>
    <label className="text-sm font-semibold">Sort by<select className={`${inputClass} mt-1`} value={value.sort} onChange={e => set({ ...value, page: 1, sort: e.target.value as Filters["sort"] })}><option value="date">Date</option><option value="name">Name</option></select></label>
  </div>;
}
function Action({ children, run, disabled = false, secondary = false }: { children: ReactNode; run: () => Promise<void>; disabled?: boolean; secondary?: boolean }) {
  const lock = useRef(false); const [busy, setBusy] = useState(false);
  return <button type="button" className={secondary ? secondaryClass : buttonClass} disabled={busy || disabled} onClick={async () => {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await run(); } finally { lock.current = false; setBusy(false); }
  }}>{busy ? "Saving..." : children}</button>;
}
function Why({ value }: { value: unknown }) {
  return <details className="text-xs text-neutral-600"><summary className="min-h-10 cursor-pointer py-2 font-semibold">Calculation and source evidence</summary><div className="max-h-72 overflow-auto break-words rounded-xl bg-neutral-50 p-3"><Evidence value={value} /></div></details>;
}
function Evidence({ value }: { value: unknown }) {
  if (value == null) return <span>Not recorded</span>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-2">{value.map((v, index) => <li key={index} className="border-l border-neutral-200 pl-2"><Evidence value={v} /></li>)}</ul> : <span>None</span>;
  if (typeof value === "object") return <dl className="space-y-1">{Object.entries(value).map(([k, v]) => <div key={k}><dt className="font-semibold capitalize">{k.replaceAll("_", " ")}</dt><dd className="ml-2"><Evidence value={v} /></dd></div>)}</dl>;
  return <span>{typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</span>;
}
async function write(rpc: string, command: string, payload: Record<string, unknown>, set: (v: Note) => void, success: string) {
  const result = await autopilotAction(rpc, command, payload);
  set(result.success ? { tone: "ok", text: success } : { tone: "error", text: result.error });
  return result;
}

type Digest = { id: string; digest_date: string; generated_at: string; message: string; metrics: Record<string, number | string | null> };
export function OwnerDigest() {
  const read = useApRead<Digest>("ap_digest", "digest", {}); const [note, setNote] = useState<Note>(null);
  return <Section title="Morning digest" description="Internal management snapshot prepared at 08:00 IST. Figures retain their generation time.">
    <Message value={note} />
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="digest" /> : !read.data ? <Empty>No digest has been prepared for today.</Empty> : <>
      <p className="text-xs font-semibold text-neutral-500">As of {fmtWhen(read.data.generated_at)}</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{read.data.message}</p>
      <div className="flex flex-wrap gap-2"><Action secondary run={async () => {
        try { await navigator.clipboard.writeText(read.data!.message); await write("ap_digest", "digest_read", { id: read.data!.id, kind: "copied" }, setNote, "Copied. Nothing has been sent."); }
        catch { setNote({ tone: "error", text: "Copy failed. Select the summary text to copy it." }); }
      }}>Copy digest</Action><Action secondary run={async () => { await write("ap_digest", "digest_read", { id: read.data!.id, kind: "read" }, setNote, "Marked read."); }}>Mark read</Action></div>
      <Why value={read.data.metrics} />
    </>}
    <Action secondary run={async () => { await write("ap_digest", "prepare_digest", {}, setNote, "Today's snapshot is ready. An existing snapshot keeps its original figures."); await read.reload(); }}>Prepare today&apos;s digest</Action>
  </Section>;
}

type ForecastDay = { date: string; firm_kg: number | null; draft_kg: number | null; firm_count: number | null; incoming_kg: number; unknown: number; firm_unknown?: number; draft_unknown?: number; shortfall_kg: number | null; with_drafts_shortfall_kg: number | null; demand: unknown };
type ForecastGroup = { alloy: string | null; diameter: number | null; free_kg: number; peak_shortfall_kg: number | null; days: ForecastDay[]; need_by: string | null; supply_sources: unknown };
export function BilletForecast() {
  const [filters, setFilters] = useState(initialFilters); const [revision, setRevision] = useState(0); const [note, setNote] = useState<Note>(null);
  const read = useApRead<Queue<ForecastGroup> & { today: string; as_of: string; basis: string; undated_or_overdue_supply: number }>("ap_planning", "billet_forecast", filters, [revision]);
  return <div className="space-y-5"><Section title="Seven-day billet requirement" description="Firm jobs, uncertain draft demand and dated supply, by alloy and diameter.">
    <FiltersBar value={filters} set={setFilters} /><Message value={note} />
    <Action run={async () => { await write("ap_planning", "prepare_billet", {}, setNote, "Shortage proposals refreshed. Existing decisions are retained."); setRevision(v => v + 1); }}>Prepare shortage proposals</Action>
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="billet requirements" /> : read.data ? <>
      <p className="text-xs text-neutral-600">{read.data.basis} As of {fmtWhen(read.data.as_of)}.</p>
      {read.data.undated_or_overdue_supply ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{read.data.undated_or_overdue_supply} linked purchase line(s) have no current arrival promise and are excluded from dated supply. <Link href="/vendors/purchasing" className="underline">Review supplier commitments</Link>.</p> : null}
      {!read.data.rows.length ? <Empty>No matching billet requirements.</Empty> : read.data.rows.map(g => <article key={`${g.alloy}:${g.diameter}`} className="min-w-0 rounded-xl border p-3">
        <h3 className="font-bold">{g.alloy ?? "Alloy missing"} / {g.diameter ?? "Diameter missing"} inch</h3><p className="text-sm">Free stock {kg(g.free_kg)}; firm shortfall {kg(g.peak_shortfall_kg)}{g.need_by ? ` by ${fmtDay(g.need_by)}` : ""}.</p>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th>Date</th><th>Firm input</th><th>Billets</th><th>Uncertain drafts</th><th>Incoming</th><th>Firm shortage</th><th>With drafts</th></tr></thead><tbody>
          {g.days.map(d => <tr key={d.date} className="border-b"><td className="py-3">{fmtDay(d.date)}</td><td>{kg(d.firm_kg)}{(d.firm_unknown ?? d.unknown) > 0 ? ` (${d.firm_unknown ?? d.unknown} firm input(s) missing)` : ""}</td><td>{d.firm_count ?? "Unknown"}</td><td>{kg(d.draft_kg)}{(d.draft_unknown ?? 0) > 0 ? ` (${d.draft_unknown} draft input(s) missing)` : ""}</td><td>{kg(d.incoming_kg)}</td><td className={Number(d.shortfall_kg) > 0 ? "font-bold text-rose-700" : ""}>{kg(d.shortfall_kg)}</td><td>{kg(d.with_drafts_shortfall_kg)}</td></tr>)}
        </tbody></table></div><Why value={{ demand: g.days.map(d => ({ date: d.date, sources: d.demand })), supply: g.supply_sources }} />
      </article>)}<Pager page={filters.page} total={read.data.total_count} onPage={page => setFilters({ ...filters, page })} />
    </> : null}
  </Section><ProposalCards key={revision} initial={null} type="billet.shortage" today={read.data?.today ?? ""} title="Confirm billet requirements" emptyText="No shortage proposal is waiting. Acceptance assigns preparation work; purchase orders and casts use their normal workflow." /></div>;
}

type Prediction = { id: string; order_id: string; order_item_id: string; order_number: string; customer: string; profile: string; due_date: string | null; estimated_date: string | null; blocker: string; is_red: boolean; created_at: string; basis: unknown };
export function LateLines({ orderId, canPredict = false, compact = false }: { orderId?: string; canPredict?: boolean; compact?: boolean }) {
  const [filters, setFilters] = useState(initialFilters); const [note, setNote] = useState<Note>(null);
  const read = useApRead<Queue<Prediction> & { generated_at: string | null; early_warning: { late_lines: number; warned_two_days_early: number } }>("ap_planning", "red_list", { ...filters, ...(orderId ? { order_id: orderId } : {}) });
  return <Section title="Order lines at risk" description="Advisory predictions from recorded progress, the press plan, finishing lead times and factory working days.">
    {!compact ? <FiltersBar value={filters} set={setFilters} /> : null}<Message value={note} />
    {canPredict ? <Action secondary run={async () => { await write("ap_planning", "predict", {}, setNote, "Today's first prediction is retained for measuring warning performance."); await read.reload(); }}>Prepare today&apos;s predictions</Action> : null}
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="order predictions" /> : read.data ? <>
      <p className="text-xs text-neutral-600">{read.data.generated_at ? `Generated ${fmtWhen(read.data.generated_at)}.` : "No prediction has run today."} Last 90 days: {read.data.early_warning.warned_two_days_early} of {read.data.early_warning.late_lines} late lines warned at least two days before due (target 80%).</p>
      {!read.data.rows.length ? <Empty>{read.data.generated_at ? "No matching open lines on the red list." : "The nightly job has not prepared today's predictions yet."}</Empty> : <ul className="divide-y">{read.data.rows.map(p => <li key={p.id} className="py-3">
        <Link className="font-bold underline" href={`/orders/${p.order_id}`}>{p.order_number} / {p.profile}</Link><p className="text-sm">{p.customer} | Due {fmtDay(p.due_date)} | Estimated {p.estimated_date ? fmtDay(p.estimated_date) : "Unknown; resolve missing input"}</p>
        <p className="mt-1 text-sm font-semibold text-rose-800">{p.blocker}</p>{!compact ? <Why value={p.basis} /> : null}
      </li>)}</ul>}
      {!compact ? <Pager page={filters.page} total={read.data.total_count} onPage={page => setFilters({ ...filters, page })} /> : <Link href="/orders/at-risk" className="inline-flex min-h-11 items-center text-sm font-bold underline">Open full red list ({read.data.total_count})</Link>}
    </> : null}
  </Section>;
}

type CloseException = { id: string; status: string; requester: string; reason: string; can_decide: boolean; fingerprint: string; decision_reason: string | null };
type Checklist = { month: string; blocking_count: number; fingerprint: string; basis: string; head: string; can_close: boolean; items: { kind: string; label: string; href: string; count: number }[]; exceptions: CloseException[] };
export function CloseChecklist({ initialMonth, canNominate = false }: { initialMonth: string; canNominate?: boolean }) {
  const [month, setMonth] = useState(initialMonth); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null);
  const read = useApRead<Checklist>("ap_accounts", "close_checklist", { month });
  return <Section title="Month-end checks" description="Clear open items before closing, or obtain a second person's approval for these exact source versions.">
    <label className="block max-w-xs text-sm font-semibold">Month<input type="month" className={`${inputClass} mt-1`} value={month} onChange={e => setMonth(e.target.value)} /></label><Message value={note} />
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="close checklist" /> : read.data ? <>
      <p className="text-sm"><strong>{read.data.blocking_count} blocking item(s).</strong> Accounts head: {read.data.head}.</p><p className="text-xs text-neutral-600">{read.data.basis}</p>
      {read.data.items.length ? <ul className="divide-y">{read.data.items.map(i => <li key={i.kind} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><Link href={i.href} className="font-semibold underline">{i.label}</Link><span>{i.count}</span></li>)}</ul> : <Empty>No blocking items for this month.</Empty>}
      <label className="block text-sm font-semibold">Reason or approval note<textarea className={`${inputClass} mt-1 min-h-20 py-2`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        {read.data.blocking_count > 0 ? <Action disabled={reason.trim().length < 10} run={async () => { await write("ap_accounts", "request_close_exception", { month, fingerprint: read.data!.fingerprint, reason }, setNote, "Exception requested. Another approver must review the listed items."); await read.reload(); }}>Request close exception</Action> : null}
        {read.data.can_close ? <Action disabled={reason.trim().length < 10} run={async () => { await write("ap_period", "close_month", { month, reason }, setNote, `${month} closed.`); await read.reload(); }}>Close checked month</Action> : null}
      </div>
      {read.data.exceptions.map(e => <article key={e.id} className="rounded-xl border p-3 text-sm"><Pill value={e.status} /><p className="mt-2">{e.requester}: {e.reason}</p>{e.fingerprint !== read.data!.fingerprint ? <p className="text-amber-800">Items have changed since this request.</p> : null}
        {e.status === "requested" && e.can_decide ? <div className="mt-2 flex flex-wrap gap-2">{(["approve", "reject"] as const).map(decision => <Action key={decision} disabled={reason.trim().length < 10} secondary={decision === "reject"} run={async () => { await write("ap_accounts", "decide_close_exception", { id: e.id, decision, reason }, setNote, "Decision recorded."); await read.reload(); }}>{decision === "approve" ? "Approve exception" : "Refuse exception"}</Action>)}</div> : null}
      </article>)}
      {canNominate ? <CloseHeadSettings onSaved={async () => { setNote({ tone: "ok", text: "Accounts head nominated. Only this employee may close months." }); await read.reload(); }} /> : null}
    </> : null}
  </Section>;
}

function CloseHeadSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const read = useApRead<{ id: string; name: string; role: string }[]>("ap_accounts", "head_options", {});
  const [actor, setActor] = useState(""); const [note, setNote] = useState<Note>(null);
  return <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Nominate the accounts head</summary>
    <Message value={note} />{read.error ? <Failure text={read.error} /> : <div className="space-y-3"><label className="block text-sm font-semibold">Employee<select className={`${inputClass} mt-1`} value={actor} onChange={e => setActor(e.target.value)}><option value="">Choose an active employee</option>{read.data?.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></label>
      <Action disabled={!actor} run={async () => { const result = await write("ap_accounts", "nominate_close_head", { actor_id: actor }, setNote, "Accounts head nominated. Only this employee may close months."); if (result.success) await onSaved(); }}>Nominate accounts head</Action></div>}
  </details>;
}

type MsmeBill = { bill_id: string; vendor_id: string; vendor: string; invoice_number: string; invoice_date: string; balance: number; accepted_on: string | null; acceptance_basis: string; deadline: string | null; applied_days: number; agreed_days: number | null; udyam: string; note: string | null; overdue: boolean };
function MsmeBillCard({ bill, reload }: { bill: MsmeBill; reload: () => Promise<void> }) {
  const [date, setDate] = useState(bill.accepted_on ?? ""); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null);
  return <article className="space-y-2 rounded-xl border p-3">
    <h3 className="font-bold"><Link className="underline" href={`/vendors/${bill.vendor_id}`}>{bill.vendor}</Link> / {bill.invoice_number}</h3>
    <p className="text-sm">{inr(bill.balance)} outstanding | Deadline {bill.deadline ? fmtDay(bill.deadline) : "Unknown: confirm acceptance"} {bill.overdue ? <Pill value="blocked" label="Overdue" /> : null}</p>
    <p className="text-xs text-neutral-600">{bill.udyam}; {bill.agreed_days == null ? "No written period recorded" : `${bill.agreed_days} days agreed`}; {bill.applied_days} days applied. {bill.acceptance_basis}.</p>
    {bill.note ? <p className="text-sm">Latest note: {bill.note}</p> : null}
    <Message value={note} /><details><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Confirm acceptance or record reason</summary>
      <div className="space-y-2"><label className="block text-sm font-semibold">Actual acceptance date<input type="date" className={`${inputClass} mt-1`} value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="block text-sm font-semibold">Evidence or reason<input className={`${inputClass} mt-1`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><Action disabled={!date || reason.trim().length < 10} run={async () => { await write("ap_accounts", "bill_acceptance", { bill_id: bill.bill_id, accepted_on: date, reason }, setNote, "Acceptance date recorded."); await reload(); }}>Record acceptance</Action>
          <Action secondary disabled={reason.trim().length < 10} run={async () => { await write("ap_accounts", "msme_note", { bill_id: bill.bill_id, reason }, setNote, "Reason recorded. The payment deadline is unchanged."); await reload(); }}>Record payment reason</Action></div>
      </div></details>
    <Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href="/expenses">Open payables to pay</Link>
  </article>;
}
export function MsmePayments() {
  const [filters, setFilters] = useState(initialFilters); const [cap, setCap] = useState("45"); const [noAgreement, setNoAgreement] = useState("15"); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null);
  const read = useApRead<Queue<MsmeBill> & { basis: string; policy: { statutory_limit: number; no_agreement_days: number } }>("ap_accounts", "msme_queue", filters);
  return <Section title="MSME supplier deadlines" description="Upcoming, overdue and missing-date bills for recorded micro and small suppliers.">
    <FiltersBar value={filters} set={setFilters} /><Message value={note} />
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="MSME bills" /> : read.data ? <>
      <p className="text-xs text-neutral-600">{read.data.basis} Written period cap: {read.data.policy.statutory_limit} days; no agreement: {read.data.policy.no_agreement_days} days.</p>
      {!read.data.rows.length ? <Empty>No matching open bills. Confirm supplier classifications on their vendor records.</Empty> : read.data.rows.map(b => <MsmeBillCard key={b.bill_id} bill={b} reload={read.reload} />)}
      <Pager page={filters.page} total={read.data.total_count} onPage={page => setFilters({ ...filters, page })} />
    </> : null}
    <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Accounts payment-period policy</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Written agreement cap (at most 45)<input type="number" min="1" max="45" className={`${inputClass} mt-1`} value={cap} onChange={e => setCap(e.target.value)} /></label>
      <label className="text-sm font-semibold">No agreement (at most 15)<input type="number" min="1" max="15" className={`${inputClass} mt-1`} value={noAgreement} onChange={e => setNoAgreement(e.target.value)} /></label>
      <label className="text-sm font-semibold sm:col-span-2">Reason<input className={`${inputClass} mt-1`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
      <Action disabled={!cap || !noAgreement || reason.trim().length < 10} run={async () => { await write("ap_accounts", "save_msme_policy", { statutory_limit: Number(cap), no_agreement_days: Number(noAgreement), reason }, setNote, "Payment-period policy saved."); await read.reload(); }}>Save policy</Action>
    </div></details>
  </Section>;
}

export function VendorMsmeTerms({ vendorId }: { vendorId: string }) {
  const read = useApRead<{ terms: { category: string; udyam: string; agreed_days: number | null } | null; history: unknown[] }>("ap_accounts", "msme_vendor", { vendor_id: vendorId });
  const [category, setCategory] = useState("micro"); const [udyam, setUdyam] = useState(""); const [days, setDays] = useState(""); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null);
  return <Section title="Supplier MSME terms" description="Accounts records the certificate classification and written payment period. Agreed periods are capped by the payment policy.">
    <Message value={note} />{read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="supplier terms" /> : <>
      <p className="text-sm">Current: {read.data?.terms ? `${read.data.terms.category} / ${read.data.terms.udyam ?? "no certificate"} / ${read.data.terms.agreed_days ?? "no written"} days` : "Not classified"}</p>
      <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Record a new terms revision</summary><div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Category<select className={`${inputClass} mt-1`} value={category} onChange={e => setCategory(e.target.value)}>{["micro", "small", "medium", "none"].map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm font-semibold">Udyam number<input className={`${inputClass} mt-1`} value={udyam} onChange={e => setUdyam(e.target.value.toUpperCase())} placeholder="UDYAM-DL-01-0000001" /></label>
        <label className="text-sm font-semibold">Written period in days (blank if none)<input type="number" min="1" max="365" className={`${inputClass} mt-1`} value={days} onChange={e => setDays(e.target.value)} /></label>
        <label className="text-sm font-semibold">Evidence and reason<input className={`${inputClass} mt-1`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
        <Action disabled={reason.trim().length < 10} run={async () => { await write("ap_accounts", "save_msme_vendor", { vendor_id: vendorId, category, ...(category !== "none" ? { udyam } : {}), ...(days ? { agreed_days: Number(days) } : {}), reason }, setNote, "Terms revision recorded."); await read.reload(); }}>Record terms</Action>
      </div></details><Why value={read.data?.history} />
    </>}
  </Section>;
}

type Adjustment = { id: string; item_id: string; item: string; direction: string; quantity: number; reason: string; status: string; can_decide: boolean; expected_stock: number };
function AdjustmentRequests({ itemId, revision }: { itemId?: string; revision: number }) {
  const [filters, setFilters] = useState(initialFilters); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null);
  const read = useApRead<Queue<Adjustment>>("ap_stock", "requests", { ...filters, ...(itemId ? { item_id: itemId } : {}) }, [revision]);
  return <Section title="Stock correction requests"><FiltersBar value={filters} set={setFilters} /><Message value={note} />
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="corrections" /> : read.data ? <>
      {!read.data.rows.length ? <Empty>No matching correction requests.</Empty> : read.data.rows.map(a => <article key={a.id} className="space-y-2 rounded-xl border p-3 text-sm">
        <Link className="font-bold underline" href={`/inventory/${a.item_id}`}>{a.item}</Link> <Pill value={a.status} /><p>{a.direction} {a.quantity}; reviewed balance {a.expected_stock}. {a.reason}</p>
        {a.status === "requested" && a.can_decide ? <><label className="block font-semibold">Decision reason<input className={`${inputClass} mt-1`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
          <div className="flex flex-wrap gap-2">{(["approve", "reject"] as const).map(decision => <Action key={decision} disabled={reason.trim().length < 10} run={async () => {
            const result = await write("ap_stock", "decide_adjustment", { id: a.id, decision, reason }, setNote, "Decision recorded.");
            if (result.success && (result.data as { status: string }).status === "stale") setNote({ tone: "error", text: "The balance changed. This correction is stale; request it again from the current balance." });
            await read.reload();
          }}>{decision === "approve" ? "Approve correction" : "Refuse correction"}</Action>)}</div></> : null}
      </article>)}<Pager page={filters.page} total={read.data.total_count} onPage={page => setFilters({ ...filters, page })} />
    </> : null}
  </Section>;
}
type Movement = { id: string; kind: string; quantity: number; signed_quantity: number; date: string; reference: string; reason: string; actor: string };
export function InventoryMovements({ itemId, canAdjust = false }: { itemId: string; canAdjust?: boolean }) {
  const [filters, setFilters] = useState({ ...initialFilters, show: "all" as const }); const [quantity, setQuantity] = useState(""); const [direction, setDirection] = useState("out");
  const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null); const [revision, setRevision] = useState(0); const requestId = useRef<string | null>(null);
  const read = useApRead<Queue<Movement> & { item: { id: string; name: string; stock: number; unit: string }; ledger_stock: number }>("ap_stock", "movements", { ...filters, item_id: itemId }, [revision]);
  function changed() { requestId.current = null; }
  return <div className="space-y-5"><Section title="Stock movements" description="Balance is read-only. Every correction retains its reason, reviewer and signed movement.">
    <Message value={note} /><FiltersBar value={filters} set={v => setFilters(v as typeof filters)} />
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="movements" /> : read.data ? <>
      <p className="text-sm font-bold">{read.data.item.name}: {read.data.item.stock} {read.data.item.unit}; rebuilt from movements: {read.data.ledger_stock}.</p>
      {Number(read.data.item.stock) !== Number(read.data.ledger_stock) ? <Failure text="The balance and ledger differ. Reconcile the source entries before adjusting." /> : null}
      {!read.data.rows.length ? <Empty>No recorded movements.</Empty> : <ul className="divide-y">{read.data.rows.map(m => <li key={m.id} className="py-3 text-sm"><p className="font-semibold">{fmtDay(m.date)} | {m.kind} | {m.signed_quantity > 0 ? "+" : ""}{m.signed_quantity} {read.data!.item.unit}</p><p>{m.reason}</p><p className="text-xs text-neutral-600">{m.reference}; {m.actor}</p></li>)}</ul>}
      <Pager page={filters.page} total={read.data.total_count} onPage={page => setFilters({ ...filters, page })} />
      {canAdjust ? <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Request stock correction</summary><div className="space-y-3">
        <label className="block text-sm font-semibold">Direction<select className={`${inputClass} mt-1`} value={direction} onChange={e => { setDirection(e.target.value); changed(); }}><option value="out">Remove</option><option value="in">Add</option></select></label>
        <label className="block text-sm font-semibold">Quantity<input className={`${inputClass} mt-1`} inputMode="decimal" value={quantity} onChange={e => { setQuantity(e.target.value); changed(); }} /></label>
        <label className="block text-sm font-semibold">Reason<input className={`${inputClass} mt-1`} value={reason} maxLength={500} onChange={e => { setReason(e.target.value); changed(); }} /></label>
        <Action disabled={!quantity || Number(quantity) <= 0 || reason.trim().length < 10} run={async () => {
          requestId.current ??= crypto.randomUUID();
          const result = await write("ap_stock", "request_adjustment", { request_id: requestId.current, item_id: itemId, direction, quantity: Number(quantity), expected_stock: Number(read.data!.item.stock), reason }, setNote, "Correction recorded.");
          if (result.success) { setNote({ tone: "ok", text: (result.data as { status: string }).status === "posted" ? "Correction posted to the movement ledger." : "Correction requested. Another person must approve it; stock is unchanged." }); setRevision(v => v + 1); }
        }}>Review and request correction</Action>
      </div></details> : null}
    </> : null}
  </Section><AdjustmentRequests itemId={itemId} revision={revision} /></div>;
}
type Balance = { inventory_item_id: string; item_code: string; item_name: string; current_stock: number; ledger_stock: number; difference: number; unit: string };
export function InventoryLedger({ canSetPolicy = false }: { canSetPolicy?: boolean }) {
  const [filters, setFilters] = useState(initialFilters);
  const read = useApRead<Queue<Balance>>("ap_stock", "balances", filters);
  return <div className="space-y-5"><Section title="Rebuild stock balances" description="Compare item balances with their signed movement ledger. Open an item to trace or correct it.">
    <FiltersBar value={filters} set={setFilters} />
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="balances" /> : read.data ? <>
      {!read.data.rows.length ? <Empty>No matching stock ledger differences.</Empty> : <ul className="divide-y">{read.data.rows.map(b => <li key={b.inventory_item_id} className="py-3 text-sm"><Link className="font-bold underline" href={`/inventory/${b.inventory_item_id}`}>{b.item_code} / {b.item_name}</Link><p>Recorded {b.current_stock}; ledger {b.ledger_stock}; difference {b.difference} {b.unit}.</p></li>)}</ul>}
      <Pager page={filters.page} total={read.data.total_count} onPage={page => setFilters({ ...filters, page })} />
    </> : null}
  </Section><AdjustmentRequests revision={0} />{canSetPolicy ? <StockPolicy /> : null}</div>;
}

function StockPolicy() {
  const read = useApRead<{ threshold: number }>("ap_stock", "stock_policy", {});
  const [threshold, setThreshold] = useState(""); const [reason, setReason] = useState(""); const [note, setNote] = useState<Note>(null);
  return <Section title="Stock correction approval threshold" description="Default zero: every correction needs a second person. Smaller corrections may post on the requester's explicit confirmation when a threshold is configured.">
    <Message value={note} />{read.error ? <Failure text={read.error} /> : <p className="text-sm">Current threshold: {read.data?.threshold ?? "Loading"} item units.</p>}
    <label className="block text-sm font-semibold">Maximum quantity without second approval<input inputMode="decimal" className={`${inputClass} mt-1`} value={threshold} onChange={e => setThreshold(e.target.value)} /></label>
    <label className="block text-sm font-semibold">Reason<input className={`${inputClass} mt-1`} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
    <Action disabled={!threshold || !Number.isFinite(Number(threshold)) || Number(threshold) < 0 || reason.trim().length < 10} run={async () => { await write("ap_stock", "save_stock_policy", { threshold: Number(threshold), reason }, setNote, "Approval threshold saved."); await read.reload(); }}>Save approval threshold</Action>
  </Section>;
}

export function QuantityTrace({ table, id }: { table: string; id: string }) {
  const [page, setPage] = useState(1);
  const read = useApRead<Queue<{ id: number; field: string; kind: string; before_qty: number | null; after_qty: number | null; delta: number; recorded_at: string; evidence: unknown }> & { rebuilt: Record<string, number> | null }>("ap_stock", "trace", { table, id, page });
  return <Section title="Quantity history" description="The baseline records stock at the AP-047 migration boundary. Later signed changes rebuild the current balance.">
    {read.error ? <Failure text={read.error} /> : read.loading ? <Loading what="quantity history" /> : read.data ? <>
      <Why value={{ rebuilt: read.data.rebuilt }} />{!read.data.rows.length ? <Empty>No quantity events have been recorded.</Empty> : read.data.rows.map(e => <div className="border-b py-3 text-sm" key={e.id}><p>{fmtWhen(e.recorded_at)} | {e.field}: {e.before_qty ?? "unknown"} to {e.after_qty ?? "unknown"} ({e.kind}; delta {e.delta})</p><Why value={e.evidence} /></div>)}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}
