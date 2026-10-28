import type { SupabaseClient } from "@supabase/supabase-js";
import { lineListSchema, lineQueueSchema, type LineQueue, type LineRequirement } from "./order-line-schedule.ts";

const UNAVAILABLE = ["PGRST202", "42883", "42P01"];
const unavailableText = "Line delivery requirements are not available on this database yet. The database upgrade must be applied first.";

/** Server-side first load for the order page. Never throws: the page still renders without it. */
export async function loadOrderLineSchedule(client: Pick<SupabaseClient, "rpc">, orderId: string): Promise<{ data: { rows: LineRequirement[]; today: string } | null; message: string | null }> {
  try {
    const result = await client.rpc("order_line_schedule_command", { p_command: "schedule.lines", p_payload: { order_id: orderId } });
    if (result.error) return { data: null, message: UNAVAILABLE.includes(result.error.code ?? "") ? unavailableText : "Line delivery requirements could not be loaded. Refresh to retry." };
    const parsed = lineListSchema.safeParse(result.data);
    return parsed.success ? { data: parsed.data, message: null } : { data: null, message: "Line delivery requirements returned an unexpected shape. Refresh to retry." };
  } catch {
    return { data: null, message: "Line delivery requirements could not be loaded. Refresh to retry." };
  }
}

/** Server-side first page of the production or dispatch line queue. */
export async function loadLineDeliveryQueue(client: Pick<SupabaseClient, "rpc">, scope: "production" | "dispatch"): Promise<{ data: LineQueue | null; message: string | null }> {
  try {
    const result = await client.rpc("order_line_schedule_command", { p_command: "schedule.queue", p_payload: { scope, filter: "all", page: 1 } });
    if (result.error) return { data: null, message: UNAVAILABLE.includes(result.error.code ?? "") ? unavailableText : "The line queue could not be loaded. Refresh to retry." };
    const parsed = lineQueueSchema.safeParse(result.data);
    return parsed.success ? { data: parsed.data, message: null } : { data: null, message: "The line queue returned an unexpected shape. Refresh to retry." };
  } catch {
    return { data: null, message: "The line queue could not be loaded. Refresh to retry." };
  }
}
