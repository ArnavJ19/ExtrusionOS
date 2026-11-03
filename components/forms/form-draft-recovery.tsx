"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DISCARD_MESSAGES, draftPayload, formDraftKey, formDraftRevisionMatches, nextFormDraft, readFormDraft, samePayload,
  type DraftDefinition, type DraftScope, type DraftValue, type FormDraftEnvelope } from "@/lib/forms/form-draft";

/**
 * NOV-013: device draft for a lengthy form. Inert when `definition` is null or while `values` is
 * null (still loading). Unchanged forms are never saved, so opening a form does not leave a draft.
 */
export function useFormDraft(definition: DraftDefinition | null, scope: DraftScope, values: Record<string, unknown> | null, restored: (payload: Record<string, DraftValue>) => void) {
  const key = definition ? formDraftKey(definition, scope) : null;
  const [status, setStatus] = useState(definition ? "Checking for a saved draft..." : "");
  const [candidate, setCandidate] = useState<FormDraftEnvelope | null>(null);
  const [blocked, setBlocked] = useState(Boolean(definition));
  const latest = useRef<FormDraftEnvelope | null>(null);
  const baseline = useRef<Record<string, DraftValue> | null>(null);
  const enabled = useRef(true);
  const serialized = definition && values ? JSON.stringify(draftPayload(definition, values)) : null;

  useEffect(() => {
    if (!definition || !key) return;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.locks) { setStatus("This browser cannot protect drafts between tabs. Keep this page open until the record is saved."); return; }
        await navigator.locks.request(key, () => {
          if (cancelled) return;
          const read = readFormDraft(definition, localStorage.getItem(key), scope);
          if (read.state === "discarded") { localStorage.removeItem(key); setStatus(DISCARD_MESSAGES[read.reason]); setBlocked(false); return; }
          const saved = read.state === "available" ? read.draft : null;
          latest.current = saved; setCandidate(saved); setBlocked(Boolean(saved));
          setStatus(saved ? `Saved draft from ${new Date(saved.savedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} is available. Restore it to recheck its source records.` : "Your entries are saved on this device as you type.");
        });
      } catch { if (!cancelled) setStatus("Device storage is unavailable. Keep this page open until the record is saved."); }
    })();
    return () => { cancelled = true; };
  // Company or employee changes remount the form with a new key.
  }, [key]);

  useEffect(() => {
    if (!definition || !key || serialized === null || blocked || !enabled.current) return;
    const payload = JSON.parse(serialized) as Record<string, DraftValue>;
    if (baseline.current === null) { baseline.current = payload; return; }
    if (samePayload(payload, baseline.current) && !latest.current) return;
    setStatus("Saving draft on this device...");
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (!navigator.locks) throw new Error("Cross-tab locking is unavailable");
        await navigator.locks.request(key, () => {
          if (cancelled || !enabled.current) return;
          const raw = localStorage.getItem(key);
          if (!formDraftRevisionMatches(raw, latest.current?.revision ?? null)) {
            const read = readFormDraft(definition, raw, scope);
            setCandidate(read.state === "available" ? read.draft : null); setBlocked(true);
            setStatus("Another tab changed this draft. Your entries on this page are unchanged; choose which entries to keep."); return;
          }
          const saved = nextFormDraft(definition, scope, payload, latest.current, crypto.randomUUID(), crypto.randomUUID());
          localStorage.setItem(key, JSON.stringify(saved)); latest.current = saved;
          setStatus(`Draft saved on this device at ${new Date(saved.savedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}. Nothing is recorded until you save the record.`);
        });
      } catch { setStatus("Draft could not be saved on this device. Your entries are still on this page."); }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [serialized, key, blocked]);

  function restore() {
    if (!definition || !key) return;
    try {
      const read = readFormDraft(definition, localStorage.getItem(key), scope);
      if (read.state !== "available") { setCandidate(null); setBlocked(false); setStatus(read.state === "discarded" ? DISCARD_MESSAGES[read.reason] : "That draft was removed. Your current entries are retained."); return; }
      latest.current = read.draft; baseline.current = read.draft.payload; restored(read.draft.payload); setCandidate(null); setBlocked(false);
      setStatus("Draft restored. Source records, stock and permissions are checked again when you save.");
    } catch { setStatus("Draft is unavailable. Your current entries are retained."); }
  }
  async function discard() {
    if (!key) return;
    try {
      if (!navigator.locks) throw new Error("Cross-tab locking is unavailable");
      await navigator.locks.request(key, () => {
        if (!formDraftRevisionMatches(localStorage.getItem(key), latest.current?.revision ?? null)) {
          const read = definition ? readFormDraft(definition, localStorage.getItem(key), scope) : { state: "none" as const };
          latest.current = read.state === "available" ? read.draft : null; setCandidate(latest.current);
          setStatus("The saved draft changed again in another tab. Review it before replacing it."); return;
        }
        localStorage.removeItem(key); latest.current = null; baseline.current = null; setCandidate(null); setBlocked(false);
        setStatus("Saved draft removed. Your current entries will be saved as you type.");
      });
    } catch { setStatus("Could not remove the saved draft."); }
  }
  /** Call only after the server confirms the record; an uncertain save keeps the draft. */
  async function confirmed() {
    enabled.current = false;
    if (!key) return;
    try { await navigator.locks?.request(key, () => { if (formDraftRevisionMatches(localStorage.getItem(key), latest.current?.revision ?? null)) localStorage.removeItem(key); }); } catch { /* The saved record remains authoritative. */ }
  }
  return { active: Boolean(definition), status, candidate, blocked, restore, discard, confirmed };
}

export function FormDraftRecovery({ draft, note }: { draft: ReturnType<typeof useFormDraft>; note?: string }) {
  if (!draft.active) return null;
  return <aside aria-label="Draft recovery" className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
    <p role="status">{draft.status}</p>
    {draft.blocked && draft.candidate ? <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={draft.restore}>Restore saved draft</Button>
      <Button type="button" variant="ghost" onClick={() => void draft.discard()}>Discard saved draft and keep current entries</Button>
    </div> : null}
    <p className="mt-2 text-xs text-slate-600">{note ?? "Drafts keep typed entries on this device only. Rates and amounts are never stored. Saving the record checks current sources again."}</p>
  </aside>;
}
