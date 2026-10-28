"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  DYNAMIC_EXCEPTION_MESSAGES, EXCEPTION_WRITE_COMMANDS, canSetExceptionPolicy, decisionSchema, parseExceptionCommand, policyListSchema, policySchema, requestListSchema, restrictionSchema
} from "@/lib/workflow/exception-requests";

export type ExceptionActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Choose a supported exception", "Choose who approves these exceptions",
  "Choose approvers allowed for this exception, a validity of 1 to 168 hours, and limits that are positive (the hard limit at or above the minimum)",
  "Record is unavailable", "Your role does not perform this step, so it cannot request this exception", "This record is not restricted, so no exception is needed",
  "Explain why the exception is needed (10 to 500 characters)", "Enter the weight to dispatch in kg", "An approved exception already covers this version",
  "An exception request for this record is already waiting for a decision", "Invalid page", "Exception request is unavailable", "This request was already decided or withdrawn",
  "Only the requester can withdraw this request", "Your role cannot decide this exception", "Another person must decide an exception you requested", "Choose approve or reject",
  "Say why the exception is rejected (3 to 500 characters)", "You are deciding a different version than the one requested. Reload the request",
  "Your company has not enabled exceptions for low-margin quotations", "A quotation priced below cost cannot be released by exception"
];

// UPGRADE_EOS feature 45. Restrictions, binding and acceptance are enforced by the database guards.
export async function exceptionAction(input: unknown): Promise<ExceptionActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = parseExceptionCommand(input);
    if (!parsed.success) return { success: false, error: parsed.error };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || (command === "policy.set" && !canSetExceptionPolicy(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("exception_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Exception requests are not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message) || DYNAMIC_EXCEPTION_MESSAGES.some((pattern) => pattern.test(message))) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The exception request could not be completed. Refresh and retry." };
    }
    const data = command === "policy.list" ? policyListSchema.parse(result.data)
      : command === "policy.set" ? policySchema.parse(result.data)
      : command === "restriction.check" ? restrictionSchema.parse(result.data)
      : command === "request.list" ? requestListSchema.parse(result.data)
      : command === "request.decide" ? decisionSchema.parse(result.data)
      : result.data;
    if (EXCEPTION_WRITE_COMMANDS.includes(command)) {
      const paths = ["/tasks/approvals", "/tasks/approvals/exceptions"];
      for (const path of paths) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The exception request could not be completed. Check your session and retry." };
  }
}
