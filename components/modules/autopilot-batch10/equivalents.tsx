"use client";

// AP-049: approved equivalent profiles. Technical approves which profiles can stand in for each other (same section under
// another code, or an alternative a customer has approved). When an order line is short, the approved equivalents with
// free stock are shown; sales records the customer's consent before any substitution. The order line itself is changed
// only through the normal order edit.
import { useState } from "react";
import Link from "next/link";
import { CONSENT_CHANNELS, EQUIVALENT_BASIS } from "@/lib/autopilot-batch10/commands";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { CustomerPicker, ProfilePicker } from "../autopilot-batch9/pickers";

type Note = { tone: "ok" | "error"; text: string } | null;
type Free = { pieces: number; kg: number; lots: { finish: string; piece_length_m: number | null; pieces: number; kg: number }[] };
type EqRow = { id: string; status: string; basis: keyof typeof EQUIVALENT_BASIS; note: string | null; profile_id: string; profile_code: string; profile_name: string; kg_per_m: number; customer: string | null;
  proposed_by: string | null; proposed_at: string; own_proposal: boolean; approved_by: string | null; approved_at: string | null; free: Free | null };
type Offer = { equivalence_id: string; profile_id: string; profile_code: string; profile_name: string; kg_per_m: number; basis: keyof typeof EQUIVALENT_BASIS; note: string | null; free: Free };
type Consent = { id: string; equivalent_code: string; consent_by_name: string; consent_channel: keyof typeof CONSENT_CHANNELS; consent_reference: string | null; consented_on: string; recorded_by: string | null };
type ShortLine = { order_item_id: string; profile_id: string; profile_code: string; short_kg: number; own_free_kg: number; equivalents: Offer[]; consent: Consent | null };
const kg = (v: unknown) => `${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
const lots = (free: Free) => free.lots.length ? free.lots.map(l => `${l.pieces} pcs × ${l.piece_length_m ?? "?"} m ${l.finish.replaceAll("_", " ")}`).join("; ") : "none free";

/** On the profile record: its equivalents, with propose, approve and retire. */
export function ProfileEquivalentsPanel({ profileId }: { profileId: string }) {
  const read = useApRead<{ rows: EqRow[]; can_approve: boolean }>("ap_equivalents", "profile", { profile_id: profileId }, []);
  const [other, setOther] = useState<{ id: string; name: string } | null>(null); const [basis, setBasis] = useState<keyof typeof EQUIVALENT_BASIS>("same_section");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null); const [text, setText] = useState(""); const [note, setNote] = useState<Note>(null);
  const [retiring, setRetiring] = useState<string | null>(null); const [reason, setReason] = useState("");
  async function propose() {
    if (!other) { setNote({ tone: "error", text: "Choose the equivalent profile." }); return; }
    if (basis === "customer_approved" && !customer) { setNote({ tone: "error", text: "Choose the customer who approved this alternative." }); return; }
    const out = await apWrite("ap_equivalents", "propose", { profile_id: profileId, equivalent_profile_id: other.id, basis, ...(basis === "customer_approved" && customer ? { customer_id: customer.id } : {}), ...(text.trim() ? { note: text.trim() } : {}) }, setNote, "Proposed. Technical approves it before it is suggested.");
    if (out) { setOther(null); setText(""); setCustomer(null); await read.reload(); }
  }
  async function decide(command: string, payload: Record<string, unknown>, ok: string) { if (await apWrite("ap_equivalents", command, payload, setNote, ok)) { setRetiring(null); setReason(""); await read.reload(); } }
  return <Section id="equivalents" title="Equivalent profiles" description="Profiles that can be offered when this one is short. Each pair is approved by technical; the customer's consent is recorded on the order before a substitution.">
    {read.loading && !read.data ? <Loading what="equivalents" /> : read.error ? <Failure text={read.error} /> : read.data ? <>
      {read.data.rows.length ? <ul className="divide-y rounded-xl border">{read.data.rows.map(r => <li key={r.id} className="space-y-1 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span><Link className="font-bold underline" href={`/profiles/${r.profile_id}`}>{r.profile_code}</Link> · {r.profile_name} · {r.kg_per_m} kg/m</span><Pill value={r.status} label={r.status === "proposed" ? "Waiting for approval" : "Approved"} /></div>
        <p className="text-neutral-600">{EQUIVALENT_BASIS[r.basis]}{r.customer ? ` (${r.customer})` : ""}{r.note ? ` · ${r.note}` : ""}</p>
        <p className="text-xs text-neutral-500">Proposed by {r.proposed_by ?? "—"} {fmtWhen(r.proposed_at)}{r.approved_by ? ` · approved by ${r.approved_by} ${fmtWhen(r.approved_at)}` : ""}</p>
        {r.free ? <p className="text-xs text-neutral-600">Free stock: {kg(r.free.kg)} ({lots(r.free)})</p> : null}
        {read.data!.can_approve ? <div className="flex flex-wrap gap-2 pt-1">
          {r.status === "proposed" ? <button type="button" className={buttonClass} disabled={r.own_proposal} title={r.own_proposal ? "Approved by someone other than the proposer" : undefined} onClick={() => decide("approve", { id: r.id }, "Approved.")}>Approve</button> : null}
          {retiring === r.id ? <><input className={`${inputClass} sm:w-72`} placeholder="Reason (at least 5 characters)" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} />
            <button type="button" className={secondaryClass} disabled={reason.trim().length < 5} onClick={() => decide("retire", { id: r.id, reason: reason.trim() }, "Retired.")}>Confirm retire</button></>
            : <button type="button" className={secondaryClass} onClick={() => { setRetiring(r.id); setReason(""); }}>Retire</button>}
        </div> : null}
        {r.status === "proposed" && r.own_proposal && read.data!.can_approve ? <p className="text-xs text-neutral-500">Your own proposal is approved by another technical user (the owner excepted).</p> : null}
      </li>)}</ul> : <Empty>No equivalent is listed for this profile.</Empty>}
      <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
        <h3 className="text-sm font-bold">Propose an equivalent</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <ProfilePicker value={other} onChange={setOther} label="Equivalent profile" />
          <label className="block text-sm font-semibold">Why it is equivalent<select className={`${inputClass} mt-1`} value={basis} onChange={e => setBasis(e.target.value as keyof typeof EQUIVALENT_BASIS)}>{Object.entries(EQUIVALENT_BASIS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {basis === "customer_approved" ? <CustomerPicker value={customer} onChange={setCustomer} label="Customer who approved it" /> : null}
          <label className="block text-sm font-semibold">Note (optional)<input className={`${inputClass} mt-1`} value={text} maxLength={300} onChange={e => setText(e.target.value)} /></label>
        </div>
        <button type="button" className={buttonClass} onClick={propose}>Propose</button>
      </div>
      <Message value={note} />
    </> : null}
  </Section>;
}

function ConsentForm({ line, offer, onDone, today }: { line: ShortLine; offer: Offer; onDone: () => void; today: string }) {
  const [by, setBy] = useState(""); const [channel, setChannel] = useState<keyof typeof CONSENT_CHANNELS>("whatsapp"); const [ref, setRef] = useState(""); const [on, setOn] = useState(today); const [note, setNote] = useState<Note>(null);
  async function save() {
    if (by.trim().length < 2) { setNote({ tone: "error", text: "Enter who at the customer agreed." }); return; }
    const out = await apWrite("ap_equivalents", "consent", { order_item_id: line.order_item_id, equivalence_id: offer.equivalence_id, consent_by_name: by.trim(), consent_channel: channel, consented_on: on, ...(ref.trim() ? { consent_reference: ref.trim() } : {}) }, setNote,
      "Consent recorded. Now change the order line to the agreed profile through the order edit.");
    if (out) onDone();
  }
  return <div className="mt-2 space-y-2 rounded-xl bg-neutral-50 p-3">
    <p className="text-sm font-bold">Customer consent for {offer.profile_code}</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-sm font-semibold">Who agreed<input className={`${inputClass} mt-1`} value={by} maxLength={80} onChange={e => setBy(e.target.value)} /></label>
      <label className="block text-sm font-semibold">How<select className={`${inputClass} mt-1`} value={channel} onChange={e => setChannel(e.target.value as keyof typeof CONSENT_CHANNELS)}>{Object.entries(CONSENT_CHANNELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="block text-sm font-semibold">Date<input type="date" className={`${inputClass} mt-1`} value={on} max={today} onChange={e => setOn(e.target.value)} /></label>
      <label className="block text-sm font-semibold">Reference (optional)<input className={`${inputClass} mt-1`} value={ref} maxLength={120} placeholder="Message or email reference" onChange={e => setRef(e.target.value)} /></label>
    </div>
    <button type="button" className={buttonClass} onClick={save}>Record consent</button>
    <Message value={note} />
  </div>;
}

/** On the order record: short lines with approved equivalents in stock, and the customer's consent. */
export function OrderEquivalentsPanel({ orderId, today }: { orderId: string; today: string }) {
  const read = useApRead<{ lines: ShortLine[]; can_record: boolean }>("ap_equivalents", "order", { order_id: orderId }, []);
  const [open, setOpen] = useState<string | null>(null); const [note, setNote] = useState<Note>(null);
  if (read.loading && !read.data) return null;
  if (read.error || !read.data || !read.data.lines.length) return null;
  return <Section id="equivalents" title="Short lines and approved equivalents" description="These lines are not covered by reserved stock or planned production. Approved equivalents with free stock are listed; record the customer's consent before substituting.">
    <ul className="space-y-3">{read.data.lines.map(l => <li key={l.order_item_id} className="rounded-xl border border-neutral-200 p-3 text-sm">
      <p><b>{l.profile_code}</b> is short by <b>{kg(l.short_kg)}</b> (its own free stock: {kg(l.own_free_kg)}).</p>
      {l.consent ? <div className="mt-2 rounded-xl bg-emerald-50 p-2 text-emerald-900">
        <p>Consent recorded for <b>{l.consent.equivalent_code}</b>: {l.consent.consent_by_name} by {CONSENT_CHANNELS[l.consent.consent_channel]} on {fmtDay(l.consent.consented_on)}{l.consent.consent_reference ? ` (${l.consent.consent_reference})` : ""}, recorded by {l.consent.recorded_by ?? "—"}.</p>
        <p className="text-xs">The order line is not changed automatically. Edit the line to the agreed profile.</p>
        {read.data!.can_record ? <button type="button" className="min-h-11 text-sm font-bold underline" onClick={async () => { const reason = window.prompt("Reason for withdrawing the consent (at least 5 characters)"); if (reason && reason.trim().length >= 5 && await apWrite("ap_equivalents", "withdraw_consent", { id: l.consent!.id, reason: reason.trim() }, setNote, "Consent withdrawn.")) await read.reload(); }}>Withdraw consent</button> : null}
      </div> : l.equivalents.length ? <ul className="mt-2 divide-y">{l.equivalents.map(o => <li key={o.equivalence_id} className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{o.profile_code}</b> · {o.profile_name} · {EQUIVALENT_BASIS[o.basis]} · free {kg(o.free.kg)}</span>
          {read.data!.can_record && Number(o.free.kg) > 0 ? <button type="button" className={secondaryClass} onClick={() => setOpen(open === `${l.order_item_id}:${o.equivalence_id}` ? null : `${l.order_item_id}:${o.equivalence_id}`)}>Record customer consent</button> : null}</div>
        <p className="text-xs text-neutral-600">{lots(o.free)}</p>
        {open === `${l.order_item_id}:${o.equivalence_id}` ? <ConsentForm line={l} offer={o} today={today} onDone={() => { setOpen(null); void read.reload(); }} /> : null}
      </li>)}</ul> : <p className="mt-1 text-neutral-600">No approved equivalent is listed for this profile.</p>}
    </li>)}</ul>
    <Message value={note} />
  </Section>;
}

/** Across open orders: short lines that an approved equivalent in stock could cover. */
export function EquivalentShortages() {
  const [page, setPage] = useState(1);
  const read = useApRead<{ rows: { order_item_id: string; order_id: string; order_number: string; customer: string | null; profile_code: string; short_kg: number; promise: string | null; equivalents: Offer[]; consent_recorded: boolean }[]; total_count: number }>("ap_equivalents", "shortages", { page }, []);
  return <Section title="Shortages an equivalent could cover" description="Open order lines that are short, where an approved equivalent has free stock. Ten per page, earliest promise first.">
    {read.loading && !read.data ? <Loading what="shortages" /> : read.error ? <Failure text={read.error} /> : read.data ? <>
      {read.data.rows.length ? <ul className="divide-y rounded-xl border">{read.data.rows.map(r => <li key={r.order_item_id} className="p-3 text-sm">
        <p><Link className="font-bold underline" href={`/orders/${r.order_id}#equivalents`}>{r.order_number}</Link> · {r.customer ?? "—"} · {r.profile_code} short by {kg(r.short_kg)}{r.promise ? ` · promised ${fmtDay(r.promise)}` : ""}{r.consent_recorded ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900">Consent recorded</span> : null}</p>
        <p className="text-xs text-neutral-600">{r.equivalents.filter(o => Number(o.free.kg) > 0).map(o => `${o.profile_code}: ${kg(o.free.kg)} free`).join(" · ")}</p></li>)}</ul>
        : <Empty>No short line can be covered by an approved equivalent in stock.</Empty>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}
