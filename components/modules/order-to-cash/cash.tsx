"use client";

// AP-084: the morning reminder queue (prepared by the system; a person copies or opens WhatsApp, then marks it sent or
// skips with a reason; nothing is sent automatically). AP-058: receipts allocated oldest first (invoices named in the
// narration first), with any excess kept on account and applied later.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PAYMENT_METHODS, REMINDER_CHANNELS, fmtDay, fmtWhen, inr, newKey, whatsappLink, type PaymentMethod, type ReminderChannel } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "./ui";

type Reminder = { id: string; customer_id: string; customer: string; reminder_date: string; invoices: Array<{ invoice_id: string; invoice_number: string; due_date: string; balance: number; days: number }>;
  total_due: number; worst_days: number; message: string; phone: string | null; status: string; copied_at: string | null; sent_via: string | null; sent_at: string | null; sent_by: string | null; skip_reason: string | null };

function ReminderCard({ r, onChanged }: { r: Reminder; onChanged: (done?: string) => void }) {
  const [channel, setChannel] = useState<ReminderChannel>("whatsapp");
  const [skip, setSkip] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const link = whatsappLink(r.phone, r.message);
  async function copied() { try { await navigator.clipboard.writeText(r.message); } catch { /* the text stays visible to copy by hand */ } await apWrite("ap_cash", "reminder_copied", { id: r.id }, setMessage, "Copied. Mark it sent once it has gone."); }
  return <article className="space-y-2 rounded-xl border border-neutral-200 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><Link className="font-bold underline" href={`/customers/${r.customer_id}`}>{r.customer}</Link><Pill value={r.status} /></div>
    <p>{inr(r.total_due)} · {r.invoices.length} invoice(s) · {r.worst_days > 0 ? `${r.worst_days} days overdue at worst` : r.worst_days === 0 ? "due today" : `due in ${-r.worst_days} days`}{r.phone ? ` · ${r.phone}` : " · no phone on record"}</p>
    <details><summary className="cursor-pointer font-semibold">Prepared message</summary><pre className="mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 p-2 font-sans">{r.message}</pre></details>
    {r.status === "prepared" ? <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={secondaryClass} onClick={copied}>Copy message</button>
      {link ? <a className={secondaryClass + " inline-flex items-center"} href={link} target="_blank" rel="noreferrer" onClick={() => void apWrite("ap_cash", "reminder_copied", { id: r.id }, setMessage)}>Open in WhatsApp</a> : null}
      <select aria-label="Sent by" value={channel} onChange={e => setChannel(e.target.value as ReminderChannel)} className={`${inputClass} w-36`}>{Object.entries(REMINDER_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_cash", "reminder_sent", { id: r.id, channel }, setMessage)) onChanged(`Reminder to ${r.customer} marked sent.`); }}>Mark sent</button>
      <button type="button" className="underline" onClick={() => setSkip(skip === null ? "" : null)}>Skip</button>
    </div> : <p className="text-neutral-600">{r.status === "sent" ? `Sent by ${r.sent_by ?? "—"} via ${REMINDER_CHANNELS[r.sent_via as ReminderChannel] ?? r.sent_via} ${fmtWhen(r.sent_at)}` : r.skip_reason ? `Skipped: ${r.skip_reason}` : ""}{r.copied_at && r.status === "prepared" ? ` · copied ${fmtWhen(r.copied_at)}` : ""}</p>}
    {skip !== null ? <div className="flex flex-wrap gap-2"><input aria-label="Why skip" value={skip} onChange={e => setSkip(e.target.value)} className={`${inputClass} flex-1`} placeholder="For example: customer promised payment on call" />
      <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_cash", "reminder_skip", { id: r.id, reason: skip.trim() }, setMessage)) onChanged(`Reminder to ${r.customer} skipped.`); }}>Skip</button></div> : null}
    <Message value={message} />
  </article>;
}

export function RemindersClient({ canPrepare }: { canPrepare: boolean }) {
  const [status, setStatus] = useState<"prepared" | "sent" | "skipped" | "all">("prepared");
  const [page, setPage] = useState(1); const [cPage, setCPage] = useState(1); const [key, setKey] = useState(0);
  const queue = useApRead<{ total_count: number; rows: Reminder[]; today: string }>("ap_cash", "reminders", { status, page }, [key]);
  const coverage = useApRead<{ total_count: number; rows: Array<{ invoice_id: string; invoice_number: string; customer: string; days_overdue: number; balance_due: number; last_sent: string | null }>;
    summary: { overdue: number; covered_by_reminder: number; covered_by_commitment: number } }>("ap_cash", "reminder_coverage", { page: cPage }, [key]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return <div className="space-y-4">
    <Section title="Payment reminders" description="Prepared each morning for invoices due in a few days, due today, or overdue at the set steps. Invoices with an active payment promise are left out until it lapses."
      actions={<div className="flex gap-2"><select aria-label="Reminder status" value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1); }} className={`${inputClass} w-36`}>
        <option value="prepared">To send</option><option value="sent">Sent</option><option value="skipped">Skipped</option><option value="all">All</option></select>
        {canPrepare ? <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ prepared: number }>("ap_cash", "prepare_reminders", {}, setMessage); if (out) { setMessage({ tone: "ok", text: `${out.prepared} reminder(s) prepared for today.` }); setKey(k => k + 1); } }}>Prepare now</button> : null}</div>}>
      {queue.loading && !queue.data ? <Loading what="reminders" /> : queue.error ? <Failure text={queue.error} /> : !queue.data?.rows.length ? <Empty>No reminders in this list.</Empty>
        : <div className="space-y-2">{queue.data.rows.map(r => <ReminderCard key={r.id} r={r} onChanged={done => { if (done) setMessage({ tone: "ok", text: done }); setKey(k => k + 1); }} />)}</div>}
      {queue.data ? <Pager page={page} total={queue.data.total_count} onPage={setPage} /> : null}
      <Message value={message} />
    </Section>
    <Section title="Overdue without a recent reminder or promise" description="Every overdue invoice should have a reminder sent within the repeat window or an active payment promise.">
      {coverage.data ? <p className={`text-sm font-semibold ${coverage.data.total_count ? "text-rose-800" : "text-emerald-800"}`}>{coverage.data.summary.overdue} overdue · {coverage.data.summary.covered_by_reminder} reminded · {coverage.data.summary.covered_by_commitment} promised · {coverage.data.total_count} not covered</p> : null}
      {coverage.data?.rows.length ? <ul className="space-y-1 text-sm">{coverage.data.rows.map(x => <li key={x.invoice_id}><Link className="underline" href={`/invoices/${x.invoice_id}`}>{x.invoice_number}</Link> · {x.customer} · {inr(x.balance_due)} · {x.days_overdue} days{x.last_sent ? ` · last reminded ${fmtDay(x.last_sent)}` : " · never reminded"}</li>)}</ul> : coverage.data ? <Empty>Every overdue invoice is covered.</Empty> : null}
      {coverage.data ? <Pager page={cPage} total={coverage.data.total_count} onPage={setCPage} /> : null}
    </Section>
  </div>;
}

type Proposal = { allocations: Array<{ invoice_id: string; invoice_number: string; invoice_date: string; due_date: string | null; balance_due: number; amount: number; basis: string }>;
  on_account: number; open_total: number; named: number; customer: string; on_account_open: number };

function CustomerSelect({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [search, setSearch] = useState("");
  const { data } = useApRead<{ id: string; name: string; city: string | null }[]>("ap_cash", "customers", search.trim().length >= 2 ? { search: search.trim() } : {}, [search]);
  return <div className="text-sm font-semibold"><span>Customer</span><input aria-label="Find customer" value={search} onChange={e => setSearch(e.target.value)} placeholder="Type to search" className={`${inputClass} mt-1`} />
    <select aria-label="Customer" value={value} onChange={e => onChange(e.target.value, e.target.selectedOptions[0]?.text ?? "")} className={`${inputClass} mt-1`}><option value="">Choose</option>{(data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}</option>)}</select></div>;
}

export function ReceiptAllocationPanel({ today }: { today: string }) {
  const router = useRouter();
  const [customer, setCustomer] = useState(""); const [amount, setAmount] = useState(""); const [narration, setNarration] = useState("");
  const [date, setDate] = useState(today); const [method, setMethod] = useState<PaymentMethod>("bank_transfer"); const [reference, setReference] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null); const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newKey()); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const received = Number(amount);
  const allocated = useMemo(() => Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0), [amounts]);
  const onAccount = Math.round((received - allocated) * 100) / 100;
  async function propose() {
    if (!customer || !(received > 0)) return setMessage({ tone: "error", text: "Choose the customer and enter the amount received." });
    const out = await apWrite<Proposal>("ap_cash", "propose", { customer_id: customer, amount: received, ...(narration.trim() ? { narration: narration.trim() } : {}) }, setMessage);
    if (!out) return;
    setMessage(null); setProposal(out); setKey(newKey());
    setAmounts(Object.fromEntries(out.allocations.map(a => [a.invoice_id, String(a.amount)])));
  }
  async function post() {
    if (!proposal || onAccount < 0) return;
    setBusy(true);
    const out = await apWrite<{ allocated: number; on_account: number; replayed: boolean }>("ap_cash", "post", { key, customer_id: customer, amount: received, payment_date: date, payment_method: method,
      ...(reference.trim() ? { reference_number: reference.trim() } : {}), ...(narration.trim() ? { notes: narration.trim().slice(0, 300) } : {}),
      allocations: Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([invoice_id, v]) => ({ invoice_id, amount: Math.round(Number(v) * 100) / 100 })),
      on_account: Math.max(onAccount, 0), proposed: proposal as unknown as Record<string, unknown> }, setMessage);
    setBusy(false);
    if (!out) return;
    setMessage({ tone: "ok", text: `${out.replayed ? "Already recorded" : "Recorded"}: ${inr(out.allocated)} against invoices${out.on_account > 0 ? `, ${inr(out.on_account)} on account` : ""}.` });
    setProposal(null); setAmounts({}); setAmount(""); setReference(""); setNarration(""); setKey(newKey()); router.refresh();
  }
  return <Section id="allocate" title="Receive money from a customer" description="The system proposes invoices named in the bank narration first, then the oldest; anything left stays on account for the next invoice. Change amounts if needed: changes are kept for audit.">
    <div className="grid gap-2 sm:grid-cols-3">
      <CustomerSelect value={customer} onChange={id => { setCustomer(id); setProposal(null); }} />
      <label className="text-sm font-semibold">Amount received (₹)<input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setProposal(null); }} className={`${inputClass} mt-1`} /></label>
      <label className="text-sm font-semibold">Bank narration (optional)<input value={narration} onChange={e => setNarration(e.target.value)} className={`${inputClass} mt-1`} placeholder="Paste it to match named invoices" /></label>
      <label className="text-sm font-semibold">Date received<input type="date" max={today} value={date} onChange={e => setDate(e.target.value)} className={`${inputClass} mt-1`} /></label>
      <label className="text-sm font-semibold">How<select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)} className={`${inputClass} mt-1`}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="text-sm font-semibold">UTR / cheque no.<input value={reference} onChange={e => setReference(e.target.value)} className={`${inputClass} mt-1`} /></label>
    </div>
    <button type="button" className={secondaryClass} onClick={propose}>Propose allocation</button>
    {proposal ? <div className="space-y-2">
      {proposal.allocations.length ? <ul className="space-y-1">{proposal.allocations.map(a => <li key={a.invoice_id} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1">{a.invoice_number} · due {fmtDay(a.due_date)} · balance {inr(a.balance_due)} {a.basis === "named" ? <Pill value="exact" label="named" /> : null}</span>
        <input aria-label={`Amount for ${a.invoice_number}`} inputMode="decimal" value={amounts[a.invoice_id] ?? ""} onChange={e => setAmounts({ ...amounts, [a.invoice_id]: e.target.value })} className={`${inputClass} w-32 text-right`} /></li>)}</ul>
        : <Empty>{proposal.customer} has no open invoice: the whole amount goes on account.</Empty>}
      <p className={`text-sm font-semibold ${onAccount < 0 ? "text-rose-800" : ""}`}>Allocated {inr(allocated)} · on account {inr(Math.max(onAccount, 0))}{onAccount < 0 ? " · allocations are more than the amount received" : ""}</p>
      <button type="button" disabled={busy || onAccount < 0} onClick={post} className={buttonClass}>{busy ? "Recording…" : "Record receipt"}</button>
    </div> : null}
    <Message value={message} />
    <OnAccountList reloadKey={key} />
  </Section>;
}

function OnAccountList({ reloadKey }: { reloadKey: string }) {
  const [page, setPage] = useState(1); const [k, setK] = useState(0);
  const { data } = useApRead<{ total_count: number; rows: Array<{ id: string; customer: string; customer_id: string; available: number; amount: number; reference: string | null; received_on: string; open_invoices: number }> }>("ap_cash", "on_account", { page }, [k, reloadKey]);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  if (!data?.rows.length) return null;
  return <div id="on-account" className="space-y-2 border-t border-neutral-100 pt-3"><h3 className="text-sm font-bold">On-account money waiting</h3>
    <ul className="space-y-1 text-sm">{data.rows.map(c => <li key={c.id} className="flex flex-wrap items-center gap-2"><span className="flex-1">{c.customer} · {inr(c.available)} of {inr(c.amount)} · {c.reference ?? "no reference"} · {fmtDay(c.received_on)}</span>
      {c.open_invoices ? <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ applied: number; remaining: number }>("ap_cash", "apply_on_account", { credit_id: c.id, key: newKey() }, setMessage);
        if (out) { setMessage({ tone: "ok", text: `${inr(out.applied)} applied oldest first; ${inr(out.remaining)} still on account.` }); setK(x => x + 1); } }}>Apply to oldest invoices</button> : <span className="text-neutral-500">no open invoice</span>}</li>)}</ul>
    <Pager page={page} total={data.total_count} onPage={setPage} /><Message value={message} /></div>;
}
