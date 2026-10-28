"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { candidateSchema, canManageProjects, canReadProjects, linkResultSchema, projectCommandSchema, projectDetailSchema, projectListSchema } from "@/lib/workflow/customer-projects";

export type ProjectActionResult = { success: true; data: unknown } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

const businessErrors = [
  "A request identity and customer are required", "The request identity was already used for different details", "Choose an active customer",
  "This customer already has a project with that name", "Enter a project name of 2 to 120 characters", "Enter a valid 6-digit PIN code",
  "Enter a valid Indian mobile number", "Project is unavailable", "The project changed since you opened it. Refresh and review it", "Choose a valid project status",
  "Reopen the project before linking more transactions", "Choose a quotation, order or dispatch to link", "The selected record is unavailable",
  "Only transactions for this project's customer can be linked", "This record is already grouped under another project. Unlink it there first",
  "Record why the record is being removed from the project", "That record is not linked to this project", "Invalid candidate request", "Invalid project search"
];

const MUTATIONS = new Set(["project.create", "project.update", "project.link", "project.unlink"]);

// UPGRADE_EOS feature 43. Company and actor come from the session; the RPC rechecks customer and company on every link.
export async function customerProjectAction(input: unknown): Promise<ProjectActionResult> {
  let mutation = false;
  let submitted = false;
  try {
    const context = await getSessionContext();
    const parsed = projectCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid project request" };
    const { command, ...payload } = parsed.data;
    mutation = MUTATIONS.has(command);
    if (context.dealerId || !(mutation ? canManageProjects(context.role) : canReadProjects(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("customer_project_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Projects are not available on this database yet. The database upgrade must be applied first." };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      if (code === "P0001" || code === "23514" || code === "23505") {
        if (message.startsWith("Check the ") && message.endsWith(" field")) return { success: false, error: message };
        return { success: false, error: businessErrors.includes(message) ? message : "The project change was rejected by current rules. Refresh and review it." };
      }
      return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "Project information could not be loaded. Retry to check it." };
    }
    const data = command === "project.load" ? projectDetailSchema.parse(result.data)
      : command === "project.list" ? projectListSchema.parse(result.data)
      : command === "project.candidates" ? candidateSchema.parse(result.data)
      : command === "project.link" ? linkResultSchema.parse(result.data)
      : result.data;
    if (mutation) {
      const id = "project_id" in payload ? payload.project_id : (result.data as { id?: string } | null)?.id;
      for (const path of ["/customers/projects", ...(id ? [`/customers/projects/${id}`] : [])]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "The project request could not be completed. Check your session and retry." };
  }
}
