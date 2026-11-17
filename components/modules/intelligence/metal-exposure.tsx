"use client";

// FS-72: metal price exposure. Visibility only — it never trades and gives no hedging advice.
import { useState } from "react";
import Link from "next/link";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";
import { kgText } from "@/lib/intelligence/format";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, Stat, buttonClass, fsWrite, inputClass, numberOrUndefined, secondaryClass, useFsRead, type Note } from "./shared";

type Order = { order_id: string; order_number: string; customer_name: string; open_kg: number; booked_kg: number; uncovered_kg: number; basis: string };
type Position = { as_of: string; sold_open_kg: number; booked_kg: number; uncovered_kg: number; price_linked_kg: number; lines_missing_quantity: number;
  stock: { billet_kg: number; cast_free_kg: number; cast_allocated_kg: number; scrap_pool_kg: number; total_kg: number }; on_order_kg: number; net_kg: number;
  direction: "short" | "long" | "flat"; price_step_per_kg: number; impact_of_step: number; limit_kg: number | null; over_limit: boolean; reference_rate: number | null; orders: Order[]; basis: string };
type Booking = { id: string; order_id: string; order_number: string; po_number: string | null; supplier_reference: string; quantity_kg: number; rate_per_kg: number; booked_on: string; status: string; booked_by_name: string; cancel_reason: string | null };

export function MetalExposureClient({ canSetLimit }: { canSetLimit: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null); const [booking, setBooking] = useState<Order | null>(null);
  const p = useFsRead<Position>("fs_metal_exposure", "position", {}, [key]);
  const v = p.data;
  const refresh = () => setKey(k => k + 1);
  return <div className="space-y-5">
    <Message value={message} />
    {p.loading && !v ? <Loading what="the metal position" /> : p.error ? <Failure text={p.error} /> : v ? <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net open position" value={`${kgText(Math.abs(v.net_kg))} ${v.direction === "flat" ? "" : v.direction}`} tone={v.over_limit ? "bad" : undefined}
          hint={v.direction === "short" ? "Sold at a fixed price, metal not yet held or bought" : v.direction === "long" ? "Metal held or bought beyond what is sold" : "Balanced"} />
        <Stat label={`A ₹${v.price_step_per_kg}/kg move`} value={inr(v.impact_of_step)} hint={v.direction === "short" ? "Cost if the price rises" : v.direction === "long" ? "Loss if the price falls" : "No effect"} />
        <Stat label="Limit" value={v.limit_kg === null ? "Not set" : kgText(v.limit_kg)} hint={v.over_limit ? "Above the limit; the owner is alerted each morning" : "Set by the owner"} tone={v.over_limit ? "bad" : undefined} />
        <Stat label="Billet reference rate" value={v.reference_rate === null ? "No approved rate" : `${inr(v.reference_rate)}/kg`} hint="Today's approved billet rate" />
      </div>
      <Section title="How the position is made" description={v.basis}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-neutral-50 p-3"><dt className="font-bold">Sold, fixed price</dt><dd>Still to produce {kgText(v.sold_open_kg)} − booked back-to-back {kgText(v.booked_kg)} = <b>{kgText(v.uncovered_kg)}</b></dd>
            {v.price_linked_kg ? <dd className="text-xs text-neutral-600">{kgText(v.price_linked_kg)} on price-linked orders is left out.</dd> : null}
            {v.lines_missing_quantity ? <dd className="text-xs text-amber-800">{v.lines_missing_quantity} order line(s) have no kg and cannot be counted.</dd> : null}</div>
          <div className="rounded-xl bg-neutral-50 p-3"><dt className="font-bold">Held and on order</dt><dd>Billet {kgText(v.stock.billet_kg)} · cast billets {kgText(v.stock.cast_free_kg + v.stock.cast_allocated_kg)} · scrap pool {kgText(v.stock.scrap_pool_kg)} · on order {kgText(v.on_order_kg)}</dd>
            <dd>Total <b>{kgText(v.stock.total_kg + v.on_order_kg)}</b></dd></div>
        </dl>
      </Section>
      <Section title="Orders carrying open metal" description="Book a purchase against an order when its metal is bought at a fixed price.">
        {v.orders.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[620px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Order</th><th className="p-2">Customer</th><th className="p-2 text-right">To produce</th><th className="p-2 text-right">Booked</th><th className="p-2 text-right">Uncovered</th><th className="p-2" /></tr></thead>
          <tbody>{v.orders.map(o => <tr key={o.order_id} className="border-t"><td className="p-2"><Link className="underline" href={`/orders/${o.order_id}`}>{o.order_number}</Link></td><td className="p-2">{o.customer_name}</td>
            <td className="p-2 text-right tabular-nums">{kgText(o.open_kg)}</td><td className="p-2 text-right tabular-nums">{kgText(o.booked_kg)}</td><td className="p-2 text-right font-bold tabular-nums">{kgText(o.uncovered_kg)}</td>
            <td className="p-2 text-right"><button type="button" className="text-sm font-bold underline" disabled={o.uncovered_kg <= 0} onClick={() => setBooking(o)}>Book metal</button></td></tr>)}</tbody>
        </table></div> : <Empty>No open fixed-price metal.</Empty>}
        {booking ? <BookForm order={booking} onDone={text => { setBooking(null); setMessage({ tone: "ok", text }); refresh(); }} onCancel={() => setBooking(null)} /> : null}
      </Section>
    </> : null}
    <Bookings key={key} onChange={refresh} />
    <Trend />
    {canSetLimit ? <Limit onSaved={refresh} /> : null}
  </div>;
}

function BookForm({ order, onDone, onCancel }: { order: Order; onDone: (text: string) => void; onCancel: () => void }) {
  const [message, setMessage] = useState<Note>(null); const [kg, setKg] = useState(String(order.uncovered_kg)); const [rate, setRate] = useState(""); const [ref, setRef] = useState(""); const [note, setNote] = useState("");
  return <div className="space-y-2 rounded-xl border border-neutral-300 bg-neutral-50 p-3">
    <p className="text-sm font-bold">Back-to-back booking for {order.order_number}</p>
    <Message value={message} />
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold">Quantity kg<input className={`${inputClass} w-32`} inputMode="decimal" value={kg} onChange={e => setKg(e.target.value)} /></label>
      <label className="text-xs font-bold">Rate ₹/kg<input className={`${inputClass} w-28`} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} /></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Supplier and reference<input className={inputClass} value={ref} onChange={e => setRef(e.target.value)} placeholder="Supplier confirmation number" /></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button type="button" className={buttonClass} disabled={!kg || !rate || ref.trim().length < 2} onClick={async () => {
        if (await fsWrite("fs_metal_exposure", "book", { order_id: order.order_id, quantity_kg: Number(kg), rate_per_kg: Number(rate), supplier_reference: ref.trim(), ...(note.trim() ? { note: note.trim() } : {}) }, setMessage)) onDone("Booking recorded.");
      }}>Record booking</button>
      <button type="button" className={secondaryClass} onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}

function Bookings({ onChange }: { onChange: () => void }) {
  const [page, setPage] = useState(1); const [status, setStatus] = useState("open"); const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null); const [reason, setReason] = useState<Record<string, string>>({});
  const d = useFsRead<{ rows: Booking[]; total_count: number }>("fs_metal_exposure", "bookings", { page, status }, [key]);
  return <Section id="bookings" title="Back-to-back bookings" description="Purchases fixed against a specific sales order.">
    <select aria-label="Status" className={`${inputClass} w-auto`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="open">Open</option><option value="cancelled">Cancelled</option><option value="all">All</option></select>
    <Message value={message} />
    {d.loading && !d.data ? <Loading what="bookings" /> : d.error ? <Failure text={d.error} /> : d.data ? <>
      {d.data.rows.length ? <ul className="divide-y rounded-xl border text-sm">{d.data.rows.map(b => <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
        <span><Link className="font-bold underline" href={`/orders/${b.order_id}`}>{b.order_number}</Link> · {kgText(b.quantity_kg)} at {inr(b.rate_per_kg)}/kg · {b.supplier_reference} · {fmtDay(b.booked_on)} · {b.booked_by_name}{b.cancel_reason ? ` · cancelled: ${b.cancel_reason}` : ""}</span>
        {b.status === "open" ? <span className="flex items-center gap-2"><input aria-label="Reason to cancel" className={`${inputClass} w-48`} placeholder="Reason to cancel" value={reason[b.id] ?? ""} onChange={e => setReason(r => ({ ...r, [b.id]: e.target.value }))} />
          <button type="button" className={secondaryClass} disabled={(reason[b.id] ?? "").trim().length < 5} onClick={async () => {
            if (await fsWrite("fs_metal_exposure", "cancel_booking", { id: b.id, reason: reason[b.id].trim() }, setMessage, "Booking cancelled.")) { setKey(k => k + 1); onChange(); }
          }}>Cancel booking</button></span> : <Pill value="cancelled" />}
      </li>)}</ul> : <Empty>No bookings.</Empty>}
      <Pager page={page} total={d.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

function Trend() {
  const d = useFsRead<{ rows: { snapshot_date: string; net_kg: number; uncovered_kg: number; stock_kg: number; on_order_kg: number; limit_kg: number | null }[] }>("fs_metal_exposure", "trend", {}, []);
  return <Section id="trend" title="Last 30 mornings" description="The position kept each morning.">
    {d.loading && !d.data ? <Loading what="the trend" /> : d.error ? <Failure text={d.error} /> : d.data?.rows.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[520px] text-sm">
      <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Day</th><th className="p-2 text-right">Uncovered sold</th><th className="p-2 text-right">Held</th><th className="p-2 text-right">On order</th><th className="p-2 text-right">Net</th></tr></thead>
      <tbody>{d.data.rows.map(r => <tr key={r.snapshot_date} className="border-t"><td className="p-2">{fmtDay(r.snapshot_date)}</td><td className="p-2 text-right tabular-nums">{kgText(r.uncovered_kg)}</td>
        <td className="p-2 text-right tabular-nums">{kgText(r.stock_kg)}</td><td className="p-2 text-right tabular-nums">{kgText(r.on_order_kg)}</td>
        <td className={`p-2 text-right font-bold tabular-nums ${r.limit_kg !== null && Math.abs(r.net_kg) > r.limit_kg ? "text-rose-700" : ""}`}>{kgText(r.net_kg)}</td></tr>)}</tbody>
    </table></div> : <Empty>The first morning snapshot appears after the morning job runs.</Empty>}
  </Section>;
}

function Limit({ onSaved }: { onSaved: () => void }) {
  const [message, setMessage] = useState<Note>(null); const [limit, setLimit] = useState(""); const [step, setStep] = useState(""); const [reason, setReason] = useState(""); const [key, setKey] = useState(0);
  const s = useFsRead<{ open_position_limit_kg: number | null; price_step_per_kg: number; reason?: string; updated_by_name?: string }>("fs_metal_exposure", "settings", {}, [key]);
  return <Section id="limit" title="Owner's limit" description="Alert when the net open position, either way, passes this many kg. Blank removes the limit.">
    <Message value={message} />
    {s.data ? <p className="text-sm">Now {s.data.open_position_limit_kg === null ? "no limit" : kgText(s.data.open_position_limit_kg)}; price step ₹{s.data.price_step_per_kg}/kg{s.data.updated_by_name ? ` · set by ${s.data.updated_by_name} (“${s.data.reason}”)` : ""}.</p> : null}
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold">Limit kg<input className={`${inputClass} w-32`} inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} /></label>
      <label className="text-xs font-bold">Price step ₹/kg<input className={`${inputClass} w-28`} inputMode="decimal" value={step} onChange={e => setStep(e.target.value)} /></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Reason<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button type="button" className={buttonClass} disabled={reason.trim().length < 5} onClick={async () => {
        if (await fsWrite("fs_metal_exposure", "save_settings", { open_position_limit_kg: numberOrUndefined(limit), price_step_per_kg: numberOrUndefined(step), reason: reason.trim() }, setMessage, "Limit saved.")) { setReason(""); setKey(k => k + 1); onSaved(); }
      }}>Save</button></div>
  </Section>;
}
