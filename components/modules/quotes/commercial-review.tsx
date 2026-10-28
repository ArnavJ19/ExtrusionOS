"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { commercialReviewAction } from "@/lib/actions/commercial-review";
import { commercialReviewProblems, type CommercialReview } from "@/lib/workflow/commercial-review";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/format";

export function CommercialReviewPanel({ initial }: { initial: CommercialReview }) {
  const router = useRouter();
  const [review, setReview] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function refresh() {
    setBusy(true); setError("");
    try {
      const result = await commercialReviewAction({ command: "quote.review", quote_id: review.quote_id });
      if (!result.success) { setError(result.error); return; }
      if (result.kind === "review") { setReview(result.data); setConfirmed(false); setRequestId(crypto.randomUUID()); }
    } finally { setBusy(false); }
  }
  async function convert() {
    if (!confirmed || busy) return;
    setBusy(true); setError("");
    try {
      const result = await commercialReviewAction({ command: "quote.convert", quote_id: review.quote_id, fingerprint: review.fingerprint, request_id: requestId });
      if (!result.success) { setError(result.error); return; }
      if (result.kind === "conversion") router.push(`/orders/${result.data.order_id}`);
    } finally { setBusy(false); }
  }
  const problems = commercialReviewProblems(review);
  return <section className="space-y-4 rounded-2xl border bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Commercial review</h2><p className="text-sm text-slate-600">Revision {review.revision_number} · saved line amounts in INR · tax rounded per line</p></div><Button variant="secondary" disabled={busy} onClick={refresh}>Refresh review</Button></div>
    <div className="overflow-x-auto"><table className="industrial-table"><thead><tr><th>Line</th><th>Pieces / cut m</th><th>Theoretical / billing kg</th><th>Before GST</th><th>GST</th><th>Tax</th></tr></thead><tbody>{review.items.map((item, i) => <tr key={item.id}><td>{item.description || `Line ${i + 1}`}</td><td>{item.pieces} / {item.cut_length_m}</td><td>{item.physical_kg} / {item.billing_kg}</td><td>{formatCurrency(item.net)}</td><td>{item.gst_percent}%</td><td>{formatCurrency(item.tax)}</td></tr>)}</tbody></table></div>
    <p className="font-bold">Before GST {formatCurrency(review.subtotal)} + GST {formatCurrency(review.tax)} = {formatCurrency(review.grand_total)}</p>
    {review.profit !== undefined ? <p className="text-sm">Estimated cost {formatCurrency(review.cost ?? 0)} · estimated profit {formatCurrency(review.profit)} · margin on price {review.margin_percent ?? "Not available"}%</p> : null}
    <p className="text-sm text-slate-600">Invoice goods use the saved per-kg rate. Lines marked for separate charges retain die and freight charges for one-time billing. Theoretical weight and billing weight remain distinct. Factory requirements below the minimum enter the existing consolidation queue.</p>
    {problems.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul> : null}
    {review.existing_order_id ? <a className="font-bold underline" href={`/orders/${review.existing_order_id}`}>Open existing order</a> : review.can_convert ? <div className="space-y-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed this accepted revision, quantities, billing basis, tax and total.</label><Button disabled={!confirmed || busy || Math.abs(review.difference) > 0.01 || review.items.some(item => !item.costing_complete)} onClick={convert}>{busy ? "Confirming..." : "Create order from this revision"}</Button></div> : <p className="text-sm text-slate-600">Customer acceptance and permission to create orders are required for conversion.</p>}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </section>;
}
