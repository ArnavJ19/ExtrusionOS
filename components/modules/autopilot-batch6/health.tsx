"use client";

import Link from "next/link";
import { PROPOSAL_TYPES, type ProposalType } from "@/lib/proposals/proposals";
import { fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Pill, Section, useApRead } from "../order-to-cash/ui";
import { Action, Stat } from "./shared";

type Job = { job_key: string; schedule: string; label: string; last_status: string | null; last_started_at: string | null; last_error: string | null; last_success_at: string | null; failed_24h: number; state: string };
type Health = { as_of: string; jobs: Job[]; proposals: { proposal_type: string; open: number; under_1_day: number; one_to_3_days: number; over_3_days: number; oldest_at: string }[];
  exports: Record<string, { at: string | null; count_30d?: number } | null>; errors: Record<string, number>; scheduler: { job: string; schedule: string; active: boolean; last_status: string | null; last_start: string | null; last_message: string | null }[] | null;
  backups: { available: boolean; message: string }; summary: { failed_jobs: number; overdue_jobs: number; old_proposals: number } };
const STATE_LABEL: Record<string, string> = { ok: "Running on time", failed: "Last run failed", overdue: "Missed its window", never_run: "Never run", stuck: "Running too long" };
const EXPORTS: [string, string, string][] = [["tally", "Tally vouchers", "/invoices/tally"], ["eway", "E-way bills", "/dispatches/eway"], ["einvoice", "E-invoices", "/invoices/einvoice"], ["irn_import", "IRN import", "/invoices/einvoice"], ["tds_statement", "TDS statement", "/payments/tds"]];

export function SystemHealth() {
  const read = useApRead<Health>("ap_health", "overview", {});
  const v = read.data;
  return <div className="space-y-5">
    <Section title="System health" description="Scheduled jobs, waiting proposals, exports and today's errors. Refreshes when you open it." actions={<Action secondary run={read.reload}>Refresh</Action>}>
      {read.error ? <Failure text={read.error} /> : read.loading && !v ? <Loading what="system health" /> : v ? <>
        <p className="text-xs text-neutral-500">As of {fmtWhen(v.as_of)}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Failed jobs" value={v.summary.failed_jobs} tone={v.summary.failed_jobs ? "bad" : "ok"} />
          <Stat label="Overdue or never run" value={v.summary.overdue_jobs} tone={v.summary.overdue_jobs ? "warn" : "ok"} />
          <Stat label="Proposals waiting over 3 days" value={v.summary.old_proposals} tone={v.summary.old_proposals ? "warn" : "ok"} />
          <Stat label="Errors today" value={(v.errors.failed_job_runs_today ?? 0) + (v.errors.offline_conflicts_today ?? 0)} tone={(v.errors.failed_job_runs_today ?? 0) ? "bad" : undefined} />
        </div>
      </> : null}
    </Section>
    {v ? <>
      <Section title="Scheduled jobs" description="Each job's last run and last success. A failed or missed job shows here within one run window.">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th className="py-2">Job</th><th>Schedule</th><th>State</th><th>Last run</th><th>Last success</th><th>Failures 24 h</th></tr></thead><tbody>
          {v.jobs.map(j => <tr key={j.job_key} className="border-b align-top"><td className="py-2"><span className="font-semibold">{j.label}</span>{j.last_error ? <p className="text-xs text-rose-700">{j.last_error}</p> : null}</td><td>{j.schedule}</td>
            <td><Pill value={j.state === "ok" ? "approved" : j.state === "failed" || j.state === "stuck" ? "rejected" : "pending"} label={STATE_LABEL[j.state] ?? j.state} /></td><td>{fmtWhen(j.last_started_at)}</td><td>{fmtWhen(j.last_success_at)}</td><td>{j.failed_24h}</td></tr>)}
        </tbody></table></div>
        <Link href="/automation" className="inline-flex min-h-11 items-center text-sm font-bold underline">Run a job now or read its runs</Link>
      </Section>
      <Section title="Scheduler" description="Supabase pg_cron runs the hourly, nightly and morning windows.">
        {v.scheduler === null ? <Empty>The scheduler&apos;s own run history is not readable from this database. Job runs above still show each window.</Empty>
          : <ul className="divide-y">{v.scheduler.map(s => <li key={s.job} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="font-semibold">{s.job} ({s.schedule})</span><span>{s.active ? "Active" : "Paused"} · {s.last_status ?? "no run"} · {fmtWhen(s.last_start)}</span></li>)}</ul>}
      </Section>
      <Section title="Waiting proposals by age">
        {!v.proposals.length ? <Empty>No proposal is waiting.</Empty> : <ul className="divide-y">{v.proposals.map(p => <li key={p.proposal_type} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
          <Link className="font-semibold underline" href={PROPOSAL_TYPES[p.proposal_type as ProposalType]?.home ?? "/dashboard"}>{PROPOSAL_TYPES[p.proposal_type as ProposalType]?.label ?? p.proposal_type}</Link>
          <span>{p.open} open · under 1 day {p.under_1_day} · 1–3 days {p.one_to_3_days} · <strong className={p.over_3_days ? "text-amber-800" : ""}>over 3 days {p.over_3_days}</strong></span></li>)}</ul>}
      </Section>
      <Section title="Exports and imports">
        <ul className="divide-y">{EXPORTS.map(([key, label, href]) => <li key={key} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><Link className="font-semibold underline" href={href}>{label}</Link>
          <span>{v.exports[key]?.at ? `Last ${fmtWhen(v.exports[key]!.at)}` : "Never"}{v.exports[key]?.count_30d !== undefined ? ` · ${v.exports[key]!.count_30d} in 30 days` : ""}</span></li>)}</ul>
      </Section>
      <Section title="Backups"><p className="text-sm">{v.backups.message}</p></Section>
      <Section title="Phone entries"><p className="text-sm">{v.errors.offline_conflicts_open ?? 0} queued phone entr{(v.errors.offline_conflicts_open ?? 0) === 1 ? "y was" : "ies were"} refused and wait for the employee to resolve.</p></Section>
    </> : null}
  </div>;
}
