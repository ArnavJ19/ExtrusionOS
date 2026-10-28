"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canMapTaskKinds, kindsListSchema, procedureVersionCommandSchema, taskInstructionsSchema, versionSchema, versionSummarySchema, versionsListSchema } from "@/lib/workflow/procedure-versions";

export type ProcedureVersionActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const procedureVersionBusinessErrors = [
  "Procedure is unavailable", "Procedure version is unavailable", "Task is unavailable", "This procedure is inactive", "Invalid page",
  "Choose the kind of task the procedure applies to", "This version was changed by someone else. Reload it before continuing",
  "Only the procedure owner, its backup or an owner/admin can write procedure versions", "Only the procedure owner, its backup or an owner/admin can review procedure versions",
  "Write between 1 and 30 steps", "Each step needs an instruction of 3 to 300 characters", "Keep each key check under 200 characters",
  "Summarise what this version changes (3 to 500 characters)", "This procedure already has a draft or a version in review. Continue that one",
  "Only a draft can be edited. Start a new draft", "Only a draft can be sent for review", "Only a draft can be discarded", "Only a version in review can be returned",
  "You wrote this version, so someone else must review it", "Explain what must change (3 to 500 characters)", "Only a version in review can be released",
  "Choose an effective date from today up to a year ahead", "Choose what happens to tasks already given an earlier version",
  "A later release is already scheduled. Choose a date on or after it, or withdraw it first", "Keep the review note under 500 characters",
  "Only a scheduled release can be withdrawn", "This version is already in effect. Release a newer version instead of withdrawing it",
  "Record why the release is withdrawn (3 to 300 characters)",
  "A task with recorded procedure instructions cannot move to another company or dealership"
];

const WRITE_COMMANDS = new Set(["draft.save", "draft.submit", "draft.discard", "review.return", "review.release", "release.withdraw", "kinds.set", "sync"]);
const MANAGER_COMMANDS = new Set(["kinds.set", "sync"]);

// UPGRADE_EOS feature 77. Authorship, four-eyes review and effective dates are enforced by the database.
export async function procedureVersionAction(input: unknown): Promise<ProcedureVersionActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = procedureVersionCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid procedure version request" };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || context.role.startsWith("dealer_") || (WRITE_COMMANDS.has(command) && context.role === "viewer") || (MANAGER_COMMANDS.has(command) && !canMapTaskKinds(context.role))) {
      return { success: false, error: "You do not have permission to use this action." };
    }
    const supabase = await createClient();
    const result = await supabase.rpc("procedure_version_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Procedure versions are not available on this database yet. The database upgrade must be applied first." };
      if (procedureVersionBusinessErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The procedure version request could not be completed. Refresh and retry." };
    }
    const data = command === "versions.list" ? versionsListSchema.parse(result.data)
      : command === "version.load" || command === "draft.save" ? versionSchema.parse(result.data)
      : command === "kinds.list" ? kindsListSchema.parse(result.data)
      : command === "task.instructions" ? taskInstructionsSchema.parse(result.data)
      : ["draft.submit", "draft.discard", "review.return", "review.release", "release.withdraw"].includes(command) ? versionSummarySchema.parse(result.data)
      : result.data;
    if (WRITE_COMMANDS.has(command)) {
      try { revalidatePath("/tasks/procedures", "layout"); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The procedure version request could not be completed. Check your session and retry." };
  }
}
