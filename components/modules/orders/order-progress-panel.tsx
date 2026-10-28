import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { buildDispatchProgress, buildOrderProgress } from "@/lib/orders/order-progress";
import { formatMeters, formatWeight } from "@/lib/utils/format";

type Progress = ReturnType<typeof buildOrderProgress>;
type Dispatch = ReturnType<typeof buildDispatchProgress>;

const NOT_CAPTURED = "Not captured";

export function OrderProgressPanel({ progress, dispatch, jobsUnavailable, canOpenJobs }: { progress: Progress | null; dispatch: Dispatch; jobsUnavailable: boolean; canOpenJobs: boolean }) {
  const jobLink = (job: { id: string; jobNumber: string }) => canOpenJobs
    ? <Link className="font-semibold text-slate-900 underline" href={`/production/${job.id}`}>{job.jobNumber}</Link>
    : <span className="font-semibold text-slate-900">{job.jobNumber}</span>;
  return (
    <section aria-labelledby="order-progress-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 id="order-progress-title" className="font-bold tracking-tight text-slate-900">Order Progress</h3>
      <p className="mt-1 text-sm font-medium text-slate-500">
        Production progress is in kg per order line: ordered less dealer stock, open production plans and completed output. Dispatch progress is for the whole order, from packed bundles.
      </p>

      <div className="mt-4 rounded-2xl border border-slate-200 p-4">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Dispatched (whole order)</p>
        {dispatch.status === "unavailable" ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-amber-800">Packed and dispatched quantities could not be verified. Refresh before answering a delivery question.</p>
        ) : (
          <div className="mt-2 grid gap-2 text-sm font-semibold text-slate-700 sm:grid-cols-3">
            <span>Dispatched: <b className="text-slate-950">{dispatch.shipped.pieces.toLocaleString("en-IN")} pcs, {formatMeters(dispatch.shipped.lengthM)}, {formatWeight(dispatch.shipped.weightKg)} net</b></span>
            {dispatch.status === "ok" ? (
              <>
                <span>Ordered: <b className="text-slate-950">{dispatch.ordered.pieces.toLocaleString("en-IN")} pcs, {formatMeters(dispatch.ordered.metres)}</b></span>
                <span>Remaining: <b className={dispatch.remaining.pieces < 0 || dispatch.remaining.metres < 0 ? "text-red-700" : "text-slate-950"}>{dispatch.remaining.pieces.toLocaleString("en-IN")} pcs, {formatMeters(dispatch.remaining.metres)}</b></span>
              </>
            ) : (
              <span className="sm:col-span-2">Ordered pieces or metres are {NOT_CAPTURED.toLowerCase()} on at least one line, so the remaining quantity is not calculated.</span>
            )}
          </div>
        )}
      </div>

      {jobsUnavailable || !progress ? (
        <p role="alert" className="mt-4 text-sm font-semibold text-amber-800">Production jobs for this order could not be loaded completely. Line progress is not shown rather than shown as zero.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="industrial-table min-w-[720px] w-full text-sm">
              <thead>
                <tr><th>Line</th><th className="text-right">Ordered</th><th className="text-right">Dealer stock</th><th className="text-right">Open plans</th><th className="text-right">Produced</th><th className="text-right">Still to plan</th><th>Production jobs</th></tr>
              </thead>
              <tbody>
                {progress.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="font-bold text-slate-900">{line.label}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{line.orderedKg === null ? NOT_CAPTURED : formatWeight(line.orderedKg)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{formatWeight(line.fromStockKg)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{formatWeight(line.openPlannedKg)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{formatWeight(line.producedKg)}</td>
                    <td className={`whitespace-nowrap text-right tabular-nums font-semibold ${line.overCommitted ? "text-red-700" : ""}`}>
                      {line.remainingToPlanKg === null ? NOT_CAPTURED : formatWeight(line.remainingToPlanKg)}
                      {line.overCommitted ? <span className="block text-xs">Committed beyond the ordered kg</span> : null}
                    </td>
                    <td>
                      {line.jobs.length ? (
                        <ul className="space-y-1">
                          {line.jobs.map((job) => <li key={job.id} className="flex flex-wrap items-center gap-2">{jobLink(job)}<Badge value={job.status} />{job.kg === null ? null : <span className="text-xs text-slate-500">{formatWeight(job.kg)}</span>}</li>)}
                        </ul>
                      ) : <span className="text-slate-500">None yet</span>}
                    </td>
                  </tr>
                ))}
                {!progress.lines.length ? <tr><td colSpan={7} className="py-6 text-center font-semibold text-slate-500">This order has no lines.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {progress.unlinkedJobs.length ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-bold">Jobs not linked to an order line (not counted above)</p>
              <ul className="mt-1 flex flex-wrap gap-3">{progress.unlinkedJobs.map((job) => <li key={job.id} className="flex items-center gap-2">{jobLink(job)}<Badge value={job.status} /></li>)}</ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
