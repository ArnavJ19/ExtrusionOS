"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { dispatchDraftKey, dispatchDraftSchema, draftRevisionMatches, nextDispatchDraft, readDispatchDraft,
  type DispatchDraft, type DispatchDraftEnvelope, type DraftScope } from "@/lib/forms/dispatch-draft";

export function useDispatchDraft({ companyId, userId }: DraftScope, payload: unknown, restored: (value: DispatchDraft) => void) {
  const key = dispatchDraftKey({ companyId, userId });
  const [status, setStatus] = useState("Checking saved draft...");
  const [candidate, setCandidate] = useState<DispatchDraftEnvelope | null>(null);
  const [blocked, setBlocked] = useState(true);
  const latest = useRef<DispatchDraftEnvelope | null>(null);
  const enabled = useRef(true);
  const [retry, setRetry] = useState(0);
  const serialized = JSON.stringify(payload);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      const saved = readDispatchDraft(raw, { companyId, userId });
      if (raw && !saved) localStorage.removeItem(key);
      latest.current = saved; setCandidate(saved); setBlocked(Boolean(saved));
      setStatus(saved ? "Saved draft available. Restore it to recheck its material sources." : "Draft saves on this device after you select an order.");
    } catch { setBlocked(true); setStatus("Device storage is unavailable. Keep this page open until the transaction is confirmed."); }
  // Scope changes remount the parent form, including its unsaved entries.
  }, [key, companyId, userId]);
  useEffect(() => {
    if (blocked || !enabled.current) return;
    const parsed = dispatchDraftSchema.safeParse(JSON.parse(serialized));
    if (!parsed.success) return;
    setStatus("Saving draft on this device...");
    const timer = setTimeout(async () => {
      try {
        if (!navigator.locks) throw new Error("Cross-tab locking is unavailable");
        await navigator.locks.request(key, () => {
        if (!enabled.current) return;
        const raw = localStorage.getItem(key);
        if (!draftRevisionMatches(raw, latest.current?.revision ?? null)) {
          setCandidate(readDispatchDraft(raw, { companyId, userId })); setBlocked(true);
          setStatus("Another tab changed this draft. Your current entries are still on this page."); return;
        }
        const saved = nextDispatchDraft({ companyId, userId }, parsed.data, latest.current, crypto.randomUUID(), crypto.randomUUID());
        localStorage.setItem(key, JSON.stringify(saved)); latest.current = saved;
        setStatus(`Saved on this device. Draft ${saved.id.slice(0, 8)}. Expires after 7 days.`);
        });
      } catch { setStatus("Draft could not be saved. Your current entries are still on this page."); }
    }, 450);
    return () => clearTimeout(timer);
  }, [serialized, key, blocked, retry, companyId, userId]);
  function restore() {
    try {
      const value = readDispatchDraft(localStorage.getItem(key), { companyId, userId });
      if (!value) { setCandidate(null); setStatus("That draft expired or was removed. Current entries are retained."); return; }
      latest.current = value; restored(value.payload); setCandidate(null); setBlocked(false);
    } catch { setStatus("Draft is unavailable. Current entries are retained."); }
  }
  async function discard() {
    try {
      if (!navigator.locks) throw new Error("Cross-tab locking is unavailable");
      await navigator.locks.request(key, () => {
      if (!draftRevisionMatches(localStorage.getItem(key), latest.current?.revision ?? null)) {
        latest.current = readDispatchDraft(localStorage.getItem(key), { companyId, userId }); setCandidate(latest.current);
        setStatus("The saved draft changed again. Review the latest draft before replacing it."); return;
      }
      localStorage.removeItem(key); latest.current = null; setCandidate(null); setBlocked(false); setRetry(value => value + 1);
      });
    } catch { setStatus("Could not remove the saved draft."); }
  }
  async function confirmed() {
    enabled.current = false;
    try { await navigator.locks?.request(key, () => { if (draftRevisionMatches(localStorage.getItem(key), latest.current?.revision ?? null)) localStorage.removeItem(key); }); } catch { /* A confirmed transaction remains confirmed. */ }
  }
  return { status, candidate, blocked, restore, discard, confirmed };
}

export function DispatchDraftRecovery({ draft }: { draft: ReturnType<typeof useDispatchDraft> }) {
  return <aside aria-label="Dispatch draft recovery" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
    <p role="status">{draft.status}</p>
    {draft.blocked ? <div className="mt-3 flex flex-wrap gap-2">
      {draft.candidate ? <Button type="button" variant="secondary" onClick={draft.restore}>Restore saved draft</Button> : null}
      <Button type="button" variant="ghost" onClick={draft.discard}>Replace saved draft with current entries</Button>
    </div> : null}
    <p className="mt-2 text-xs text-slate-600">Drafts preserve entries only. Current stock and order balances are checked again before dispatch.</p>
  </aside>;
}
