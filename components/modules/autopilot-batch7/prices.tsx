"use client";

// AP-057: purchase lines priced above the last price, and the variance threshold. The inline line check and the
// per-order panel live in components/modules/vendors/purchase-price-check (shown on the purchase order itself).
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";
import { pctText } from "@/components/modules/vendors/purchase-price-check";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, useApRead } from "../order-to-cash/ui";

type Flagged = { line_id: string; purchase_order_id: string; po_number: string; vendor: string; status: string; order_date: string; line_number: number; description: string; unit: string;
  unit_rate: number; reference_rate: number; variance_percent: number; threshold_percent: number; reason: string | null };

export function PricesClient({ canSetThreshold }: { canSetThreshold: boolean }) {
  const [show, setShow] = useState<"all" | "missing">("all"); const [page, setPage] = useState(1); const [key, setKey] = useState(0);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const list = useApRead<{ rows: Flagged[]; total_count: number; issued_without_reason: number }>("ap_price", "flagged", { page, show }, [key]);
  const settings = useApRead<{ variance_percent: number; saved: boolean }>("ap_price", "settings", {}, [key]);
  const [threshold, setThreshold] = useState("");
  useEffect(() => { if (settings.data) setThreshold(String(settings.data.variance_percent)); }, [settings.data]);
  return <div className="space-y-4">
    <Section title="Purchase lines priced above the last price" description="Each purchase order line is compared with the most recent issued purchase order for the same description and unit."
      actions={<select aria-label="Show" className={`${inputClass} w-48`} value={show} onChange={e => { setShow(e.target.value as typeof show); setPage(1); }}><option value="all">All flagged lines</option><option value="missing">Without a reason</option></select>}>
      {list.data && list.data.issued_without_reason > 0 ? <p className="text-sm font-semibold text-rose-800">{list.data.issued_without_reason} issued line(s) have no reason (issued before this check existed).</p> : null}
      {list.loading && !list.data ? <Loading what="flagged lines" /> : list.error ? <Failure text={list.error} /> : !list.data?.rows.length ? <Empty>No line is priced above the threshold.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="text-left text-neutral-500"><th className="py-1">PO</th><th>Supplier</th><th>Line</th><th className="text-right">Rate</th><th className="text-right">Last</th><th className="text-right">Variance</th><th>Reason</th></tr></thead>
          <tbody>{list.data.rows.map(r => <tr key={r.line_id} className="border-t border-neutral-100 align-top"><td className="py-2"><Link className="font-semibold underline" href={`/vendors/purchasing?order_id=${encodeURIComponent(r.purchase_order_id)}`}>{r.po_number}</Link><span className="block text-xs text-neutral-500">{r.status} · {fmtDay(r.order_date)}</span></td>
            <td>{r.vendor}</td><td>{r.line_number}. {r.description} ({r.unit})</td><td className="text-right">{inr(r.unit_rate)}</td><td className="text-right">{inr(r.reference_rate)}</td><td className="text-right font-semibold text-amber-900">{pctText(r.variance_percent)}</td>
            <td>{r.reason ?? <span className="font-semibold text-rose-800">Missing</span>}</td></tr>)}</tbody></table></div>}
      {list.data ? <Pager page={page} total={list.data.total_count} onPage={setPage} /> : null}
    </Section>
    <Section title="Variance threshold" description="A line priced more than this above the last purchase price needs a reason. Existing checks keep the threshold they were made with.">
      {settings.data ? <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="text-sm font-semibold">Threshold %<input aria-label="Variance threshold percent" inputMode="decimal" className={`${inputClass} mt-1 w-40`} disabled={!canSetThreshold} value={threshold} onChange={e => setThreshold(e.target.value)} /></label>
        {canSetThreshold ? <button type="button" className={buttonClass} onClick={async () => { const ok = await apWrite("ap_price", "save_settings", { variance_percent: Number(threshold) }, setMessage, "Threshold saved."); if (ok) setKey(k => k + 1); }}>Save threshold</button> : <p className="text-xs text-neutral-500">Only the owner or an admin changes the threshold.</p>}
        {!settings.data.saved ? <p className="text-xs text-neutral-500">Using the default of 5% until a threshold is saved.</p> : null}
      </div> : settings.error ? <Failure text={settings.error} /> : <Loading what="the threshold" />}
      <Message value={message} />
    </Section>
  </div>;
}
