"use client";

// AP-076 / FS-73: thirteen weeks of expected cash in and out, from open invoices (an open collection promise dates the
// promised part; the rest is due date plus each customer's usual delay), approved unpaid bills, unbilled purchase orders,
// fixed expenses (salaries, power, loan instalments) and one-offs accounts adds (tax dates). A running balance appears only
// after accounts enters today's bank and cash balance; weeks closing below the minimum balance are flagged. Each week's
// first forecast is kept and compared with what happened.
import { useState } from "react";
import Link from "next/link";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Item = { kind: string; direction: "in" | "out"; expected_on: string; amount: number; label: string; basis: string; ref_id: string };
type Week = { week_start: string; week_end: string; cash_in: number; cash_out: number; net: number; receipts: number; promised: number; payables: number; purchase_orders: number; fixed: number; one_off_in: number; one_off_out: number; closing?: number; below_minimum?: boolean; items: Item[] };
type Forecast = { from: string; weeks: Week[]; opening_balance: number | null; balance_as_of: string | null; minimum_balance: number | null; first_week_below_minimum: string | null; basis: string };
const KIND: Record<string, string> = { receivable: "Invoice", scrap_sale: "Scrap sale", payable: "Bill", purchase_order: "Purchase order", fixed: "Fixed expense", one_off: "One-off" };
const href = (i: Item) => i.kind === "receivable" ? `/invoices/${i.ref_id}` : i.kind === "scrap_sale" ? `/foundry/scrap-sales/${i.ref_id}` : i.kind === "purchase_order" ? `/vendors/purchasing/${i.ref_id}` : null;

export function CashForecastClient() {
  const [key, setKey] = useState(0); const [open, setOpen] = useState<string | null>(null); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<Forecast>("ap_cash_forecast", "forecast", { weeks: 13 }, [key]);
  const [balance, setBalance] = useState(""); const [minimum, setMinimum] = useState("");
  const f = data.data;
  return <div className="space-y-5">
    <Section title="Next thirteen weeks" description={f?.basis ?? "Expected receipts and payments by week."}>
      {data.loading && !f ? <Loading what="the forecast" /> : data.error ? <Failure text={data.error} /> : f ? <>
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3 text-sm">
          <p className="min-w-0 flex-1">{f.opening_balance !== null ? <>Bank and cash balance <b>{inr(f.opening_balance)}</b> as of {fmtDay(f.balance_as_of)}.</> : "Enter today's bank and cash balance to see the running balance."}</p>
          <label className="text-xs font-bold">Balance ₹<input className={inputClass} inputMode="decimal" value={balance} onChange={e => setBalance(e.target.value)} /></label>
          <button type="button" className={secondaryClass} disabled={!balance.trim()} onClick={async () => { if (await apWrite("ap_cash_forecast", "save_opening", { opening_balance: Number(balance) }, setMessage, "Balance saved.")) { setBalance(""); setKey(k => k + 1); } }}>Save balance</button>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-neutral-50 p-3 text-sm">
          <p className="min-w-0 flex-1">{f.minimum_balance !== null ? <>Minimum balance <b>{inr(f.minimum_balance)}</b>{f.first_week_below_minimum ? <> · <span className="font-bold text-rose-700">first falls below in the week of {fmtDay(f.first_week_below_minimum)}</span></> : " · no week falls below it"}.</> : "Set a minimum balance to flag the weeks that fall below it."}</p>
          <label className="text-xs font-bold">Minimum ₹<input className={inputClass} inputMode="decimal" value={minimum} onChange={e => setMinimum(e.target.value)} /></label>
          <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_cash_forecast", "save_minimum", minimum.trim() ? { minimum_balance: Number(minimum) } : {}, setMessage, minimum.trim() ? "Minimum balance saved." : "Minimum balance cleared.")) { setMinimum(""); setKey(k => k + 1); } }}>{minimum.trim() ? "Save minimum" : "Clear minimum"}</button>
        </div>
        <Message value={message} />
        <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[720px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Week</th><th className="p-2 text-right">In</th><th className="p-2 text-right">of which promised</th><th className="p-2 text-right">Out</th><th className="p-2 text-right">Net</th><th className="p-2 text-right">Closing</th><th className="p-2" /></tr></thead>
          <tbody>{f.weeks.map((w, k) => <tr key={w.week_start} className={`border-t ${w.below_minimum ? "bg-rose-50" : ""}`}>
            <td className="p-2 font-semibold">{k === 0 ? "This week" : fmtDay(w.week_start)}{w.below_minimum ? <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">Below minimum</span> : null}</td>
            <td className="p-2 text-right tabular-nums">{inr(w.cash_in)}</td><td className="p-2 text-right tabular-nums text-neutral-600">{Number(w.promised) ? inr(w.promised) : "—"}</td>
            <td className="p-2 text-right tabular-nums">{inr(w.cash_out)}</td>
            <td className={`p-2 text-right font-bold tabular-nums ${Number(w.net) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{Number(w.net) >= 0 ? `+${inr(w.net)}` : `−${inr(Math.abs(Number(w.net)))}`}</td>
            <td className={`p-2 text-right tabular-nums ${Number(w.closing) < 0 || w.below_minimum ? "font-bold text-rose-700" : ""}`}>{w.closing !== undefined ? inr(w.closing) : "—"}</td>
            <td className="p-2 text-right"><button type="button" className="text-sm font-bold underline" onClick={() => setOpen(open === w.week_start ? null : w.week_start)}>{open === w.week_start ? "Hide" : `Show ${w.items.length} item(s)`}</button></td>
          </tr>)}</tbody>
        </table></div>
        {open ? (() => { const w = f.weeks.find(x => x.week_start === open); return w ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[640px] text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Date</th><th className="p-2">What</th><th className="p-2">Basis</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Out</th></tr></thead>
          <tbody>{w.items.map((i, k) => <tr key={k} className="border-t"><td className="p-2">{fmtDay(i.expected_on)}</td>
            <td className="p-2"><span className="text-xs text-neutral-500">{KIND[i.kind] ?? i.kind}</span> {href(i) ? <Link className="underline" href={href(i)!}>{i.label}</Link> : i.label}</td>
            <td className="p-2 text-xs text-neutral-600">{i.basis}</td><td className="p-2 text-right tabular-nums">{i.direction === "in" ? inr(i.amount) : ""}</td><td className="p-2 text-right tabular-nums">{i.direction === "out" ? inr(i.amount) : ""}</td></tr>)}</tbody>
        </table></div> : null; })() : null}
      </> : null}
    </Section>
    <FixedAndOneOffs onChange={() => setKey(k => k + 1)} />
    <ForecastAccuracy />
  </div>;
}

function FixedAndOneOffs({ onChange }: { onChange: () => void }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ rows: { id: string; label: string; amount: number; frequency: string; day_of_month: number | null; weekday: number | null }[]; one_offs: { id: string; on_date: string; direction: string; amount: number; label: string }[] }>("ap_cash_forecast", "fixed", {}, [key]);
  const [label, setLabel] = useState(""); const [amount, setAmount] = useState(""); const [freq, setFreq] = useState("monthly"); const [dom, setDom] = useState("1"); const [wd, setWd] = useState("6");
  const [oDate, setODate] = useState(""); const [oDir, setODir] = useState("out"); const [oAmt, setOAmt] = useState(""); const [oLabel, setOLabel] = useState("");
  const done = (text: string) => { setMessage({ tone: "ok", text }); setKey(k => k + 1); onChange(); };
  const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return <Section id="fixed" title="Fixed expenses and one-offs" description="Salaries, rent, power and loan instalments repeat; one-offs are known receipts or payments on a date.">
    <Message value={message} />
    {data.loading && !data.data ? <Loading what="fixed expenses" /> : data.error ? <Failure text={data.error} /> : data.data ? <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">{data.data.rows.length ? <ul className="divide-y rounded-xl border text-sm">{data.data.rows.map(r => <li key={r.id} className="flex items-center justify-between gap-2 p-2">
        <span>{r.label} · {inr(r.amount)} · {r.frequency === "monthly" ? `every month on day ${r.day_of_month}` : `every ${days[r.weekday ?? 1]}`}</span>
        <button type="button" className="text-xs font-bold underline" onClick={async () => { if (await apWrite("ap_cash_forecast", "retire_fixed", { id: r.id }, setMessage)) done("Removed."); }}>Remove</button></li>)}</ul> : <Empty>No fixed expense yet.</Empty>}
        <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-bold">Expense<input className={inputClass} value={label} onChange={e => setLabel(e.target.value)} placeholder="Salaries" /></label>
          <label className="text-xs font-bold">₹<input className={inputClass} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <select aria-label="Frequency" className={`${inputClass} w-auto`} value={freq} onChange={e => setFreq(e.target.value)}><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select>
          {freq === "monthly" ? <label className="text-xs font-bold">Day<input className={`${inputClass} w-20`} inputMode="numeric" value={dom} onChange={e => setDom(e.target.value)} /></label>
            : <select aria-label="Weekday" className={`${inputClass} w-auto`} value={wd} onChange={e => setWd(e.target.value)}>{days.slice(1).map((d, k) => <option key={d} value={k + 1}>{d}</option>)}</select>}
          <button type="button" className={buttonClass} disabled={label.trim().length < 3 || !amount} onClick={async () => {
            if (await apWrite("ap_cash_forecast", "save_fixed", { label: label.trim(), amount: Number(amount), frequency: freq, ...(freq === "monthly" ? { day_of_month: Number(dom) } : { weekday: Number(wd) }) }, setMessage)) { setLabel(""); setAmount(""); done("Fixed expense added."); }
          }}>Add</button></div></div>
      <div className="space-y-2">{data.data.one_offs.length ? <ul className="divide-y rounded-xl border text-sm">{data.data.one_offs.map(o => <li key={o.id} className="flex items-center justify-between gap-2 p-2">
        <span>{fmtDay(o.on_date)} · {o.direction === "in" ? "in" : "out"} {inr(o.amount)} · {o.label}</span>
        <button type="button" className="text-xs font-bold underline" onClick={async () => { if (await apWrite("ap_cash_forecast", "remove_one_off", { id: o.id }, setMessage)) done("Removed."); }}>Remove</button></li>)}</ul> : <Empty>No one-off entered.</Empty>}
        <div className="flex flex-wrap items-end gap-2"><label className="text-xs font-bold">Date<input type="date" className={inputClass} value={oDate} onChange={e => setODate(e.target.value)} /></label>
          <select aria-label="Direction" className={`${inputClass} w-auto`} value={oDir} onChange={e => setODir(e.target.value)}><option value="out">Money out</option><option value="in">Money in</option></select>
          <label className="text-xs font-bold">₹<input className={inputClass} inputMode="decimal" value={oAmt} onChange={e => setOAmt(e.target.value)} /></label>
          <label className="min-w-0 flex-1 text-xs font-bold">Description<input className={inputClass} value={oLabel} onChange={e => setOLabel(e.target.value)} placeholder="Advance tax instalment" /></label>
          <button type="button" className={buttonClass} disabled={!oDate || !oAmt || oLabel.trim().length < 3} onClick={async () => {
            if (await apWrite("ap_cash_forecast", "save_one_off", { on_date: oDate, direction: oDir, amount: Number(oAmt), label: oLabel.trim() }, setMessage)) { setOAmt(""); setOLabel(""); done("One-off added."); }
          }}>Add</button></div></div>
    </div> : null}
  </Section>;
}

function ForecastAccuracy() {
  const [page, setPage] = useState(1);
  const data = useApRead<{ rows: { week_start: string; expected_in: number; expected_out: number; actual_in: number; actual_out: number }[]; total_count: number }>("ap_cash_forecast", "accuracy", { page }, []);
  return <Section id="accuracy" title="Forecast against actual" description="The first forecast of each week, compared with receipts and payments recorded that week.">
    {data.loading && !data.data ? <Loading what="past weeks" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.rows.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[560px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Week of</th><th className="p-2 text-right">Expected in</th><th className="p-2 text-right">Actual in</th><th className="p-2 text-right">Expected out</th><th className="p-2 text-right">Actual out</th></tr></thead>
        <tbody>{data.data.rows.map(r => <tr key={r.week_start} className="border-t"><td className="p-2">{fmtDay(r.week_start)}</td><td className="p-2 text-right tabular-nums">{inr(r.expected_in)}</td>
          <td className="p-2 text-right tabular-nums">{inr(r.actual_in)}</td><td className="p-2 text-right tabular-nums">{inr(r.expected_out)}</td><td className="p-2 text-right tabular-nums">{inr(r.actual_out)}</td></tr>)}</tbody>
      </table></div> : <Empty>The first comparison appears after a full week has passed.</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}
