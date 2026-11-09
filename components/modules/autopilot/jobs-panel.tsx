"use client";

// AP-001: scheduled job health and the ledger of runs. "Run now" performs a real run of the registered job (recorded
// as a manual run); a repeated tap in the same minute is recognised as the same run.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { JOB_SCHEDULES, jobRunsSchema, jobsOverviewSchema, windowLabel, type JobRuns, type JobsOverview } from "@/lib/jobs/registry";

const when = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "Never";

export function JobsPanel({ initial, initialError }: { initial: JobsOverview | null; initialError: string | null }) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);
  const [error, setError] = useState(initialError);
  const [runs, setRuns] = useState<JobRuns | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"" | "failed">("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsError(null);
    const result = await autopilotAction("ap_jobs", "runs", { page, ...(filter ? { status: filter } : {}) });
    const parsed = result.success ? jobRunsSchema.safeParse(result.data) : null;
    if (!parsed?.success) { setRunsError(result.success ? "The run ledger could not be read." : result.error); return; }
    setRuns(parsed.data);
  }, [page, filter]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  async function runNow(jobKey: string, label: string) {
    setBusy(jobKey); setMessage(null);
    const result = await autopilotAction("ap_jobs", "run_now", { job_key: jobKey });
    setBusy(null);
    if (!result.success) { setMessage(result.error); return; }
    const data = result.data as { state: string; error?: string; result?: { examined: number; proposals: number; alerts: number } };
    setMessage(data.state === "already_ran" ? `${label} already ran this minute; showing that run.`
      : data.state === "failed" ? `${label} failed: ${data.error ?? "see the ledger"}.`
      : `${label} ran: ${data.result?.examined ?? 0} checked, ${data.result?.proposals ?? 0} proposal(s), ${data.result?.alerts ?? 0} alert(s).`);
    const fresh = await autopilotAction("ap_jobs", "overview", {});
    const parsed = fresh.success ? jobsOverviewSchema.safeParse(fresh.data) : null;
    if (parsed?.success) { setOverview(parsed.data); setError(null); }
    await loadRuns(); router.refresh();
  }

  const pages = Math.max(1, Math.ceil((runs?.total_count ?? 0) / 10));
  return <section className="min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5" aria-labelledby="scheduled-jobs">
    <div><h2 id="scheduled-jobs" className="text-lg font-bold">Scheduled jobs</h2>
      <p className="text-sm text-neutral-600">These run on their own through Vercel Cron and only prepare proposals and alerts. Each run is recorded once per window; three failed windows in a row alert the owner.</p></div>
    {message ? <p role="status" className="rounded-xl bg-neutral-50 p-3 text-sm font-semibold">{message}</p> : null}
    {error ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">{error}</p> : <ul className="grid gap-3 lg:grid-cols-2">
      {(overview?.jobs ?? []).map(job => <li key={job.job_key} className="min-w-0 rounded-xl border border-neutral-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><p className="font-bold">{job.label}</p><p className="text-xs text-neutral-600">{JOB_SCHEDULES[job.schedule].label} · {job.job_key}</p></div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${!job.last ? "bg-neutral-100 text-neutral-700" : job.last.status === "failed" ? "bg-rose-50 text-rose-800" : job.last.status === "running" ? "bg-sky-50 text-sky-800" : "bg-emerald-50 text-emerald-800"}`}>
            {!job.last ? "Not run yet" : job.last.status === "failed" ? `Failed${job.failed_streak > 1 ? ` ${job.failed_streak} times in a row` : ""}` : job.last.status === "running" ? "Running" : "Healthy"}</span>
        </div>
        <p className="mt-2 text-sm text-neutral-700">{job.description}</p>
        <p className="mt-2 text-xs text-neutral-600">Last success: {when(job.last_success_at)}{job.last ? ` · last run ${when(job.last.started_at)} (${job.last.trigger_source === "manual" ? "run by a person" : "scheduled"})` : ""}</p>
        {job.last?.error_message ? <p className="mt-1 text-xs font-semibold text-rose-800 [overflow-wrap:anywhere]">{job.last.error_message}</p> : null}
        <button type="button" disabled={busy !== null} onClick={() => runNow(job.job_key, job.label)} className="mt-3 min-h-11 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold disabled:opacity-50">{busy === job.job_key ? "Running…" : "Run now (real run)"}</button>
      </li>)}
    </ul>}
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Run ledger</h3>
        <label className="text-sm font-semibold">Show <select className="ml-1 h-10 rounded-lg border border-neutral-300 bg-white px-2" value={filter} onChange={event => { setFilter(event.target.value as "" | "failed"); setPage(1); }}>
          <option value="">All runs</option><option value="failed">Failed runs</option></select></label></div>
      {runsError ? <p role="alert" className="text-sm font-semibold text-amber-900">{runsError}</p> : !runs ? <p className="text-sm text-neutral-500">Loading runs…</p>
        : !runs.rows.length ? <p className="text-sm text-neutral-600">No runs recorded yet.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-neutral-500"><th className="py-2 pr-3">Job</th><th className="pr-3">Window</th><th className="pr-3">Result</th><th className="pr-3">Checked</th><th className="pr-3">Proposals</th><th>Started</th></tr></thead>
          <tbody>{runs.rows.map(run => <tr key={run.id} className="border-b align-top"><td className="py-2 pr-3 font-semibold">{run.job_key}</td><td className="pr-3">{windowLabel(run.window_key)}{run.requested_by ? ` · ${run.requested_by}` : ""}</td>
            <td className="pr-3">{run.status}{run.error_message ? <span className="block text-xs text-rose-800 [overflow-wrap:anywhere]">{run.error_message}</span> : null}</td><td className="pr-3">{run.examined}</td><td className="pr-3">{run.proposals_created}</td><td>{when(run.started_at)}</td></tr>)}</tbody></table></div>}
      {pages > 1 ? <div className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></div> : null}
    </div>
  </section>;
}
