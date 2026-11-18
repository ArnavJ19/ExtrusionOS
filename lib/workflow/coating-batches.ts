// AP-055: batch powder coating by shade. Material waiting for coating is grouped by shade and powder brand so the line
// changes colour as few times as possible; groups run in order of their earliest promised date. The plan shows which
// promised dates the batching would miss before anyone confirms it. Pure functions: the queue comes from the database
// (public.ap_coating "queue") and the confirmed order goes back through lib/actions/autopilot-batch10.

export type CoatingJob = {
  id: string; order_number: string | null; customer: string | null; shade_key: string | null; shade: string | null; brand: string | null;
  kg: number | null; due: string | null; priority: string | null; job_number?: string | null; status?: string | null;
};
export type CoatingSettings = { capacity_kg_per_hour: number; changeover_minutes: number; day_start: string; hours_per_day: number };
export type CoatingGroup = {
  key: string; shade_key: string | null; shade: string | null; brand: string | null; job_ids: string[]; jobs: CoatingJob[]; kg: number | null; unweighed_jobs: number;
  earliest_due: string | null; start_day: string | null; finish_day: string | null; hours: number | null;
};
export type CoatingBreach = { job_id: string; order_number: string | null; customer: string | null; due: string; finish_day: string; days_late: number; shade: string | null };
export type CoatingPlan = {
  run_day: string; groups: CoatingGroup[]; shade_changes: number; baseline_changes: number; saved_changes: number; breaches: CoatingBreach[];
  total_kg: number; unweighed_jobs: number; timed: boolean; notes: string[];
};

const PRIORITY: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const rank = (priority: string | null) => PRIORITY[priority ?? "normal"] ?? 2;
const byDue = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

/** Jobs of one shade and powder brand run together. A job whose shade is not recorded is a run of its own. */
export function coatingGroupKey(job: Pick<CoatingJob, "id" | "shade_key" | "brand">): string {
  return job.shade_key ? `${job.shade_key}|${(job.brand ?? "").trim().toUpperCase()}` : `?|${job.id}`;
}

/** Shade changes when the jobs run one after another in the given order. */
export function countShadeChanges(keys: string[]): number {
  let changes = 0;
  for (let index = 1; index < keys.length; index++) if (keys[index] !== keys[index - 1]) changes++;
  return changes;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * Groups the queue and sequences the groups. `order` is the supervisor's own order of group keys (groups it leaves out
 * follow in the default order); without it groups run by earliest promised date, then order priority, then shade.
 * `workingDays` are the factory's working days from the run day onwards (lib/calendar via the gateway); with settings
 * and working days each group gets a finish day and late jobs are listed, otherwise the plan is untimed and says so.
 */
export function planCoatingRuns(jobs: CoatingJob[], options: { runDay: string; settings: CoatingSettings | null; workingDays: string[]; order?: string[] }): CoatingPlan {
  const { runDay, settings } = options;
  const notes: string[] = [];
  const map = new Map<string, CoatingGroup>();
  for (const job of jobs) {
    const key = coatingGroupKey(job);
    let group = map.get(key);
    if (!group) {
      group = { key, shade_key: job.shade_key, shade: job.shade, brand: job.brand, job_ids: [], jobs: [], kg: 0, unweighed_jobs: 0, earliest_due: null, start_day: null, finish_day: null, hours: null };
      map.set(key, group);
    }
    group.job_ids.push(job.id); group.jobs.push(job);
    if (job.kg === null || !(job.kg > 0)) group.unweighed_jobs++; else group.kg = (group.kg ?? 0) + job.kg;
    if (job.due && (group.earliest_due === null || job.due < group.earliest_due)) group.earliest_due = job.due;
  }
  for (const group of map.values()) {
    group.jobs.sort((a, b) => byDue(a.due, b.due) || rank(a.priority) - rank(b.priority) || (a.order_number ?? "").localeCompare(b.order_number ?? "") || a.id.localeCompare(b.id));
    group.job_ids = group.jobs.map(job => job.id);
    // A group where no job has a weight has no known weight; a partly weighed group keeps the weighed total and says how many are missing.
    if (group.unweighed_jobs === group.jobs.length) group.kg = null;
  }
  const natural = [...map.values()].sort((a, b) => byDue(a.earliest_due, b.earliest_due)
    || Math.min(...a.jobs.map(j => rank(j.priority))) - Math.min(...b.jobs.map(j => rank(j.priority))) || a.key.localeCompare(b.key));
  let groups = natural;
  if (options.order?.length) {
    const chosen = options.order.map(key => map.get(key)).filter((group): group is CoatingGroup => Boolean(group));
    const used = new Set(chosen.map(group => group.key));
    groups = [...new Map(chosen.map(group => [group.key, group])).values(), ...natural.filter(group => !used.has(group.key))];
  }

  // Baseline: the same jobs one by one in promised-date order, as the line runs without batching.
  const oneByOne = [...jobs].sort((a, b) => byDue(a.due, b.due) || rank(a.priority) - rank(b.priority) || (a.order_number ?? "").localeCompare(b.order_number ?? "") || a.id.localeCompare(b.id));
  const baseline = countShadeChanges(oneByOne.map(coatingGroupKey));
  const changes = Math.max(groups.length - 1, 0);

  const days = options.workingDays.filter(day => day >= runDay).sort();
  const timed = Boolean(settings && settings.capacity_kg_per_hour > 0 && settings.hours_per_day > 0 && days.length);
  const breaches: CoatingBreach[] = [];
  if (!settings) notes.push("Line capacity is not set, so finish days and late jobs cannot be shown. Set the coating line's capacity first.");
  else if (!days.length) notes.push("No working day is available from the run day in the factory calendar.");
  if (timed && settings) {
    let dayIndex = 0, usedHours = 0;
    const advance = (hours: number): string | null => {
      let left = hours;
      while (left > 1e-9) {
        if (dayIndex >= days.length) return null;
        const room = settings.hours_per_day - usedHours;
        if (left <= room + 1e-9) { usedHours += left; left = 0; }
        else { left -= room; dayIndex++; usedHours = 0; }
      }
      return days[Math.min(dayIndex, days.length - 1)] ?? null;
    };
    groups.forEach((group, index) => {
      if (index > 0 && advance(settings.changeover_minutes / 60) === null) { group.start_day = null; group.finish_day = null; return; }
      // A group that starts exactly at the end of a day starts on the next working day.
      if (usedHours >= settings.hours_per_day - 1e-9 && dayIndex < days.length - 1) { dayIndex++; usedHours = 0; }
      group.start_day = days[dayIndex] ?? null;
      group.hours = group.kg === null ? null : Math.round(((group.kg ?? 0) / settings.capacity_kg_per_hour) * 100) / 100;
      group.finish_day = advance(group.hours ?? 0);
      if (!group.finish_day) return;
      for (const job of group.jobs) {
        if (job.due && group.finish_day > job.due) {
          breaches.push({ job_id: job.id, order_number: job.order_number, customer: job.customer, due: job.due, finish_day: group.finish_day, days_late: daysBetween(job.due, group.finish_day), shade: group.shade });
        }
      }
    });
    if (groups.some(group => group.finish_day === null)) notes.push("The queue runs past the three weeks of working days that were checked; later runs have no finish day.");
  }
  const unweighed = groups.reduce((sum, group) => sum + group.unweighed_jobs, 0);
  if (unweighed) notes.push(`${unweighed} job(s) have no input weight; their coating time is not counted, so finish days may be later than shown.`);
  if (groups.some(group => !group.shade_key)) notes.push("Jobs without a recorded shade are run on their own; record the shade to batch them.");
  return { run_day: runDay, groups, shade_changes: changes, baseline_changes: baseline, saved_changes: baseline - changes, breaches,
    total_kg: Math.round(groups.reduce((sum, group) => sum + (group.kg ?? 0), 0) * 1000) / 1000, unweighed_jobs: unweighed, timed, notes };
}
