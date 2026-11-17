// AP-067: combine the cut lengths of several orders that run on the same die into one push pattern.
// One-dimensional cutting: every push gives one extruded length (the usable length after butt and crops, within the
// run-out table). Planned separately, each job fills its pushes with its own cut length and the remainder of every push is
// scrap. Combined, a push may carry cuts of several jobs. Order quantities and cut lengths are never changed: each job
// gets exactly its pieces, and every cut names the job it belongs to.

export const ALUMINIUM_DENSITY_KG_M3 = 2700;

export type CutDemand = { job_id: string; length_m: number; pieces: number };
export type CutPatternCut = { job_id: string; length_m: number; pieces: number };
export type CutPattern = { pushes: number; cuts: CutPatternCut[]; used_m: number; waste_m: number };
export type CutPlan = { pushes: number; cut_m: number; recovery_percent: number; patterns: CutPattern[] };
export type CutComparison =
  | { ok: true; usable_m: number; kerf_mm: number; separate: CutPlan; combined: CutPlan; saved_pushes: number; gain_percent: number; improves: boolean }
  | { ok: false; error: string };

const round = (value: number, digits = 3) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;
const MM = 1000;

/** How many pieces of one length fit in a push: every piece costs its length plus one saw kerf, except the last cut. */
export function piecesPerPush(usableM: number, lengthM: number, kerfMm: number): number {
  if (!(usableM > 0) || !(lengthM > 0)) return 0;
  return Math.max(0, Math.floor((usableM * MM + kerfMm + 1e-6) / (lengthM * MM + kerfMm)));
}

/**
 * Usable extruded length of one push (metres): billet metal past the butt, at the section's kg/m, less the front and back
 * crops, and never longer than the run-out table. Null when an input is missing (blank stays blank).
 */
export function usableLengthPerPush(input: { billet_mm: number | null; billet_diameter_mm: number | null; butt_mm: number | null; kg_per_m: number | null; runout_m: number | null;
  front_crop_m?: number | null; back_crop_m?: number | null; density_kg_m3?: number | null }): number | null {
  const { billet_mm, billet_diameter_mm, butt_mm, kg_per_m, runout_m } = input;
  if (!(Number(billet_mm) > 0) || !(Number(billet_diameter_mm) > 0) || !(Number(kg_per_m) > 0) || !(Number(runout_m) > 0) || butt_mm === null || butt_mm === undefined) return null;
  const area = Math.PI * (Number(billet_diameter_mm) / 2000) ** 2;
  const metalKg = area * ((Number(billet_mm) - Number(butt_mm)) / MM) * (input.density_kg_m3 ?? ALUMINIUM_DENSITY_KG_M3);
  if (!(metalKg > 0)) return null;
  const extruded = Math.min(metalKg / Number(kg_per_m), Number(runout_m));
  const usable = extruded - (input.front_crop_m ?? 0) - (input.back_crop_m ?? 0);
  return usable > 0 ? round(usable) : null;
}

function validate(demands: CutDemand[], usableM: number, kerfMm: number): string | null {
  if (!(usableM > 0)) return "The usable length per push is not known";
  if (!(kerfMm >= 0) || kerfMm > 50) return "The saw kerf must be between 0 and 50 mm";
  if (demands.length < 1) return "Choose the jobs to combine";
  const seen = new Set<string>();
  for (const d of demands) {
    if (seen.has(d.job_id)) return "A job is listed twice";
    seen.add(d.job_id);
    if (!(d.length_m > 0) || !Number.isInteger(d.pieces) || d.pieces < 1) return "Every job needs a cut length and whole pieces";
    if (d.length_m > usableM + 1e-9) return `A cut length of ${d.length_m} m is longer than one push (${usableM} m)`;
  }
  return null;
}

function plan(patterns: CutPattern[], usableM: number): CutPlan {
  const pushes = patterns.reduce((sum, p) => sum + p.pushes, 0);
  const cutM = patterns.reduce((sum, p) => sum + p.pushes * p.cuts.reduce((s, c) => s + c.pieces * c.length_m, 0), 0);
  return { pushes, cut_m: round(cutM), recovery_percent: pushes ? round((cutM / (pushes * usableM)) * 100, 2) : 0, patterns };
}

function pattern(cuts: CutPatternCut[], pushes: number, usableM: number, kerfMm: number): CutPattern {
  const pieces = cuts.reduce((sum, c) => sum + c.pieces, 0);
  const used = cuts.reduce((sum, c) => sum + c.pieces * c.length_m, 0) + (Math.max(pieces - 1, 0) * kerfMm) / MM;
  return { pushes, cuts, used_m: round(used), waste_m: round(Math.max(usableM - used, 0)) };
}

/** Each job on its own pushes: full pushes of its cut length, then one last push for the remainder. */
export function separatePlan(demands: CutDemand[], usableM: number, kerfMm: number): CutPlan {
  const patterns: CutPattern[] = [];
  for (const d of demands) {
    const per = piecesPerPush(usableM, d.length_m, kerfMm);
    if (per < 1) continue;
    const full = Math.floor(d.pieces / per), rest = d.pieces - full * per;
    if (full) patterns.push(pattern([{ job_id: d.job_id, length_m: d.length_m, pieces: per }], full, usableM, kerfMm));
    if (rest) patterns.push(pattern([{ job_id: d.job_id, length_m: d.length_m, pieces: rest }], 1, usableM, kerfMm));
  }
  return plan(patterns, usableM);
}

/**
 * The fullest single push from what is still needed: a bounded search over how many pieces of each job go in, longest
 * cuts first, keeping the fill with the least waste. The search is capped; the cap only affects how good the fill is,
 * never whether the plan is valid.
 */
function fullestPush(remaining: { job_id: string; length_mm: number; left: number }[], capacityMm: number, kerfMm: number): number[] {
  const order = remaining.map((r, index) => ({ ...r, index })).filter(r => r.left > 0).sort((a, b) => b.length_mm - a.length_mm);
  let best: number[] = new Array(remaining.length).fill(0), bestUsed = -1, steps = 0;
  const counts = new Array(remaining.length).fill(0);
  const search = (position: number, room: number, used: number) => {
    if (++steps > 150000) return;
    if (used > bestUsed) { bestUsed = used; best = counts.slice(); }
    if (position >= order.length || bestUsed >= capacityMm - 0.5) return;
    const item = order[position];
    const max = Math.min(item.left, Math.floor((room + 1e-6) / (item.length_mm + kerfMm)));
    for (let n = max; n >= 0; n--) {
      counts[item.index] = n;
      search(position + 1, room - n * (item.length_mm + kerfMm), used + n * item.length_mm);
      if (steps > 150000) break;
    }
    counts[item.index] = 0;
  };
  // One kerf of head-room: the last cut of a push needs no kerf after it.
  search(0, capacityMm + kerfMm, 0);
  return best;
}

/** Pushes that mix jobs: repeatedly take the fullest push from what is still needed and run it as often as it stays valid. */
export function combinedPlan(demands: CutDemand[], usableM: number, kerfMm: number): CutPlan {
  const remaining = demands.map(d => ({ job_id: d.job_id, length_mm: d.length_m * MM, length_m: d.length_m, left: d.pieces }));
  const patterns: CutPattern[] = [];
  for (let guard = 0; guard < 5000 && remaining.some(r => r.left > 0); guard++) {
    const counts = fullestPush(remaining, usableM * MM, kerfMm);
    if (!counts.some(n => n > 0)) break;
    let repeat = Infinity;
    counts.forEach((n, index) => { if (n > 0) repeat = Math.min(repeat, Math.floor(remaining[index].left / n)); });
    repeat = Math.max(1, Number.isFinite(repeat) ? repeat : 1);
    const cuts = counts.map((n, index) => ({ job_id: remaining[index].job_id, length_m: remaining[index].length_m, pieces: n })).filter(c => c.pieces > 0);
    patterns.push(pattern(cuts, repeat, usableM, kerfMm));
    counts.forEach((n, index) => { remaining[index].left -= n * repeat; });
  }
  return plan(patterns, usableM);
}

/** Pieces each job receives from a plan (for the check that no order quantity changed). */
export function piecesByJob(planned: CutPlan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of planned.patterns) for (const c of p.cuts) out[c.job_id] = (out[c.job_id] ?? 0) + p.pushes * c.pieces;
  return out;
}

/**
 * Separate against combined for the same jobs on the same press. The combined plan is offered only when it gives every
 * job exactly its pieces and needs no more pushes than planning the jobs one by one; otherwise the separate plan stands.
 */
export function compareCutPlans(demands: CutDemand[], usableM: number, kerfMm: number): CutComparison {
  const problem = validate(demands, usableM, kerfMm);
  if (problem) return { ok: false, error: problem };
  const separate = separatePlan(demands, usableM, kerfMm);
  let combined = combinedPlan(demands, usableM, kerfMm);
  const made = piecesByJob(combined);
  const exact = demands.every(d => made[d.job_id] === d.pieces);
  if (!exact || combined.pushes > separate.pushes) combined = separate;
  const saved = separate.pushes - combined.pushes;
  return { ok: true, usable_m: usableM, kerf_mm: kerfMm, separate, combined, saved_pushes: saved,
    gain_percent: round(combined.recovery_percent - separate.recovery_percent, 2), improves: saved > 0 };
}
