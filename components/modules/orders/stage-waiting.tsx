"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { orderStageAgeAction } from "@/lib/actions/order-stage-age";
import { elapsedStageTime, type StageTiming } from "@/lib/workflow/stage-age";
import { labelize } from "@/types/app";

export function StageWaiting({ orderIds }: { orderIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ rows: StageTiming[]; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const idsKey = JSON.stringify(orderIds.slice(0, 10));
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void orderStageAgeAction(JSON.parse(idsKey)).then((value) => { if (!cancelled) { setNow(Date.now()); setResult(value); } }, () => { if (!cancelled) setResult({ rows: [], error: "Stage history is unavailable. Retry the check." }); });
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [open, idsKey, retry]);
  return <details className="mx-4 mb-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4" onToggle={(event) => { if (event.currentTarget.open) setResult(null); setOpen(event.currentTarget.open); }}><summary className="cursor-pointer text-sm font-bold">Time in current order stage</summary><p className="mt-2 text-xs leading-5 text-neutral-600">Calendar time since the recorded entry into the current stage, shown separately from the dispatch due date. Includes holds and non-working hours; no active-versus-waiting split is inferred.</p>{open && !result ? <p role="status" className="mt-3 text-sm">Checking stage history...</p> : null}{result?.error ? <p role="alert" className="mt-3 text-sm text-red-700">{result.error}</p> : null}{open && result ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{result.rows.map((row) => <div key={row.id} className="min-w-0 rounded-xl border border-neutral-200 bg-white p-3"><Link href={`/orders/${encodeURIComponent(row.id)}`} className="break-words text-sm font-bold underline">{row.label}</Link><p className="mt-1 text-xs text-neutral-600">{labelize(row.stage)}</p><p className="mt-2 font-bold">{elapsedStageTime(row.enteredAt, now)}</p><p className="mt-1 text-xs text-neutral-600">Stage entered: {row.enteredAt ? new Date(row.enteredAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "Not recorded"}</p><p className="mt-1 text-xs">Dispatch due: {row.dueDate || "Not recorded"}</p>{row.reason ? <p className="mt-2 text-xs text-amber-800">{row.reason}</p> : null}</div>)}</div> : null}{open ? <button type="button" className="mt-3 text-xs font-bold underline" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>Recheck stage history</button> : null}</details>;
}
