"use client";

// AP-069: while quoting, booked against available press kg per week for the presses that can run the profile, and the
// earliest realistic week for this quantity after work already waiting for those presses. Indicative only: the delivery
// promise on the order still goes through the feasibility check.
import { useState } from "react";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, secondaryClass, useApRead } from "../order-to-cash/ui";

type Week = { week_start: string; available_kg: number; booked_kg: number; free_kg: number; working_days: number; load_percent: number | null };
export type CapacityView = { press_group: { basis: "profile" | "history" | "all"; machines: { id: string; name: string }[] }; configured: boolean; weeks: Week[]; unscheduled_kg: number;
  quantity_kg: number | null; earliest_week: string | null; finishing: string; finishing_lead_days: number | null; ready_by: string | null; beyond_horizon: boolean; note: string; profile_code?: string | null; profile_id?: string | null };
type Note = { tone: "ok" | "error"; text: string } | null;
const kg = (v: number | null | undefined) => v === null || v === undefined ? "—" : `${Math.round(Number(v)).toLocaleString("en-IN")} kg`;
const BASIS: Record<string, string> = { profile: "presses named on the profile", history: "presses that ran this profile in the last year", all: "all active extrusion presses" };

export function CapacityWeeks({ view }: { view: CapacityView }) {
  const max = Math.max(1, ...view.weeks.map(w => Math.max(w.available_kg, w.booked_kg)));
  return <div className="space-y-2">
    <p className="text-xs text-neutral-600">{view.press_group.machines.length ? view.press_group.machines.map(m => m.name).join(", ") : "No press"} ({BASIS[view.press_group.basis]})</p>
    <ul className="space-y-1" aria-label="Press load by week">{view.weeks.map(w => <li key={w.week_start} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-xs">
      <span className={w.week_start === view.earliest_week ? "font-black text-emerald-800" : "text-neutral-600"}>{fmtDay(w.week_start)}</span>
      <span className="relative h-3 overflow-hidden rounded bg-neutral-100" title={`${kg(w.booked_kg)} booked of ${kg(w.available_kg)}`}>
        <span className="absolute inset-y-0 left-0 bg-neutral-300" style={{ width: `${(w.available_kg / max) * 100}%` }} />
        <span className={`absolute inset-y-0 left-0 ${w.load_percent !== null && w.load_percent > 100 ? "bg-rose-500" : "bg-sky-700"}`} style={{ width: `${(Math.min(w.booked_kg, max) / max) * 100}%` }} /></span>
      <span className="tabular-nums">{kg(w.booked_kg)} / {kg(w.available_kg)}</span></li>)}</ul>
  </div>;
}

function Summary({ view }: { view: CapacityView }) {
  if (!view.configured) return <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Press shift capacity is not set up for these presses, so no week can be suggested. Set it in Production → Factory capacity.</p>;
  if (!view.quantity_kg) return <p className="text-sm text-neutral-600">Enter a quantity to see the earliest week.</p>;
  return <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-950">{view.earliest_week
    ? <>Earliest realistic press week for {kg(view.quantity_kg)}: week of {fmtDay(view.earliest_week)}{view.ready_by ? `, ready to dispatch around ${fmtDay(view.ready_by)} after ${view.finishing.replaceAll("_", " ")}` : view.finishing_lead_days === null ? ` (no ${view.finishing.replaceAll("_", " ")} lead time recorded)` : ""}.</>
    : view.beyond_horizon ? <>Not within the weeks shown: {kg(view.unscheduled_kg)} already waits for these presses.</> : "No week found."}
    {view.unscheduled_kg > 0 && view.earliest_week ? <span className="block text-xs font-normal">After {kg(view.unscheduled_kg)} of confirmed work not yet scheduled on these presses.</span> : null}</p>;
}

/** Quotation record: one block per profile on the quote; "Use this week" records the indication against the quote. */
export function QuoteCapacityPanel({ quoteId, canRecord }: { quoteId: string; canRecord: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ lines: CapacityView[]; last_check: { earliest_week: string | null; checked_at: string; used: boolean } | null }>("ap_capacity", "quote", { quote_id: quoteId }, [key]);
  return <Section id="capacity" title="Press capacity for this quotation" description="Booked against available kg per week on the presses that can run each profile. Indicative: the order's delivery promise is still checked for feasibility.">
    {data.loading && !data.data ? <Loading what="press capacity" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.last_check ? <p className="text-xs text-neutral-600">Last checked {fmtDay(data.data.last_check.checked_at.slice(0, 10))}{data.data.last_check.earliest_week ? `: week of ${fmtDay(data.data.last_check.earliest_week)}` : ""}{data.data.last_check.used ? " (used to promise)" : ""}</p> : null}
      {data.data.lines.length ? data.data.lines.map(view => <div key={view.profile_id ?? "none"} className="space-y-2 rounded-xl border border-neutral-200 p-3">
        <p className="text-sm font-bold">{view.profile_code ?? "Lines without a profile"}</p><Summary view={view} /><CapacityWeeks view={view} />
        {canRecord && view.earliest_week ? <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_capacity", "record", { quote_id: quoteId, ...(view.profile_id ? { profile_id: view.profile_id } : {}), used: true }, setMessage, "Recorded. The promised week is compared with actual completion when the order is made.")) setKey(k => k + 1); }}>Use this week to promise</button> : null}
      </div>) : <Empty>This quotation has no quantity yet.</Empty>}
      <Message value={message} />
    </> : null}
  </Section>;
}

/** Quotation entry: the same read for the profile and quantity being typed. */
export function ProfileCapacityHint({ profileId, quantityKg, finishingType }: { profileId: string | null; quantityKg: number | null; finishingType: string | null }) {
  // Debounced so typing a quantity does not query the press load on every keystroke.
  const kgNow = useDebounce(quantityKg, 600);
  const payload = { ...(profileId ? { profile_id: profileId } : {}), ...(kgNow && kgNow > 0 ? { quantity_kg: Math.min(10000000, Math.round(kgNow * 1000) / 1000) } : {}), ...(finishingType && /^[a-z_]{2,40}$/.test(finishingType) ? { finishing_type: finishingType } : {}) };
  const data = useApRead<CapacityView>("ap_capacity", "profile", payload, []);
  if (!profileId) return null;
  return <details className="rounded-xl border border-neutral-200 bg-white p-3 text-sm" open>
    <summary className="cursor-pointer font-bold">Press capacity</summary>
    <div className="mt-2 space-y-2">{data.loading && !data.data ? <Loading what="press capacity" /> : data.error ? <Failure text={data.error} /> : data.data ? <><Summary view={data.data} /><CapacityWeeks view={data.data} /></> : null}
      <p className="text-xs text-neutral-500">Indicative; the order&apos;s delivery promise is still checked for feasibility.</p></div>
  </details>;
}

type Accuracy = { rows: { quote_number: string; order_number: string; order_id: string; indicated_week: string | null; completed_week: string | null; weeks_late: number | null; used: boolean }[]; total_count: number;
  summary: { compared: number; on_time: number; late: number; median_weeks_late: number | null } };

/** How indicated weeks compared with when orders actually finished at the press. */
export function CapacityAccuracy() {
  const [page, setPage] = useState(1);
  const data = useApRead<Accuracy>("ap_capacity", "accuracy", { page }, []);
  return <Section title="Promised week against completion" description="For quotations that became orders: the week capacity indicated, and the week the order's last job finished.">
    {data.loading && !data.data ? <Loading what="comparison" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <p className="text-sm">{data.data.summary.compared} compared · {data.data.summary.on_time} on or before the week · {data.data.summary.late} later{data.data.summary.median_weeks_late !== null ? ` · median ${data.data.summary.median_weeks_late} week(s)` : ""}</p>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border text-sm">{data.data.rows.map(r => <li key={`${r.quote_number}:${r.order_number}`} className="flex flex-wrap justify-between gap-2 p-2"><span>{r.quote_number} → {r.order_number}</span>
        <span>{r.indicated_week ? fmtDay(r.indicated_week) : "—"} → {r.completed_week ? fmtDay(r.completed_week) : "not finished"}{r.weeks_late !== null ? ` (${r.weeks_late > 0 ? `+${r.weeks_late}` : r.weeks_late} wk)` : ""}</span></li>)}</ul> : <Empty>No quotation with a capacity check has become an order yet.</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}
