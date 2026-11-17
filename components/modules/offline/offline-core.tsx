"use client";

// AP-094: shared offline queue for factory phone entries. submit() stores the entry with its request ID first, then
// tries to send; entries that cannot reach the server stay on the phone and are sent again when the connection
// returns. A refusal from the server (job closed, tag not on the truck) becomes a conflict the employee resolves.
// This core takes its transport from the screen, so it loads no server action itself (offline-queue.tsx adds the
// Autopilot gateway transport; the bundle screen passes its own bundle action).
import { useCallback, useEffect, useRef, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { flushEntries, isPersistent, listEntries, newEntry, ownerKey, putEntry, removeEntry, type OfflineEntry, type OfflineKind, type SendOutcome } from "@/lib/offline/queue";

/** Sends one entry; fromQueue is true when it is sent later from the queue, with nobody watching the screen. */
export type OfflineTransport = { send: (entry: OfflineEntry, fromQueue: boolean) => Promise<SendOutcome>; resolve?: (entry: OfflineEntry, resolution: "discarded" | "redone") => Promise<void> };
export type BundleSender = (payload: Record<string, unknown>) => Promise<{ success: true; data?: unknown } | { success: false; error: string }>;

/** Transport for bundle capture: the bundle writer is idempotent by the bundle identity, which is the request ID. */
export function bundleTransport(sendBundle: BundleSender): OfflineTransport {
  return { send: async entry => {
    const result = await sendBundle(entry.payload);
    if (result.success) return { kind: "applied", data: result.data };
    // The bundle writer's own generic failure means the outcome is unknown: retry with the same identity.
    if (/could not be confirmed/i.test(result.error)) return { kind: "retry", message: result.error };
    return { kind: "conflict", message: result.error };
  } };
}

export type OfflineQueue = ReturnType<typeof useOfflineQueueCore>;
export function useOfflineQueueCore(companyId: string, userId: string, transport: OfflineTransport, onApplied?: () => void) {
  const io = useRef(transport);
  useEffect(() => { io.current = transport; }, [transport]);
  const owner = ownerKey(companyId, userId);
  const [entries, setEntries] = useState<OfflineEntry[]>([]);
  const [online, setOnline] = useState(true);
  const flushing = useRef(false); const applied = useRef(onApplied);
  useEffect(() => { applied.current = onApplied; }, [onApplied]);
  const refresh = useCallback(async () => setEntries(await listEntries(owner)), [owner]);
  const flush = useCallback(async () => {
    if (flushing.current) return; flushing.current = true;
    try { const r = await flushEntries(owner, entry => io.current.send(entry, true)); if (r.applied) applied.current?.(); } finally { flushing.current = false; await refresh(); }
  }, [owner, refresh]);
  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    void refresh(); void flush();
    const up = () => { setOnline(true); void flush(); }; const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    const timer = setInterval(() => { void flush(); }, 15000);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(timer); };
  }, [flush, refresh]);

  /** Stores the entry, then sends it. Returns what happened so the screen can say so. */
  const submit = useCallback(async (input: { kind?: OfflineKind; rpc: string; command: string; payload: Record<string, unknown>; label: string; requestId?: string }): Promise<SendOutcome> => {
    const entry = newEntry({ owner, kind: input.kind ?? "ap", rpc: input.rpc, command: input.command, payload: input.payload, label: input.label, requestId: input.requestId });
    await putEntry(entry);
    let outcome: SendOutcome;
    try { outcome = await io.current.send(entry, false); } catch { outcome = { kind: "retry", message: "No connection." }; }
    if (outcome.kind === "applied") await removeEntry(entry.request_id);
    // Refused straight away: the screen shows the refusal itself, so nothing is left queued.
    else if (outcome.kind === "conflict") await removeEntry(entry.request_id);
    else await putEntry({ ...entry, attempts: 1, message: outcome.message ?? "Waiting for a connection." });
    await refresh();
    return outcome;
  }, [owner, refresh]);

  const resolve = useCallback(async (entry: OfflineEntry, resolution: "discarded" | "redone") => {
    try { await io.current.resolve?.(entry, resolution); } catch { /* resolved on this phone; the server keeps the conflict listed */ }
    await removeEntry(entry.request_id); await refresh();
  }, [refresh]);

  const adopt = useCallback(async (list: OfflineEntry[]) => { for (const e of list) await putEntry(e); await refresh(); void flush(); }, [flush, refresh]);
  return { owner, entries, pending: entries.filter(e => e.state === "pending"), conflicts: entries.filter(e => e.state === "conflict"), online, submit, flush, resolve, adopt };
}

export function OfflineQueuePanel({ queue, what = "entries", place = "phone" }: { queue: OfflineQueue; what?: string; place?: string }) {
  if (!queue.entries.length && queue.online) return null;
  return <section aria-label="Phone entries waiting" className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    {!queue.online ? <p className="flex items-center gap-2 font-semibold"><CloudOff className="h-4 w-4" aria-hidden="true" />No connection. New {what} are saved on this {place} and sent when it returns.</p> : null}
    {queue.pending.length ? <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="font-semibold">{queue.pending.length} {what} waiting to send from this {place}{isPersistent() === false ? " (this browser cannot keep them after closing)" : ""}.</p>
      <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 font-bold" onClick={() => void queue.flush()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Send now</button></div> : null}
    {queue.conflicts.length ? <div className="space-y-2"><p className="font-semibold">{queue.conflicts.length} queued entr{queue.conflicts.length === 1 ? "y was" : "ies were"} refused. Resolve each one:</p>
      <ul className="space-y-2">{queue.conflicts.map(e => <li key={e.request_id} className="rounded-xl bg-white p-3">
        <p className="font-semibold">{e.label} · saved {new Date(e.queued_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
        <p className="text-rose-800">{e.message}</p>
        <div className="mt-2 flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-xl border px-3 font-bold" onClick={() => void queue.resolve(e, "redone")}>I entered it again</button>
          <button type="button" className="min-h-11 rounded-xl border px-3 font-bold" onClick={() => void queue.resolve(e, "discarded")}>Discard</button></div></li>)}</ul></div> : null}
  </section>;
}
