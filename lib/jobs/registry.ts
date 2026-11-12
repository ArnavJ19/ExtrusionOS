// AP-001: registered scheduled jobs. Mirrors private.ap_job_registry(); a test compares the two.
// Jobs only prepare proposals and alerts. Supabase pg_cron runs them (migration 20261111120000_autopilot_pg_cron.sql,
// jobs autopilot-hourly/-nightly/-morning calling private.ap_jobs_run). /api/cron/<schedule> stays as a manual trigger: it
// verifies CRON_SECRET and calls public.ap_jobs_cron with the server-only service role. Labels are IST; cron strings are UTC.
import { z } from "zod";

export const JOB_SCHEDULES = {
  hourly: { label: "Every hour", cron: "5 * * * *" },
  nightly: { label: "Every night at 00:30", cron: "0 19 * * *" },
  morning: { label: "Every morning at 08:00", cron: "30 2 * * *" }
} as const;
export type JobSchedule = keyof typeof JOB_SCHEDULES;

export const JOBS = [
  { job_key: "alerts.reevaluate", schedule: "hourly", label: "Close cleared alerts" },
  { job_key: "bank.rematch", schedule: "hourly", label: "Rematch bank lines" },
  { job_key: "billing.prepare_drafts", schedule: "hourly", label: "Prepare invoice drafts" },
  { job_key: "calendar.check", schedule: "nightly", label: "Check the factory calendar" },
  { job_key: "dies.predict_service", schedule: "hourly", label: "Propose die service" },
  { job_key: "maintenance.propose_pm", schedule: "hourly", label: "Propose preventive maintenance" },
  { job_key: "navigation.propose", schedule: "nightly", label: "Propose role navigation" },
  { job_key: "periods.propose_close", schedule: "morning", label: "Propose month close" },
  { job_key: "press.idle_reconcile", schedule: "nightly", label: "Find unexplained press idle time" },
  { job_key: "proposals.refresh", schedule: "hourly", label: "Refresh open proposals" },
  { job_key: "quality.sample_windows", schedule: "hourly", label: "Mark missed samples" },
  { job_key: "quotes.expire", schedule: "nightly", label: "Expire stale quotations" },
  { job_key: "quotes.followups", schedule: "morning", label: "Prepare quotation follow-ups" },
  { job_key: "receivables.reminders", schedule: "morning", label: "Prepare payment reminders" },
  { job_key: "series.propose", schedule: "nightly", label: "Propose financial-year numbering" }
] as const satisfies ReadonlyArray<{ job_key: string; schedule: JobSchedule; label: string }>;
export type JobKey = (typeof JOBS)[number]["job_key"];
export const JOB_KEYS = JOBS.map(job => job.job_key) as [JobKey, ...JobKey[]];

export const jobScheduleSchema = z.enum(["hourly", "nightly", "morning"]);

const runSchema = z.object({
  id: z.string().uuid(), status: z.enum(["running", "succeeded", "failed"]), window_key: z.string(), trigger_source: z.enum(["cron", "manual"]),
  started_at: z.string(), finished_at: z.string().nullable(), examined: z.number(), proposals_created: z.number(), alerts_created: z.number(), error_message: z.string().nullable()
});
export const jobsOverviewSchema = z.object({
  jobs: z.array(z.object({
    job_key: z.string(), schedule: jobScheduleSchema, label: z.string(), description: z.string(), last: runSchema.nullable(),
    last_success_at: z.string().nullable(), failed_streak: z.number()
  }))
});
export type JobsOverview = z.infer<typeof jobsOverviewSchema>;
export const jobRunsSchema = z.object({
  total_count: z.number(),
  rows: z.array(z.object({
    id: z.string().uuid(), job_key: z.string(), window_key: z.string(), trigger_source: z.enum(["cron", "manual"]), requested_by: z.string().nullable(),
    status: z.enum(["running", "succeeded", "failed"]), started_at: z.string(), finished_at: z.string().nullable(), examined: z.number(), proposals_created: z.number(),
    alerts_created: z.number(), error_message: z.string().nullable()
  }))
});
export type JobRuns = z.infer<typeof jobRunsSchema>;

export function windowLabel(windowKey: string) {
  const [kind, value] = windowKey.split(":");
  const date = `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  if (kind === "hour") return `${date} ${value.slice(9, 11)}:00 hour`;
  if (kind === "manual") return `Run now ${date} ${value.slice(9, 11)}:${value.slice(11, 13)}`;
  return `${date} (daily)`;
}
