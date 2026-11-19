// FS-07: server-side errors. Next.js calls onRequestError for errors thrown while rendering, in route handlers and in
// server actions. The route path, error name and message are recorded through the service-role-only database function
// public.fs_monitoring_service, which scrubs personal data and amounts and alerts the owner and admin once a day per
// error. Nothing here may throw.
export async function register() {}

type RequestInfo = { path: string; method: string };
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

export async function onRequestError(error: unknown, request: RequestInfo, context: ErrorContext) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const e = error instanceof Error ? error : new Error(String(error));
    const digest = (error as { digest?: string } | null)?.digest;
    await createAdminClient().rpc("fs_monitoring_service", {
      p_command: "server_error",
      p_payload: {
        route: (context?.routePath || request?.path || "/unknown").split("?")[0].slice(0, 300),
        name: (e.name || "Error").slice(0, 80),
        message: `${context?.routeType ?? "request"}: ${e.message || "Unknown error"}`.slice(0, 2000),
        ...(digest ? { digest: String(digest).slice(0, 80) } : {}),
        ...(process.env.VERCEL_GIT_COMMIT_SHA ? { release: process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12) } : {}),
      },
    });
  } catch {
    // Monitoring must never turn one failure into two.
  }
}
