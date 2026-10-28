"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { approvalCommandSchema, approvalHistorySchema, approvalInboxSchema, canUseApprovalInbox } from "@/lib/workflow/approval-inbox";

export type ApprovalActionResult = { success: true; data: unknown } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

// Messages written by the database for the approver; anything else is replaced by a generic message.
const businessErrors = [
  "Choose a request, its version and a decision", "Keep the note under 1,000 characters", "Explain the rejection or the question for the requester",
  "The request identity was already used for different details", "Approval request is unavailable", "Only owners and admins may decide low-margin quotations",
  "Expenses above Rs 25,000 need owner or admin approval", "This request was already decided. Refresh the inbox",
  "This request changed since you opened it. Review the current version before deciding", "You cannot decide your own request",
  "Complete the costing on every quotation line before approving", "Complete quotation item costing before confirmation. Incomplete drafts may still be saved.",
  "Expenses above Rs 25,000 need owner or admin review", "Per sqft finishing requires a profile perimeter and a recalculated quote before approval or sending",
  "Invalid inbox request", "Invalid page"
];

// UPGRADE_EOS feature 44. Decisions are idempotent by request id; the database applies them through each record's own workflow.
export async function approvalInboxAction(input: unknown): Promise<ApprovalActionResult> {
  let decide = false;
  let submitted = false;
  try {
    const context = await getSessionContext();
    const parsed = approvalCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid approval request" };
    const { command, ...payload } = parsed.data;
    decide = command === "inbox.decide";
    if (context.dealerId || !canUseApprovalInbox(context.role)) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("approval_inbox_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "The approval inbox is not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This decision is not permitted for your current session." };
      if (code === "P0001" || code === "23514" || code === "23505") return { success: false, error: "The decision was rejected by the record's current rules. Refresh and review it." };
      return { success: false, uncertain: decide, error: decide ? "Confirmation is unavailable. Retry the same decision to check whether it was recorded." : "The inbox could not be loaded. Retry." };
    }
    const data = command === "inbox.list" ? approvalInboxSchema.parse(result.data) : command === "inbox.history" ? approvalHistorySchema.parse(result.data) : result.data;
    if (decide && "source_type" in payload) {
      const paths = ["/tasks/approvals", payload.source_type === "quote" ? `/quotes/${payload.source_id}` : `/expenses/${payload.source_id}`, payload.source_type === "quote" ? "/quotes" : "/expenses"];
      for (const path of paths) {
        try { revalidatePath(path); } catch { /* A confirmed decision remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: decide && submitted, error: decide && submitted ? "Confirmation is unavailable. Retry the same decision to check whether it was recorded." : "The approval request could not be completed. Check your session and retry." };
  }
}
