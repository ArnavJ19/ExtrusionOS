"use client";

import { useState } from "react";
import Link from "next/link";
import { WEIGHT_STATES } from "@/lib/autopilot-batch6/commands";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { ProposalCards } from "../autopilot/proposal-cards";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, inputClass, useApRead } from "../order-to-cash/ui";
import { Action, Field, Filters, NumberInput, Stat, Why, num, optional, pct, write, type Note, type Queue } from "./shared";

type Point = { bundle_id: string; recorded_at: string; bundle_number: string; job_number: string | null; net_kg: number; net_length_m: number; kgm: number };
type Drift = { die_id: string; die_number: string; die_status: string; profile_id: string | null; profile_code: string | null; profile_name: string | null; theoretical_kgm: number | null;
  tolerance_percent: number | null; tolerance_source: string; window_bundles: number; min_bundles: number; bundles_used: number; actual_kgm: number | null; drift_percent: number | null;
  state: keyof typeof WEIGHT_STATES; last_bundle_at: string | null; points: Point[]; basis: string };
const tone = (s: string) => s === "heavy" || s === "light" ? "bad" : s === "within" ? "ok" : "warn";

/** Actual kg/m of each weighed bundle against the master weight, with the tolerance band. */
export function WeightTrend({ points, theoretical, tolerance }: { points: Point[]; theoretical: number | null; tolerance: number | null }) {
  if (!points.length) return <Empty>No weighed production bundles from this die yet.</Empty>;
  const values = points.map(p => Number(p.kgm)).concat(theoretical ? [theoretical, theoretical * (1 + (tolerance ?? 0) / 100), theoretical * (1 - (tolerance ?? 0) / 100)] : []);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || Math.max(0.001, max * 0.02);
  const w = 320, h = 120, pad = 8, x = (i: number) => pad + (points.length === 1 ? (w - 2 * pad) / 2 : i * (w - 2 * pad) / (points.length - 1));
  const y = (v: number) => h - pad - (v - (min - span * 0.1)) / (span * 1.2) * (h - 2 * pad);
  return <figure className="min-w-0"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Actual kg per metre by bundle against the master weight" className="h-32 w-full rounded-xl border bg-white">
    {theoretical && tolerance ? <rect x={0} width={w} y={y(theoretical * (1 + tolerance / 100))} height={Math.max(1, y(theoretical * (1 - tolerance / 100)) - y(theoretical * (1 + tolerance / 100)))} fill="#ecfdf5" /> : null}
    {theoretical ? <line x1={0} x2={w} y1={y(theoretical)} y2={y(theoretical)} stroke="#047857" strokeDasharray="4 3" /> : null}
    <polyline fill="none" stroke="#111827" strokeWidth={1.5} points={points.map((p, i) => `${x(i)},${y(Number(p.kgm))}`).join(" ")} />
    {points.map((p, i) => <circle key={p.bundle_id} cx={x(i)} cy={y(Number(p.kgm))} r={2.5} fill="#111827"><title>{`${p.bundle_number}: ${p.kgm} kg/m`}</title></circle>)}
  </svg><figcaption className="mt-1 text-xs text-neutral-600">Dots: weighed bundles, oldest to newest. Dashed line: master {num(theoretical, 4)} kg/m{tolerance ? `; green band ±${tolerance}%` : ""}.</figcaption></figure>;
}

export function DieWeightPanel({ dieId, today }: { dieId: string; today: string }) {
  const read = useApRead<Drift>("ap_weight", "die", { die_id: dieId });
  const d = read.data;
  return <Section id="weight-drift" title="Section weight from bundles" description="Actual kg/m from weighed production bundles of this die, against the profile master.">
    {read.error ? <Failure text={read.error} /> : read.loading && !d ? <Loading what="section weight" /> : d ? <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Master kg/m" value={d.theoretical_kgm == null ? "Not set" : num(d.theoretical_kgm, 4)} />
        <Stat label={`Actual (last ${d.bundles_used})`} value={d.actual_kgm == null ? "Unknown" : num(d.actual_kgm, 4)} />
        <Stat label="Drift" value={pct(d.drift_percent)} tone={tone(d.state)} />
        <Stat label="Status" value={WEIGHT_STATES[d.state] ?? d.state} tone={tone(d.state)} />
      </div>
      <p className="text-xs text-neutral-600">Tolerance: {d.tolerance_percent == null ? "not set — QC sets it on Section weight" : `±${d.tolerance_percent}% (${d.tolerance_source === "profile" ? "profile master" : "factory setting"})`}. {d.basis}</p>
      <WeightTrend points={d.points} theoretical={d.theoretical_kgm} tolerance={d.tolerance_percent} />
      <Why value={d.points.map(p => ({ bundle: p.bundle_number, job: p.job_number, net_kg: p.net_kg, net_length_m: p.net_length_m, kg_per_m: p.kgm, weighed: fmtWhen(p.recorded_at) }))} title="Bundle weights used" />
      <ProposalCards initial={null} type="die.weight_drift" target={dieId} today={today} title="Weight decision" emptyText="No weight decision is waiting for this die." />
    </> : null}
  </Section>;
}

export function WeightDriftList({ canSet = false }: { canSet?: boolean }) {
  const [search, setSearch] = useState(""); const [show, setShow] = useState("attention"); const [sort, setSort] = useState("date"); const [page, setPage] = useState(1);
  const [note, setNote] = useState<Note>(null); const [rev, setRev] = useState(0);
  const read = useApRead<Queue<Drift> & { states: Record<string, number>; settings: { tolerance_percent: number | null; window_bundles: number; min_bundles: number } | null }>("ap_weight", "list", { page, search, show, sort }, [rev]);
  return <div className="space-y-5"><Section title="Section weight by die" description="Every active die's actual kg/m against its master weight. Drift beyond tolerance prepares a decision for QC or the die shop.">
    <Filters search={search} setSearch={v => { setSearch(v); setPage(1); }} show={show} setShow={v => { setShow(v); setPage(1); }} sort={sort} setSort={setSort}
      options={[["attention", "Drift or missing data"], ["all", "All active dies"]]} />
    <Message value={note} />
    <Action secondary run={async () => { await write("ap_weight", "prepare", {}, setNote, "Checked. Drift beyond tolerance has a decision waiting."); setRev(v => v + 1); }}>Check drift now</Action>
    {read.error ? <Failure text={read.error} /> : read.loading && !read.data ? <Loading what="dies" /> : read.data ? <>
      <p className="text-xs text-neutral-600">{Object.entries(read.data.states).map(([s, n]) => `${WEIGHT_STATES[s] ?? s}: ${n}`).join(" · ") || "No active dies."}</p>
      {!read.data.rows.length ? <Empty>No die needs attention.</Empty> : <ul className="divide-y">{read.data.rows.map(d => <li key={d.die_id} className="flex flex-wrap items-start justify-between gap-2 py-3">
        <div className="min-w-0"><Link className="font-bold underline" href={`/dies/${d.die_id}#weight-drift`}>{d.die_number}</Link> <span className="text-sm text-neutral-600">{d.profile_code ?? "No profile"}</span>
          <p className="text-sm">Master {num(d.theoretical_kgm, 4)} · actual {num(d.actual_kgm, 4)} kg/m · {d.bundles_used} bundle(s) · drift {pct(d.drift_percent)}</p></div>
        <Pill value={d.state} label={WEIGHT_STATES[d.state]} /></li>)}</ul>}
      <Pager page={page} total={read.data.total_count} onPage={setPage} />
    </> : null}
  </Section>
  {canSet ? <WeightSettings onSaved={() => setRev(v => v + 1)} /> : null}
  <ProposalCards key={rev} initial={null} type="die.weight_drift" today="" title="Weight decisions waiting" emptyText="No weight decision is waiting." /></div>;
}

function WeightSettings({ onSaved }: { onSaved: () => void }) {
  const read = useApRead<{ tolerance_percent: number | null; window_bundles: number; min_bundles: number }>("ap_weight", "settings", {});
  const [tol, setTol] = useState<string | null>(null); const [win, setWin] = useState<string | null>(null); const [min, setMin] = useState<string | null>(null); const [note, setNote] = useState<Note>(null);
  const v = read.data;
  return <Section title="Drift rules" description="Set by QC. A profile's own weight tolerance overrides the factory tolerance.">
    {!v ? <Loading what="settings" /> : <><div className="grid gap-3 sm:grid-cols-3">
      <Field label="Factory tolerance (%)" hint="Blank: only profiles with their own tolerance are judged"><NumberInput value={tol ?? (v.tolerance_percent == null ? "" : String(v.tolerance_percent))} onChange={setTol} /></Field>
      <Field label="Bundles averaged"><input type="number" min={3} max={100} className={inputClass} value={win ?? String(v.window_bundles)} onChange={e => setWin(e.target.value)} /></Field>
      <Field label="Minimum bundles"><input type="number" min={2} max={50} className={inputClass} value={min ?? String(v.min_bundles)} onChange={e => setMin(e.target.value)} /></Field>
    </div><Message value={note} />
    <Action run={async () => { if (await write("ap_weight", "save_settings", { ...(optional(tol ?? String(v.tolerance_percent ?? "")) !== undefined ? { tolerance_percent: optional(tol ?? String(v.tolerance_percent ?? "")) } : {}),
      window_bundles: Number(win ?? v.window_bundles), min_bundles: Number(min ?? v.min_bundles) }, setNote, "Drift rules saved.")) onSaved(); }}>Save drift rules</Action></>}
  </Section>;
}
