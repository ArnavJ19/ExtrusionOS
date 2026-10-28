"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canReadLineSchedule, canSetLineSchedule, lineHistorySchema, lineListSchema, lineQueueSchema, lineScheduleCommandSchema } from "@/lib/workflow/order-line-schedule";

export type LineScheduleActionResult = { success: true; data: unknown } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

const businessErrors = [
  "Order is unavailable", "Order line is unavailable", "Choose a valid required date", "Choose a valid priority",
  "A request identity, line and version are required", "Record why the line requirement is changing (up to 500 characters)",
  "The request identity was already used for different details", "Delivery requirements cannot change on a delivered, closed or cancelled order",
  "The line requirement changed since you opened it. Refresh and review it", "The required date must fall between the order date and two years after it",
  "Choose today or a later required date", "Nothing changed on this line", "This line is fully packed. Its delivery requirement can no longer change",
  "Invalid page", "Invalid queue request"
];

// UPGRADE_EOS feature 38. Company and actor come from the session; the RPC rechecks role, tenancy and state.
export async function orderLineScheduleAction(input: unknown): Promise<LineScheduleActionResult> {
  let mutation = false;
  let submitted = false;
  try {
    const context = await getSessionContext();
    const parsed = lineScheduleCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid schedule request" };
    const { command, ...payload } = parsed.data;
    mutation = command === "schedule.set";
    if (context.dealerId || !(mutation ? canSetLineSchedule(context.role) : canReadLineSchedule(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("order_line_schedule_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Line delivery schedules are not available on this database yet. The database upgrade must be applied first." };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      if (code === "P0001" || code === "23514" || code === "23505") return { success: false, error: businessErrors.includes(message) ? message : "The change was rejected by current order rules. Refresh and review the line." };
      if (code === "55P03") return { success: false, error: "The order is being changed by someone else. Refresh and retry." };
      return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "Line requirements could not be loaded. Retry to check them." };
    }
    const data = command === "schedule.lines" ? lineListSchema.parse(result.data)
      : command === "schedule.queue" ? lineQueueSchema.parse(result.data)
      : command === "schedule.history" ? lineHistorySchema.parse(result.data)
      : result.data;
    if (mutation) {
      for (const path of ["/orders", "/production", "/dispatches"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "The schedule request could not be completed. Check your session and retry." };
  }
}
