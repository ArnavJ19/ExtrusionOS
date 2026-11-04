"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { lifecycleAction } from "@/lib/actions/lifecycle";
import { parseRecoveryMarker } from "@/lib/workflow/coordination";
import { lifecycleMutationSchema, lifecycleOutcomeSchema, lifecycleRecoveryKey, type LifecycleMutation, type LifecycleOutcome } from "@/lib/workflow/lifecycle";
import type { SessionContext } from "@/types/app";

// Same reviewed-action protocol as daily coordination (NOV-097/098): one persisted request identity
// per action, a server-generated review, and only a confirmed database outcome counts as success.
const ActionContext = createContext<{ locked: boolean; review: (mutation: LifecycleMutation) => Promise<void> } | null>(null);
export function useLifecycleAction() {
  const value = useContext(ActionContext);
  if (!value) throw new Error("Lifecycle actions require the action center");
  return value;
}

export function LifecycleActionCenter({ context, children }: { context: SessionContext; children: ReactNode }) {
  const router = useRouter();
  const key = lifecycleRecoveryKey(context.companyId, context.userId);
  const [ready, setReady] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const markerRef = useRef<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      const marker = parseRecoveryMarker(raw);
      if (raw && !marker) { setError("The saved request reference is unreadable. Check the affected record and its history before submitting another action."); return; }
      if (marker) { markerRef.current = marker.request_id; setRequestId(marker.request_id); setUncertain(true); }
      setReady(true);
    } catch { setError("This browser cannot retain the original request reference. Enable session storage before submitting a consequential action."); }
    return () => { mounted.current = false; };
  }, [key]);

  async function run(command: "preview" | "commit" | "outcome" | "abandon", mutation?: LifecycleMutation) {
    if (inFlight.current || !ready) return;
    if (command === "preview" && markerRef.current) return;
    inFlight.current = true; setBusy(true); setError("");
    let original = markerRef.current;
    try {
      if (command === "preview") {
        const parsed = lifecycleMutationSchema.safeParse(mutation);
        if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Review the action details."); return; }
        const generated = crypto.randomUUID();
        sessionStorage.setItem(key, JSON.stringify({ request_id: generated, created_at: Date.now() }));
        original = generated;
        markerRef.current = original; setRequestId(original); setOutcome(null);
      }
      if (!original) return;
      const input = command === "preview" ? { command, request_id: original, mutation }
        : command === "commit" ? { command, request_id: original, fingerprint: outcome?.fingerprint }
        : { command, request_id: original };
      const result = await lifecycleAction(input);
      if (!mounted.current) return;
      if (!result.success) {
        // A preview the server refused (permission or current source) recorded nothing; the reference can be released.
        if (command === "preview" && !result.uncertain) {
          try { sessionStorage.removeItem(key); markerRef.current = null; setRequestId(null); } catch { setUncertain(true); }
          setError(result.error); return;
        }
        setError(result.error); setUncertain(true);
        return;
      }
      const next = lifecycleOutcomeSchema.parse(result.data);
      if (next.request_id !== original) throw new Error("Mismatched request result");
      setOutcome(next); setUncertain(false);
      panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (next.state === "confirmed") {
        try { router.refresh(); } catch { /* Retain the known database outcome. */ }
      }
    } catch {
      if (mounted.current) {
        if (!original) setReady(false);
        setUncertain(Boolean(original));
        setError(original ? "The result could not be confirmed. Check the original request; do not submit another copy." : "The original request reference could not be saved. No action was submitted. Restore browser session storage and reload before continuing.");
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function clearResolved() {
    if (inFlight.current || !outcome || outcome.state === "prepared" || uncertain) return;
    try { sessionStorage.removeItem(key); }
    catch { setError("The resolved request reference could not be cleared. Retry before starting another action."); return; }
    markerRef.current = null; setRequestId(null); setOutcome(null); setError("");
  }

  const terminal = outcome && outcome.state !== "prepared";
  return <ActionContext.Provider value={{ locked: !ready || busy || Boolean(requestId), review: mutation => run("preview", mutation) }}>
    {(requestId || error) ? <section ref={panel} aria-label="Action review and result" className="space-y-4 rounded-2xl border border-slate-300 bg-white p-4 sm:p-5">
      <div aria-live="polite" className="space-y-1">
        <h2 className="text-lg font-bold text-slate-950">{busy ? "Checking the original request" : uncertain ? "Outcome needs checking" : outcome?.state === "confirmed" ? "Action confirmed" : outcome?.state === "rejected" ? "Action rejected" : outcome?.state === "prepared" ? "Review before confirming" : requestId ? "Original request" : "Action not started"}</h2>
        {!outcome && requestId ? <p className="text-sm text-slate-600">A saved request is associated with this user and company. Check its authoritative outcome before continuing.</p> : null}
        {outcome ? <><p className="font-semibold">{outcome.review.title}</p><p className="text-sm text-slate-700">{outcome.review.effect}</p></> : null}
      </div>
      {outcome?.state === "prepared" ? <>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{Object.entries(outcome.review.facts).map(([label, value]) => <div key={label} className="min-w-0"><dt className="font-semibold text-slate-500">{label}</dt><dd className="break-words text-slate-950">{value == null ? "Not recorded" : String(value)}</dd></div>)}</dl>
        {outcome.review.warnings.length ? <ul className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{outcome.review.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
        <p className="text-xs text-slate-500">Review expires {new Date(outcome.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. The server checks current sources and permissions again.</p>
      </> : null}
      {outcome?.result ? <div role="status" className={`space-y-2 rounded-xl p-3 text-sm ${outcome.state === "confirmed" ? "bg-emerald-50 text-emerald-950" : "bg-slate-100 text-slate-900"}`}>
        <p className="font-bold">{outcome.result.label}</p><p>{outcome.result.message}</p>
        {outcome.result.href ? <Link href={outcome.result.href} className="inline-flex min-h-11 items-center font-bold underline">Open confirmed record</Link> : null}
      </div> : null}
      {error ? <p role="alert" className="break-words text-sm font-semibold text-red-800">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {requestId ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void run("outcome")}>Check original request</Button> : null}
        {outcome?.state === "prepared" && !uncertain ? <><Button type="button" disabled={busy} onClick={() => void run("commit")}>Confirm reviewed action</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => void run("abandon")}>Cancel this review</Button></> : null}
        {terminal && !uncertain ? <Button type="button" variant="secondary" disabled={busy} onClick={clearResolved}>Start another action</Button> : null}
      </div>
      {requestId ? <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">Original request reference</summary><p className="break-all">{requestId}</p></details> : null}
    </section> : null}
    {children}
  </ActionContext.Provider>;
}
