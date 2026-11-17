"use client";

// FS-26 stage: the earliest realistic dispatch date for a profile and quantity, and the work now at risk on a press that
// has broken down. Both reuse the AP-069 capacity and AP-065 die availability read models; both are advisory.
import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { kgText, slackText } from "@/lib/intelligence/format";
import { Empty, Failure, Loading, Message, Pill, Section, buttonClass, inputClass, useFsRead, type Note } from "./shared";
import { intelligenceAction } from "@/lib/actions/intelligence";

type Option = { id: string; label: string };
type Estimate = { earliest_dispatch: string | null; production_by: string | null; die_ready: string | null; usable_dies: number; free_billet_kg: number;
  constraints: { kind: string; blocking: boolean; text: string }[]; capacity: { weeks: { week_start: string; free_kg: number; load_percent: number | null }[]; unscheduled_kg: number; press_group: { machines: { id: string; name: string }[] } }; basis: string };
type Reflow = { breakdowns: { breakdown_id: string; press: string; since: string; days_down: number; issue: string | null; status: string;
  work: { job_id: string; job_number: string | null; order_id: string; order_number: string; planned_end: string; promise: string | null; slack_days: number | null; at_risk: boolean }[] }[]; basis: string };
const FINISHES: Record<string, string> = { mill_finish: "Mill finish", powder_coating: "Powder coated", anodizing: "Anodised", wood_finish: "Wood finish" };

export function PromiseClient({ profiles }: { profiles: Option[] }) {
  const [filter, setFilter] = useState(""); const [profile, setProfile] = useState(""); const [kg, setKg] = useState(""); const [finish, setFinish] = useState("mill_finish");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null); const [result, setResult] = useState<Estimate | null>(null);
  const shown = useMemo(() => profiles.filter(p => p.label.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 200), [profiles, filter]);
  return <div className="space-y-5">
    <Section title="Promise-date calculator" description="Earliest realistic dispatch for a profile and quantity, from free press capacity, die availability, finishing and packing.">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-bold">Find profile<input className={inputClass} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Code or name" /></label>
        <label className="min-w-0 flex-1 text-xs font-bold">Profile<select className={inputClass} value={profile} onChange={e => setProfile(e.target.value)}><option value="">Choose…</option>{shown.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label className="text-xs font-bold">Quantity kg<input className={`${inputClass} w-32`} inputMode="decimal" value={kg} onChange={e => setKg(e.target.value)} /></label>
        <label className="text-xs font-bold">Finish<select className={inputClass} value={finish} onChange={e => setFinish(e.target.value)}>{Object.entries(FINISHES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button type="button" className={buttonClass} disabled={!profile || !kg || busy} onClick={async () => {
          setBusy(true); setMessage(null);
          const r = await intelligenceAction("fs_promise", "estimate", { profile_id: profile, quantity_kg: Number(kg), finishing_type: finish });
          setBusy(false);
          if (!r.success) { setMessage({ tone: "error", text: r.error }); setResult(null); } else setResult(r.data as Estimate);
        }}>{busy ? "Calculating…" : "Calculate"}</button>
      </div>
      <Message value={message} />
      {result ? <div className="space-y-2 rounded-xl bg-neutral-50 p-3 text-sm">
        <p className="text-lg font-black">{result.earliest_dispatch ? `Earliest dispatch ${fmtDay(result.earliest_dispatch)}` : "No date can be promised yet"}</p>
        <p className="text-xs text-neutral-600">Production by {result.production_by ? fmtDay(result.production_by) : "—"} · die ready {result.die_ready ? fmtDay(result.die_ready) : "—"} ({result.usable_dies} usable die(s)) · free billet {kgText(result.free_billet_kg)} · {kgText(result.capacity.unscheduled_kg)} of unscheduled work ahead</p>
        {result.constraints.length ? <ul className="space-y-1">{result.constraints.map((c, k) => <li key={k} className={c.blocking ? "font-bold text-rose-700" : "text-amber-800"}>{c.blocking ? "Blocks the date: " : "Note: "}{c.text}</li>)}</ul> : null}
        <p className="text-xs text-neutral-500">{result.basis}</p>
      </div> : null}
    </Section>
    <Reflow />
  </div>;
}

function Reflow() {
  const d = useFsRead<Reflow>("fs_promise", "reflow", {}, []);
  return <Section id="reflow" title="Breakdown re-flow" description={d.data?.basis ?? "Orders at risk on presses that are down."}>
    {d.loading && !d.data ? <Loading what="breakdowns" /> : d.error ? <Failure text={d.error} /> : d.data ? d.data.breakdowns.length ? <div className="space-y-3">{d.data.breakdowns.map(b => <article key={b.breakdown_id} className="rounded-xl border p-3">
      <p className="font-bold">{b.press} · down {b.days_down} day(s) since {new Date(b.since).toLocaleString("en-IN")} <Pill value="blocked" label={b.status.replace("_", " ")} /></p>
      {b.issue ? <p className="text-xs text-neutral-600">{b.issue}</p> : null}
      {b.work.length ? <ul className="mt-2 divide-y text-sm">{b.work.map(w => <li key={w.job_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
        <span><Link className="underline" href={`/production/${w.job_id}`}>{w.job_number ?? "Job"}</Link> for <Link className="underline" href={`/orders/${w.order_id}`}>{w.order_number}</Link> · planned end {fmtDay(w.planned_end)} · promise {w.promise ? fmtDay(w.promise) : "none"}</span>
        <span className={w.at_risk ? "font-bold text-rose-700" : "text-neutral-600"}>{w.at_risk ? "At risk · " : ""}{slackText(w.slack_days)}</span></li>)}</ul> : <p className="text-xs text-neutral-600">No scheduled work on this press after the stoppage.</p>}
      {b.work.some(w => w.at_risk) ? <Link className="mt-2 inline-block text-sm font-bold underline" href="/orders/delay-notices">Draft delay notices</Link> : null}
    </article>)}</div> : <Empty>No press is broken down.</Empty> : null}
  </Section>;
}
