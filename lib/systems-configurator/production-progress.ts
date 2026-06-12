export type ProductionProgressJob = {
  id?: string | null;
  job_number?: string | null;
  status?: string | null;
  planned_quantity_kg?: number | string | null;
  actual_quantity_kg?: number | string | null;
  planned_meters?: number | string | null;
  actual_meters?: number | string | null;
};

export type ProductionProgressSummary = {
  jobCount: number;
  plannedKg: number;
  actualKg: number;
  plannedMeters: number;
  actualMeters: number;
  progressPercent: number;
  completedJobs: number;
  activeJobs: number;
  status: "not_started" | "planned" | "in_progress" | "completed" | "blocked";
};

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function summarizeProductionProgress(jobs: ProductionProgressJob[]): ProductionProgressSummary {
  const activeJobs = jobs.filter((job) => !["completed", "cancelled"].includes(job.status ?? "")).length;
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const plannedKg = jobs.reduce((sum, job) => sum + toNumber(job.planned_quantity_kg), 0);
  const actualKg = jobs.reduce((sum, job) => sum + toNumber(job.actual_quantity_kg), 0);
  const plannedMeters = jobs.reduce((sum, job) => sum + toNumber(job.planned_meters), 0);
  const actualMeters = jobs.reduce((sum, job) => sum + toNumber(job.actual_meters), 0);
  const progressPercent = plannedKg > 0 ? Math.min(100, round((actualKg / plannedKg) * 100)) : completedJobs && jobs.length ? 100 : 0;
  const statuses = new Set(jobs.map((job) => job.status ?? "planned"));
  const status = !jobs.length ? "not_started" : statuses.has("on_hold") || statuses.has("cancelled") ? "blocked" : completedJobs === jobs.length ? "completed" : statuses.has("in_progress") || actualKg > 0 ? "in_progress" : "planned";

  return { jobCount: jobs.length, plannedKg: round(plannedKg, 3), actualKg: round(actualKg, 3), plannedMeters: round(plannedMeters), actualMeters: round(actualMeters), progressPercent, completedJobs, activeJobs, status };
}
