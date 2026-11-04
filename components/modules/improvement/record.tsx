"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ImprovementMutationForm, IMPROVEMENT_ACTION_FORMS } from "./mutation-form";
import { DENOMINATORS, OCCURRENCE_TYPES, PROBLEM_CATEGORIES, SERVICE_EVENTS, SUGGESTION_CATEGORIES, THRESHOLD_BASES, canUseImprovementAction, improvementStatusLabel,
  type ImprovementAction, type ImprovementDetail, type ImprovementView } from "@/lib/workflow/improvement";
import type { SessionContext } from "@/types/app";
import { formatDate } from "@/lib/utils/format";

function readable(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return `${new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  return String(value).replaceAll("_", " ");
}
const list = <T,>(value: unknown) => (Array.isArray(value) ? value as T[] : []);
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

function Facts({ entries }: { entries: [string, unknown][] }) {
  return <dl className="grid gap-4 sm:grid-cols-2">{entries.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-900">{readable(value)}</dd></div>)}</dl>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-bold">{title}</h2>{children}</section>;
}
function ActionDisclosure({ children, open }: { children: ReactElement<{ action: ImprovementAction; role: string; title?: string }>; open?: boolean }) {
  if (!canUseImprovementAction(children.props.role, children.props.action)) return null;
  return <details open={open} className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 text-sm font-bold text-slate-700">{children.props.title ?? IMPROVEMENT_ACTION_FORMS[children.props.action].title}</summary><div className="mt-3">{children}</div></details>;
}

const RESPONSES_FROM: Record<string, string[]> = {
  submitted: ["acknowledged", "clarification", "trial", "adopted", "declined"], acknowledged: ["clarification", "trial", "adopted", "declined"],
  clarification: ["acknowledged", "trial", "declined"], trial: ["adopted", "declined"], adopted: ["resolved"]
};
type Link_ = { id: string; source_type: string; label: string; occurred_at: string; href: string | null; removed: boolean; removed_reason: string | null };
type Window_ = { from: string; to: string; occurrences: number; activity: number; rate_per_100: number | null };
type TimelineEvent = { at: string; kind: string; label: string; href: string | null };
type Check = { threshold_id: string; basis: string; service_event: string; warn_at: number; value: number | null; state: string };
type MetricWindow = { from: string; to: string; value: number | null; numerator: number | null; denominator: number | null; sample: number; missing: number; not_applicable?: boolean; elapsed_hours?: number; active_hours?: number; waiting_hours?: number; unrecorded_hours?: number };

export function ImprovementRecord({ view, detail, context }: { view: ImprovementView; detail: ImprovementDetail; context: SessionContext }) {
  const { row } = detail; const d = row.details; const role = context.role;
  const action = (name: ImprovementAction, fixed: Record<string, unknown>, open = false, title?: string, only?: readonly string[]) =>
    <ActionDisclosure open={open}><ImprovementMutationForm action={name} role={role} fixed={fixed} title={title} only={only} /></ActionDisclosure>;
  const lead = d.owner_id === context.userId || ["owner", "admin", "factory_manager", "quality"].includes(role);
  return <div className="space-y-5">
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="break-words text-xl font-bold">{row.label}</h2><Badge value={row.status} /></div>
      <p className="text-sm font-semibold text-slate-800">{improvementStatusLabel(row.status)}</p>
      <p className="break-words text-sm text-slate-700">{row.summary}</p>
      {row.owner || row.due_date ? <p className="text-sm font-semibold">{row.owner ?? "Not assigned"}{row.due_date ? ` · ${formatDate(row.due_date)}` : ""}</p> : null}
      {row.source_href ? <Link href={row.source_href} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the source record</Link> : null}
      <p className="text-xs text-slate-500">Current authorized read as of {readable(detail.as_of)}. Every action rechecks current sources before it is recorded.</p>
    </section>

    {view === "problems" ? (() => {
      const recurrence = record(d.recurrence); const baseline = record(recurrence.baseline) as unknown as Window_; const trial = record(recurrence.trial) as unknown as Window_;
      const open = d.problem_status !== "closed"; const status = String(d.problem_status);
      return <>
        <Section title="Problem"><Facts entries={[["Category", PROBLEM_CATEGORIES[d.category as keyof typeof PROBLEM_CATEGORIES] ?? d.category], ["Improvement owner", d.owner_name], ["What keeps happening", d.description],
          ["Immediate containment", d.containment], ["Cause", d.cause ? `${d.cause} (${d.cause_basis === "established" ? "established" : "observation, not established"})` : null], ["Cause evidence", d.cause_evidence],
          ["Proposed change", d.proposed_action], ["Trial scope", d.trial_scope], ["Review date", d.review_date], ["Measured per", d.denominator ? DENOMINATORS[d.denominator as keyof typeof DENOMINATORS] : null],
          ["Linked procedure change", d.procedure_improvement ? `${d.procedure_improvement} (${readable(d.procedure_improvement_status)})` : null], ["Trial started", d.trial_started_at], ["Reopened", d.reopened_count]]} />
          <p className="text-xs text-slate-600">Containment protects customers now; the cause and the trialled change are separate outcomes. The problem closes only after the effectiveness review.</p></Section>
        <Section title="Occurrences">{list<Link_>(d.links).length ? <ul className="space-y-2">{list<Link_>(d.links).map(item => <li key={item.id} className={`space-y-1 rounded-xl p-3 text-sm ${item.removed ? "bg-slate-50 text-slate-500" : "bg-amber-50 text-amber-950"}`}>
          <p className="font-semibold">{OCCURRENCE_TYPES[item.source_type as keyof typeof OCCURRENCE_TYPES] ?? readable(item.source_type)}: {item.label}</p>
          <p className="text-xs">{readable(item.occurred_at)}{item.href ? <> · <Link href={item.href} className="font-semibold underline">Open the source record</Link></> : null}</p>
          {item.removed ? <p className="text-xs">Removed: {item.removed_reason}</p> : action("problem.unlink", { id: row.id, link_id: item.id }, false, "Remove this occurrence")}</li>)}</ul>
          : <p className="text-sm text-slate-600">No occurrences linked yet.</p>}
          {action("problem.link", { id: row.id }, open && list(d.links).length === 0)}</Section>
        <Section title="Recurrence before and during the trial">{recurrence.state === "not_started" ? <p className="text-sm text-slate-600">{String(recurrence.note ?? "Recurrence is compared once a trial starts.")}</p> : recurrence.state ? <>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th scope="col" className="py-2 pr-3">Window</th><th scope="col" className="py-2 pr-3">Occurrences</th><th scope="col" className="py-2 pr-3">{readable(recurrence.denominator)}</th><th scope="col" className="py-2">Per 100</th></tr></thead>
            <tbody>{([["Before the trial", baseline], ["During the trial", trial]] as const).map(([label, w]) => <tr key={label} className="border-b last:border-0"><td className="py-2 pr-3">{label}<span className="block text-xs text-slate-500">{readable(w.from)} to {readable(w.to)}</span></td>
              <td className="py-2 pr-3">{readable(w.occurrences)}</td><td className="py-2 pr-3">{readable(w.activity)}</td><td className="py-2 font-semibold">{w.rate_per_100 === null ? "No activity recorded" : readable(w.rate_per_100)}</td></tr>)}</tbody></table></div>
          <p className="text-xs text-slate-600">{String(recurrence.note)} Window: {readable(recurrence.window_days)} day(s) each.</p></> : null}
          {d.outcome ? <p className="rounded-xl bg-slate-50 p-3 text-sm">Last review: {readable(record(d.outcome).decision)} · {String(record(d.outcome).evidence ?? "")}</p> : null}</Section>
        {list<{ reference: string; id: string; status: string }>(d.suggestions).length ? <Section title="Employee suggestions linked"><ul className="space-y-1 text-sm">{list<{ reference: string; id: string; status: string }>(d.suggestions).map(item =>
          <li key={item.id}><Link href={`/tasks/improvement/suggestions/${item.id}`} className="font-semibold underline">{item.reference}</Link> · {improvementStatusLabel(item.status)}</li>)}</ul></Section> : null}
        <div className="space-y-4">
          {lead && ["open", "investigating", "planned"].includes(status) ? action("problem.investigate", { id: row.id }, status === "open" && list(d.links).length > 0) : null}
          {lead && ["investigating", "planned"].includes(status) ? action("problem.plan", { id: row.id }, status === "investigating") : null}
          {lead && status === "planned" ? action("problem.trial", { id: row.id }, true) : null}
          {lead && status === "trial" ? action("problem.review", { id: row.id }, row.status === "review_due") : null}
          {lead && status === "trial" ? action("problem.cancel_trial", { id: row.id }) : null}
          {status === "closed" ? action("problem.reopen", { id: row.id }) : action("problem.reassign", { id: row.id })}
        </div>
      </>;
    })() : null}

    {view === "suggestions" ? <>
      <Section title="Suggestion"><Facts entries={[["Kind", SUGGESTION_CATEGORIES[d.category as keyof typeof SUGGESTION_CATEGORIES] ?? d.category], ["Screen", d.source_path], ["Made by", d.mine ? "You" : d.contributor],
        ["Process owner", d.assigned_to_me ? "You" : d.owner_name], ["Sent", d.created_at], ["What happened and what would help", d.description], ["Supporting reference", d.evidence]]} />
        {typeof d.source_path === "string" && d.source_path.startsWith("/") ? <Link href={d.source_path} className="inline-flex min-h-11 items-center text-sm font-bold underline">Open the screen it came from</Link> : null}</Section>
      <Section title="What became of it">{d.response ? <p className="break-words text-sm"><span className="font-semibold">Response:</span> {String(d.response)}</p> : <p className="text-sm text-slate-600">No response yet. The process owner is notified.</p>}
        {d.decline_reason ? <p className="break-words text-sm"><span className="font-semibold">Declined because:</span> {String(d.decline_reason)}</p> : null}
        {d.clarification ? <p className="break-words text-sm"><span className="font-semibold">Clarification:</span> {String(d.clarification)}</p> : null}
        {d.merged_into ? <p className="text-sm">Merged with {String(d.merged_into)}, which is now {improvementStatusLabel(String(d.merged_into_status ?? ""))}.</p> : null}
        {d.problem_title ? <p className="text-sm">Linked to the recurring problem “{String(d.problem_title)}”.</p> : null}
        {d.procedure_improvement ? <p className="text-sm">Linked to the procedure change “{String(d.procedure_improvement)}”.</p> : null}
        {list<{ reference: string; id: string }>(d.merged_from).length ? <p className="text-sm">Similar suggestions merged here: {list<{ reference: string; id: string }>(d.merged_from).map(item => item.reference).join(", ")}.</p> : null}
        {d.internal_note ? <p className="rounded-xl bg-slate-50 p-3 text-sm"><span className="font-semibold">Internal note (process owners only):</span> {String(d.internal_note)}</p> : null}</Section>
      <div className="space-y-4">
        {d.mine && row.status === "clarification" ? action("suggestion.clarify", { id: row.id }, true) : null}
        {(d.assigned_to_me || ["owner", "admin"].includes(role)) && RESPONSES_FROM[row.status] ? <>
          {action("suggestion.respond", { id: row.id }, row.status === "submitted", undefined, RESPONSES_FROM[row.status])}
          {action("suggestion.link", { id: row.id })}
          {action("suggestion.merge", { id: row.id })}
          {action("suggestion.reassign", { id: row.id })}
        </> : null}
      </div>
    </> : null}

    {view === "outcomes" ? (() => {
      const definition = record(d.definition); const current = record(d.current) as unknown as MetricWindow; const previous = record(d.previous) as unknown as MetricWindow;
      const cell = (w: MetricWindow) => w.not_applicable ? "Not applicable" : w.value === null ? "No value: no records" : `${readable(w.value)}%`;
      return <>
        <Section title="Current and previous 30 days"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th scope="col" className="py-2 pr-3">Period</th><th scope="col" className="py-2 pr-3">Value</th><th scope="col" className="py-2 pr-3">Numerator / denominator</th><th scope="col" className="py-2 pr-3">Sample</th><th scope="col" className="py-2">Missing evidence</th></tr></thead>
          <tbody>{([["Last 30 days", current], ["Previous 30 days", previous]] as const).map(([label, w]) => <tr key={label} className="border-b last:border-0"><td className="py-2 pr-3">{label}<span className="block text-xs text-slate-500">{readable(w.from)} to {readable(w.to)}</span></td>
            <td className="py-2 pr-3 font-semibold">{cell(w)}</td><td className="py-2 pr-3">{w.not_applicable ? "—" : `${readable(w.numerator)} / ${readable(w.denominator)}`}</td><td className="py-2 pr-3">{readable(w.sample)}</td><td className="py-2">{readable(w.missing)}</td></tr>)}</tbody></table></div>
          {current.elapsed_hours !== undefined ? <Facts entries={[["Elapsed hours", current.elapsed_hours], ["Recorded active hours", current.active_hours], ["Recorded waiting hours", current.waiting_hours], ["Unrecorded hours", current.unrecorded_hours]]} /> : null}
          <p className="text-xs text-slate-600">{row.status === "small_sample" ? "Fewer than 10 records: do not draw a conclusion from this figure. " : ""}A missing record is counted as missing evidence, never as zero. Changes of at least 2 points are labelled improved or worsened.</p></Section>
        <Section title={`Definition (version ${readable(d.version)}, from ${readable(d.effective_from)})`}><Facts entries={[["Numerator", definition.numerator], ["Denominator", definition.denominator], ["Time basis", definition.time_basis], ["Exclusions", definition.exclusions], ["Owner", definition.owner], ["Source", definition.source], ["Better when", definition.direction === "higher" ? "Higher" : "Lower"]]} />
          <p className="text-xs text-slate-600">{String(d.note ?? "")}</p></Section>
        <Section title="Records behind the figure">{d.drill_permitted ? list<{ label: string; detail: string; href: string }>(d.drill).length ? <ul className="space-y-2">{list<{ label: string; detail: string; href: string }>(d.drill).map((item, index) => <li key={index} className="text-sm"><Link href={item.href} className="font-semibold underline">{item.label}</Link> · {item.detail}</li>)}</ul>
          : <p className="text-sm text-slate-600">No contributing records in the last 30 days.</p> : <p className="text-sm text-slate-600">Source records are shown to the team&apos;s leads and factory management.</p>}</Section>
      </>;
    })() : null}

    {view === "dies" ? (() => {
      const service = record(d.service); const checks = list<Check>(d.checks);
      return <>
        <Section title="Operating exposure"><Facts entries={[["Recorded runs", d.runs], ["Output from recorded runs (kg)", d.run_kg], ["Opening balance before system use (kg)", d.opening_kg], ["Opening runs", d.opening_runs],
          ["Runs not yet counted (ready or running)", d.running_jobs], ["Cancelled runs (not counted)", d.cancelled_runs], ["Die status", d.die_status], ["Rack", d.rack_location]]} />
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b"><th scope="col" className="py-2 pr-3">Since the last</th><th scope="col" className="py-2 pr-3">Date</th><th scope="col" className="py-2 pr-3">Kg</th><th scope="col" className="py-2 pr-3">Runs</th><th scope="col" className="py-2">Days</th></tr></thead>
            <tbody>{(["nitriding", "correction", "any"] as const).map(key => { const s = record(service[key]); return <tr key={key} className="border-b last:border-0"><td className="py-2 pr-3">{SERVICE_EVENTS[key]}</td>
              <td className="py-2 pr-3">{s.date ? readable(s.date) : "Never recorded"}</td><td className="py-2 pr-3">{readable(s.kg)}{s.includes_opening ? " (incl. opening)" : ""}</td><td className="py-2 pr-3">{readable(s.runs)}</td><td className="py-2">{s.days === null || s.days === undefined ? "Unknown" : readable(s.days)}</td></tr>; })}</tbody></table></div>
          {list<string>(d.warnings).length ? <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{list<string>(d.warnings).map(item => <li key={item}>{item}</li>)}</ul> : null}
          {list<string>(d.missing).length ? <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{list<string>(d.missing).map(item => <li key={item}>{item}</li>)}</ul> : null}
          <p className="text-xs text-slate-600">Only completed runs count; output corrections are already reflected in a job&apos;s recorded output. Warnings are advisory; the production compatibility guard decides whether a die can be used.</p></Section>
        {checks.length ? <Section title="Reviewed service thresholds"><ul className="space-y-1 text-sm">{checks.map(check => <li key={check.threshold_id}><Link href={`/tasks/improvement/thresholds/${check.threshold_id}`} className="font-semibold underline">{THRESHOLD_BASES[check.basis as keyof typeof THRESHOLD_BASES]}</Link> after {SERVICE_EVENTS[check.service_event as keyof typeof SERVICE_EVENTS]?.toLowerCase()}: {readable(check.value)} of {readable(check.warn_at)} · {readable(check.state)}</li>)}</ul></Section> : null}
        <Section title="Operating history">{list<TimelineEvent>(d.timeline).length ? <ol className="space-y-2">{list<TimelineEvent>(d.timeline).map((event, index) => <li key={index} className="border-l-2 border-slate-200 pl-3 text-sm">
          <p className="font-semibold">{event.href ? <Link href={event.href} className="underline">{event.label}</Link> : event.label}</p><p className="text-xs text-slate-500">{readable(event.kind)} · {readable(event.at)}</p></li>)}</ol>
          : <p className="text-sm text-slate-600">No recorded events.</p>}<p className="text-xs text-slate-600">{String(d.status_history_note ?? "")} Showing the latest 60 events.</p></Section>
      </>;
    })() : null}

    {view === "thresholds" ? <>
      <Section title="Threshold"><Facts entries={[["Counts", THRESHOLD_BASES[d.basis as keyof typeof THRESHOLD_BASES]], ["Restarts after", SERVICE_EVENTS[d.service_event as keyof typeof SERVICE_EVENTS]], ["Warn at", d.warn_at],
        ["Dies", d.die_type ? readable(d.die_type) : "All dies"], ["Rationale", d.rationale], ["Proposed by", d.proposed_by], ["Approved by", d.approved_by], ["Dies due now", d.dies_due]]} />
        <p className="text-xs text-slate-600">A threshold warns planners; it never blocks production. A second person approves each proposal.</p></Section>
      {row.status === "proposed" && d.proposed_by_id !== context.userId ? action("threshold.approve", { id: row.id }, true) : null}
      {row.status === "proposed" && d.proposed_by_id === context.userId ? <p className="rounded-xl bg-slate-50 p-3 text-sm">You proposed this threshold. Another authorized person approves it.</p> : null}
      {row.status !== "retired" ? action("threshold.retire", { id: row.id }) : null}
    </> : null}
  </div>;
}
