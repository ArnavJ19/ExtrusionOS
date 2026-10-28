// UPGRADE_EOS feature 6: connected order workspace. Per-line production progress uses the same
// kilogram basis as private.guard_production_order_balance; dispatch progress uses verified
// packing history, which is recorded per order rather than per order line.
import { roundWeight } from "../calculations/pcda/rounding.ts";

export type ProgressOrderLine = { id: string; label: string; quantity_kg?: unknown; quantity_pieces?: unknown; total_meters?: unknown };
export type ProgressJob = { id: string; job_number?: string | null; status: string; source_line_id?: string | null; planned_quantity_kg?: unknown; actual_quantity_kg?: unknown };
export type ProgressFulfillment = { order_item_id?: string | null; fulfilled_weight_kg?: unknown; credited_at?: string | null };

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export type LineProgress = {
  id: string;
  label: string;
  orderedKg: number | null;
  fromStockKg: number;
  openPlannedKg: number;
  producedKg: number;
  remainingToPlanKg: number | null;
  overCommitted: boolean;
  jobs: { id: string; jobNumber: string; status: string; kg: number | null }[];
};

export function buildOrderProgress(input: {
  lines: ProgressOrderLine[];
  jobs: ProgressJob[];
  fulfillments: ProgressFulfillment[];
  orderLevelTargetKg?: unknown;
}) {
  const singleLine = input.lines.length === 1;
  const lineIds = new Set(input.lines.map((line) => line.id));
  const liveJobs = input.jobs.filter((job) => job.status !== "cancelled");
  const activeFulfillments = input.fulfillments.filter((row) => !row.credited_at);
  const lines: LineProgress[] = input.lines.map((line) => {
    // As in the database guard, a single-line order may fall back to the order-level production quantity.
    const orderedKg = amount(line.quantity_kg) ?? (singleLine ? amount(input.orderLevelTargetKg) : null);
    const lineJobs = liveJobs.filter((job) => job.source_line_id === line.id);
    let openPlannedKg = 0;
    let producedKg = 0;
    const jobs = lineJobs.map((job) => {
      const actual = amount(job.actual_quantity_kg);
      const planned = amount(job.planned_quantity_kg);
      const completed = job.status === "completed" && actual !== null && actual > 0;
      if (completed) producedKg += actual;
      else openPlannedKg += planned ?? 0;
      return { id: job.id, jobNumber: job.job_number || "Production job", status: job.status, kg: completed ? actual : planned };
    });
    const fromStockKg = activeFulfillments.filter((row) => row.order_item_id === line.id).reduce((sum, row) => sum + (amount(row.fulfilled_weight_kg) ?? 0), 0);
    const remaining = orderedKg === null ? null : roundWeight(orderedKg - fromStockKg - openPlannedKg - producedKg);
    return {
      id: line.id,
      label: line.label,
      orderedKg: orderedKg === null ? null : roundWeight(orderedKg),
      fromStockKg: roundWeight(fromStockKg),
      openPlannedKg: roundWeight(openPlannedKg),
      producedKg: roundWeight(producedKg),
      remainingToPlanKg: remaining === null ? null : Math.max(remaining, 0),
      overCommitted: remaining !== null && remaining < -0.001,
      jobs
    };
  });
  const unlinkedJobs = liveJobs
    .filter((job) => !job.source_line_id || !lineIds.has(job.source_line_id))
    .map((job) => ({ id: job.id, jobNumber: job.job_number || "Production job", status: job.status }));
  return { lines, unlinkedJobs };
}

/** Order-level dispatch balance in pieces and metres. Missing ordered quantities are not treated as zero. */
export function buildDispatchProgress(lines: ProgressOrderLine[], shipped: { pieces: number; lengthM: number; weightKg: number } | null) {
  if (!shipped) return { status: "unavailable" as const };
  let pieces = 0;
  let milliMetres = 0;
  for (const line of lines) {
    const linePieces = amount(line.quantity_pieces);
    const lineMetres = amount(line.total_meters);
    if (linePieces === null || lineMetres === null || !Number.isSafeInteger(linePieces)) return { status: "ordered_incomplete" as const, shipped };
    pieces += linePieces;
    milliMetres += Math.round(lineMetres * 1000);
  }
  const shippedMilliMetres = Math.round(shipped.lengthM * 1000);
  return {
    status: "ok" as const,
    shipped,
    ordered: { pieces, metres: milliMetres / 1000 },
    remaining: { pieces: pieces - shipped.pieces, metres: (milliMetres - shippedMilliMetres) / 1000 }
  };
}
