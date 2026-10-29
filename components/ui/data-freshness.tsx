import { Clock3, Database, RefreshCw } from "lucide-react";
import { describeDataFreshness, formatFreshnessTimestamp, freshnessStatusLabel } from "@/lib/workflow/data-freshness";

export function DataFreshnessSummary({ refreshedAt, refreshing = false, onRefresh }: { refreshedAt: string | null; refreshing?: boolean; onRefresh?: () => void }) {
  return <div className="flex flex-col items-start justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 sm:flex-row sm:items-center">
    <span className="inline-flex min-w-0 items-start gap-1.5 sm:flex-1" aria-live="polite"><RefreshCw className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${refreshing ? "animate-spin" : ""}`} />
      <span className="min-w-0 leading-5">{refreshedAt ? <>Page data fetched <time dateTime={refreshedAt}>{formatFreshnessTimestamp(refreshedAt)}</time>. Record dates below describe when each row was recorded or changed.</> : "Page data has not loaded successfully for this view."}</span>
    </span>
    {onRefresh ? <button type="button" onClick={onRefresh} disabled={refreshing} className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 font-semibold text-neutral-700 hover:bg-neutral-100 disabled:cursor-wait disabled:opacity-60">{refreshing ? "Refreshing..." : "Refresh page"}</button> : null}
  </div>;
}

export function DataFreshness({ row, fetchedAt }: { row: Record<string, unknown>; fetchedAt: string | null }) {
  const freshness = describeDataFreshness(row);
  const record = freshness.recordTime;
  return <details className="group relative min-w-0 max-w-full" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange">
      <Clock3 className="h-3.5 w-3.5" /> Data age <span className="sr-only">and source details</span>
    </summary>
    <div className="mt-2 w-72 max-w-full space-y-2 whitespace-normal rounded-xl border border-neutral-200 bg-white p-3 text-left text-xs font-normal text-neutral-700 shadow-sm [overflow-wrap:anywhere]">
      <p className="flex items-start gap-2"><RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0"><strong>Page fetched:</strong> {fetchedAt ? formatFreshnessTimestamp(fetchedAt) : "No successful fetch for this view"}</span></p>
      <p className="flex items-start gap-2"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0"><strong>{record.label}:</strong> {formatFreshnessTimestamp(record.value)} ({freshnessStatusLabel(record.status)}). A page refresh does not change this record timestamp.</span></p>
      <p><strong>Record updated:</strong> {formatFreshnessTimestamp(freshness.updated.value)}</p>
      <p><strong>Record created:</strong> {formatFreshnessTimestamp(freshness.created.value)}</p>
      <p><strong>Physical observation:</strong> {freshness.observation.value ? `${formatFreshnessTimestamp(freshness.observation.value)} (${freshnessStatusLabel(freshness.observation.status)})` : "Not recorded in this data source"}</p>
      <p><strong>Data verification:</strong> {freshness.verification.value ? `${formatFreshnessTimestamp(freshness.verification.value)} (${freshnessStatusLabel(freshness.verification.status)})` : "Not recorded in this data source"}</p>
      <p><strong>Source:</strong> {freshness.source ?? "Not recorded in this data source"}</p>
    </div>
  </details>;
}
