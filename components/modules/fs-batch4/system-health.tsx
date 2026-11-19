"use client";

// FS-07: system health for the owner and admin. The last run of every scheduled job with failures in the past day, the
// week's five most frequent application errors, and the latest errors ten at a time. Error text is stored without
// personal data or amounts.
import { useState } from "react";
import { Empty, Failure, Loading, Pager, Pill, Section, useB4Read, when } from "./shared";

type Health = {
  jobs: { job_key: string; status: string; started_at: string; finished_at: string | null; error: string | null; failures_24h: number; last_success: string | null }[];
  top_errors: { fingerprint: string; message: string; route: string; source: string; count: number; last_seen: string }[];
  errors_7d: number;
  recent: { occurred_at: string; source: string; route: string; role: string | null; name: string | null; message: string; digest: string | null }[];
  recent_total: number; page: number;
};

export function SystemHealth() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useB4Read<Health>("fs_monitoring", "health", { page }, [page]);
  if (loading && !data) return <Loading what="system health" />;
  if (error) return <Failure text={error} />;
  if (!data) return null;
  const failing = data.jobs.filter(j => j.status === "failed");
  return <div className="space-y-5">
    <Section title="Scheduled jobs" description="The latest run of every job. A failed run alerts the owner and admin until the next successful run."
      actions={<button type="button" onClick={() => void reload()} className="min-h-11 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold">Refresh</button>}>
      {failing.length ? <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{failing.length} job(s) failed on their last run.</p> : null}
      {data.jobs.length === 0 ? <Empty>No scheduled job has run yet.</Empty> : <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="industrial-table min-w-[680px]">
          <thead><tr><th>Job</th><th>Last run</th><th>Status</th><th className="text-right">Failures (24 h)</th><th>Last success</th></tr></thead>
          <tbody>{data.jobs.map(j => <tr key={j.job_key}>
            <td className="font-semibold">{j.job_key}</td><td>{when(j.started_at)}</td>
            <td><Pill value={j.status === "succeeded" ? "passed" : j.status === "failed" ? "rejected" : "open"} label={j.status} />{j.error ? <p className="mt-1 text-xs text-rose-800">{j.error}</p> : null}</td>
            <td className="text-right tabular-nums">{j.failures_24h}</td><td>{when(j.last_success)}</td>
          </tr>)}</tbody>
        </table></div>}
    </Section>

    <Section title="Most frequent errors this week" description={`${data.errors_7d} error(s) in the last seven days. Review the top five weekly.`}>
      {data.top_errors.length === 0 ? <Empty>No application errors in the last seven days.</Empty> : <ol className="space-y-2">
        {data.top_errors.map(e => <li key={e.fingerprint} className="rounded-xl border border-neutral-200 p-3 text-sm">
          <p className="font-bold break-words">{e.message}</p>
          <p className="text-xs text-neutral-600">{e.count} time(s) · {e.source} · {e.route} · last {when(e.last_seen)}</p>
        </li>)}
      </ol>}
    </Section>

    <Section title="Latest errors" description="Route, role and message only: no personal data, prices or record contents.">
      {data.recent.length === 0 ? <Empty>No errors recorded.</Empty> : <ul className="divide-y divide-neutral-200 text-sm">
        {data.recent.map((e, n) => <li key={`${e.occurred_at}-${n}`} className="py-2">
          <p className="break-words"><span className="font-semibold">{e.name ?? "Error"}</span>: {e.message}</p>
          <p className="text-xs text-neutral-600">{when(e.occurred_at)} · {e.source} · {e.route}{e.role ? ` · ${e.role.replaceAll("_", " ")}` : ""}{e.digest ? ` · ref ${e.digest}` : ""}</p>
        </li>)}
      </ul>}
      <Pager page={data.page} total={data.recent_total} onPage={setPage} />
    </Section>
  </div>;
}
