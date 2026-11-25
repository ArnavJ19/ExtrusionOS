"use client";

// FS-36: live screens. A Supabase Realtime subscription to a few tables; a change only signals "something changed",
// and the screen re-reads through its usual server path, so permissions and calculations stay where they are. Realtime
// itself delivers a row only to sessions whose row-level security admits it. Debounced so a burst of pushes costs one
// refresh. Falls back to "paused" (and a manual refresh still works) when the connection drops.
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export type LiveStatus = "connecting" | "live" | "paused";

/** Tables published for Realtime by migrations 20261118120000, 20261122100000, 20261123100000, 20261124100000, 20261125100000 and 20261126100000; a screen may subscribe only to these. */
export const LIVE_TABLES = ["production_jobs", "production_push_events", "production_plan_slots", "breakdown_logs", "orders", "dispatches", "notifications", "action_requests", "approval_decisions",
  "olo_events", "olo_task_events", "quality_containments", "die_preparation_events", "dispatch_communications", "quality_reversals", "final_qc_records",
  "fg_transfers", "fg_transfer_bundles", "dispatch_tracking_updates", "delivery_receipts", "customer_complaint_events"] as const;
export type LiveTable = (typeof LIVE_TABLES)[number];

export function useLiveTables(name: string, tables: readonly LiveTable[], onChange: () => void, debounceMs = 1500) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const key = tables.join(",");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let supabase: ReturnType<typeof createClient>;
    try { supabase = createClient(); } catch { setStatus("paused"); return; }
    const channel = supabase.channel(`live:${name}:${Math.random().toString(36).slice(2, 8)}`);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { setUpdatedAt(Date.now()); callback.current(); }, debounceMs);
      });
    }
    channel.subscribe(state => {
      if (state === "SUBSCRIBED") { setStatus("live"); setUpdatedAt(u => u ?? Date.now()); }
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") setStatus("paused");
    });
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [name, key, debounceMs]);
  return { status, updatedAt };
}

/** Who else has this record open (Realtime presence). Names only; nothing is stored. */
export function usePresence(recordKey: string, me: { id: string; name: string }) {
  const [others, setOthers] = useState<string[]>([]);
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try { supabase = createClient(); } catch { return; }
    const tab = Math.random().toString(36).slice(2, 10);
    const channel = supabase.channel(`presence:${recordKey}`, { config: { presence: { key: `${me.id}:${tab}` } } });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ user_id: string; name: string }>();
      const names = new Set<string>();
      for (const entries of Object.values(state)) for (const e of entries) if (e.user_id !== me.id) names.add(e.name);
      setOthers([...names].sort());
    });
    channel.subscribe(async state => { if (state === "SUBSCRIBED") await channel.track({ user_id: me.id, name: me.name }); });
    return () => { void supabase.removeChannel(channel); };
  }, [recordKey, me.id, me.name]);
  return others;
}
