"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageTriggerRules, canUseTriggers, parseTriggerCommand, recoveryResultSchema, ruleListSchema, runResultSchema, triggeredTaskListSchema, TRIGGER_WRITE_COMMANDS } from "@/lib/workflow/task-triggers";

export type TriggerActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Enter whole numbers for the threshold, look-back and due days", "Name the rule (3 to 120 characters)", "Choose a supported trigger event",
  "Choose who receives the work: a role, or a named employee with an optional fallback role", "The chosen employee is inactive or cannot take this kind of work",
  "Trigger rule is unavailable", "The event of an existing rule cannot be changed. Create a new rule instead", "This rule was changed by someone else. Reload it before saving",
  "A company can have at most 50 trigger rules",
  "Enter a threshold within the range for this event, a look-back of 0 to 90 days, a due policy of 0 to 30 days and a valid priority",
  "Triggered task is unavailable", "This task was already assigned or closed. Refresh the list", "The chosen employee cannot take this work", "Invalid page"
];

// UPGRADE_EOS feature 64. Creation, deduplication and assignment happen in the database.
export async function taskTriggerAction(input: unknown): Promise<TriggerActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = parseTriggerCommand(input);
    if (!parsed.success) return { success: false, error: parsed.error };
    const { command, ...payload } = parsed.data;
    const allowed = command === "rules.save" ? canManageTriggerRules(context.role) : canUseTriggers(context.role);
    if (context.dealerId || !allowed) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("task_trigger_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Task triggers are not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message) || /^The [a-z ]+ role cannot take this kind of work$/.test(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The task trigger request could not be completed. Refresh and retry." };
    }
    const data = command === "rules.list" ? ruleListSchema.parse(result.data)
      : command === "triggers.run" ? runResultSchema.parse(result.data)
      : command === "tasks.list" || command === "recovery.list" ? triggeredTaskListSchema.parse(result.data)
      : command === "recovery.assign" || command === "recovery.retry" ? recoveryResultSchema.parse(result.data)
      : result.data;
    if (TRIGGER_WRITE_COMMANDS.includes(command)) {
      for (const path of ["/tasks/triggers", "/tasks"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    // The request may have reached the database; a run is retried with the same request id.
    return { success: false, error: "The task trigger request could not be completed. Check your session and retry." };
  }
}
