"use client";

// AP-050: customer health, scored every night from order rhythm against the customer's own normal, volume trend, payment
// delay trend, complaints and quotation wins. Internal to sales; each component explains itself. Sales records the follow-up.
import { useState } from "react";
import Link from "next/link";
import { FOLLOW_UP_OUTCOMES, HEALTH_BANDS } from "@/lib/autopilot-batch8/commands";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Component = { points: number; max: number; explain: string };
type FollowUp = { outcome: string; note: string; at: string; by: string | null };
type Row = { customer_id: string; customer: string; score: number; band: string; reasons: string[]; scored_on: string; previous_score: number | null; last_follow_up: FollowUp | null };
const BAND_TONE: Record<string, string> = { at_risk: "blocked", watch: "held", healthy: "approved" };
const COMPONENT: Record<string, string> = { frequency: "Order rhythm", volume: "Volume", payment: "Payment", complaints: "Complaints", quotes: "Quotation wins" };

function FollowUpForm({ customerId, onDone }: { customerId: string; onDone: (text: string) => void }) {
  const [outcome, setOutcome] = useState("called"); const [note, setNote] = useState(""); const [message, setMessage] = useState<Note>(null); const [busy, setBusy] = useState(false);
  return <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs font-bold">Follow-up<select className={`${inputClass} w-auto`} value={outcome} onChange={e => setOutcome(e.target.value)}>{Object.entries(FOLLOW_UP_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <label className="min-w-0 flex-1 text-xs font-bold">What was said<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="Spoke to purchase; new project from January" /></label>
    <button type="button" className={buttonClass} disabled={busy || note.trim().length < 5} onClick={async () => { setBusy(true); const ok = await apWrite("ap_customer_health", "follow_up", { customer_id: customerId, outcome, note: note.trim() }, setMessage); setBusy(false); if (ok) { setNote(""); onDone("Follow-up recorded."); } }}>Record</button>
    <Message value={message} />
  </div>;
}

/** CRM: the customers most at risk, lowest score first, with why. Ten per page. */
export function AtRiskCustomers() {
  const [page, setPage] = useState(1); const [band, setBand] = useState("at_risk"); const [search, setSearch] = useState(""); const [q, setQ] = useState(""); const [key, setKey] = useState(0);
  const [open, setOpen] = useState<string | null>(null); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ rows: Row[]; total_count: number; as_of: string | null; can_score: boolean; counts: { at_risk: number; watch: number; healthy: number } }>("ap_customer_health", "at_risk", { page, band, ...(q ? { search: q } : {}) }, [key]);
  const canScore = Boolean(data.data?.can_score);
  return <Section id="at-risk" title="Customers at risk" description="Scored each night against each customer's own normal. Follow up the ten at the top every Monday and record what happened."
    actions={canScore ? <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ examined: number }>("ap_customer_health", "score_now", {}, setMessage); if (out) { setMessage({ tone: "ok", text: `Scored ${out.examined} customer(s).` }); setKey(k => k + 1); } }}>Score now</button> : undefined}>
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
      <select aria-label="Band" className={`${inputClass} w-auto`} value={band} onChange={e => { setBand(e.target.value); setPage(1); }}><option value="at_risk">At risk</option><option value="watch">Watch</option><option value="healthy">Healthy</option><option value="all">All customers</option></select>
      <input aria-label="Search customer" className={`${inputClass} max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer name" />
      <button type="submit" className={secondaryClass}>Search</button>
    </form>
    <Message value={message} />
    {data.loading && !data.data ? <Loading what="customer health" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <p className="text-sm text-neutral-600">{data.data.as_of ? `Scored ${fmtDay(data.data.as_of)}` : "Not scored yet"} · {data.data.counts.at_risk} at risk · {data.data.counts.watch} to watch · {data.data.counts.healthy} healthy</p>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(r => <li key={r.customer_id} className="space-y-2 p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><Link href={`/customers/${r.customer_id}#customer-health`} className="font-bold underline">{r.customer}</Link>
          <p className="text-xs text-neutral-500">Score {r.score}{r.previous_score !== null ? ` (was ${r.previous_score} a month ago)` : ""}{r.last_follow_up ? ` · last follow-up ${fmtWhen(r.last_follow_up.at)} by ${r.last_follow_up.by ?? "sales"}` : " · not followed up"}</p></div>
          <Pill value={BAND_TONE[r.band] ?? "unknown"} label={(HEALTH_BANDS as Record<string, string>)[r.band] ?? r.band} /></div>
        {r.reasons.length ? <ul className="list-disc space-y-0.5 pl-5">{r.reasons.map(x => <li key={x}>{x}</li>)}</ul> : <p className="text-neutral-600">Nothing unusual.</p>}
        {open === r.customer_id ? <FollowUpForm customerId={r.customer_id} onDone={text => { setMessage({ tone: "ok", text }); setOpen(null); setKey(k => k + 1); }} />
          : <button type="button" className="text-sm font-bold underline" onClick={() => setOpen(r.customer_id)}>Record follow-up</button>}
      </li>)}</ul> : <Empty>{q ? "No customer matches." : band === "at_risk" ? "No customer is at risk." : "No customer in this band."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

type Detail = { latest: { score: number; band: string; scored_on: string; reasons: string[]; components: Record<string, Component> } | null; months: { month: string; score: number; band: string }[]; follow_ups: FollowUp[] };

/** Customer record: this customer's score, the five components and their explanations, the monthly trend and follow-ups. */
export function CustomerHealthPanel({ customerId }: { customerId: string }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<Detail>("ap_customer_health", "customer", { customer_id: customerId }, [key]);
  const d = data.data;
  return <Section id="customer-health" title="Customer health" description="Internal to sales. Points are lost only where the customer's own history shows a change.">
    {data.loading && !d ? <Loading what="customer health" /> : data.error ? <Failure text={data.error} /> : d ? !d.latest ? <Empty>Not scored yet: the nightly score covers customers with an order in the last year.</Empty> : <>
      <div className="flex flex-wrap items-center gap-3"><p className="text-3xl font-black">{d.latest.score}</p><Pill value={BAND_TONE[d.latest.band] ?? "unknown"} label={(HEALTH_BANDS as Record<string, string>)[d.latest.band] ?? d.latest.band} /><span className="text-xs text-neutral-500">scored {fmtDay(d.latest.scored_on)}</span>
        {d.months.length > 1 ? <span className="text-xs text-neutral-600">Monthly: {d.months.map(m => `${new Date(`${m.month}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })} ${m.score}`).join(" · ")}</span> : null}</div>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.keys(COMPONENT).filter(k => d.latest!.components[k]).map(k => [k, d.latest!.components[k]] as const).map(([k, c]) => <div key={k} className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs font-bold uppercase text-neutral-500">{COMPONENT[k] ?? k} · −{c.points} of {c.max}</dt><dd className="mt-1 text-sm">{c.explain}</dd></div>)}</dl>
      <FollowUpForm customerId={customerId} onDone={text => { setMessage({ tone: "ok", text }); setKey(k => k + 1); }} />
      <Message value={message} />
      {d.follow_ups.length ? <ul className="space-y-1 text-sm">{d.follow_ups.map((f, i) => <li key={`${f.at}:${i}`}>{(FOLLOW_UP_OUTCOMES as Record<string, string>)[f.outcome] ?? f.outcome} · {f.note} <span className="text-xs text-neutral-500">{f.by ?? "sales"} {fmtWhen(f.at)}</span></li>)}</ul> : null}
    </> : null}
  </Section>;
}
