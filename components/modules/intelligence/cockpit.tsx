"use client";

// FS-38: one mobile-first owner screen. Yesterday's figures are the stored morning digest, so this screen and the
// message always agree; every number taps through to the list behind it. The WhatsApp brief opens in WhatsApp for the
// owner to send — no provider is connected, so nothing is sent automatically.
import { useState } from "react";
import Link from "next/link";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";
import { kgText, pct, tonnes, whatsappShareUrl } from "@/lib/intelligence/format";
import { Failure, Loading, Message, Section, secondaryClass, useFsRead, type Note } from "./shared";

type Cockpit = { as_of: string; digest_generated_at: string; digest_date: string;
  yesterday: { production_kg: number | null; recovery_percent: number | null; recovery_missing_jobs: number; dispatch_kg: number; invoiced: number; collections: number; overdue: number; credit_holds: number; red_lines: number; idle_presses: number; owner_approvals: number };
  order_book: { open_kg: number; presses: { machine_id: string | null; press: string; days_of_load: number | null }[] };
  billet: { free_kg: number; daily_use_kg: number | null; days: number | null }; otif: { percent: number | null; due: number; otif: number };
  metal: { net_kg: number; direction: string; over_limit: boolean; limit_kg: number | null };
  cash: { first_week_below_minimum: string | null; lowest_week: string | null; lowest_closing: number | null; opening_balance: number | null };
  exceptions: { key: string; label: string; count: number; kg?: number; href: string }[]; message: string };
type Trend = { weeks: Record<string, { days: number; production_kg: number; dispatch_kg: number; invoiced: number; collections: number }> | null;
  months: Record<string, { days: number; production_kg: number; dispatch_kg: number; invoiced: number; collections: number }> | null; basis: string };

function Tile({ href, label, value, hint, bad }: { href: string; label: string; value: string; hint?: string; bad?: boolean }) {
  return <Link href={href} className="block min-w-0 rounded-2xl border border-neutral-200 bg-white p-3 hover:border-orange/60">
    <p className="text-xs font-bold uppercase text-neutral-500">{label}</p><p className={`mt-1 text-xl font-black tabular-nums ${bad ? "text-rose-700" : ""}`}>{value}</p>
    {hint ? <p className="mt-0.5 text-xs text-neutral-600">{hint}</p> : null}</Link>;
}

export function CockpitClient() {
  const d = useFsRead<Cockpit>("fs_cockpit", "today", {}, []);
  const [message, setMessage] = useState<Note>(null);
  const v = d.data;
  if (d.loading && !v) return <Loading what="the owner cockpit" />;
  if (d.error) return <Failure text={d.error} />;
  if (!v) return null;
  const y = v.yesterday;
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2">
      <a className={secondaryClass + " inline-flex items-center"} href={whatsappShareUrl(v.message)} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
      <button type="button" className={secondaryClass} onClick={async () => { try { await navigator.clipboard.writeText(v.message); setMessage({ tone: "ok", text: "Brief copied." }); } catch { setMessage({ tone: "error", text: "Copy is not available in this browser; select the text below." }); } }}>Copy brief</button>
    </div>
    <Message value={message} />
    <Section title="Yesterday" description={`From the morning digest of ${fmtDay(v.digest_date)}, generated ${new Date(v.digest_generated_at).toLocaleString("en-IN")}.`}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile href="/production" label="Production" value={y.production_kg === null ? "—" : tonnes(y.production_kg)} hint={y.recovery_percent === null ? `Recovery unknown (${y.recovery_missing_jobs} job(s) without billet input)` : `Recovery ${pct(y.recovery_percent)}`} />
        <Tile href="/dispatches" label="Dispatched" value={tonnes(y.dispatch_kg)} hint={`Invoiced ${inr(y.invoiced)}`} />
        <Tile href="/payments" label="Cash received" value={inr(y.collections)} />
        <Tile href="/payments/reminders" label="Overdue" value={inr(y.overdue)} bad={Number(y.overdue) > 0} />
      </div>
    </Section>
    <Section title="Now" description={`Live as of ${new Date(v.as_of).toLocaleTimeString("en-IN")}.`}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile href="/insights/order-book" label="Order book" value={tonnes(v.order_book.open_kg)} hint={v.order_book.presses.filter(p => p.days_of_load !== null).map(p => `${p.press} ${p.days_of_load} d`).join(" · ") || "Press capacity not set"} />
        <Tile href="/production/material-plan" label="Billet stock" value={v.billet.days === null ? kgText(v.billet.free_kg) : `${v.billet.days} days`} hint={v.billet.daily_use_kg ? `${kgText(v.billet.free_kg)} at ${kgText(v.billet.daily_use_kg)}/day` : "No completed jobs with billet input in 30 days"} bad={v.billet.days !== null && v.billet.days < 3} />
        <Tile href="/insights/otif" label="OTIF, 30 days" value={pct(v.otif.percent)} hint={`${v.otif.otif} of ${v.otif.due} lines`} bad={v.otif.percent !== null && v.otif.percent < 80} />
        <Tile href="/insights/metal-exposure" label="Metal position" value={`${tonnes(Math.abs(Number(v.metal.net_kg)))} ${v.metal.direction === "flat" ? "" : v.metal.direction}`} hint={v.metal.limit_kg ? `Limit ${tonnes(v.metal.limit_kg)}` : "No limit set"} bad={v.metal.over_limit} />
        <Tile href="/payments/cash-forecast" label="Cash, 13 weeks" value={v.cash.lowest_closing === null ? "Enter bank balance" : inr(v.cash.lowest_closing)} hint={v.cash.first_week_below_minimum ? `Below minimum from ${fmtDay(v.cash.first_week_below_minimum)}` : v.cash.lowest_week ? `Lowest week ${fmtDay(v.cash.lowest_week)}` : undefined} bad={!!v.cash.first_week_below_minimum} />
      </div>
    </Section>
    <Section title="Exceptions">
      <ul className="divide-y rounded-xl border">{v.exceptions.map(e => <li key={e.key}><Link href={e.href} className="flex items-center justify-between gap-2 p-3 text-sm hover:bg-neutral-50">
        <span>{e.label}</span><span className={`font-black tabular-nums ${e.count > 0 ? "text-rose-700" : "text-neutral-500"}`}>{e.count}{e.kg ? ` · ${kgText(e.kg)}` : ""}</span></Link></li>)}</ul>
    </Section>
    <Trends />
    <Section title="The brief as sent"><pre className="whitespace-pre-wrap rounded-xl bg-neutral-50 p-3 text-xs">{v.message}</pre></Section>
  </div>;
}

function Trends() {
  const d = useFsRead<Trend>("fs_cockpit", "trend", {}, []);
  const row = (label: string, a?: { days: number; production_kg: number; dispatch_kg: number; invoiced: number; collections: number }) => <tr className="border-t"><td className="p-2">{label}{a ? <span className="text-xs text-neutral-500"> ({a.days} day(s))</span> : null}</td>
    <td className="p-2 text-right tabular-nums">{a ? tonnes(a.production_kg) : "—"}</td><td className="p-2 text-right tabular-nums">{a ? tonnes(a.dispatch_kg) : "—"}</td><td className="p-2 text-right tabular-nums">{a ? inr(a.invoiced) : "—"}</td><td className="p-2 text-right tabular-nums">{a ? inr(a.collections) : "—"}</td></tr>;
  return <Section title="Weekly and monthly" description={d.data?.basis}>
    {d.loading && !d.data ? <Loading what="trends" /> : d.error ? <Failure text={d.error} /> : d.data ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[560px] text-sm">
      <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Period</th><th className="p-2 text-right">Production</th><th className="p-2 text-right">Dispatch</th><th className="p-2 text-right">Invoiced</th><th className="p-2 text-right">Collected</th></tr></thead>
      <tbody>{row("This week", d.data.weeks?.this_week)}{row("Last week", d.data.weeks?.last_week)}{row("This month", d.data.months?.this_month)}{row("Last month", d.data.months?.last_month)}</tbody>
    </table></div> : null}
  </Section>;
}
