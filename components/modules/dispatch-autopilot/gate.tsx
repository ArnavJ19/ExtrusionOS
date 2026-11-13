"use client";

// AP-019: the gate. Loaded dispatches wait here; security taps "Vehicle out" after reading the number plate. A different
// vehicle needs a dispatch supervisor's reason; a missing e-way bill above the threshold warns (or blocks, per policy).
// The register below replaces the paper gate register for outbound dispatches. AP-051: the ready-to-ship list.
import { useState } from "react";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { StartLoadingButton } from "./loading";

type Note = { tone: "ok" | "error"; text: string } | null;
type Waiting = { dispatch_id: string; dispatch_number: string; order_number: string; customer: string; vehicle_number: string | null; transporter_name: string | null; lr_number: string | null;
  eway_bill_number: string | null; bundles: number; net_kg: number; loaded_at: string; value: number | null; eway_required: boolean; eway_policy: string; eway_threshold: number };
type Exit = { id: string; dispatch_id: string; dispatch_number: string; order_number: string; customer: string; vehicle_number: string; transporter_name: string | null; lr_number: string | null;
  eway_bill_number: string | null; bundles: number; net_kg: number; exited_at: string; recorded_by: string; vehicle_check: string; override_reason: string | null; eway_state: string; eway_reason: string | null };

function GateCard({ d, supervisor, onOut }: { d: Waiting; supervisor: boolean; onOut: (text: string) => void }) {
  const [plate, setPlate] = useState(""); const [override, setOverride] = useState(""); const [ewayReason, setEwayReason] = useState("");
  const [message, setMessage] = useState<Note>(null);
  const missingEway = !d.eway_bill_number && d.eway_required;
  const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mismatch = Boolean(plate.trim() && d.vehicle_number && norm(plate) !== norm(d.vehicle_number));
  async function out() {
    const payload: Record<string, unknown> = { dispatch_id: d.dispatch_id, vehicle_number: plate.trim() };
    if (override.trim()) payload.override_reason = override.trim();
    if (ewayReason.trim()) payload.eway_reason = ewayReason.trim();
    const r = await apWrite<{ state: string; message: string }>("ap_dispatch", "gate_out", payload, setMessage);
    if (r) onOut(r.message);
  }
  return <article className="space-y-2 rounded-2xl border border-neutral-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-lg font-black">{d.vehicle_number ?? "Vehicle not recorded"}</p>
      <p className="text-sm text-neutral-600">{d.dispatch_number} · {d.order_number} · {d.customer}</p></div>
      {missingEway ? <Pill value="held" label="No e-way bill" /> : d.eway_bill_number ? <Pill value="approved" label={`EWB ${d.eway_bill_number}`} /> : <Pill value="cleared" label="EWB not needed" />}</div>
    <p className="text-sm">{d.bundles} bundle(s) · {Number(d.net_kg).toLocaleString("en-IN")} kg · {d.transporter_name ?? "no transporter"}{d.lr_number ? ` · LR ${d.lr_number}` : ""} · loaded {fmtWhen(d.loaded_at)}</p>
    <div className="flex flex-wrap gap-2">
      <input aria-label={`Number plate for ${d.dispatch_number}`} placeholder="Type the number plate" autoCapitalize="characters" className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-neutral-900 px-3 font-mono font-bold uppercase" value={plate} onChange={e => setPlate(e.target.value)} />
      <button type="button" disabled={plate.trim().length < 4} className={`${buttonClass} inline-flex min-h-12 items-center gap-2`} onClick={out}><LogOut className="h-4 w-4" aria-hidden="true" />Vehicle out</button>
    </div>
    {mismatch ? <div role="alert" className="space-y-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><p className="font-bold">This is not the dispatch vehicle ({d.vehicle_number}). Stop the vehicle.</p>
      {supervisor ? <input aria-label="Supervisor reason" className={inputClass} value={override} onChange={e => setOverride(e.target.value)} placeholder="Supervisor: why a different vehicle may leave" /> : <p>A dispatch supervisor must record the exception.</p>}</div> : null}
    {missingEway ? <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">{d.eway_policy === "block" ? "This vehicle cannot leave without an e-way bill number." : `No e-way bill for a consignment ${d.value === null ? "with no priced value" : `of ${inr(d.value)}`} (above ${inr(d.eway_threshold)}).`}</p>
      {d.eway_policy === "warn" ? <input aria-label="Why it leaves without an e-way bill" className={inputClass} value={ewayReason} onChange={e => setEwayReason(e.target.value)} placeholder="Reason it leaves without one (recorded)" /> : <Link className="underline" href="/dispatches/eway">Record the e-way bill</Link>}</div> : null}
    <Message value={message} />
  </article>;
}

export function GateClient({ supervisor, canGate = true }: { supervisor: boolean; canGate?: boolean }) {
  const [tab, setTab] = useState<"waiting" | "register">(canGate ? "waiting" : "register");
  const [page, setPage] = useState(1); const [rPage, setRPage] = useState(1); const [key, setKey] = useState(0); const [search, setSearch] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const waiting = useApRead<{ rows: Waiting[]; total_count: number }>("ap_dispatch", canGate ? "gate_queue" : "gate_register", { page, ...(search.trim() ? { search: search.trim() } : {}) }, [key]);
  const register = useApRead<{ rows: Exit[]; total_count: number; from: string; to: string }>("ap_dispatch", "gate_register", { page: rPage, ...(search.trim() ? { search: search.trim() } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) }, [key, tab]);
  const [message, setMessage] = useState<Note>(null);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      {(canGate ? (["waiting", "register"] as const) : (["register"] as const)).map(t => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={`min-h-11 rounded-xl px-4 text-sm font-bold ${tab === t ? "bg-neutral-950 text-white" : "border border-neutral-300 bg-white"}`}>{t === "waiting" ? `Waiting to leave${waiting.data ? ` (${waiting.data.total_count})` : ""}` : "Gate register"}</button>)}
      <input aria-label="Search vehicle or dispatch" placeholder="Vehicle, dispatch or order" className={`${inputClass} max-w-xs`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); setRPage(1); }} />
    </div>
    <Message value={message} />
    {tab === "waiting" ? <Section title="Loaded vehicles waiting at the gate">
      {waiting.loading && !waiting.data ? <Loading what="the gate queue" /> : waiting.error ? <Failure text={waiting.error} /> : !waiting.data?.rows.length ? <Empty>No loaded vehicle is waiting.</Empty> :
        <div className="grid gap-3 lg:grid-cols-2">{waiting.data.rows.map(d => <GateCard key={d.dispatch_id} d={d} supervisor={supervisor} onOut={text => { setMessage({ tone: "ok", text }); setKey(k => k + 1); }} />)}</div>}
      {waiting.data ? <Pager page={page} total={waiting.data.total_count} onPage={setPage} /> : null}
    </Section> : <Section title="Gate register (outbound dispatches)" description={register.data ? `${fmtDay(register.data.from)} to ${fmtDay(register.data.to)}` : undefined}
      actions={<span className="flex flex-wrap gap-2"><input type="date" aria-label="From" className={`${inputClass} w-40`} value={from} onChange={e => { setFrom(e.target.value); setRPage(1); }} /><input type="date" aria-label="To" className={`${inputClass} w-40`} value={to} onChange={e => { setTo(e.target.value); setRPage(1); }} /></span>}>
      {register.loading && !register.data ? <Loading what="the register" /> : register.error ? <Failure text={register.error} /> : !register.data?.rows.length ? <Empty>No vehicle left in this period.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">Out at</th><th>Vehicle</th><th>Dispatch</th><th>Customer</th><th>LR / transporter</th><th>E-way bill</th><th>Security</th></tr></thead>
          <tbody>{register.data.rows.map(x => <tr key={x.id} className="border-t border-neutral-100 align-top"><td className="py-2">{fmtWhen(x.exited_at)}</td><td className="font-mono font-bold">{x.vehicle_number}{x.vehicle_check === "override" ? <span className="block text-xs font-normal text-rose-700">Different vehicle: {x.override_reason}</span> : x.vehicle_check === "filled" ? <span className="block text-xs font-normal text-neutral-500">recorded at the gate</span> : null}</td>
            <td><Link className="underline" href={`/dispatches/${x.dispatch_id}`}>{x.dispatch_number}</Link><span className="block text-xs text-neutral-500">{x.bundles} bdl · {Number(x.net_kg).toLocaleString("en-IN")} kg</span></td><td>{x.customer}</td>
            <td>{x.lr_number ?? "—"}<span className="block text-xs text-neutral-500">{x.transporter_name ?? ""}</span></td>
            <td>{x.eway_bill_number ?? (x.eway_state === "not_required" ? "Not needed" : <span className="text-amber-900">Missing: {x.eway_reason}</span>)}</td><td>{x.recorded_by}</td></tr>)}</tbody></table></div>}
      {register.data ? <Pager page={rPage} total={register.data.total_count} onPage={setRPage} /> : null}
    </Section>}
  </div>;
}

type ReadyLine = { order_id: string; order_number: string; due: string | null; profile: string | null; bundles: number; pieces: number; packed_kg: number; released_kg: number; held_kg: number;
  held_reason: string | null; credit: string; overdue: boolean; loading_session_id: string | null };
type ReadyGroup = { customer_id: string; customer: string; destination: string; first_due: string | null; released_kg: number; released_gross_kg: number; held_kg: number; orders: number; lines: ReadyLine[] };

export function ReadyToShipClient({ canLoad }: { canLoad: boolean }) {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [due, setDue] = useState<string>(""); const [releasedOnly, setReleasedOnly] = useState(true);
  const list = useApRead<{ rows: ReadyGroup[]; total_count: number }>("ap_dispatch", "ready", { page, ...(search.trim() ? { search: search.trim() } : {}), ...(due ? { due_within_days: Number(due) } : {}), released_only: releasedOnly }, []);
  return <Section title="Ready to ship" description="Packed bundles not yet dispatched, by customer and destination. Released means QC-approved and packaged; held kilograms show why.">
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Search customer, city or order" placeholder="Customer, city or order" className={`${inputClass} max-w-xs`} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <select aria-label="Due" className={`${inputClass} w-44`} value={due} onChange={e => { setDue(e.target.value); setPage(1); }}><option value="">Any due date</option><option value="0">Due today or late</option><option value="3">Due in 3 days</option><option value="7">Due in 7 days</option></select>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={releasedOnly} onChange={e => { setReleasedOnly(e.target.checked); setPage(1); }} />Only lines with released material</label>
    </div>
    {list.loading && !list.data ? <Loading what="the ready list" /> : list.error ? <Failure text={list.error} /> : !list.data?.rows.length ? <Empty>Nothing packed is waiting to ship.</Empty> :
      <div className="space-y-3">{list.data.rows.map(g => <article key={`${g.customer_id}:${g.destination}`} className="rounded-2xl border border-neutral-200 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-black">{g.customer} <span className="font-semibold text-neutral-600">· {g.destination}</span></h3>
          <p className="text-sm"><b>{Number(g.released_kg).toLocaleString("en-IN")} kg</b> released ({Number(g.released_gross_kg).toLocaleString("en-IN")} kg gross){Number(g.held_kg) > 0 ? ` · ${Number(g.held_kg).toLocaleString("en-IN")} kg held` : ""} · first due {fmtDay(g.first_due)}</p></div>
        <ul className="mt-2 space-y-2">{g.lines.map((l, i) => <li key={`${l.order_id}:${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 p-2 text-sm">
          <span className="min-w-0"><Link className="font-bold underline" href={`/orders/${l.order_id}`}>{l.order_number}</Link> · {l.profile ?? "Profile"} · {l.bundles} bdl · {l.pieces} pcs · <b>{Number(l.released_kg).toLocaleString("en-IN")} kg</b> released
            {Number(l.held_kg) > 0 ? <span className="block text-amber-900">{Number(l.held_kg).toLocaleString("en-IN")} kg held: {l.held_reason}</span> : null}
            <span className="block text-neutral-600">Due {fmtDay(l.due)}{l.overdue ? " · late" : ""}</span></span>
          <span className="flex flex-wrap items-center gap-2">{l.credit === "held" ? <Pill value="held" label="Credit hold" /> : l.credit === "rejected" ? <Pill value="rejected" label="Credit refused" /> : l.credit === "approved" ? <Pill value="approved" label="Credit approved" /> : null}
            {canLoad ? l.loading_session_id ? <Link className={`${secondaryClass} inline-flex items-center`} href={`/dispatches/loading/${l.loading_session_id}`}>Continue loading</Link> : <StartLoadingButton orderId={l.order_id} label="Start loading" /> : null}</span>
        </li>)}</ul>
      </article>)}</div>}
    {list.data ? <Pager page={page} total={list.data.total_count} onPage={setPage} /> : null}
  </Section>;
}
