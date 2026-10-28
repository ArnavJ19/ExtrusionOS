"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canDelegate, candidatesSchema, delegationCommandSchema, delegationDetailSchema, delegationListSchema } from "@/lib/workflow/task-delegation";

export type DelegationActionResult = { success: true; data: unknown } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

const businessErrors = [
  "A request identity is required", "The request identity was already used for different details", "Choose two employees of this company; the replacement must be active",
  "Choose a different employee as the replacement", "You can delegate only between employees in teams you supervise", "Choose a valid start and end",
  "Choose a period that starts now or later, ends after it starts, and lasts at most 90 days", "Choose all open tasks or a selection",
  "Record why the work is delegated (3 to 300 characters)", "Choose the tasks to delegate", "Choose between 1 and 100 tasks to delegate",
  "A selection of tasks is delegated from now; schedule only all-open delegations", "This employee already has a delegation in that period",
  "The replacement is away in that period", "Delegation is unavailable", "This delegation has already ended",
  "Record why the delegation ends early (3 to 300 characters)", "Employee is unavailable", "Invalid delegation list request"
];

// UPGRADE_EOS feature 35. Company and actor come from the session; the database checks eligibility and supervision.
export async function taskDelegationAction(input: unknown): Promise<DelegationActionResult> {
  let mutation = false;
  let submitted = false;
  try {
    const context = await getSessionContext();
    const parsed = delegationCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid delegation request" };
    const { command, ...payload } = parsed.data;
    mutation = command === "delegation.create" || command === "delegation.cancel";
    if (context.dealerId || ((mutation || command === "delegation.candidates") && !canDelegate(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("task_delegation_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Task delegation is not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "Delegations could not be loaded. Retry." };
    }
    const data = command === "delegation.list" ? delegationListSchema.parse(result.data)
      : command === "delegation.load" ? delegationDetailSchema.parse(result.data)
      : command === "delegation.candidates" ? candidatesSchema.parse(result.data)
      : result.data;
    if (mutation || command === "delegation.sync") {
      for (const path of ["/tasks", "/tasks/delegations"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "The delegation request could not be completed. Check your session and retry." };
  }
}
