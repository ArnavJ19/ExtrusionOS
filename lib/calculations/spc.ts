// AP-052: control-chart rules for one characteristic. The database (private.ap8_spc_chart) is authoritative for alarms;
// this mirror draws the chart and is compared with the database in tests. Limits come only from the approved plan.

export type SpcLimits = { nominal: number | null; lower: number | null; upper: number | null };
export type SpcRule = "outside_limits" | "run_of_seven";

/** Centre line: the plan's nominal, else the middle of its limits, else the one limit there is. */
export function spcCenter(limits: SpcLimits): number | null {
  if (limits.nominal !== null) return limits.nominal;
  if (limits.lower !== null && limits.upper !== null) return (limits.lower + limits.upper) / 2;
  return limits.lower ?? limits.upper;
}

export function outsideLimits(value: number, limits: SpcLimits) {
  return (limits.lower !== null && value < limits.lower) || (limits.upper !== null && value > limits.upper);
}

/** Readings in time order (oldest first). Uses the last 50, as the chart shows. */
export function evaluateSpc(values: number[], limits: SpcLimits) {
  const points = values.filter(Number.isFinite).slice(-50);
  const center = spcCenter(limits);
  const rules: SpcRule[] = [];
  const last = points.at(-1);
  if (last !== undefined && outsideLimits(last, limits)) rules.push("outside_limits");
  if (center !== null && points.length >= 7) {
    const run = points.slice(-7);
    if (run.every(v => v > center) || run.every(v => v < center)) rules.push("run_of_seven");
  }
  const n = points.length;
  const mean = n ? points.reduce((a, b) => a + b, 0) / n : null;
  const sigma = n >= 2 && mean !== null ? Math.sqrt(points.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const cpk = mean !== null && sigma && limits.lower !== null && limits.upper !== null ? Math.min(limits.upper - mean, mean - limits.lower) / (3 * sigma) : null;
  return { center, rules, mean, sigma, cpk, count: n };
}

/** Y range for drawing: the limits and every point, with a margin. */
export function spcScale(values: number[], limits: SpcLimits) {
  const all = [...values, limits.lower, limits.upper, limits.nominal].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!all.length) return { min: 0, max: 1 };
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}
