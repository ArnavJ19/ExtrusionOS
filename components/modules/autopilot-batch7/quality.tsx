"use client";

// AP-003: how often each kind of system proposal is accepted, edited, rejected or left to expire, by proposal type and by
// the role that decided (never a ranking of individual people). Rule changes are recorded so acceptance and the number
// of fields people had to type can be compared before and after.
import { useState } from "react";
import { PROPOSAL_TYPES } from "@/lib/proposals/proposals";
import { QUALITY_FLAGS } from "@/lib/autopilot-batch7/commands";
import { fmtDay } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Stats = { total: number; accepted: number; edited: number; rejected: number; ignored: number; stale: number; open: number; decided: number; acceptance_rate: number | null;
  edit_rate: number | null; reject_rate: number | null; ignored_rate: number | null; fields_typed: number | null; median_minutes: number | null };
type Change = { id: string; proposal_type: string; changed_on: string; description: string; recorded_by_role: string | null; comparison: Comparison };
type Comparison = { window_days: number; before: Stats; after: Stats | null; acceptance_change: number | null; fields_typed_change: number | null; state: "too_early" | "few_decisions" | "comparable"; rules_before: string[]; rules_after: string[] };

const label = (type: string) => (PROPOSAL_TYPES as Record<string, { label: string }>)[type]?.label ?? type;
const pc = (v: number | null | undefined) => v === null || v === undefined ? "—" : `${v}%`;
const minutes = (v: number | null) => v === null ? "—" : v < 60 ? `${Math.round(v)} min` : v < 1440 ? `${(v / 60).toFixed(1)} h` : `${(v / 1440).toFixed(1)} days`;
const signed = (v: number | null, unit = "") => v === null ? "—" : `${v > 0 ? "+" : ""}${v}${unit}`;

function StatsRow({ name, s, flags, onOpen, selected }: { name: string; s: Stats; flags?: string[]; onOpen?: () => void; selected?: boolean }) {
  return <tr className={`border-t border-neutral-100 align-top ${selected ? "bg-orange/5" : ""}`}>
    <td className="py-2 pr-2">{onOpen ? <button type="button" className="text-left font-semibold underline" onClick={onOpen}>{name}</button> : <span className="font-semibold">{name}</span>}
      {flags?.length ? <ul className="mt-1 space-y-0.5">{flags.map(f => <li key={f} className="text-xs font-semibold text-amber-900">{QUALITY_FLAGS[f] ?? f}</li>)}</ul> : null}</td>
    {[s.total, pc(s.acceptance_rate), pc(s.edit_rate), pc(s.reject_rate), pc(s.ignored_rate), s.fields_typed ?? "—", minutes(s.median_minutes)].map((cell, n) => <td key={n} className="py-2 pl-2 text-right tabular-nums">{cell}</td>)}
  </tr>;
}
const Head = ({ first }: { first: string }) => <thead><tr className="text-left text-xs text-neutral-500"><th className="py-1">{first}</th><th className="text-right">Prepared</th><th className="text-right">Accepted</th><th className="text-right">Edited</th><th className="text-right">Rejected</th><th className="text-right">Expired unanswered</th><th className="text-right">Fields typed per decision</th><th className="text-right">Median time to decide</th></tr></thead>;

function TypeDetail({ type, weeks, onClose }: { type: string; weeks: 4 | 12; onClose: () => void }) {
  const weekly = useApRead<{ weeks: { week_start: string; stats: Stats }[] }>("ap_quality", "weekly", { proposal_type: type }, [type]);
  const roles = useApRead<{ roles: { role: string; stats: Stats }[] }>("ap_quality", "roles", { proposal_type: type, weeks }, [type, weeks]);
  const corrections = useApRead<{ fields: { field: string; edits: number; most_common_value: string; times: number; usually_proposed: string }[] }>("ap_quality", "corrections", { proposal_type: type, weeks }, [type, weeks]);
  return <Section title={label(type)} description="Twelve weeks, the roles that decided, and the fields people change most often." actions={<button type="button" className={secondaryClass} onClick={onClose}>Close</button>}>
    {weekly.loading && !weekly.data ? <Loading what="weekly figures" /> : weekly.error ? <Failure text={weekly.error} /> : weekly.data ?
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><Head first="Week starting" /><tbody>{weekly.data.weeks.map(w => <StatsRow key={w.week_start} name={fmtDay(w.week_start)} s={w.stats} />)}</tbody></table></div> : null}
    <h3 className="pt-2 text-sm font-bold">By role ({weeks} weeks)</h3>
    {roles.data?.roles.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><Head first="Role" /><tbody>{roles.data.roles.map(r => <StatsRow key={r.role} name={r.role.replaceAll("_", " ")} s={r.stats} />)}</tbody></table></div>
      : roles.error ? <Failure text={roles.error} /> : <Empty>No decisions in this window.</Empty>}
    <h3 className="pt-2 text-sm font-bold">Most corrected fields ({weeks} weeks)</h3>
    {corrections.data?.fields.length ? <ul className="space-y-1 text-sm">{corrections.data.fields.map(f => <li key={f.field} className="break-words"><b>{f.field.replaceAll("_", " ")}</b>: changed {f.edits} time(s); most often to <code className="rounded bg-neutral-100 px-1">{f.most_common_value}</code> ({f.times}×) when the system proposed <code className="rounded bg-neutral-100 px-1">{f.usually_proposed}</code>.</li>)}</ul>
      : corrections.error ? <Failure text={corrections.error} /> : <Empty>No edited proposals in this window.</Empty>}
  </Section>;
}

function ChangeRow({ c }: { c: Change }) {
  const x = c.comparison;
  return <li className="space-y-1 rounded-xl border border-neutral-200 p-3 text-sm">
    <p className="font-semibold">{label(c.proposal_type)} · changed {fmtDay(c.changed_on)}{c.recorded_by_role ? ` · recorded by the ${c.recorded_by_role.replaceAll("_", " ")}` : ""}</p>
    <p className="break-words text-neutral-700">{c.description}</p>
    {x.state === "too_early" ? <p className="text-xs text-neutral-500">Changed today; the comparison starts tomorrow.</p> : <>
      <p>Over {x.window_days} day(s) each side: accepted {pc(x.before.acceptance_rate)} → {pc(x.after?.acceptance_rate)} ({signed(x.acceptance_change, " points")}); fields typed per decision {x.before.fields_typed ?? "—"} → {x.after?.fields_typed ?? "—"} ({signed(x.fields_typed_change)}).</p>
      <p className="text-xs text-neutral-500">{x.before.decided} decision(s) before, {x.after?.decided ?? 0} after{x.state === "few_decisions" ? " — fewer than five on one side, so treat the change as indicative" : ""}. Rules seen: {x.rules_before.join(", ") || "none"} → {x.rules_after.join(", ") || "none"}.</p>
    </>}
  </li>;
}

export function QualityClient({ canRecord }: { canRecord: boolean }) {
  const [weeks, setWeeks] = useState<4 | 12>(4); const [type, setType] = useState<string | null>(null); const [page, setPage] = useState(1); const [key, setKey] = useState(0);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState(() => ({ proposal_type: "", changed_on: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10), description: "" }));
  const overview = useApRead<{ types: { proposal_type: string; stats: Stats; flags: string[] }[]; all: Stats; note: string }>("ap_quality", "overview", { weeks }, [key]);
  const changes = useApRead<{ rows: Change[]; total_count: number }>("ap_quality", "changes", { page }, [key]);
  return <div className="space-y-4">
    <Section title="Proposal acceptance by type" description={overview.data?.note ?? "Counts by proposal type and role."}
      actions={<select aria-label="Window" className={`${inputClass} w-36`} value={weeks} onChange={e => setWeeks(Number(e.target.value) as 4 | 12)}><option value={4}>Last 4 weeks</option><option value={12}>Last 12 weeks</option></select>}>
      {overview.loading && !overview.data ? <Loading what="proposal figures" /> : overview.error ? <Failure text={overview.error} /> : !overview.data?.types.length ? <Empty>No proposals were prepared in this window.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><Head first="Proposal type" /><tbody>
          {overview.data.types.map(t => <StatsRow key={t.proposal_type} name={label(t.proposal_type)} s={t.stats} flags={t.flags} selected={type === t.proposal_type} onOpen={() => setType(t.proposal_type)} />)}
          <StatsRow name="All types" s={overview.data.all} /></tbody></table></div>}
      <p className="text-xs text-neutral-500">Fields typed per decision: 0 when accepted as proposed, otherwise the number of fields changed. A type overridden more often than accepted is marked for review; a type accepted every time is worth sampling.</p>
    </Section>
    {type ? <TypeDetail type={type} weeks={weeks} onClose={() => setType(null)} /> : null}
    <Section title="Rule changes" description="Record when a rule, threshold or default changed; each change shows acceptance and fields typed before and after it.">
      {canRecord ? <form className="grid gap-3 sm:grid-cols-[1fr_auto_2fr_auto] sm:items-end" onSubmit={async e => {
        e.preventDefault();
        const ok = await apWrite("ap_quality", "record_change", { proposal_type: form.proposal_type, changed_on: form.changed_on, description: form.description.trim() }, setNote, "Rule change recorded.");
        if (ok) { setForm(f => ({ ...f, description: "" })); setKey(k => k + 1); }
      }}>
        <label className="text-sm font-semibold">Proposal type<select required aria-label="Proposal type changed" value={form.proposal_type} onChange={e => setForm(f => ({ ...f, proposal_type: e.target.value }))} className={`${inputClass} mt-1`}>
          <option value="">Choose</option>{(overview.data?.types ?? []).map(t => <option key={t.proposal_type} value={t.proposal_type}>{label(t.proposal_type)}</option>)}</select></label>
        <label className="text-sm font-semibold">Changed on<input required type="date" aria-label="Changed on" value={form.changed_on} onChange={e => setForm(f => ({ ...f, changed_on: e.target.value }))} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold">What changed<input required minLength={10} maxLength={500} aria-label="What changed" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={`${inputClass} mt-1`} placeholder="For example: die service warning moved from 90% to 85% of the interval" /></label>
        <button type="submit" className={buttonClass}>Record</button>
      </form> : <p className="text-xs text-neutral-500">The owner or an admin records rule changes.</p>}
      <Message value={note} />
      {changes.loading && !changes.data ? <Loading what="rule changes" /> : changes.error ? <Failure text={changes.error} /> : !changes.data?.rows.length ? <Empty>No rule change recorded yet.</Empty>
        : <ul className="space-y-2">{changes.data.rows.map(c => <ChangeRow key={c.id} c={c} />)}</ul>}
      {changes.data ? <Pager page={page} total={changes.data.total_count} onPage={setPage} /> : null}
    </Section>
  </div>;
}
