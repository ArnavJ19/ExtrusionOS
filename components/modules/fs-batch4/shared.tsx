"use client";

// Shared pieces for the FS batch 4 screens: one gateway read with reload and one write with its message. Every call goes
// through the allow-listed server action (lib/actions/fs-batch4). Layout pieces are the order-to-cash ones, so these
// screens look like the rest of ExtrusionOS.
import { useCallback, useEffect, useState } from "react";
import { fsBatch4Action } from "@/lib/actions/fs-batch4";

export { Empty, Failure, Loading, Message, Pager, Pill, Section, buttonClass, inputClass, secondaryClass } from "../order-to-cash/ui";
export type Note = { tone: "ok" | "error"; text: string } | null;

export function useB4Read<T>(rpc: string, command: string, payload: Record<string, unknown>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(payload);
  const depKey = JSON.stringify(deps);
  const reload = useCallback(async () => {
    setLoading(true);
    const result = await fsBatch4Action(rpc, command, JSON.parse(key));
    setLoading(false);
    if (!result.success) { setError(result.error); return; }
    setError(null); setData(result.data as T);
  }, [rpc, command, key, depKey]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

/** Runs one write and reports its message; returns the data on success, null on failure. */
export async function b4Write<T = unknown>(rpc: string, command: string, payload: Record<string, unknown>, setMessage: (m: Note) => void, ok?: string) {
  const result = await fsBatch4Action(rpc, command, payload);
  if (!result.success) { setMessage({ tone: "error", text: result.error }); return null; }
  if (ok) setMessage({ tone: "ok", text: ok });
  return result.data as T;
}

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h12" });
export function when(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : IST.format(d);
}

/** "payment_terms" -> "Payment terms". */
export function fieldLabel(field: string) {
  const t = field.replaceAll("_", " ").replace(/\bkg\b/g, "kg").replace(/\bid\b/g, "ID").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A stored value as plain text: blank stays blank, objects are summarised, never "[object Object]". */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (Array.isArray(value)) return value.length ? value.map(v => valueText(v)).join(", ") : "none";
  return "details changed";
}
