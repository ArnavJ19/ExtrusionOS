"use client";

// AP-074: scrap stock by grade (derived from recorded scrap and the foundry pool), buyer offers, the sale, the weighbridge
// weight and the GST invoice. Accepting an offer only creates the sale; the weighed kilograms are drawn from the yard and the
// oldest foundry lots of that grade (so the furnace cannot charge what was sold); the invoice is raised by accounts.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RECEIPT_METHODS, SCRAP_SALE_STATUS } from "@/lib/autopilot-batch9/commands";
import { fmtDay, fmtWhen, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { CustomerPicker } from "./pickers";

type Note = { tone: "ok" | "error"; text: string } | null;
type Grade = { grade_id: string; code: string; name: string; hsn_code: string; gst_percent: number; generated_kg: number; pool_kg: number; pool_available_kg: number; remelted_kg: number;
  sold_pool_kg: number; sold_yard_kg: number; yard_available_kg: number; on_hand_kg: number };
type Offer = { id: string; grade_id: string; grade: string; buyer: string; rate_per_kg: number; quantity_kg: number; valid_until: string; expired: boolean; status: string; note: string | null; best: boolean };
type SaleRow = { id: string; sale_number: string; status: string; grade: string; buyer: string; rate_per_kg: number; ordered_kg: number; net_kg: number | null; invoice_number: string | null; invoice_total: number | null; amount_received: number; created_at: string };
const kg = (v: unknown) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`);
const STATUS_TONE: Record<string, string> = { ordered: "held", weighed: "pending", invoiced: "approved", paid: "approved", cancelled: "blocked" };

export function ScrapStock({ onPickGrade }: { onPickGrade?: (grade: Grade) => void }) {
  const data = useApRead<{ grades: Grade[]; latest_weighing: { month: string; weighed_kg: number; reference: string | null } | null; basis: string }>("ap_scrap_sale", "stock", {}, []);
  return <Section id="scrap-stock" title="Scrap stock by grade" description={data.data?.basis ?? "Derived from recorded scrap, the foundry pool and sales."}>
    {data.loading && !data.data ? <Loading what="scrap stock" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[720px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Grade</th><th className="p-2 text-right">Generated</th><th className="p-2 text-right">To foundry</th>
          <th className="p-2 text-right">Remelted</th><th className="p-2 text-right">Sold</th><th className="p-2 text-right">In yard</th><th className="p-2 text-right">Foundry pool</th><th className="p-2 text-right">On hand</th><th className="p-2" /></tr></thead>
        <tbody>{data.data.grades.map(g => <tr key={g.grade_id} className="border-t"><td className="p-2"><b>{g.code}</b><span className="block text-xs text-neutral-500">{g.name} · HSN {g.hsn_code}</span></td>
          <td className="p-2 text-right tabular-nums">{kg(g.generated_kg)}</td><td className="p-2 text-right tabular-nums">{kg(g.pool_kg)}</td><td className="p-2 text-right tabular-nums">{kg(g.remelted_kg)}</td>
          <td className="p-2 text-right tabular-nums">{kg(Number(g.sold_pool_kg) + Number(g.sold_yard_kg))}</td><td className="p-2 text-right tabular-nums">{kg(g.yard_available_kg)}</td>
          <td className="p-2 text-right tabular-nums">{kg(g.pool_available_kg)}</td><td className="p-2 text-right font-bold tabular-nums">{kg(g.on_hand_kg)}</td>
          <td className="p-2">{onPickGrade ? <button type="button" className="text-sm font-bold underline" onClick={() => onPickGrade(g)}>Record offer</button> : null}</td></tr>)}</tbody>
      </table></div>
      <p className="text-xs text-neutral-600">On hand = generated − remelted − sold. {data.data.latest_weighing ? `Last yard weighing ${fmtDay(data.data.latest_weighing.month)}: ${kg(data.data.latest_weighing.weighed_kg)}.` : "No monthly yard weighing recorded yet."}</p>
    </> : null}
  </Section>;
}

function OfferForm({ grade, onDone }: { grade: Grade; onDone: () => void }) {
  const [buyer, setBuyer] = useState<{ id: string; name: string } | null>(null); const [rate, setRate] = useState(""); const [qty, setQty] = useState(""); const [until, setUntil] = useState(""); const [note, setNote] = useState("");
  const [message, setMessage] = useState<Note>(null); const [busy, setBusy] = useState(false);
  return <div className="space-y-3 rounded-xl border bg-neutral-50 p-3">
    <p className="text-sm font-bold">Offer for {grade.code} · {kg(grade.on_hand_kg)} on hand</p>
    <CustomerPicker label="Buyer" value={buyer} onChange={setBuyer} />
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-xs font-bold">Rate ₹/kg<input className={inputClass} inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} /></label>
      <label className="text-xs font-bold">Quantity kg<input className={inputClass} inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>
      <label className="text-xs font-bold">Valid until<input type="date" className={inputClass} value={until} onChange={e => setUntil(e.target.value)} /></label></div>
    <label className="block text-xs font-bold">Note (optional)<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="Lifting by Friday, payment in advance" /></label>
    <button type="button" className={buttonClass} disabled={busy || !buyer || !rate || !qty || !until} onClick={async () => {
      setBusy(true); const out = await apWrite("ap_scrap_sale", "offer", { grade_id: grade.grade_id, buyer_id: buyer!.id, rate_per_kg: Number(rate), quantity_kg: Number(qty), valid_until: until, ...(note.trim() ? { note: note.trim() } : {}) }, setMessage); setBusy(false);
      if (out) onDone();
    }}>Record offer</button>
    <Message value={message} />
  </div>;
}

export function ScrapOffers({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [grade, setGrade] = useState<Grade | null>(null); const [key, setKey] = useState(0); const [page, setPage] = useState(1); const [message, setMessage] = useState<Note>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null); const [reason, setReason] = useState("");
  const offers = useApRead<{ rows: Offer[]; total_count: number }>("ap_scrap_sale", "offers", { status: "open", page }, [key]);
  async function accept(o: Offer, why?: string) {
    const sale = await apWrite<{ id: string }>("ap_scrap_sale", "accept_offer", { offer_id: o.id, ...(why ? { reason: why } : {}) }, setMessage);
    if (sale) router.push(`/foundry/scrap-sales/${sale.id}`); else if (!o.best) setReasonFor(o.id);
  }
  return <>
    <ScrapStock onPickGrade={canManage ? setGrade : undefined} key={`stock-${key}`} />
    <Section id="scrap-offers" title="Open buyer offers" description="The best open offer per grade is marked. Accepting a lower one needs a reason.">
      {grade ? <OfferForm grade={grade} onDone={() => { setGrade(null); setKey(k => k + 1); setMessage({ tone: "ok", text: "Offer recorded." }); }} /> : null}
      <Message value={message} />
      {offers.loading && !offers.data ? <Loading what="offers" /> : offers.error ? <Failure text={offers.error} /> : offers.data ? <>
        {offers.data.rows.length ? <ul className="divide-y rounded-xl border">{offers.data.rows.map(o => <li key={o.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p><b>{o.grade}</b> · {o.buyer} · {inr(o.rate_per_kg)}/kg for {kg(o.quantity_kg)} · until {fmtDay(o.valid_until)}{o.best ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900">Best</span> : null}{o.expired ? <span className="ml-2 text-xs text-amber-800">expired</span> : null}</p>
            {canManage && !o.expired ? <div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => void accept(o)}>Accept</button>
              <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_scrap_sale", "withdraw_offer", { id: o.id }, setMessage)) setKey(k => k + 1); }}>Withdraw</button></div> : null}</div>
          {reasonFor === o.id ? <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-bold">Reason for not taking the best offer<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} placeholder="Best bidder cannot lift this week" /></label>
            <button type="button" className={buttonClass} disabled={reason.trim().length < 5} onClick={() => void accept(o, reason.trim())}>Accept with reason</button></div> : null}
          {o.note ? <p className="text-xs text-neutral-600">{o.note}</p> : null}
        </li>)}</ul> : <Empty>No open offer. Pick a grade above to record one.</Empty>}
        <Pager page={page} total={offers.data.total_count} onPage={setPage} />
      </> : null}
    </Section>
    <ScrapSalesList reloadKey={key} />
  </>;
}

export function ScrapSalesList({ reloadKey = 0 }: { reloadKey?: number }) {
  const [page, setPage] = useState(1); const [status, setStatus] = useState("all"); const [search, setSearch] = useState(""); const [q, setQ] = useState("");
  const data = useApRead<{ rows: SaleRow[]; total_count: number }>("ap_scrap_sale", "sales", { page, status, ...(q ? { search: q } : {}) }, [reloadKey]);
  return <Section id="scrap-sales" title="Scrap sales" description="Ten per page, newest first.">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
      <select aria-label="Status" className={`${inputClass} w-auto`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">All</option>{Object.entries(SCRAP_SALE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input aria-label="Search sales" className={`${inputClass} max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Sale, invoice or buyer" />
      <button type="submit" className={secondaryClass}>Search</button></form>
    {data.loading && !data.data ? <Loading what="scrap sales" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <div className="min-w-0"><Link className="font-bold underline" href={`/foundry/scrap-sales/${r.id}`}>{r.sale_number}</Link> · {r.grade} · {r.buyer}
          <p className="text-xs text-neutral-500">{inr(r.rate_per_kg)}/kg · {r.net_kg ? `weighed ${kg(r.net_kg)}` : `ordered ${kg(r.ordered_kg)}`}{r.invoice_number ? ` · ${r.invoice_number} ${inr(r.invoice_total)} (received ${inr(r.amount_received)})` : ""} · {fmtWhen(r.created_at)}</p></div>
        <Pill value={STATUS_TONE[r.status] ?? "unknown"} label={SCRAP_SALE_STATUS[r.status] ?? r.status} /></li>)}</ul> : <Empty>{q ? "No sale matches." : "No scrap sale yet."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

type Sale = SaleRow & { grade: { code: string; name: string }; buyer: { id: string; name: string; gst_number: string | null; state: string | null }; gross_kg: number | null; tare_kg: number | null;
  weighbridge_ref: string | null; vehicle_registration: string | null; not_best_reason: string | null; hsn_code: string | null; taxable_value: number | null; cgst_amount: number | null; sgst_amount: number | null;
  igst_amount: number | null; invoice_date: string | null; place_of_supply: string | null; cancel_reason: string | null;
  allocations: { kg: number; source: string; lot: string | null; released: boolean }[]; receipts: { amount: number; received_on: string; method: string; reference: string | null }[] };

export function ScrapSaleRecord({ id, canManage, canMoney }: { id: string; canManage: boolean; canMoney: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<Sale>("ap_scrap_sale", "sale", { id }, [key]);
  const [gross, setGross] = useState(""); const [tare, setTare] = useState(""); const [slip, setSlip] = useState(""); const [vehicle, setVehicle] = useState("");
  const [amount, setAmount] = useState(""); const [method, setMethod] = useState("bank_transfer"); const [ref, setRef] = useState(""); const [cancel, setCancel] = useState("");
  const s = data.data;
  if (data.loading && !s) return <Loading what="the scrap sale" />;
  if (data.error || !s) return <Failure text={data.error ?? "Scrap sale not found."} />;
  const done = (text: string) => { setMessage({ tone: "ok", text }); setKey(k => k + 1); };
  const net = Number(gross) - Number(tare);
  return <div className="space-y-5">
    <Section title={`Scrap sale ${s.sale_number}`} description={`${s.grade.code} · ${s.grade.name} to ${s.buyer.name} at ${inr(s.rate_per_kg)}/kg`} actions={<Pill value={STATUS_TONE[s.status] ?? "unknown"} label={SCRAP_SALE_STATUS[s.status] ?? s.status} />}>
      <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-xs font-bold uppercase text-neutral-500">Ordered</dt><dd>{kg(s.ordered_kg)}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-neutral-500">Weighbridge net</dt><dd>{s.net_kg ? `${kg(s.net_kg)} (gross ${kg(s.gross_kg)} − tare ${kg(s.tare_kg)}) · slip ${s.weighbridge_ref}${s.vehicle_registration ? ` · ${s.vehicle_registration}` : ""}` : "Not weighed"}</dd></div>
        <div><dt className="text-xs font-bold uppercase text-neutral-500">Buyer GSTIN</dt><dd>{s.buyer.gst_number ?? "Not recorded"}{s.buyer.state ? ` · ${s.buyer.state}` : ""}</dd></div></dl>
      {s.not_best_reason ? <p className="text-sm text-neutral-600">Not the best offer: {s.not_best_reason}</p> : null}
      {s.allocations.length ? <p className="text-xs text-neutral-600">Drawn from: {s.allocations.map(a => `${kg(a.kg)} ${a.source === "yard" ? "yard" : `lot ${a.lot}`}${a.released ? " (released)" : ""}`).join(", ")}</p> : null}
      {s.cancel_reason ? <p className="text-sm text-rose-800">Cancelled: {s.cancel_reason}</p> : null}
      <Message value={message} />
    </Section>
    {s.status === "ordered" && canManage ? <Section title="Weighbridge weight" description="Enter the gross and tare from the weighbridge slip. The net weight is drawn from this grade's stock.">
      <div className="grid gap-2 sm:grid-cols-4"><label className="text-xs font-bold">Gross kg<input className={inputClass} inputMode="decimal" value={gross} onChange={e => setGross(e.target.value)} /></label>
        <label className="text-xs font-bold">Tare kg<input className={inputClass} inputMode="decimal" value={tare} onChange={e => setTare(e.target.value)} /></label>
        <label className="text-xs font-bold">Slip number<input className={inputClass} value={slip} onChange={e => setSlip(e.target.value)} /></label>
        <label className="text-xs font-bold">Vehicle<input className={inputClass} value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="MH12AB1234" /></label></div>
      <p className="text-sm font-bold">Net: {gross && tare && net > 0 ? kg(net) : "—"}</p>
      <button type="button" className={buttonClass} disabled={!gross || !tare || !slip.trim() || !(net > 0)} onClick={async () => {
        if (await apWrite("ap_scrap_sale", "weigh", { id, gross_kg: Number(gross), tare_kg: Number(tare), weighbridge_ref: slip.trim(), ...(vehicle.trim() ? { vehicle_registration: vehicle.trim() } : {}) }, setMessage)) done("Weight recorded and drawn from stock.");
      }}>Record weight</button>
    </Section> : null}
    {s.status === "weighed" ? <Section title="Invoice" description={`HSN ${s.grade.code ? "from the grade" : ""}; GST by place of supply. ${canMoney ? "" : "Accounts raises the invoice."}`}>
      <p className="text-sm">Taxable value {inr(Number(s.net_kg) * Number(s.rate_per_kg))} before GST.</p>
      {canMoney ? <button type="button" className={buttonClass} onClick={async () => { if (await apWrite("ap_scrap_sale", "invoice", { id }, setMessage)) done("Invoice raised."); }}>Raise invoice</button> : null}
    </Section> : null}
    {s.invoice_number ? <Section title={`Invoice ${s.invoice_number}`} description={`${fmtDay(s.invoice_date)} · HSN ${s.hsn_code} · place of supply ${s.place_of_supply ?? "—"}`}
      actions={<a className={secondaryClass + " inline-flex items-center"} href={`/api/pdf/scrap-invoice/${id}`} target="_blank" rel="noreferrer">Invoice PDF</a>}>
      <p className="text-sm">Taxable {inr(s.taxable_value)} · {Number(s.igst_amount) > 0 ? `IGST ${inr(s.igst_amount)}` : `CGST ${inr(s.cgst_amount)} + SGST ${inr(s.sgst_amount)}`} · <b>Total {inr(s.invoice_total)}</b> · received {inr(s.amount_received)}</p>
      {s.receipts.length ? <ul className="text-sm">{s.receipts.map((r, k) => <li key={k}>{fmtDay(r.received_on)} · {inr(r.amount)} · {RECEIPT_METHODS[r.method as keyof typeof RECEIPT_METHODS] ?? r.method}{r.reference ? ` · ${r.reference}` : ""}</li>)}</ul> : null}
      {s.status === "invoiced" && canMoney ? <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold">Amount ₹<input className={inputClass} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="text-xs font-bold">Received by<select className={`${inputClass} w-auto`} value={method} onChange={e => setMethod(e.target.value)}>{Object.entries(RECEIPT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs font-bold">Reference<input className={inputClass} value={ref} onChange={e => setRef(e.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={!amount} onClick={async () => { if (await apWrite("ap_scrap_sale", "receipt", { id, amount: Number(amount), method, ...(ref.trim() ? { reference: ref.trim() } : {}) }, setMessage)) { setAmount(""); setRef(""); done("Receipt recorded."); } }}>Record receipt</button>
      </div> : null}
    </Section> : null}
    {["ordered", "weighed"].includes(s.status) && canManage ? <Section title="Cancel this sale" description="A weighed sale gives its kilograms back to the yard and the foundry lots.">
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-bold">Reason<input className={inputClass} value={cancel} onChange={e => setCancel(e.target.value)} /></label>
        <button type="button" className={secondaryClass} disabled={cancel.trim().length < 5} onClick={async () => { if (await apWrite("ap_scrap_sale", "cancel", { id, reason: cancel.trim() }, setMessage)) done("Sale cancelled."); }}>Cancel sale</button></div>
    </Section> : null}
  </div>;
}
