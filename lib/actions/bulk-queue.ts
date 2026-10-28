"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bulkCommandSchema, bulkOutcomeSchema, canBulkJobs, canBulkTasks } from "@/lib/workflow/bulk-queue";

export type BulkActionResult = { success: true; data: unknown } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

const businessErrors = [
  "Choose a supported bulk change", "Choose an active employee of this company", "You can assign work only to employees in teams you supervise",
  "Choose a valid date", "Choose a date from today up to one year ahead", "Choose a valid priority", "Enter a shift name of up to 20 characters",
  "Select between 1 and 50 records", "The selection contains an invalid record reference", "A request identity is required",
  "Preview the change before applying it", "The request identity was already used for different details"
];

// UPGRADE_EOS feature 13. The database rechecks every record under lock; an uncertain apply is retried with the same request id.
export async function bulkQueueAction(input: unknown): Promise<BulkActionResult> {
  let apply = false;
  let submitted = false;
  try {
    const context = await getSessionContext();
    const parsed = bulkCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid bulk request" };
    const { command, change, ...rest } = parsed.data;
    apply = command === "bulk.apply";
    const allowed = change.target === "tasks" ? canBulkTasks(context.role) : canBulkJobs(context.role);
    if (context.dealerId || !allowed) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("bulk_queue_command", { p_command: command, p_payload: { ...change, ...rest } });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Bulk updates are not available on this database yet. The database upgrade must be applied first." };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      if (code === "P0001") return { success: false, error: businessErrors.includes(message) ? message : "The bulk change was rejected. Preview it again." };
      if (code === "55P03") return { success: false, uncertain: apply, error: "Some records are being changed by someone else. Retry the same request." };
      return { success: false, uncertain: apply, error: apply ? "Confirmation is unavailable. Retry the same request to check what was recorded." : "The preview could not be built. Retry." };
    }
    const data = bulkOutcomeSchema.parse(result.data);
    if (apply) {
      for (const path of change.target === "tasks" ? ["/tasks", "/tasks/bulk", "/tasks/handoffs"] : ["/production", "/production/bulk", "/production/database", "/production/schedule"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: apply && submitted, error: apply && submitted ? "Confirmation is unavailable. Retry the same request to check what was recorded." : "The bulk request could not be completed. Check your session and retry." };
  }
}
