"use client";

// FS-36: a live indicator that refreshes the server-rendered screen when its tables change, and a presence note that
// shows who else has the same record open.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { freshness } from "@/lib/intelligence/format";
import { useLiveTables, usePresence, type LiveTable } from "@/lib/realtime/live";

export function LiveRefresh({ name, tables, onChange }: { name: string; tables: readonly LiveTable[]; onChange?: () => void }) {
  const router = useRouter();
  const { status, updatedAt } = useLiveTables(name, tables, onChange ?? (() => router.refresh()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const label = status === "live" ? `Live · updated ${freshness(updatedAt, now)}` : status === "connecting" ? "Connecting…" : "Live updates paused";
  return <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${status === "live" ? "bg-emerald-50 text-emerald-800" : status === "paused" ? "bg-amber-50 text-amber-900" : "bg-neutral-100 text-neutral-700"}`}>
    <span aria-hidden className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-600" : status === "paused" ? "bg-amber-500" : "bg-neutral-400"}`} />{label}
    {status === "paused" ? <button type="button" className="underline" onClick={() => router.refresh()}>Refresh</button> : null}
  </span>;
}

export function EditingPresence({ recordKey, me }: { recordKey: string; me: { id: string; name: string } }) {
  const others = usePresence(recordKey, me);
  if (!others.length) return null;
  return <p role="status" className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900">Also open by {others.join(", ")} — check before you change anything.</p>;
}
