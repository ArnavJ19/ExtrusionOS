import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/jobs/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// FS-07: the authenticated health endpoint. An uptime monitor calls it with "Authorization: Bearer $HEALTH_CHECK_TOKEN"
// (or a signed-in owner/admin opens it). It answers 200 when the database answers and no scheduled job failed in the
// last 24 hours, 503 otherwise. It returns counts only: no business data. /api/health/live is the unauthenticated
// liveness check for the login page's uptime monitor.
export const dynamic = "force-dynamic";

async function signedInAdmin() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.from("app_users").select("role, is_active").eq("id", user.id).maybeSingle();
    return Boolean(data?.is_active && ["owner", "admin"].includes(String(data.role)));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const token = isAuthorizedCronRequest(request.headers.get("authorization"), process.env.HEALTH_CHECK_TOKEN);
  if (!token && !(await signedInAdmin())) return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const started = Date.now();
  try {
    const result = await createAdminClient().rpc("fs_monitoring_service", { p_command: "health", p_payload: {} });
    if (result.error) return NextResponse.json({ ok: false, database: "error", latency_ms: Date.now() - started }, { status: 503 });
    const health = result.data as { failed_jobs_24h: number; stale_running_jobs: number; last_job_run: string | null };
    const ok = Number(health.failed_jobs_24h) === 0 && Number(health.stale_running_jobs) === 0;
    return NextResponse.json({ ok, database: "ok", latency_ms: Date.now() - started, ...health }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, database: "unreachable", latency_ms: Date.now() - started }, { status: 503 });
  }
}
