"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CRITERIA_SUPERVISOR_COMMANDS, CRITERIA_WRITE_COMMANDS, canManageTemplates, canSuperviseCriteria, evaluationSchema, parseCriteriaCommand, reviewListSchema, templateListSchema
} from "@/lib/workflow/completion-criteria";

export type CriteriaActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Choose the kind of task the criterion applies to", "Describe the criterion (3 to 120 characters)", "Criterion template is unavailable",
  "This template was changed by someone else. Reload it before saving", "A task kind can have at most 10 active criteria", "Invalid page", "Task is unavailable",
  "Only a completed task can be reopened", "Record why the task is reopened (3 to 300 characters)", "Criteria can be changed only while the task is open",
  "This task is not linked to a record, so it cannot check one", "A task can have at most 10 criteria", "Criterion is unavailable",
  "Record why the criterion is removed (3 to 300 characters)", "Evidence can be recorded only while the task is open", "This criterion does not take an observation",
  "Only the assignee or a supervisor can record results", "Enter the observed value as a number", "This criterion does not take a sign-off",
  "Your role cannot sign off this criterion", "The assignee cannot sign off their own work",
  // Settings problems (private.criterion_config_problem).
  "Invalid criterion settings", "Choose the kind of record this criterion checks", "Choose at least one required state", "A required state does not exist for this kind of record",
  "Give the unit of the observation (1 to 20 characters)", "Observation limits must be numbers", "Set at least one observation limit", "The lower limit is above the upper limit",
  "Choose who may sign off", "Only supervisors, quality or accounts can sign off", "Choose a supported criterion"
];

// UPGRADE_EOS feature 67. Criteria are evaluated, and completion refused, by the database.
export async function completionCriteriaAction(input: unknown): Promise<CriteriaActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = parseCriteriaCommand(input);
    if (!parsed.success) return { success: false, error: parsed.error };
    const { command, ...payload } = parsed.data;
    const allowed = command === "templates.save" ? canManageTemplates(context.role) : CRITERIA_SUPERVISOR_COMMANDS.includes(command) ? canSuperviseCriteria(context.role) : true;
    if (context.dealerId || !allowed) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("task_criteria_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Completion criteria are not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The completion criteria request could not be completed. Refresh and retry." };
    }
    const data = command === "templates.list" ? templateListSchema.parse(result.data)
      : command === "review.list" ? reviewListSchema.parse(result.data)
      : command === "task.evaluate" || command === "evidence.observe" || command === "evidence.sign_off" ? evaluationSchema.parse(result.data)
      : result.data;
    if (CRITERIA_WRITE_COMMANDS.includes(command)) {
      const paths = ["/tasks/criteria", ...("task_id" in payload ? [`/tasks/${String(payload.task_id)}`] : [])];
      for (const path of paths) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The completion criteria request could not be completed. Check your session and retry." };
  }
}
