"use client";

// AP-094: the offline queue with the Autopilot gateway transport (public.ap_offline records each request ID with its
// effect, so a retry never posts twice). Used by the press station, loading station and QC sample record.
import { autopilotAction } from "@/lib/actions/autopilot";
import type { OfflineEntry, SendOutcome } from "@/lib/offline/queue";
import { OfflineQueuePanel, useOfflineQueueCore, type OfflineQueue, type OfflineTransport } from "./offline-core";

export { OfflineQueuePanel, type OfflineQueue };

// From the queue, a scan the server answered with "refused" or "needs a note" is shown as a conflict; sent straight
// away, the screen handles those answers itself.
async function send(entry: OfflineEntry, fromQueue: boolean): Promise<SendOutcome> {
  const result = await autopilotAction("ap_offline", "submit", { request_id: entry.request_id, rpc: entry.rpc, command: entry.command, payload: entry.payload, queued_at: entry.queued_at });
  if (!result.success) {
    if (/check your (connection|session) and retry/i.test(result.error)) return { kind: "retry", message: result.error };
    return { kind: "conflict", message: result.error };
  }
  const data = result.data as { state: "applied" | "conflict"; message?: string | null; result?: unknown };
  if (data.state !== "applied") {
    // Refused while the employee is watching: the screen shows it, so the server-side conflict is closed at once.
    if (!fromQueue) { try { await autopilotAction("ap_offline", "resolve", { request_id: entry.request_id, resolution: "discarded" }); } catch { /* stays listed for the employee */ } }
    return { kind: "conflict", message: data.message ?? "The server refused this entry." };
  }
  const answer = data.result as { state?: string; message?: string } | null;
  if (fromQueue && entry.rpc === "ap_dispatch" && answer && (answer.state === "refused" || answer.state === "confirm")) return { kind: "conflict", message: answer.message ?? "The scan needs attention." };
  return { kind: "applied", data: data.result };
}
const gateway: OfflineTransport = {
  send,
  resolve: async (entry, resolution) => { await autopilotAction("ap_offline", "resolve", { request_id: entry.request_id, resolution }); }
};

export function useOfflineQueue(companyId: string, userId: string, onApplied?: () => void) {
  return useOfflineQueueCore(companyId, userId, gateway, onApplied);
}
