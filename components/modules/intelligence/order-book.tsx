"use client";

// FS-71: weighted pipeline, order book in tonnes and weeks of load, customer concentration, dropping customers and a
// simple seasonal projection. Every method is shown beside its number; nothing is a black box.
import { useState } from "react";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";
import { kgText, pct, tonnes } from "@/lib/intelligence/format";
import { Empty, Failure, Loading, Message, Section, Stat, buttonClass, fsWrite, inputClass, numberOrUndefined, useFsRead, type Note } from "./shared";

type Stage = { stage: string; quotes: number; value: number; kg: number; probability_percent: number | null; probability_source: string; weighted_value: number | null; weighted_kg: number | null };
type Book = { pipeline: { stages: Stage[]; win_rates: Record<string, { decided: number; won: number; percent: number | null }> };
  order_book: { open_kg: number; to_make_kg: number; lines: number; by_alloy: { key: string; open_kg: number }[]; by_finish: { key: string; label: string; open_kg: number }[] };
  presses: { machine_id: string | null; press: string; open_job_kg: number; weekly_capacity_kg: number | null; weeks_of_load: number | null; days_of_load: number | null }[];
  concentration: { total_value: number; customers: number; top5_share_percent: number | null; top5: { customer_id: string; name: string; value: number; share_percent: number }[] };
  dropping: { customer_id: string; name: string; recent_90_kg: number; average_90_kg: number; change_percent: number }[]; drop_threshold_percent: number;
  projection: { months: { month: string; projected_kg: number }[]; customers: { customer_id: string; name: string; projected_kg: number }[] };
  settings: { reason: string; updated_at: string; updated_by: string } | null; basis: Record<string, string> };

export function OrderBookClient({ canSet }: { canSet: boolean }) {
  const [key, setKey] = useState(0);
  const d = useFsRead<Book>("fs_order_book", "overview", {}, [key]);
  const v = d.data;
  if (d.loading && !v) return <Loading what="the order book" />;
  if (d.error) return <Failure text={d.error} />;
  if (!v) return null;
  const weighted = v.pipeline.stages.reduce((s, x) => s + Number(x.weighted_kg ?? 0), 0);
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Order book" value={tonnes(v.order_book.open_kg)} hint={`${v.order_book.lines} open line(s) to dispatch`} />
      <Stat label="Still to make" value={tonnes(v.order_book.to_make_kg)} hint="Ordered − produced − from stock" />
      <Stat label="Weighted pipeline" value={v.pipeline.stages.some(s => s.probability_percent === null) ? "Partly unknown" : tonnes(weighted)} hint="Open quotes × win rate" />
      <Stat label="Top five customers" value={pct(v.concentration.top5_share_percent)} hint="Share of 12 months' invoicing" tone={(v.concentration.top5_share_percent ?? 0) > 60 ? "bad" : undefined} />
    </div>
    <Section title="Load by press" description={v.basis.presses}>
      {v.presses.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[520px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Press</th><th className="p-2 text-right">Open job kg</th><th className="p-2 text-right">Weekly capacity</th><th className="p-2 text-right">Weeks of load</th></tr></thead>
        <tbody>{v.presses.map(p => <tr key={p.machine_id ?? "none"} className="border-t"><td className="p-2">{p.press}</td><td className="p-2 text-right tabular-nums">{kgText(p.open_job_kg)}</td>
          <td className="p-2 text-right tabular-nums">{p.weekly_capacity_kg ? kgText(p.weekly_capacity_kg) : "Not set"}</td><td className="p-2 text-right font-bold tabular-nums">{p.weeks_of_load ?? "—"}</td></tr>)}</tbody>
      </table></div> : <Empty>No open production jobs.</Empty>}
    </Section>
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="By alloy" description={v.basis.order_book}><Bars rows={v.order_book.by_alloy.map(r => ({ label: r.key, kg: r.open_kg }))} /></Section>
      <Section title="By finish"><Bars rows={v.order_book.by_finish.map(r => ({ label: r.label, kg: r.open_kg }))} /></Section>
    </div>
    <Section title="Weighted pipeline" description={v.basis.pipeline}>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[620px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Stage</th><th className="p-2 text-right">Quotes</th><th className="p-2 text-right">Value</th><th className="p-2 text-right">kg</th><th className="p-2 text-right">Win rate</th><th className="p-2 text-right">Weighted kg</th></tr></thead>
        <tbody>{v.pipeline.stages.map(s => { const rate = v.pipeline.win_rates[s.stage]; return <tr key={s.stage} className="border-t"><td className="p-2">{s.stage === "sent" ? "Sent to customer" : "Not yet sent"}</td>
          <td className="p-2 text-right tabular-nums">{s.quotes}</td><td className="p-2 text-right tabular-nums">{inr(s.value)}</td><td className="p-2 text-right tabular-nums">{kgText(s.kg)}</td>
          <td className="p-2 text-right">{s.probability_percent === null ? <span className="text-xs text-amber-800">Not enough history ({rate?.decided ?? 0} decided)</span> : <>{pct(s.probability_percent)} <span className="text-xs text-neutral-500">{s.probability_source === "set" ? "set" : `${rate?.won}/${rate?.decided}`}</span></>}</td>
          <td className="p-2 text-right font-bold tabular-nums">{s.weighted_kg === null ? "—" : kgText(s.weighted_kg)}</td></tr>; })}</tbody>
      </table></div>
    </Section>
    <div className="grid gap-5 lg:grid-cols-2">
      <Section title="Customer concentration" description={v.basis.concentration}>
        {v.concentration.top5.length ? <ol className="space-y-1 text-sm">{v.concentration.top5.map(c => <li key={c.customer_id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{c.name}</span><span className="tabular-nums">{inr(c.value)} · {pct(c.share_percent)}</span></li>)}</ol> : <Empty>No invoices in the last twelve months.</Empty>}
      </Section>
      <Section title="Customers ordering less" description={`${v.basis.dropping} Threshold ${v.drop_threshold_percent}%.`}>
        {v.dropping.length ? <ul className="space-y-1 text-sm">{v.dropping.map(c => <li key={c.customer_id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{c.name}</span>
          <span className="tabular-nums text-rose-700">{kgText(c.recent_90_kg)} vs {kgText(c.average_90_kg)} ({pct(c.change_percent)})</span></li>)}</ul> : <Empty>No customer has dropped below the threshold.</Empty>}
      </Section>
    </div>
    <Section title="Next three months (projection)" description={v.basis.projection}>
      <div className="grid gap-3 sm:grid-cols-3">{v.projection.months.map(m => <Stat key={m.month} label={fmtDay(m.month).replace(/^\d+ /, "")} value={tonnes(m.projected_kg)} />)}</div>
      {v.projection.customers.length ? <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{v.projection.customers.map(c => <li key={c.customer_id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{c.name}</span><span className="tabular-nums">{kgText(c.projected_kg)}</span></li>)}</ul>
        : <Empty>No orders in the same months last year to project from.</Empty>}
    </Section>
    {canSet ? <Settings current={v.settings} onSaved={() => setKey(k => k + 1)} /> : null}
  </div>;
}

function Bars({ rows }: { rows: { label: string; kg: number }[] }) {
  const max = Math.max(1, ...rows.map(r => Number(r.kg)));
  if (!rows.length) return <Empty>No open order lines.</Empty>;
  return <ul className="space-y-2 text-sm">{rows.map(r => <li key={r.label}>
    <div className="flex justify-between gap-2"><span>{r.label}</span><span className="tabular-nums">{tonnes(r.kg)}</span></div>
    <div className="h-2 rounded-full bg-neutral-100" aria-hidden><div className="h-2 rounded-full bg-neutral-800" style={{ width: `${Math.max(2, Number(r.kg) / max * 100)}%` }} /></div>
  </li>)}</ul>;
}

function Settings({ current, onSaved }: { current: Book["settings"]; onSaved: () => void }) {
  const [message, setMessage] = useState<Note>(null); const [unsent, setUnsent] = useState(""); const [sent, setSent] = useState(""); const [drop, setDrop] = useState(""); const [reason, setReason] = useState("");
  return <Section id="settings" title="Probabilities and threshold" description="Leave a probability blank to use the measured win rate. A set value is recorded with your name and reason.">
    <Message value={message} />
    {current ? <p className="text-sm">Last set by {current.updated_by} on {new Date(current.updated_at).toLocaleDateString("en-IN")} (“{current.reason}”).</p> : null}
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold">Unsent %<input className={`${inputClass} w-24`} inputMode="decimal" value={unsent} onChange={e => setUnsent(e.target.value)} /></label>
      <label className="text-xs font-bold">Sent %<input className={`${inputClass} w-24`} inputMode="decimal" value={sent} onChange={e => setSent(e.target.value)} /></label>
      <label className="text-xs font-bold">Drop threshold %<input className={`${inputClass} w-24`} inputMode="decimal" value={drop} onChange={e => setDrop(e.target.value)} /></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Reason<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button type="button" className={buttonClass} disabled={reason.trim().length < 5} onClick={async () => {
        if (await fsWrite("fs_order_book", "save_settings", { probability_unsent_percent: numberOrUndefined(unsent), probability_sent_percent: numberOrUndefined(sent), drop_threshold_percent: numberOrUndefined(drop), reason: reason.trim() }, setMessage, "Saved.")) { setReason(""); onSaved(); }
      }}>Save</button></div>
  </Section>;
}
