// AP-090: the last five values a person chose in a selector, kept in this browser per signed-in user and field.
// Storage can be unavailable (private window, blocked site data); every read and write falls back silently.
// Only values that are also in the selector's current, server-authorised options are ever shown.

export const RECENT_LIMIT = 5;
const PREFIX = "exos.recent.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function recentStorageKey(userScope: string, field: string): string | null {
  const scope = userScope.trim(), name = field.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "-").slice(0, 80);
  if (!scope || !name) return null;
  return `${PREFIX}:${scope}:${name}`;
}

function storage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function readRecent(key: string | null, store: StorageLike | null = storage()): string[] {
  if (!key || !store) return [];
  try {
    const value = JSON.parse(store.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200).slice(0, RECENT_LIMIT) : [];
  } catch { return []; }
}

/** Puts the value first, without duplicates, keeping at most five. Returns the new list. */
export function rememberRecent(key: string | null, value: string, store: StorageLike | null = storage()): string[] {
  if (!key || !value || value.length > 200) return readRecent(key, store);
  const next = [value, ...readRecent(key, store).filter(v => v !== value)].slice(0, RECENT_LIMIT);
  try { store?.setItem(key, JSON.stringify(next)); } catch { /* storage full or blocked: the selection itself still stands */ }
  return next;
}

/** Recent options first (in recency order, only those still offered), then the rest in their original order. */
export function orderWithRecent<T extends { value: string; disabled?: boolean }>(options: T[], recent: string[]): { recent: T[]; rest: T[] } {
  const byValue = new Map(options.map(option => [option.value, option]));
  const first = recent.map(value => byValue.get(value)).filter((option): option is T => Boolean(option) && !option!.disabled);
  const chosen = new Set(first.map(option => option.value));
  return { recent: first, rest: options.filter(option => !chosen.has(option.value)) };
}
