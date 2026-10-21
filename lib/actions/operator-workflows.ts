"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canUseOperatorCommand, operatorCommandSchema, operatorUnavailableMessage, parseOperatorData, type OperatorResult } from "@/lib/operations/operator-workflows";

const businessErrors = new Set([
  "Customer is unavailable for this company", "Customer is inactive", "Alias is unavailable",
  "Choose one exact active canonical profile code", "Enter a valid alias and canonical profile code",
  "The request identity was already used for different details", "This alias mapping already exists or the request identity was reused",
  "Enter a valid physical location and move reason", "Record is unavailable for this company",
  "The location changed. Refresh and review the current location before moving it", "Choose a different physical location",
  "Choose an exception reason and explain other exceptions", "Production job is unavailable for this company",
  "Commitment is unavailable", "This commitment is already closed", "Record the reason or outcome",
  "The due date changed. Refresh before rescheduling", "Choose a different valid due date",
  "Enter a commitment and a valid due date", "Use valid calendar dates", "Invalid due date",
  "Invalid commitment status", "Invalid commitment outcome", "Invalid commitment queue filters"
]);

export async function operatorWorkflowAction(input: unknown): Promise<OperatorResult> {
  let mutation = false;
  let submitted = false;
  try {
    const context = await getSessionContext();
    const parsed = operatorCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid workflow request" };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || !canUseOperatorCommand(context.role, command, "entity_type" in payload ? payload.entity_type : undefined)) return { success: false, error: "You do not have permission to use this action." };
    if (parsed.data.command === "exceptions.report" && parsed.data.reason === "other" && !parsed.data.note) return { success: false, error: "Explain the other exception." };
    mutation = !["aliases.list", "aliases.search", "locations.load", "exceptions.list", "commitments.list", "commitments.history", "commitments.queue"].includes(command);
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("operator_workflow_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: operatorUnavailableMessage() };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      if (code === "P0001") return { success: false, error: businessErrors.has(result.error.message) ? result.error.message : "The action was rejected by current workflow rules. Refresh and review the record." };
      if (["23505", "23514", "23503", "22P02", "22007", "22008"].includes(code)) return { success: false, error: "The details conflict with current records. Refresh and review them before retrying." };
      return { success: false, uncertain: mutation, error: mutation ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "Current workflow information could not be loaded. Retry to check it." };
    }
    const data = parseOperatorData(result.data, command);
    if (mutation) {
      const paths = ["/customers", "/production", "/inventory", "/dies", "/tasks", "/tasks/commitments"];
      if ("customer_id" in payload) paths.push(`/customers/${payload.customer_id}`);
      if ("job_id" in payload) paths.push(`/production/${payload.job_id}`);
      if ("entity_id" in payload) paths.push(`${payload.entity_type === "die" ? "/dies" : "/inventory"}/${payload.entity_id}`);
      for (const path of paths) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: mutation && submitted, error: mutation && submitted ? "Confirmation is unavailable. Retry the same request to check whether it was recorded." : "The workflow request could not be completed. Check your session and retry." };
  }
}
