"use client";

// AP-052: control charts per characteristic and die (coating thickness per finish line), with limits from the approved
// inspection plan, and the alarm queue QC reviews. Alarms are raised by the hourly check; reviewing one records what QC found.
import { useState } from "react";
import Link from "next/link";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { SPC_OUTCOMES, SPC_RULES } from "@/lib/autopilot-batch8/commands";
import { spcScale } from "@/lib/calculations/spc";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

export type SpcPoint = { value: number; at: string; source: string; job_id: string | null; outside: boolean };
export type SpcChartData = { item_id: string; chart_key: string; subgroup: string; subgroup_label: string; characteristic: string; unit: string; profile_code: string | null; plan_version: number;
  nominal: number | null; lower_limit: number | null; upper_limit: number | null; center: number | null; points: SpcPoint[]; count: number; mean: number | null; sigma: number | null; cpk: number | null;
  rules: { rule: string; message: string }[]; open_alarms: { id: string; rule: string; raised_at: string }[] };
type Alarm = { id: string; item_id: string; subgroup: string; subgroup_label: string; characteristic: string; rule: string; reading_at: string; reading_value: number;
  limits: { lower: number | null; upper: number | null; center: number | null; unit: string }; status: string; raised_at: string; review_outcome: string | null; review_note: string | null; reviewed_at: string | null; reviewed_by: string | null };
type Note = { tone: "ok" | "error"; text: string } | null;
const n = (v: number | null | undefined, d = 3) => v === null || v === undefined ? "—" : String(Number(Number(v).toFixed(d)));

/** One control chart: plan limits (dashed), centre line, readings in time order; readings outside limits in red. */
export function SpcChart({ chart }: { chart: SpcChartData }) {
  const W = 640, H = 180, L = 46, R = 10, T = 10, B = 22;
  const values = chart.points.map(p => Number(p.value));
  const limits = { nominal: chart.nominal, lower: chart.lower_limit, upper: chart.upper_limit };
  const { min, max } = spcScale(values, limits);
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min));
  const x = (i: number) => L + (values.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (values.length - 1));
  const line = (v: number | null, cls: string, label: string) => v === null ? null : <g key={label}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={cls} /><text x={L - 4} y={y(v) + 3} textAnchor="end" className="fill-neutral-500 text-[9px]">{n(v)}</text></g>;
  return <figure className="min-w-0">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${chart.characteristic} control chart for ${chart.subgroup_label}: ${chart.count} readings`} className="h-auto w-full">
      <rect x={L} y={T} width={W - L - R} height={H - T - B} className="fill-neutral-50" />
      {line(chart.upper_limit, "stroke-rose-500 [stroke-dasharray:4_3]", "usl")}
      {line(chart.lower_limit, "stroke-rose-500 [stroke-dasharray:4_3]", "lsl")}
      {line(chart.center, "stroke-neutral-400", "center")}
      {values.length > 1 ? <polyline fill="none" className="stroke-sky-700" strokeWidth={1.5} points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} /> : null}
      {chart.points.map((p, i) => <circle key={`${p.at}:${i}`} cx={x(i)} cy={y(Number(p.value))} r={3.2} className={p.outside ? "fill-rose-600" : "fill-sky-700"}><title>{`${n(p.value, 4)} ${chart.unit} · ${fmtWhen(p.at)}`}</title></circle>)}
      {!values.length ? <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-neutral-500 text-xs">No readings yet</text> : null}
    </svg>
    <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
      <span>Limits {n(chart.lower_limit)} – {n(chart.upper_limit)} {chart.unit} (plan v{chart.plan_version})</span><span>Centre {n(chart.center)}</span>
      <span>Mean {n(chart.mean)}</span><span>σ {n(chart.sigma, 4)}</span><span>Cpk {chart.cpk === null ? "—" : n(chart.cpk, 2)}</span><span>{chart.count} readings</span>
    </figcaption>
  </figure>;
}

function ChartCard({ chart }: { chart: SpcChartData }) {
  return <article className="min-w-0 space-y-2 rounded-2xl border border-neutral-200 bg-white p-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-bold">{chart.characteristic} <span className="font-normal text-neutral-500">({chart.unit})</span></p>
      <p className="text-xs text-neutral-500">{chart.subgroup_label}{chart.profile_code ? ` · ${chart.profile_code}` : " · default plan"}</p></div>
      {chart.open_alarms.length ? <Pill value="blocked" label={`${chart.open_alarms.length} alarm${chart.open_alarms.length > 1 ? "s" : ""}`} /> : chart.rules.length ? <Pill value="held" label="Rule triggered" /> : <Pill value="approved" label="In control" />}</div>
    <SpcChart chart={chart} />
    {chart.rules.map(r => <p key={r.rule} className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{r.message}</p>)}
  </article>;
}

export function SpcChartsClient() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [q, setQ] = useState(""); const [state, setState] = useState<"all" | "alarm">("all");
  const data = useApRead<{ rows: SpcChartData[]; total_count: number; active_characteristics: number; open_alarms: number }>("ap_spc", "charts", { page, state, ...(q ? { search: q } : {}) }, []);
  return <Section title="Control charts" description="One chart per active characteristic of an approved inspection plan, per die (coating thickness per finish). Charts with alarms first.">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
      <input aria-label="Search characteristic or profile" className={`${inputClass} max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Characteristic or profile" />
      <select aria-label="Charts to show" className={`${inputClass} w-auto`} value={state} onChange={e => { setState(e.target.value as "all" | "alarm"); setPage(1); }}><option value="all">All charts</option><option value="alarm">With open alarms</option></select>
      <button type="submit" className={secondaryClass}>Search</button>
    </form>
    {data.loading && !data.data ? <Loading what="charts" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <p className="text-sm text-neutral-600">{data.data.active_characteristics} active characteristic(s) · {data.data.open_alarms} open alarm(s)</p>
      {data.data.rows.length ? <div className="grid gap-3 xl:grid-cols-2">{data.data.rows.map(c => <ChartCard key={`${c.item_id}:${c.subgroup}`} chart={c} />)}</div>
        : <Empty>{q || state === "alarm" ? "No chart matches." : "No approved inspection plan has a measured characteristic yet. Approve a plan in Quality → Plans."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

function AlarmRow({ alarm, canReview, onDone }: { alarm: Alarm; canReview: boolean; onDone: (text: string) => void }) {
  const [outcome, setOutcome] = useState<string>("process_adjusted"); const [note, setNote] = useState(""); const [message, setMessage] = useState<Note>(null); const [busy, setBusy] = useState(false);
  return <li className="space-y-2 p-3 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0"><b>{alarm.characteristic}</b> · {alarm.subgroup_label}<br /><span className="text-neutral-600">{(SPC_RULES as Record<string, string>)[alarm.rule] ?? alarm.rule}: {n(alarm.reading_value, 4)} {alarm.limits.unit} (limits {n(alarm.limits.lower)} – {n(alarm.limits.upper)}) · {fmtWhen(alarm.reading_at)}</span></p>
      {alarm.status === "open" ? <Pill value="open" label="To review" /> : <Pill value="approved" label="Reviewed" />}</div>
    {alarm.status === "reviewed" ? <p className="text-xs text-neutral-600">{(SPC_OUTCOMES as Record<string, string>)[alarm.review_outcome ?? ""] ?? alarm.review_outcome}: {alarm.review_note} · {alarm.reviewed_by ?? "QC"} {fmtWhen(alarm.reviewed_at)}</p>
      : canReview ? <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold">Finding<select className={`${inputClass} w-auto`} value={outcome} onChange={e => setOutcome(e.target.value)}>{Object.entries(SPC_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="min-w-0 flex-1 text-xs font-bold">What QC did<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder="Checked die bearing; adjusted puller speed" /></label>
        <button type="button" className={buttonClass} disabled={busy || note.trim().length < 5} onClick={async () => { setBusy(true); const ok = await apWrite("ap_spc", "review", { id: alarm.id, outcome, note: note.trim() }, setMessage); setBusy(false); if (ok) onDone("Alarm reviewed."); }}>Record review</button>
      </div> : null}
    <Message value={message} />
  </li>;
}

export function SpcAlarmsPanel() {
  const [page, setPage] = useState(1); const [status, setStatus] = useState<"open" | "reviewed">("open"); const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const data = useApRead<{ rows: Alarm[]; total_count: number; can_review: boolean }>("ap_spc", "alarms", { page, status }, [key]);
  return <Section id="spc-alarms" title="Quality drift alarms" description="Raised when a reading is outside the plan limits, or seven in a row sit on one side of the centre line, before rejects start."
    actions={<div className="flex flex-wrap gap-2"><select aria-label="Alarm status" className={`${inputClass} w-auto`} value={status} onChange={e => { setStatus(e.target.value as "open" | "reviewed"); setPage(1); }}><option value="open">To review</option><option value="reviewed">Reviewed</option></select>
      <Link href="/quality/spc" className={`${secondaryClass} inline-flex items-center`}>All charts</Link>
      {data.data?.can_review ? <button type="button" className={secondaryClass} onClick={async () => { const out = await apWrite<{ alerts: number; examined: number }>("ap_spc", "check", {}, setMessage); if (out) { setMessage({ tone: "ok", text: `Checked ${out.examined} chart(s); ${out.alerts} new alarm notice(s).` }); setKey(k => k + 1); } }}>Check now</button> : null}</div>}>
    <Message value={message} />
    {data.loading && !data.data ? <Loading what="alarms" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(a => <AlarmRow key={`${a.id}:${a.status}`} alarm={a} canReview={data.data!.can_review} onDone={text => { setMessage({ tone: "ok", text }); setKey(k => k + 1); }} />)}</ul>
        : <Empty>{status === "open" ? "No alarm is waiting for review." : "No reviewed alarm yet."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

/** The control charts of one die (die record). */
export function SpcDiePanel({ dieId }: { dieId: string }) {
  const [page, setPage] = useState(1);
  const data = useApRead<{ rows: SpcChartData[]; total_count: number }>("ap_spc", "charts", { page, die_id: dieId }, []);
  if (data.data && !data.data.total_count) return null;
  return <Section id="die-spc" title="Quality trend on this die" description="Readings from inspections and triggered samples of jobs on this die, against the approved plan limits.">
    {data.loading && !data.data ? <Loading what="charts" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <div className="grid gap-3 xl:grid-cols-2">{data.data.rows.map(c => <ChartCard key={`${c.item_id}:${c.subgroup}`} chart={c} />)}</div>
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}
