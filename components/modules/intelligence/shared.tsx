"use client";

// Shared pieces for the Phase 4 screens: one gateway read with reload, one write with its message. Every call goes through
// the allow-listed server action (lib/actions/intelligence). Layout pieces are the order-to-cash ones, so these screens
// look like the rest of ExtrusionOS.
import { useCallback, useEffect, useState } from "react";
import { intelligenceAction } from "@/lib/actions/intelligence";

export { Empty, Failure, Loading, Message, Pager, Pill, Section, buttonClass, inputClass, secondaryClass } from "../order-to-cash/ui";
export type Note = { tone: "ok" | "error"; text: string } | null;

export function useFsRead<T>(rpc: string, command: string, payload: Record<string, unknown>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(payload);
  const depKey = JSON.stringify(deps);
  const reload = useCallback(async () => {
    setLoading(true);
    const result = await intelligenceAction(rpc, command, JSON.parse(key));
    setLoading(false);
    if (!result.success) { setError(result.error); return; }
    setError(null); setData(result.data as T);
  }, [rpc, command, key, depKey]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

/** Runs one write and reports its message; returns the data on success, null on failure. */
export async function fsWrite<T = unknown>(rpc: string, command: string, payload: Record<string, unknown>, setMessage: (m: Note) => void, ok?: string) {
  const result = await intelligenceAction(rpc, command, payload);
  if (!result.success) { setMessage({ tone: "error", text: result.error }); return null; }
  if (ok) setMessage({ tone: "ok", text: ok });
  return result.data as T;
}

/** A number field value: blank stays undefined, otherwise a finite number or NaN (the schema then refuses it). */
export function numberOrUndefined(value: string): number | undefined {
  const t = value.trim();
  return t === "" ? undefined : Number(t);
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  return <div className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-3">
    <p className="text-xs font-bold uppercase text-neutral-500">{label}</p>
    <p className={`mt-1 text-xl font-black tabular-nums ${tone === "bad" ? "text-rose-700" : tone === "good" ? "text-emerald-700" : ""}`}>{value}</p>
    {hint ? <p className="mt-0.5 text-xs text-neutral-600">{hint}</p> : null}
  </div>;
}
