// AP-039: state (and district, when the India Post directory is bundled) from a six-digit PIN, read from the offline
// table public/data/pin-prefixes.json. No customer address is sent to any outside service.
import { GST_STATES } from "../validations/gstin.ts";

export type PinTable = { version: number; source: string; districts: boolean; prefixes: Record<string, string[]> };
export type PinLookup =
  | { kind: "state"; pin: string; code: string; state: string; district: string | null; prefix: string }
  | { kind: "choose"; pin: string; candidates: { code: string; state: string }[]; district: string | null; prefix: string }
  | { kind: "no_state"; pin: string; reason: string }
  | { kind: "unknown"; pin: string; reason: string }
  | { kind: "invalid"; pin: string; reason: string };

export const PIN_PATTERN = /^[1-9][0-9]{5}$/;

export function lookupPin(table: PinTable, input: string, districts: Record<string, string> | null = null): PinLookup {
  const pin = String(input ?? "").replace(/\s+/g, "");
  if (!PIN_PATTERN.test(pin)) return { kind: "invalid", pin, reason: "A PIN code has six digits and does not start with 0." };
  const district = districts?.[pin] ?? null;
  for (let length = 6; length >= 2; length--) {
    const prefix = pin.slice(0, length);
    const codes = table.prefixes[prefix];
    if (!codes) continue;
    if (!codes.length) return { kind: "no_state", pin, reason: "This is an Army Postal Service PIN. Enter the state yourself." };
    const candidates = codes.filter(code => GST_STATES[code]).map(code => ({ code, state: GST_STATES[code] }));
    if (candidates.length === 1) return { kind: "state", pin, code: candidates[0].code, state: candidates[0].state, district, prefix };
    return { kind: "choose", pin, candidates, district, prefix };
  }
  return { kind: "unknown", pin, reason: "This PIN prefix is not in the offline table. Enter the state yourself." };
}

/** Normalises a typed state to its GST spelling when it matches one exactly (case and spacing ignored). */
export function canonicalStateName(value: string): string {
  const key = value.trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const match = Object.values(GST_STATES).find(name => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key);
  return match ?? value;
}

let tableLoad: Promise<PinTable | null> | null = null;
let districtLoad: Promise<Record<string, string> | null> | null = null;

/** Loads the offline table once per page (browser only). Failure leaves the field for manual entry. */
export async function loadPinTable(fetcher: typeof fetch = fetch): Promise<{ table: PinTable | null; districts: Record<string, string> | null }> {
  tableLoad ??= fetcher("/data/pin-prefixes.json", { cache: "force-cache" }).then(r => (r.ok ? r.json() as Promise<PinTable> : null)).catch(() => null);
  const table = await tableLoad;
  if (!table) { tableLoad = null; return { table: null, districts: null }; }
  if (table.districts) {
    districtLoad ??= fetcher("/data/pin-districts.json", { cache: "force-cache" }).then(r => (r.ok ? r.json() : null)).then(j => (j?.districts ?? null) as Record<string, string> | null).catch(() => null);
  }
  return { table, districts: table.districts ? await districtLoad : null };
}
