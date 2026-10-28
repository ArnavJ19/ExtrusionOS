"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { blueprintLoadSchema, blueprintsListSchema, canManageBlueprints, exceptionsListSchema, taskBlueprintCommandSchema, taskBlueprintSchema } from "@/lib/workflow/task-blueprints";

export type TaskBlueprintActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const taskBlueprintBusinessErrors = [
  "Blueprint is unavailable", "Invalid page", "Record why the blueprint is saved (3 to 300 characters)", "Choose the kind of task the blueprint applies to",
  "List up to 10 inputs", "Each input needs 2 to 120 characters", "Choose at least one responsible employee role", "List up to 6 prerequisites",
  "Each prerequisite needs a kind and a record type", "A record-state prerequisite needs at least one state", "A required state is not valid for that record type",
  "All prerequisites must refer to the same linked record type", "Choose the role that resolves exceptions", "Fill in the title, purpose, trigger and exception instruction",
  "This blueprint was changed by someone else. Reload it before saving", "That task kind already has a blueprint. Edit it instead",
  "Exception is unavailable", "This exception is already resolved", "Only the role this exception is routed to can resolve it",
  "Someone other than the employee who raised it must resolve it", "Record the outcome (3 to 500 characters)", "Task is unavailable",
  "This task has no blueprint, so it has no exception route", "Exceptions can be raised only while the task is open", "Only the assignee or a supervisor can raise an exception",
  "Describe why the task cannot proceed (3 to 500 characters)", "An exception is already open for this task"
];
const PASSED_REFUSALS = new Set(["Only the role this exception is routed to can resolve it", "Someone other than the employee who raised it must resolve it", "Only the assignee or a supervisor can raise an exception"]);
const WRITE_COMMANDS = new Set(["blueprint.save", "exception.raise", "exception.resolve"]);

// UPGRADE_EOS feature 61. Prerequisites, exception routing and resolution rights are enforced by the database.
export async function taskBlueprintAction(input: unknown): Promise<TaskBlueprintActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = taskBlueprintCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid blueprint request" };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || context.role.startsWith("dealer_") || (command === "blueprint.save" && !canManageBlueprints(context.role)) || (WRITE_COMMANDS.has(command) && context.role === "viewer")) {
      return { success: false, error: "You do not have permission to use this action." };
    }
    const supabase = await createClient();
    const result = await supabase.rpc("task_blueprint_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Task blueprints are not available on this database yet. The database upgrade must be applied first." };
      if (code === "42501") return { success: false, error: PASSED_REFUSALS.has(message) ? message : "This action is not permitted for your current session." };
      if (taskBlueprintBusinessErrors.includes(message)) return { success: false, error: message };
      return { success: false, error: "The blueprint request could not be completed. Refresh and retry." };
    }
    const data = command === "blueprints.list" ? blueprintsListSchema.parse(result.data)
      : command === "blueprint.load" ? blueprintLoadSchema.parse(result.data)
      : command === "task.blueprint" ? taskBlueprintSchema.parse(result.data)
      : command === "exceptions.list" ? exceptionsListSchema.parse(result.data)
      : result.data;
    if (WRITE_COMMANDS.has(command)) {
      try { revalidatePath("/tasks", "layout"); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The blueprint request could not be completed. Check your session and retry." };
  }
}
