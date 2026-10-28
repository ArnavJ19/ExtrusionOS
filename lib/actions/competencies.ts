"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageCompetencies, catalogSchema, competencyCommandSchema, holdersSchema, myGrantsSchema, requirementsSchema, standingResultSchema } from "@/lib/workflow/competencies";

export type CompetencyActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Procedure is unavailable", "Enter a code (capitals, digits, - or _), a name of 3 to 120 characters and a validity of 1 to 60 months if it expires",
  "That competency code is already used", "Competency is unavailable", "Choose an active competency", "Choose an active employee", "You cannot grant a competency to yourself",
  "Choose trained, supervised or independent", "Keep the note under 300 characters", "Record why the competency is withdrawn (3 to 300 characters)", "No current grant to withdraw",
  "Invalid page", "Choose QC release or production start", "Grant this competency at independent level to at least one employee before requiring it",
  "Choose the action, record and employee being supervised", "You cannot supervise yourself", "The record is unavailable", "This action does not require a competency",
  "Only an independent holder of the competency can confirm supervision"
];

const MANAGER_COMMANDS = new Set(["catalog.save", "grant.set", "grant.revoke", "requirements.set"]);

// UPGRADE_EOS feature 76. Grants, requirements and refusals are enforced by the database.
export async function competencyAction(input: unknown): Promise<CompetencyActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = competencyCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid competency request" };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || (MANAGER_COMMANDS.has(command) && !canManageCompetencies(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("competency_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Competencies are not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The competency request could not be completed. Refresh and retry." };
    }
    const data = command === "catalog.list" ? catalogSchema.parse(result.data)
      : command === "grants.list" ? ("employee_id" in payload && payload.employee_id ? myGrantsSchema.parse(result.data) : holdersSchema.parse(result.data))
      : command === "requirements.list" ? requirementsSchema.parse(result.data)
      : command === "standing" ? standingResultSchema.parse(result.data)
      : result.data;
    if (MANAGER_COMMANDS.has(command) || command === "supervise.confirm") {
      try { revalidatePath("/tasks/competencies"); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The competency request could not be completed. Check your session and retry." };
  }
}
