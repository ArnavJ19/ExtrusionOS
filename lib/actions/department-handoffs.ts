"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { acceptanceCommandSchema, acceptanceStatusSchema, canReadHandoffs, canReprocessHandoffs, handoffCommandSchema, handoffQueueSchema, policyListSchema } from "@/lib/workflow/department-handoffs";

export type HandoffActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = ["Handoff is unavailable", "This handoff was already taken or closed. Refresh the queue", "Choose a quality inspection, finishing job or packaging job", "Invalid handoff queue request"];

// UPGRADE_EOS feature 14. Taking and reprocessing are idempotent in the database, so a retry is always safe.
export async function departmentHandoffAction(input: unknown): Promise<HandoffActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = handoffCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid handoff request" };
    const { command, ...payload } = parsed.data;
    const allowed = command === "handoff.reprocess" ? canReprocessHandoffs(context.role) : command === "handoff.take" ? canReadHandoffs(context.role) && context.role !== "viewer" : canReadHandoffs(context.role);
    if (context.dealerId || !allowed) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("department_handoff_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Department handoffs are not available on this database yet. The database upgrade must be applied first." };
      if (code === "42501") return { success: false, error: message === "This handoff belongs to another team" ? message : "This action is not permitted for your current session." };
      if (code === "P0001") return { success: false, error: businessErrors.includes(message) ? message : "The handoff action was rejected. Refresh and retry." };
      // UPGRADE_EOS feature 61: a task blueprint's start prerequisites, generated from current records.
      if (code === "23514" && message.startsWith("This task cannot start yet:")) return { success: false, error: message };
      return { success: false, error: "The handoff request could not be confirmed. Retrying is safe." };
    }
    const data = command === "handoff.list" ? handoffQueueSchema.parse(result.data) : result.data;
    if (command !== "handoff.list") {
      for (const path of ["/tasks", "/tasks/handoffs"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The handoff request could not be completed. Check your session and retry." };
  }
}

const acceptanceErrors = [
  "Handoff is unavailable", "This handoff belongs to another team", "This handoff was already accepted", "This handoff is waiting for its return to be resolved",
  "This handoff is already closed", "Enter the quantity received", "Keep the note under 500 characters", "Choose what is missing",
  "Describe what the source team must resolve (5 to 500 characters)", "This handoff already has an open return", "Only a handoff that has not been started can be returned",
  "Choose a team", "Set a quantity tolerance between 0 and 10 percent", "Invalid handoff references"
];

// UPGRADE_EOS feature 69. Acceptance prerequisites and tolerances are evaluated by the database.
export async function handoffAcceptanceAction(input: unknown): Promise<HandoffActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = acceptanceCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid handoff request" };
    const { command, ...payload } = parsed.data;
    const managers = ["owner", "admin", "factory_manager"];
    const allowed = command === "policy.set" ? managers.includes(context.role)
      : command === "acceptance.accept" || command === "acceptance.return" ? canReadHandoffs(context.role) && context.role !== "viewer"
      : canReadHandoffs(context.role);
    if (context.dealerId || !allowed) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("handoff_acceptance_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Handoff acceptance is not available on this database yet. The database upgrade must be applied first." };
      // Prerequisite and quantity messages are generated from current records; show them as written.
      if (code === "23514" && (message.startsWith("Cannot accept yet:") || message.startsWith("Received "))) return { success: false, error: message };
      if (acceptanceErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The handoff could not be updated. Refresh and retry; retrying is safe." };
    }
    const data = command === "acceptance.status" ? acceptanceStatusSchema.parse(result.data) : command === "policy.list" ? policyListSchema.parse(result.data) : result.data;
    if (command !== "acceptance.status" && command !== "policy.list") {
      for (const path of ["/tasks", "/tasks/handoffs"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The handoff request could not be completed. Check your session and retry." };
  }
}
