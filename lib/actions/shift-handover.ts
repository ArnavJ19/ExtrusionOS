"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canReadHandover, canSubmitHandover, handoverCommandSchema, handoverListSchema, handoverRecordSchema, handoverSummarySchema } from "@/lib/workflow/shift-handover";

export type HandoverActionResult = { success: true; data: unknown } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

const businessErrors = [
  "Choose a valid shift start and end", "Choose a shift window of up to 24 hours that has ended within the last 31 days",
  "A request identity is required", "Enter a shift name and a note of up to 2,000 characters",
  "The request identity was already used for different details", "A handover overlapping this shift window was already submitted",
  "Keep the acknowledgement note under 1,000 characters", "Handover is unavailable", "This handover was already acknowledged",
  "The incoming supervisor must acknowledge the handover, not the person who prepared it", "Invalid page"
];

// UPGRADE_EOS feature 39. Company and actor come from the session; the RPC rechecks role and tenancy.
export async function shiftHandoverAction(input: unknown): Promise<HandoverActionResult> {
  let mutation = false;
  let submitted = false;
  try {
    const context = await getSessionContext();
    const parsed = handoverCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid handover request" };
    const { command, ...payload } = parsed.data;
    mutation = command === "handover.submit" || command === "handover.acknowledge";
    if (context.dealerId || !(mutation ? canSubmitHandover(context.role) : canReadHandover(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("shift_handover_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Shift handovers are not available on this database yet. The database upgrade must be applied first." };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      if (code === "P0001" || code === "23514" || code === "23505") return { success: false, error: businessErrors.includes(message) ? message : "The handover was rejected by current rules. Refresh and review it." };
      if (code === "22P02") return { success: false, error: "The handover reference is not valid." };
      return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "Handover information could not be loaded. Retry to check it." };
    }
    const data = command === "handover.preview" ? handoverSummarySchema.parse(result.data)
      : command === "handover.load" ? handoverRecordSchema.parse(result.data)
      : command === "handover.list" ? handoverListSchema.parse(result.data)
      : result.data;
    if (mutation) {
      const id = (result.data as { id?: string } | null)?.id;
      for (const path of ["/production/handover", ...(id ? [`/production/handover/${id}`] : [])]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "The handover request could not be completed. Check your session and retry." };
  }
}
