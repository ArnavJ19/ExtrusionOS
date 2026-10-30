"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { configurationReleaseAction } from "@/lib/actions/configuration-release";
import type { ConfigurationReleaseResult } from "@/lib/workflow/configuration-release";

type ReleaseState = Extract<ConfigurationReleaseResult, { kind: "release_state" }>;
type PendingApproval = Extract<Parameters<typeof configurationReleaseAction>[0], { command: "release.approve" }>;

const statusLabels: Record<ReleaseState["status"], string> = {
  not_calculated: "No captured calculation",
  blocked: "Blocked by release checks",
  estimated: "Estimate only",
  pending_approval: "Ready for independent review",
  approved: "Approved for production handoff",
  stale: "Source changed; recalculate and review",
  handed_off: "Handed to production"
};

function shortFingerprint(value: string | undefined) {
  return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "Not captured";
}

export function ConfigurationRelease({
  initialState,
  initialError = "",
  configurationId,
  userId,
  canApprove
}: {
  initialState: ReleaseState | null;
  initialError?: string;
  configurationId: string;
  userId: string;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<ReleaseState | null>(initialState);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const latest = state?.latest ?? null;

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const response = await configurationReleaseAction({ command: "release.load", payload: { configuration_id: configurationId } });
      if (!response.success) {
        setState(null);
        setMessage(response.error);
        return;
      }
      if (response.data.kind !== "release_state") throw new Error("Unexpected configurator release response.");
      setState(response.data);
      setPending(null);
    } catch {
      setState(null);
      setMessage("Current release status could not be confirmed. Reload this project before approving or handing it off.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!latest) return;
    const request: PendingApproval = pending ?? {
      command: "release.approve",
      payload: {
        snapshot_id: latest.id,
        output_fingerprint: latest.output_fingerprint,
        request_id: crypto.randomUUID(),
        note: note.trim()
      }
    };
    setPending(request);
    setBusy(true);
    setMessage("");
    try {
      const response = await configurationReleaseAction(request);
      if (!response.success) {
        setMessage(response.error);
        return;
      }
      if (response.data.kind !== "release_reviewed") throw new Error("Unexpected configurator review response.");
      setPending(null);
      setNote("");
      await load();
      router.refresh();
    } catch {
      setMessage("Approval confirmation is uncertain. Retry the same review request to avoid recording a second decision.");
    } finally {
      setBusy(false);
    }
  }

  const eligible = Boolean(canApprove && latest?.readiness === "ready" && state?.status === "pending_approval" && latest.author_id !== userId);
  const activeRequest = pending ?? (latest ? {
    command: "release.approve" as const,
    payload: { snapshot_id: latest.id, output_fingerprint: latest.output_fingerprint, request_id: "", note: note.trim() }
  } : null);

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Fabrication release">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-[linear-gradient(110deg,#f8fafc,#fff7ed)] p-5">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Controlled production handoff</p>
        <h2 className="mt-1 text-xl font-black text-slate-950">Fabrication release</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">A calculation is captured with its exact project inputs, rule versions, and persisted output rows. Production handoff requires a current, independently approved snapshot.</p>
      </div>
      <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50" disabled={busy} onClick={() => void load()}>{busy ? "Checking…" : "Refresh release status"}</button>
    </div>

    <div className="space-y-5 p-5">
      {!state ? <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">{message || "Release status is unavailable. Refresh to load the current evidence."}</p> : <>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1.5 text-sm font-black ${state.status === "approved" || state.status === "handed_off" ? "bg-emerald-100 text-emerald-900" : state.status === "pending_approval" ? "bg-sky-100 text-sky-900" : state.status === "stale" || state.status === "blocked" ? "bg-rose-100 text-rose-900" : "bg-amber-100 text-amber-900"}`}>{statusLabels[state.status]}</span>
          {latest ? <span className="text-sm text-slate-600">Snapshot {latest.revision} · readiness {latest.readiness}</span> : null}
        </div>

        {latest ? <>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Version label="Input fingerprint" value={shortFingerprint(latest.input_fingerprint)} />
            <Version label="Rule fingerprint" value={shortFingerprint(latest.rules_fingerprint)} />
            <Version label="Output fingerprint" value={shortFingerprint(latest.output_fingerprint)} />
            <Version label="Source revisions" value={`Rules ${latest.rules_revision} · outputs ${latest.output_revision}`} />
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="font-black text-slate-900">Unresolved release checks</h3>
              {latest.unresolved_reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{latest.unresolved_reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-800">No unresolved checks in this snapshot.</p>}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <h3 className="font-black text-slate-900">Estimated fields</h3>
              {latest.estimated_fields.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{latest.estimated_fields.map((field) => <li key={field}>{field.replaceAll("_", " ")}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No estimated values recorded.</p>}
            </div>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Context label="Calculated by" value={latest.author_id} />
            <Context label="Reviewed by" value={latest.approved_by ? `${latest.approved_by}${latest.approved_at ? ` · ${new Date(latest.approved_at).toLocaleString("en-IN")}` : ""}` : "No independent approval"} />
            <Context label="Handoff order" value={latest.handoff_order_id ?? "Not handed off"} />
            <Context label="Handoff time" value={latest.handed_off_at ? new Date(latest.handed_off_at).toLocaleString("en-IN") : "Not handed off"} />
          </div>

          {eligible || pending ? <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <label className="block text-sm font-bold text-slate-800">Independent review note (optional)
              <textarea className="mt-1 block min-h-20 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal" maxLength={1000} disabled={Boolean(pending) || busy} value={activeRequest?.payload.note ?? note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {latest.author_id === userId ? <p className="text-sm font-semibold text-amber-900">The calculation author cannot approve this release.</p> : null}
            <button type="button" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!eligible || busy} onClick={() => void approve()}>{pending ? "Retry identical approval" : "Approve this exact snapshot"}</button>
          </div> : null}
        </> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{state.unresolved_reasons.join(" ") || "Calculate this project to capture its exact inputs, rules, and outputs."}</p>}
      </>}
      <p role="status" className="text-sm text-slate-600">{busy ? "Verifying the captured release evidence…" : message}</p>
    </div>
  </section>;
}

function Version({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg bg-slate-50 p-3"><dt className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</dt><dd className="mt-1 break-all font-mono text-xs text-slate-800">{value}</dd></div>;
}

function Context({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-100 p-3"><p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 break-all text-slate-800">{value}</p></div>;
}
