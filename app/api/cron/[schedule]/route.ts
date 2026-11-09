import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/jobs/cron-auth";
import { jobScheduleSchema } from "@/lib/jobs/registry";
import { createAdminClient } from "@/lib/supabase/admin";

// AP-001: Vercel Cron calls GET /api/cron/<hourly|nightly|morning> with "Authorization: Bearer $CRON_SECRET".
// The service-role key stays on the server; the only thing it may call here is public.ap_jobs_cron, which runs
// the registered jobs once per window and records each run in system_job_runs.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ schedule: string }> }) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  const schedule = jobScheduleSchema.safeParse((await params).schedule);
  if (!schedule.success) return NextResponse.json({ error: "Unknown schedule" }, { status: 404 });
  try {
    const result = await createAdminClient().rpc("ap_jobs_cron", { p_payload: { schedule: schedule.data } });
    if (result.error) return NextResponse.json({ error: "The job runner could not start", code: result.error.code ?? null }, { status: 500 });
    const runs = ((result.data as { runs?: Array<{ job_key: string; state: string; run_id?: string }> })?.runs ?? []).map(run => ({ job_key: run.job_key, state: run.state, run_id: run.run_id ?? null }));
    return NextResponse.json({ schedule: schedule.data, runs }, { status: runs.some(run => run.state === "failed") ? 207 : 200 });
  } catch {
    return NextResponse.json({ error: "The job runner is not configured on this deployment" }, { status: 500 });
  }
}
