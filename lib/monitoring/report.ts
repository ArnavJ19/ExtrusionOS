// FS-07: browser-side error reporting. Sends only the route path, the error name, a message and the framework digest;
// the database removes e-mail addresses, numbers and identifiers before storing it and attaches the role from the
// session. Each distinct error is sent at most once per page load, and at most 20 errors per page load in total.
import { fsBatch4Action } from "@/lib/actions/fs-batch4";

const sent = new Set<string>();
let count = 0;

export function errorRoute(pathname: string) {
  return (pathname.split("?")[0].split("#")[0] || "/").slice(0, 300);
}

export async function reportBrowserError(error: unknown, pathname: string, digest?: string) {
  try {
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
    const message = (e.message || "Unknown error").slice(0, 2000);
    const key = `${e.name}|${message}|${errorRoute(pathname)}`;
    if (sent.has(key) || count >= 20) return;
    sent.add(key); count += 1;
    await fsBatch4Action("fs_monitoring", "report", { route: errorRoute(pathname), name: (e.name || "Error").slice(0, 80), message, ...(digest ? { digest: digest.slice(0, 80) } : {}),
      ...(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ? { release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA.slice(0, 12) } : {}) });
  } catch {
    // Reporting must never break the page.
  }
}
