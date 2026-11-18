"use client";

// AP-057: last prices and variance on purchase order lines. Every line written gets a database price check; a line priced
// above the threshold needs a reason before its purchase order can be issued. Purchase and management roles only.
import { useEffect, useRef, useState } from "react";
import { purchasePriceAction } from "@/lib/actions/purchase-lifecycle";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";

type Hist = { rate: number; unit?: string; vendor: string; po_number: string; order_date: string; same_supplier?: boolean };
export type PriceHistory = { last: Hist[]; same_supplier: Hist | null; reference_rate: number | null; variance_percent: number | null; threshold_percent?: number; flagged: boolean; basis: string };
type Check = { purchase_order_line_id: string; line_number: number; unit_rate: number; reference_rate: number | null; variance_percent: number | null; threshold_percent: number;
  flagged: boolean; reason: string | null; reason_at: string | null; reason_by_name: string | null; history: PriceHistory };

export const pctText = (v: number | null | undefined) => v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

function HistoryLine({ h }: { h: PriceHistory }) {
  if (!h.last?.length) return <p className="text-xs text-slate-600">{h.basis}</p>;
  return <div className="space-y-1 text-xs text-slate-700">
    <p className="font-semibold">Last prices (issued purchase orders):</p>
    <ul className="space-y-0.5">{h.last.map((x, i) => <li key={i}>{inr(x.rate)} · {x.vendor}{x.same_supplier ? " (this supplier)" : ""} · {x.po_number} · {fmtDay(x.order_date)}</li>)}</ul>
    {h.same_supplier && !h.last.some(x => x.same_supplier) ? <p>This supplier last charged {inr(h.same_supplier.rate)} on {h.same_supplier.po_number} ({fmtDay(h.same_supplier.order_date)}).</p> : null}
  </div>;
}

/** Inline on a draft purchase order line: earlier prices and the variance, with the reason box when it is flagged. */
export function PriceCheck({ description, unit, vendorId, rate, reason, onReason, onFlag }: {
  description: string; unit: string; vendorId: string; rate: string; reason: string; onReason: (v: string) => void; onFlag: (flagged: boolean) => void;
}) {
  const [data, setData] = useState<PriceHistory | null>(null); const [error, setError] = useState<string | null>(null);
  const flagRef = useRef(onFlag);
  useEffect(() => { flagRef.current = onFlag; });
  useEffect(() => {
    const text = description.trim();
    if (text.length < 3) { setData(null); setError(null); flagRef.current(false); return; }
    let live = true;
    const timer = setTimeout(async () => {
      const r = Number(rate);
      const result = await purchasePriceAction("history", { description: text.slice(0, 240), unit, ...(vendorId ? { vendor_id: vendorId } : {}),
        ...(rate.trim() !== "" && Number.isFinite(r) && r >= 0 ? { rate: Math.round(r * 100) / 100 } : {}) });
      if (!live) return;
      if (!result.success) { setError(result.error); setData(null); flagRef.current(false); return; }
      const h = result.data as PriceHistory; setData(h); setError(null); flagRef.current(Boolean(h.flagged));
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [description, unit, vendorId, rate]);
  if (error) return <p className="text-xs text-slate-500 sm:col-span-6">{error}</p>;
  if (!data) return null;
  return <div className={`space-y-2 rounded-xl border p-3 sm:col-span-6 ${data.flagged ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
    <HistoryLine h={data} />
    {data.variance_percent !== null ? <p className={`text-xs font-semibold ${data.flagged ? "text-amber-900" : "text-slate-700"}`}>This rate is {pctText(data.variance_percent)} against the last price {inr(data.reference_rate)} (threshold {data.threshold_percent}%).</p> : null}
    {data.flagged ? <label className="block text-xs font-semibold text-amber-900">Why is this price higher? (needed before the PO is issued)
      <textarea required minLength={10} maxLength={300} rows={2} value={reason} onChange={e => onReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-normal" placeholder="For example: metal rate rose 6% since the last order; supplier quotation attached" /></label> : null}
  </div>;
}

/** On a purchase order: the price check of each line; on a draft, a flagged line can be given its reason. */
export function OrderPriceChecks({ orderId, canJustify }: { orderId: string; canJustify: boolean }) {
  const [data, setData] = useState<{ lines: Check[]; status: string } | null>(null); const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null); const [key, setKey] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    void purchasePriceAction("order_checks", { purchase_order_id: orderId }).then(result => {
      if (!live) return;
      if (result.success) { setData(result.data as { lines: Check[]; status: string }); setError(null); } else setError(result.error);
    });
    return () => { live = false; };
  }, [orderId, key]);
  if (error) return <p className="text-xs text-slate-500">{error}</p>;
  if (!data) return <p role="status" className="text-xs text-slate-500">Loading price checks…</p>;
  if (!data.lines.length) return <p className="text-xs text-slate-500">No price check is recorded for this purchase order (it was written before price checks existed).</p>;
  const open = data.lines.filter(l => l.flagged && !l.reason).length;
  return <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-bold">Price checks</h3>
    {open ? <p className="text-xs font-semibold text-amber-900">{open} line(s) are priced above the last purchase price without a reason. The PO cannot be issued until each has one.</p> : null}
    {data.lines.map(l => <div key={l.purchase_order_line_id} className="rounded-xl bg-slate-50 p-3 text-xs">
      <p className="font-semibold">Line {l.line_number}: {inr(l.unit_rate)} · {l.reference_rate !== null ? `${pctText(l.variance_percent)} vs ${inr(l.reference_rate)}` : "no earlier price"}{l.flagged ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-900">Above threshold</span> : null}</p>
      <HistoryLine h={l.history} />
      {l.reason ? <p className="mt-1">Reason: {l.reason} <span className="text-slate-500">({l.reason_by_name ?? "recorded"}, {fmtDay(l.reason_at)})</span></p>
        : l.flagged && canJustify && data.status === "draft" ? <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input aria-label={`Price reason for line ${l.line_number}`} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" maxLength={300} value={reasons[l.purchase_order_line_id] ?? ""}
            onChange={e => setReasons(r => ({ ...r, [l.purchase_order_line_id]: e.target.value }))} placeholder="Why is this price higher?" />
          <button type="button" className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold" onClick={async () => {
            const result = await purchasePriceAction("justify", { line_id: l.purchase_order_line_id, reason: (reasons[l.purchase_order_line_id] ?? "").trim() });
            setMessage(result.success ? { tone: "ok", text: "Reason recorded." } : { tone: "error", text: result.error });
            if (result.success) setKey(k => k + 1);
          }}>Record reason</button></div> : null}
    </div>)}
    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-xs font-semibold ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}
  </div>;
}
