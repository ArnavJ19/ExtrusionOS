"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageTargets, escalationListSchema, targetsSchema, turnaroundCommandSchema, turnaroundStatusSchema } from "@/lib/workflow/turnaround";

export type TurnaroundActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Choose a valid task kind", "Set a completion target, an optional shorter response target, a calendar and an escalation role", "Invalid task references",
  "Task is unavailable", "Only the assignee or a supervisor can record waiting time", "Only open work can wait", "Choose what the work is waiting for",
  "Say what the work is waiting for (3 to 300 characters)", "This task is already recorded as waiting", "This task is not waiting", "Invalid page"
];

// UPGRADE_EOS feature 71. Targets, waits and escalations are computed and recorded by the database.
export async function turnaroundAction(input: unknown): Promise<TurnaroundActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = turnaroundCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid turnaround request" };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || ((command === "targets.set" || command === "escalations.run") && !canManageTargets(context.role))) {
      return { success: false, error: "You do not have permission to use this action." };
    }
    const supabase = await createClient();
    const result = await supabase.rpc("turnaround_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Turnaround targets are not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The turnaround request could not be completed. Refresh and retry." };
    }
    const data = command === "task.status" ? turnaroundStatusSchema.parse(result.data)
      : command === "targets.list" ? targetsSchema.parse(result.data)
      : command === "escalations.list" ? escalationListSchema.parse(result.data)
      : command === "wait.start" || command === "wait.end" ? turnaroundStatusSchema.parse([result.data])[0]
      : result.data;
    if (command === "targets.set" || command === "escalations.run" || command === "wait.start" || command === "wait.end") {
      for (const path of ["/tasks", "/tasks/turnaround", "/tasks/handoffs"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The turnaround request could not be completed. Check your session and retry." };
  }
}
