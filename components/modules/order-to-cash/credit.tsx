"use client";

// AP-032: credit limits on the customer, the credit check on the order (at confirmation, recheck and dispatch), and the
// queue of orders on credit hold for the authorised approver. A hold never blocks confirmation itself; it stops draft-job
// release and dispatch until another person approves.
import { useState } from "react";
import Link from "next/link";
import { fmtDay, fmtWhen, inr, APPROVER_ROLES } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "./ui";

type Exposure = { outstanding: number; unbilled: number; unpriced_dispatches: number; this_value: number; on_account: number; exposure: number; credit_limit: number | null;
  credit_days: number | null; grace_days: number | null; overdue_beyond_grace: number; headroom: number | null; result: string };
type Hold = { id: string; order_id: string; order_number: string | null; customer: string | null; status: string; reasons: string[]; exposure: number; credit_limit: number | null;
  overdue_beyond_grace: number; approved_exposure: number | null; expires_at: string | null; decided_by: string | null; decision_note: string | null; cleared_note: string | null;
  created_at: string; requested_by: string | null; order_value: number | null; can_decide: boolean };

const RESULT_LABEL: Record<string, string> = { within: "Within limit", over_limit: "Over the credit limit", overdue: "Overdue beyond grace", over_limit_and_overdue: "Over limit and overdue", no_limit: "No credit limit set" };

export function ExposureTable({ e }: { e: Exposure }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
    <div><dt className="text-neutral-500">Open invoices</dt><dd className="font-semibold">{inr(e.outstanding)}</dd></div>
    <div><dt className="text-neutral-500">Dispatched, not billed</dt><dd className="font-semibold">{inr(e.unbilled)}{e.unpriced_dispatches > 0 ? ` + ${e.unpriced_dispatches} unpriced` : ""}</dd></div>
    <div><dt className="text-neutral-500">This order / dispatch</dt><dd className="font-semibold">{inr(e.this_value)}</dd></div>
    <div><dt className="text-neutral-500">On-account money</dt><dd className="font-semibold">− {inr(e.on_account)}</dd></div>
    <div><dt className="text-neutral-500">Exposure</dt><dd className="font-black">{inr(e.exposure)}</dd></div>
    <div><dt className="text-neutral-500">Credit limit</dt><dd className="font-semibold">{e.credit_limit === null ? "Not set" : inr(e.credit_limit)}{e.headroom !== null ? ` (headroom ${inr(e.headroom)})` : ""}</dd></div>
    <div className="col-span-2 sm:col-span-3"><dt className="text-neutral-500">Overdue beyond {e.grace_days ?? 0}-day grace</dt><dd className="font-semibold">{inr(e.overdue_beyond_grace)} · <Pill value={e.result === "within" ? "passed" : e.result === "no_limit" ? "not_checked" : "held"} label={RESULT_LABEL[e.result] ?? e.result} /></dd></div>
  </dl>;
}

function DecideHold({ hold, onDone, setMessage }: { hold: Hold; onDone: (text: string) => void; setMessage: (m: { tone: "ok" | "error"; text: string } | null) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const text = decision === "approve" ? `Credit approved for ${hold.order_number ?? "the order"}. Draft jobs can be released and the order dispatched within the approved exposure.` : `Credit refused for ${hold.order_number ?? "the order"}; sales is told.`;
    const done = await apWrite("ap_credit", "decide", { hold_id: hold.id, decision, ...(note.trim() ? { note: note.trim() } : {}) }, setMessage, text);
    setBusy(false);
    if (done) onDone(text);
  }
  return <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
    <label className="block text-sm font-semibold">Decision note<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={`${inputClass} mt-1 py-2`} placeholder="Required when refusing (for example: wait for the cheque to clear)" /></label>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => decide("approve")} className={buttonClass}>Approve credit</button>
      <button type="button" disabled={busy} onClick={() => decide("reject")} className={secondaryClass}>Refuse</button></div>
  </div>;
}

function HoldCard({ hold, onChanged }: { hold: Hold; onChanged: (text?: string) => void }) {
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return <article className="space-y-2 rounded-xl border border-neutral-200 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/orders/${hold.order_id}#credit`} className="font-bold underline">{hold.order_number ?? "Order"}</Link><Pill value={hold.status} /></div>
    <p className="text-sm">{hold.customer} · order {inr(hold.order_value)} · exposure {inr(hold.exposure)} against {hold.credit_limit === null ? "no limit" : inr(hold.credit_limit)}</p>
    <ul className="list-disc pl-5 text-sm text-neutral-700">{hold.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    <p className="text-xs text-neutral-500">Raised {fmtWhen(hold.created_at)}{hold.requested_by ? ` for ${hold.requested_by}'s order` : ""}{hold.decided_by ? ` · decided by ${hold.decided_by}` : ""}
      {hold.expires_at && hold.status === "approved" ? ` · approval valid until ${fmtWhen(hold.expires_at)} for exposure up to ${inr(hold.approved_exposure)}` : ""}</p>
    {hold.decision_note ? <p className="text-sm">Note: {hold.decision_note}</p> : null}
    {hold.cleared_note ? <p className="text-sm text-neutral-600">{hold.cleared_note}</p> : null}
    {hold.can_decide ? <DecideHold hold={hold} onDone={onChanged} setMessage={setMessage} /> : hold.status === "held" ? <p className="text-xs text-neutral-500">Waiting for an approver other than the person who entered the order.</p> : null}
    <Message value={message} />
  </article>;
}

export function OrderCreditPanel({ orderId }: { orderId: string }) {
  const { data, error, loading, reload } = useApRead<{ hold: Hold | null; exposure: Exposure | null; checks: Array<{ stage: string; exposure: number; result: string; outcome: string; checked_at: string; dispatch_number: string | null }>; can_request: boolean }>(
    "ap_credit", "order", { order_id: orderId });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (loading && !data) return <Loading what="credit check" />;
  if (error) return <Failure text={error} />;
  if (!data) return null;
  return <Section id="credit" title="Credit check" description="Exposure is open invoices plus dispatched-but-unbilled goods plus what is left of this order, less on-account money. Checked at confirmation and again at each dispatch.">
    {data.exposure ? <ExposureTable e={data.exposure} /> : <Empty>The order has no customer.</Empty>}
    {data.hold && ["held", "approved", "rejected"].includes(data.hold.status) ? <HoldCard hold={data.hold} onChanged={() => void reload()} /> : null}
    {data.checks.length ? <details className="text-sm"><summary className="cursor-pointer font-semibold">Check history</summary>
      <ul className="mt-2 space-y-1">{data.checks.map(c => <li key={c.checked_at + c.stage}>{fmtWhen(c.checked_at)} · {c.stage}{c.dispatch_number ? ` (${c.dispatch_number})` : ""} · {inr(c.exposure)} · <Pill value={c.outcome} /></li>)}</ul></details> : null}
    {data.can_request ? <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_credit", "request", { order_id: orderId }, setMessage, "Credit rechecked with today's balances.")) void reload(); }}>Recheck credit now</button> : null}
    <Message value={message} />
  </Section>;
}

export function CustomerCreditPanel({ customerId }: { customerId: string }) {
  const { data, error, loading, reload } = useApRead<{ exposure: Exposure; limit_history: Array<{ id: string; credit_limit: number; credit_days: number | null; grace_days: number; reason: string; status: string; set_at: string; set_by: string }>;
    holds: Hold[]; on_account: Array<{ id: string; amount: number; applied: number; reference: string | null; received_on: string }>; remitters: Array<{ id: string; alias: string; source: string }>; can_set_limit: boolean }>(
    "ap_credit", "customer", { customer_id: customerId });
  const [form, setForm] = useState({ limit: "", days: "", grace: "", reason: "" });
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (loading && !data) return <Loading what="credit" />;
  if (error) return <Failure text={error} />;
  if (!data) return null;
  async function save() {
    const limit = Number(form.limit);
    if (form.limit.trim() === "" || !Number.isFinite(limit) || limit < 0) return setMessage({ tone: "error", text: "Enter the credit limit in rupees (0 for cash only)." });
    const done = await apWrite("ap_credit", "set_limit", { customer_id: customerId, credit_limit: limit, ...(form.days ? { credit_days: Number(form.days) } : {}),
      ...(form.grace ? { grace_days: Number(form.grace) } : {}), reason: form.reason.trim() }, setMessage, "Credit limit saved. Open orders are rechecked.");
    if (done) { setForm({ limit: "", days: "", grace: "", reason: "" }); void reload(); }
  }
  const active = data.limit_history.find(l => l.status === "active");
  return <Section id="credit" title="Credit and receipts" description="Accounts sets the limit with a reason; every change is kept. Orders over the limit or overdue beyond grace go on credit hold.">
    <ExposureTable e={data.exposure} />
    <p className="text-sm">{active ? `Limit ${inr(active.credit_limit)}, ${active.credit_days ?? "—"} credit days, ${active.grace_days}-day grace. Set by ${active.set_by} on ${fmtDay(active.set_at)}: ${active.reason}` : "No credit limit: orders for this customer are not credit-checked."}</p>
    {data.can_set_limit ? <details className="rounded-xl bg-neutral-50 p-3"><summary className="cursor-pointer text-sm font-semibold">{active ? "Change the credit limit" : "Set a credit limit"}</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-sm font-semibold">Limit (₹)<input inputMode="decimal" value={form.limit} onChange={e => setForm({ ...form, limit: e.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold">Credit days<input inputMode="numeric" value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} className={`${inputClass} mt-1`} placeholder="Due date of invoices" /></label>
        <label className="text-sm font-semibold">Grace days<input inputMode="numeric" value={form.grace} onChange={e => setForm({ ...form, grace: e.target.value })} className={`${inputClass} mt-1`} placeholder="0" /></label>
        <label className="text-sm font-semibold sm:col-span-3">Reason<input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className={`${inputClass} mt-1`} placeholder="For example: agreed at annual review" /></label>
      </div>
      <button type="button" onClick={save} className={`${buttonClass} mt-2`}>Save limit</button></details> : null}
    {data.holds.length ? <div className="space-y-2"><h3 className="text-sm font-bold">Orders on credit hold</h3>{data.holds.map(h => <HoldCard key={h.id} hold={h} onChanged={() => void reload()} />)}</div> : null}
    {data.on_account.length ? <div><h3 className="text-sm font-bold">On-account money</h3><ul className="text-sm">{data.on_account.map(c => <li key={c.id}>{inr(c.amount - c.applied)} of {inr(c.amount)} · {c.reference ?? "no reference"} · received {fmtDay(c.received_on)}</li>)}</ul>
      <Link href="/payments/receipts#on-account" className="text-sm font-semibold underline">Apply to invoices</Link></div> : null}
    {data.remitters.length ? <div><h3 className="text-sm font-bold">Bank remitter names learned</h3><ul className="flex flex-wrap gap-2 text-sm">{data.remitters.map(r => <li key={r.id} className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5">{r.alias}
      {data.can_set_limit ? <button type="button" aria-label={`Forget ${r.alias}`} className="text-xs underline" onClick={async () => { if (await apWrite("ap_credit", "remove_remitter", { id: r.id }, setMessage, "Remitter forgotten.")) void reload(); }}>remove</button> : null}</li>)}</ul></div> : null}
    <Message value={message} />
  </Section>;
}

function CreditSettings() {
  const { data, error, reload } = useApRead<{ credit_approver_roles: string[]; credit_approval_hours: number; quote_extension_needs_approval: boolean; quote_extension_roles: string[];
    reminder_steps: number[]; reminder_repeat_days: number; duplicate_window_days: number; can_edit: boolean }>("ap_credit", "settings", {});
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (error) return <Failure text={error} />;
  if (!data) return <Loading what="settings" />;
  const d = draft ?? { approvers: data.credit_approver_roles.join(","), hours: String(data.credit_approval_hours), extApproval: String(data.quote_extension_needs_approval),
    extRoles: data.quote_extension_roles.join(","), steps: data.reminder_steps.join(", "), repeat: String(data.reminder_repeat_days), window: String(data.duplicate_window_days) };
  const toggle = (key: "approvers" | "extRoles", role: string) => { const set = new Set(d[key].split(",").filter(Boolean)); if (set.has(role)) set.delete(role); else set.add(role); setDraft({ ...d, [key]: [...set].join(",") }); };
  async function save() {
    const steps = d.steps.split(/[,\s]+/).filter(Boolean).map(Number);
    if (steps.some(s => !Number.isInteger(s))) return setMessage({ tone: "error", text: "Reminder steps are whole days, for example -3, 0, 7, 15, 30." });
    const done = await apWrite("ap_credit", "save_settings", { credit_approver_roles: d.approvers.split(",").filter(Boolean), credit_approval_hours: Number(d.hours),
      quote_extension_needs_approval: d.extApproval === "true", quote_extension_roles: d.extRoles.split(",").filter(Boolean), reminder_steps: steps,
      reminder_repeat_days: Number(d.repeat), duplicate_window_days: Number(d.window) }, setMessage, "Settings saved.");
    if (done) { setDraft(null); void reload(); }
  }
  return <Section title="Order-to-cash settings" description="Who approves credit and validity extensions, reminder steps (days from due date; negative = before), and the duplicate warning window.">
    <fieldset disabled={!data.can_edit} className="space-y-3">
      <div><p className="text-sm font-semibold">Credit approvers</p><div className="mt-1 flex flex-wrap gap-2">{APPROVER_ROLES.map(role => <label key={role} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm"><input type="checkbox" checked={d.approvers.split(",").includes(role)} onChange={() => toggle("approvers", role)} />{role.replace("_", " ")}</label>)}</div></div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-sm font-semibold">Approval valid (hours)<input value={d.hours} onChange={e => setDraft({ ...d, hours: e.target.value })} className={`${inputClass} mt-1`} inputMode="numeric" /></label>
        <label className="text-sm font-semibold sm:col-span-2">Reminder steps (days)<input value={d.steps} onChange={e => setDraft({ ...d, steps: e.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold">Repeat overdue every (days)<input value={d.repeat} onChange={e => setDraft({ ...d, repeat: e.target.value })} className={`${inputClass} mt-1`} inputMode="numeric" /></label>
        <label className="text-sm font-semibold">Duplicate window (days)<input value={d.window} onChange={e => setDraft({ ...d, window: e.target.value })} className={`${inputClass} mt-1`} inputMode="numeric" /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold sm:col-span-3"><input type="checkbox" checked={d.extApproval === "true"} onChange={e => setDraft({ ...d, extApproval: String(e.target.checked) })} />Quotation validity extensions need approval</label>
      </div>
      <div><p className="text-sm font-semibold">Extension approvers</p><div className="mt-1 flex flex-wrap gap-2">{APPROVER_ROLES.map(role => <label key={role} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm"><input type="checkbox" checked={d.extRoles.split(",").includes(role)} onChange={() => toggle("extRoles", role)} />{role.replace("_", " ")}</label>)}</div></div>
      {data.can_edit ? <button type="button" onClick={save} className={buttonClass}>Save settings</button> : <p className="text-xs text-neutral-500">Only the owner or an admin changes these.</p>}
    </fieldset>
    <Message value={message} />
  </Section>;
}

export function CreditHoldsClient() {
  const [status, setStatus] = useState<"held" | "approved" | "rejected" | "cleared" | "all">("held");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApRead<{ total_count: number; rows: Hold[] }>("ap_credit", "holds", { status, page });
  const [decided, setDecided] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return <div className="space-y-4">
    <Message value={decided} />
    <Section title="Orders on credit hold" actions={<select aria-label="Hold status" value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1); }} className={`${inputClass} w-40`}>
      <option value="held">Waiting</option><option value="approved">Approved</option><option value="rejected">Refused</option><option value="cleared">Cleared</option><option value="all">All</option></select>}>
      {loading && !data ? <Loading what="holds" /> : error ? <Failure text={error} /> : !data?.rows.length ? <Empty>No orders in this list.</Empty>
        : <div className="space-y-2">{data.rows.map(h => <HoldCard key={h.id} hold={h} onChanged={text => { if (text) setDecided({ tone: "ok", text }); void reload(); }} />)}</div>}
      {data ? <Pager page={page} total={data.total_count} onPage={setPage} /> : null}
    </Section>
    <CreditSettings />
  </div>;
}
