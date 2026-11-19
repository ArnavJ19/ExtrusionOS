// FS-51: origin check for state-changing API requests (used by proxy.ts). A browser marks a request from another site
// with Sec-Fetch-Site: cross-site and sends its Origin; either one not matching this host refuses the request.
// Requests with neither header (server-to-server, scripts) are left to the route's own session check.
export function isSameOriginRequest(request: { method: string; headers: Headers; host: string }): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || request.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
