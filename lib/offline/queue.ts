// AP-094: a per-employee queue of factory phone entries kept in IndexedDB while the connection is down.
// Every entry carries its own request ID from the moment it is created; the server records that ID with the effect in
// one transaction (public.ap_offline, or the bundle writer's own identity), so a retry after a lost response posts
// nothing twice. Business refusals become conflicts for the employee to resolve; only connection failures are retried.

export type OfflineKind = "ap" | "bundle";
export type OfflineEntry = {
  request_id: string; owner: string; kind: OfflineKind; rpc: string; command: string; payload: Record<string, unknown>; label: string;
  queued_at: string; attempts: number; state: "pending" | "conflict"; message?: string | null;
};
export type SendOutcome = { kind: "applied"; data?: unknown } | { kind: "conflict"; message: string } | { kind: "retry"; message?: string };

const DB = "extrusionos-offline", STORE = "entries";
const memory = new Map<string, OfflineEntry>();
let persistent: boolean | null = null;

export const ownerKey = (companyId: string, userId: string) => `${companyId}:${userId}`;

function open(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") { persistent = false; resolve(null); return; }
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => { const store = request.result.createObjectStore(STORE, { keyPath: "request_id" }); store.createIndex("owner", "owner"); };
      request.onsuccess = () => { persistent = true; resolve(request.result); };
      request.onerror = () => { persistent = false; resolve(null); };
      request.onblocked = () => { persistent = false; resolve(null); };
    } catch { persistent = false; resolve(null); }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode); const request = work(tx.objectStore(STORE)); let value: T | undefined;
    if (request) request.onsuccess = () => { value = request.result; };
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

/** True when entries survive a reload on this device (IndexedDB available). */
export const isPersistent = () => persistent;

export async function putEntry(entry: OfflineEntry) {
  memory.set(entry.request_id, entry);
  try { await run("readwrite", store => store.put(entry)); } catch { /* the in-memory copy still sends while this page is open */ }
}
export async function removeEntry(requestId: string) {
  memory.delete(requestId);
  try { await run("readwrite", store => store.delete(requestId)); } catch { /* removed from memory */ }
}
export async function listEntries(owner: string): Promise<OfflineEntry[]> {
  let stored: OfflineEntry[] | undefined;
  try { stored = await run<OfflineEntry[]>("readonly", store => store.index("owner").getAll(owner)); } catch { stored = undefined; }
  const byId = new Map<string, OfflineEntry>();
  for (const e of stored ?? []) byId.set(e.request_id, e);
  for (const e of memory.values()) if (e.owner === owner && !byId.has(e.request_id)) byId.set(e.request_id, e);
  return [...byId.values()].sort((a, b) => a.queued_at.localeCompare(b.queued_at) || a.request_id.localeCompare(b.request_id));
}

export function newEntry(input: { owner: string; kind: OfflineKind; rpc: string; command: string; payload: Record<string, unknown>; label: string; requestId?: string; now?: Date }): OfflineEntry {
  const request_id = input.requestId ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : fallbackUuid());
  return { request_id, owner: input.owner, kind: input.kind, rpc: input.rpc, command: input.command, payload: input.payload, label: input.label,
    queued_at: (input.now ?? new Date()).toISOString(), attempts: 0, state: "pending", message: null };
}
function fallbackUuid() {
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Sends pending entries oldest first. Stops at the first connection failure so order is kept; conflicts stay listed. */
export async function flushEntries(owner: string, send: (entry: OfflineEntry) => Promise<SendOutcome>): Promise<{ applied: number; conflicts: number; waiting: number }> {
  let applied = 0, conflicts = 0;
  const entries = await listEntries(owner);
  for (const entry of entries) {
    if (entry.state !== "pending") continue;
    let outcome: SendOutcome;
    try { outcome = await send(entry); } catch { outcome = { kind: "retry" }; }
    if (outcome.kind === "applied") { await removeEntry(entry.request_id); applied++; }
    else if (outcome.kind === "conflict") { await putEntry({ ...entry, state: "conflict", message: outcome.message, attempts: entry.attempts + 1 }); conflicts++; }
    else { await putEntry({ ...entry, attempts: entry.attempts + 1, message: outcome.message ?? "Waiting for a connection." }); break; }
  }
  const left = await listEntries(owner);
  return { applied, conflicts, waiting: left.filter(e => e.state === "pending").length };
}

/** Moves older press-station taps (batch 2 localStorage queue) into this queue once, keeping their IDs. */
export function legacyTapEntries(owner: string, raw: string | null): OfflineEntry[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(t => t && typeof t.id === "string" && typeof t.session_id === "string" && typeof t.job_id === "string")
      .map(t => ({ request_id: t.id, owner, kind: "ap" as const, rpc: "ap_press", command: "push", payload: { id: t.id, session_id: t.session_id, job_id: t.job_id, ...(t.client_at ? { client_at: t.client_at } : {}) },
        label: "Press push", queued_at: typeof t.client_at === "string" ? t.client_at : new Date().toISOString(), attempts: 0, state: "pending" as const, message: null }));
  } catch { return []; }
}
