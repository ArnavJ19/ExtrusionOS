"use client";

// AP-036: freight from transporter rate cards. The estimate is an AP-002 proposal on the quote, loading session or
// dispatch; the decision, any override reason and the transporter's billed amount are kept for the variance report.
// Supplier rates are internal: nothing here reaches a customer document.
import { useState } from "react";
import { Truck } from "lucide-react";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { GST_STATE_OPTIONS, fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Decision = { target: { weight_kg: number | null; state: string | null; state_label: string | null; city: string | null; label: string | null };
  decision: null | { id: string; decision: string; transporter: string | null; vehicle_type: string | null; vehicles: number | null; proposed_amount: number; chosen_amount: number;
    override_reason: string | null; decided_by: string; decided_at: string; billed_amount: number | null; billed_reference: string | null; billed_source: string | null };
  proposal_id: string | null; can_record_billed: boolean };

export function FreightPanel({ kind, id, today }: { kind: "quote" | "loading" | "dispatch"; id: string; today: string }) {
  const [key, setKey] = useState(0);
  const state = useApRead<Decision>("ap_freight", "decision", { target_kind: kind, target_id: id }, [key]);
  const [message, setMessage] = useState<Note>(null);
  const [billed, setBilled] = useState(""); const [reference, setReference] = useState("");
  const d = state.data;
  async function propose() {
    const result = await apWrite<{ state: string; message?: string }>("ap_freight", "propose", { target_kind: kind, target_id: id }, setMessage);
    if (result && result.state !== "proposed") setMessage({ tone: "error", text: result.message ?? "No estimate could be prepared." });
    setKey(k => k + 1);
  }
  return <Section id="freight" title="Freight" description="Estimated from the transporter rate cards for this weight and destination. Internal only.">
    {state.loading && !d ? <Loading what="freight" /> : state.error ? <Failure text={state.error} /> : d ? <>
      <p className="text-sm text-neutral-700">{d.target.weight_kg ? `${Number(d.target.weight_kg).toLocaleString("en-IN")} kg` : "No weight yet"} to {[d.target.city, d.target.state_label].filter(Boolean).join(", ") || "an unknown destination"}</p>
      {d.decision ? <div className="space-y-1 rounded-xl bg-neutral-50 p-3 text-sm">
        <p className="font-bold">{inr(d.decision.chosen_amount)} with {d.decision.transporter ?? "—"}{d.decision.vehicle_type ? ` (${d.decision.vehicles} × ${d.decision.vehicle_type})` : ""} <Pill value={d.decision.decision === "accepted" ? "approved" : "held"} label={d.decision.decision} /></p>
        <p className="text-neutral-600">Estimate {inr(d.decision.proposed_amount)} · decided by {d.decision.decided_by} {fmtWhen(d.decision.decided_at)}{d.decision.override_reason ? ` · ${d.decision.override_reason}` : ""}</p>
        {d.decision.billed_amount !== null ? <p>Billed {inr(d.decision.billed_amount)}{d.decision.billed_reference ? ` (${d.decision.billed_reference})` : ""} · difference {inr(Number(d.decision.billed_amount) - Number(d.decision.chosen_amount))}</p>
          : d.can_record_billed && kind !== "quote" ? <div className="flex flex-wrap items-end gap-2 pt-1">
            <button type="button" className={secondaryClass} onClick={async () => { const r = await apWrite<{ state: string; message?: string }>("ap_freight", "refresh_billed", { decision_id: d.decision!.id }, setMessage); if (r?.state === "none") setMessage({ tone: "error", text: r.message ?? "" }); setKey(k => k + 1); }}>Take from transporter expense</button>
            <input aria-label="Billed amount" inputMode="decimal" className={`${inputClass} w-32`} value={billed} onChange={e => setBilled(e.target.value)} placeholder="₹ billed" />
            <input aria-label="Bill reference" className={`${inputClass} w-40`} value={reference} onChange={e => setReference(e.target.value)} placeholder="Bill number" />
            <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_freight", "record_billed", { decision_id: d.decision!.id, amount: Number(billed), reference: reference.trim() }, setMessage, "Billed freight recorded.")) setKey(k => k + 1); }}>Record billed</button>
          </div> : null}
      </div> : null}
      {d.proposal_id ? <ProposalCards type="freight.estimate" target={`${kind}:${id}`} initial={null} today={today} title="Freight estimate to confirm" onDecided={() => setKey(k => k + 1)} />
        : <button type="button" className={`${secondaryClass} inline-flex items-center gap-2`} onClick={propose}><Truck className="h-4 w-4" aria-hidden="true" />{d.decision ? "Estimate again" : "Estimate freight"}</button>}
    </> : null}
    <Message value={message} />
  </Section>;
}

type Card = { id: string; transporter: string; basis: string; vehicle_type: string | null; capacity_kg: number | null; state: string; state_label: string; city: string | null; rate: number;
  min_charge: number; effective_from: string; effective_to: string | null; status: string; note: string | null; retire_reason: string | null };
type Variance = { transporter: string; decisions: number; billed: number; overridden: number; chosen: number | null; billed_total: number | null; variance: number | null; variance_percent: number | null };
type Transporter = { id: string; name: string; city: string | null };

export function FreightCardsClient() {
  const [page, setPage] = useState(1); const [vPage, setVPage] = useState(1); const [key, setKey] = useState(0);
  const [status, setStatus] = useState<"active" | "retired" | "all">("active");
  const cards = useApRead<{ rows: Card[]; total_count: number; can_edit: boolean }>("ap_freight", "cards", { page, status }, [key]);
  const variance = useApRead<{ rows: Variance[]; total_count: number; unbilled: number }>("ap_freight", "variance", { page: vPage }, [key]);
  const transporters = useApRead<Transporter[]>("ap_freight", "transporters", {}, []);
  const [form, setForm] = useState({ transporter_id: "", basis: "per_kg", vehicle_type: "", vehicle_capacity_kg: "", destination_state: "27", destination_city: "", rate: "", min_charge: "", effective_from: new Date().toISOString().slice(0, 10) });
  const [message, setMessage] = useState<Note>(null);
  const [retire, setRetire] = useState<{ id: string; reason: string } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));
  async function save() {
    const payload: Record<string, unknown> = { transporter_id: form.transporter_id, basis: form.basis, destination_state: form.destination_state, rate: Number(form.rate), effective_from: form.effective_from };
    if (form.destination_city.trim()) payload.destination_city = form.destination_city.trim();
    if (form.min_charge.trim()) payload.min_charge = Number(form.min_charge);
    if (form.basis === "per_vehicle") { payload.vehicle_type = form.vehicle_type.trim(); payload.vehicle_capacity_kg = Number(form.vehicle_capacity_kg); }
    if (await apWrite("ap_freight", "save_card", payload, setMessage, "Rate card added.")) { setForm(f => ({ ...f, rate: "", min_charge: "", destination_city: "" })); setKey(k => k + 1); }
  }
  return <div className="space-y-5">
    {cards.data?.can_edit ? <Section title="Add a rate card" description="Per kg, or per vehicle type with its capacity. A city card replaces the state card of the same transporter and vehicle for that city.">
      {transporters.data && !transporters.data.length ? <Empty>No active transporters. Add a vendor of type transporter first.</Empty> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold">Transporter<select className={`${inputClass} mt-1`} value={form.transporter_id} onChange={set("transporter_id")}><option value="">Choose</option>{(transporters.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Basis<select className={`${inputClass} mt-1`} value={form.basis} onChange={set("basis")}><option value="per_kg">Per kg</option><option value="per_vehicle">Per vehicle</option></select></label>
        <label className="text-sm font-semibold">Destination state<select className={`${inputClass} mt-1`} value={form.destination_state} onChange={set("destination_state")}>{GST_STATE_OPTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <label className="text-sm font-semibold">City (optional)<input className={`${inputClass} mt-1`} value={form.destination_city} onChange={set("destination_city")} /></label>
        {form.basis === "per_vehicle" ? <>
          <label className="text-sm font-semibold">Vehicle type<input className={`${inputClass} mt-1`} value={form.vehicle_type} onChange={set("vehicle_type")} placeholder="14 ft truck" /></label>
          <label className="text-sm font-semibold">Capacity kg<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.vehicle_capacity_kg} onChange={set("vehicle_capacity_kg")} /></label></> : null}
        <label className="text-sm font-semibold">{form.basis === "per_kg" ? "Rate ₹/kg" : "Rate ₹/vehicle"}<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.rate} onChange={set("rate")} /></label>
        <label className="text-sm font-semibold">Minimum charge ₹<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.min_charge} onChange={set("min_charge")} /></label>
        <label className="text-sm font-semibold">Effective from<input type="date" className={`${inputClass} mt-1`} value={form.effective_from} onChange={set("effective_from")} /></label>
      </div>
      <button type="button" className={buttonClass} onClick={save}>Add rate card</button>
      <Message value={message} />
    </Section> : null}
    <Section title="Rate cards" actions={<select aria-label="Show cards" className={`${inputClass} w-36`} value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(1); }}><option value="active">Active</option><option value="retired">Retired</option><option value="all">All</option></select>}>
      {cards.loading && !cards.data ? <Loading what="rate cards" /> : cards.error ? <Failure text={cards.error} /> : !cards.data?.rows.length ? <Empty>No rate cards yet.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Transporter</th><th>Destination</th><th>Basis</th><th>Rate</th><th>Minimum</th><th>From</th><th /></tr></thead>
          <tbody>{cards.data.rows.map(c => <tr key={c.id} className="border-t border-neutral-100"><td className="py-2 font-semibold">{c.transporter}</td><td>{c.city ? `${c.city}, ` : ""}{c.state_label}</td>
            <td>{c.basis === "per_kg" ? "Per kg" : `${c.vehicle_type} (${Number(c.capacity_kg).toLocaleString("en-IN")} kg)`}</td><td>{inr(c.rate)}</td><td>{inr(c.min_charge)}</td><td>{fmtDay(c.effective_from)}</td>
            <td>{c.status === "active" && cards.data!.can_edit ? retire?.id === c.id ? <span className="flex gap-1"><input aria-label="Why retire" className={`${inputClass} w-40`} value={retire.reason} onChange={e => setRetire({ id: c.id, reason: e.target.value })} />
              <button type="button" className="underline" onClick={async () => { if (await apWrite("ap_freight", "retire_card", { id: c.id, reason: retire.reason.trim() }, setMessage, "Card retired.")) { setRetire(null); setKey(k => k + 1); } }}>Retire</button></span>
              : <button type="button" className="underline" onClick={() => setRetire({ id: c.id, reason: "" })}>Retire</button> : <Pill value={c.status === "active" ? "open" : "cancelled"} label={c.status} />}</td></tr>)}</tbody></table></div>}
      {cards.data ? <Pager page={page} total={cards.data.total_count} onPage={setPage} /> : null}
    </Section>
    <Section title="Estimated vs billed freight" description={`Last 90 days, per transporter.${variance.data?.unbilled ? ` ${variance.data.unbilled} dispatch decision(s) have no billed amount yet.` : ""}`}>
      {variance.loading && !variance.data ? <Loading what="variance" /> : variance.error ? <Failure text={variance.error} /> : !variance.data?.rows.length ? <Empty>No freight decisions yet.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Transporter</th><th>Decisions</th><th>Overridden</th><th>Agreed (billed ones)</th><th>Billed</th><th>Variance</th></tr></thead>
          <tbody>{variance.data.rows.map(v => <tr key={v.transporter} className="border-t border-neutral-100"><td className="py-2 font-semibold">{v.transporter}</td><td>{v.decisions} ({v.billed} billed)</td><td>{v.overridden}</td>
            <td>{inr(v.chosen)}</td><td>{inr(v.billed_total)}</td><td>{v.variance === null ? "—" : `${inr(v.variance)} (${v.variance_percent ?? "—"}%)`}</td></tr>)}</tbody></table></div>}
      {variance.data ? <Pager page={vPage} total={variance.data.total_count} onPage={setVPage} /> : null}
    </Section>
  </div>;
}
