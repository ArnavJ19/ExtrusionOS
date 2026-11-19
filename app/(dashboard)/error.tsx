"use client";

// FS-07: a screen that fails shows a way forward instead of a blank page, and the error is recorded for the owner's
// System health view (route, role and a scrubbed message only).
import { useEffect } from "react";
import Link from "next/link";
import { reportBrowserError } from "@/lib/monitoring/report";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { void reportBrowserError(error, window.location.pathname, error.digest); }, [error]);
  return <div role="alert" className="mx-auto max-w-xl space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-6">
    <h1 className="text-lg font-black text-amber-950">This screen could not load</h1>
    <p className="text-sm text-amber-900">Nothing you saved is lost. The problem has been recorded for the system administrator{error.digest ? ` (reference ${error.digest})` : ""}.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={reset} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Try again</button>
      <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-bold">Go to the dashboard</Link>
    </div>
  </div>;
}
