"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { canUseCollaboration, collaborationCommandSchema, collaborationReads, discussionTypes, parseCollaborationData, type CollaborationResult } from "@/lib/operations/collaboration-workflows";

const businessErrors = new Set(["Invalid request.","Invalid page or search.","A request identity is required.","The record is unavailable for your current company and role.","This request identity was already used for different details.","Enter a discussion and at most three permitted mentions.","The reply belongs to a different record.","Choose each mentioned colleague once.","A mentioned colleague cannot access this record.","Invalid procedure filter.","This procedure is unavailable for your company.","Choose an active opening or closing routine.","The process owner and backup are unavailable. Reassign ownership first.","Archived procedures cannot be reviewed.","Record the review and choose a future review date.","Enter a procedure, distinct owner and backup, and up to six observation prompts.","Observation prompts must be short nonempty text.","Choose an active authorised process owner.","Choose an active authorised backup.","Record a reason for the change.","This procedure changed. Refresh before continuing.","Invalid routine filter.","This routine is unavailable for your company.","This routine is already completed.","Review the work context, answer every observation, and record the handover outcome.","Answer each approved observation once and explain any follow-up.","Work context changed. Refresh and review it before completing the routine."]);

export async function collaborationWorkflowAction(input: unknown): Promise<CollaborationResult> {
  let mutation = false, submitted = false;
  try {
    const context = await getSessionContext(), parsed = collaborationCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || !canUseCollaboration(context.role, command, "entity_type" in payload ? payload.entity_type : undefined)) return { success: false, error: "This action is not permitted for your current session." };
    mutation = !collaborationReads.includes(command);
    const client = await createClient(); submitted = true;
    const result = await client.rpc("collaboration_workflow_command", { p_command: command, p_payload: payload });
    if (result.error) {
      if (["PGRST202", "42883", "42P01"].includes(result.error.code ?? "")) return { success: false, unavailable: true, error: "These collaboration tools require the database upgrade before they can be used." };
      if (result.error.code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      if (result.error.code === "P0001") return { success: false, error: businessErrors.has(result.error.message.slice(10)) && result.error.message.startsWith("WORKFLOW: ") ? result.error.message.slice(10) : "Current workflow rules rejected this action. Refresh and review the record." };
      if (["23505", "23503", "23514", "22P02", "22007", "22008"].includes(result.error.code ?? "")) return { success: false, error: "The details conflict with current records. Refresh and review them." };
      return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to verify its result." : "Current information is unavailable. Refresh to retry." };
    }
    const data = parseCollaborationData(result.data, command);
    if (mutation) {
      const paths = ["/tasks/procedures", "/tasks/routines", "/notifications"];
      if ("procedure_id" in payload) paths.push(`/tasks/procedures/${payload.procedure_id}`);
      if (command === "procedures.create") paths.push(`/tasks/procedures/${data.id}`);
      if ("entity_type" in payload) paths.push(`${discussionTypes[payload.entity_type].path}/${payload.entity_id}`);
      for (const path of paths) { try { revalidatePath(path); } catch { /* Keep confirmed writes confirmed. */ } }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Retry the same request to verify its result." : "The request could not be completed. Check your session and retry." };
  }
}
