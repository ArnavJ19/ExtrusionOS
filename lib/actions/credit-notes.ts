"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

export async function issueDispatchCreditNoteAction(input: { dispatch_id: string; reason: string; idempotency_key: string }) {
  try {
    const parsed = z.object({ dispatch_id: z.string().uuid(), reason: z.string().trim().min(8), idempotency_key: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the credit note details." };
    const context = await getSessionContext();
    if (!can(context.role, "create", "financials")) return { success: false as const, error: "You do not have permission to issue credit notes." };
    const supabase = await createClient();
    const result = await supabase.rpc("issue_dispatch_return_credit_note_atomic", {
      p_dispatch_id: parsed.data.dispatch_id,
      p_reason: parsed.data.reason,
      p_idempotency_key: parsed.data.idempotency_key
    });
    if (result.error || !result.data) throw result.error ?? new Error("Credit note was not created");
    revalidatePath(`/dispatches/${parsed.data.dispatch_id}`);
    revalidatePath("/invoices");
    revalidatePath("/payments");
    revalidatePath("/analytics");
    return { success: true as const, creditNoteId: String(result.data) };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Could not issue dispatch credit note") };
  }
}

export async function reverseCreditNoteAction(input: { credit_note_id: string; dispatch_id: string; reason: string }) {
  try {
    const parsed = z.object({ credit_note_id: z.string().uuid(), dispatch_id: z.string().uuid(), reason: z.string().trim().min(8) }).safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the reversal details." };
    const context = await getSessionContext();
    if (!can(context.role, "update", "financials")) return { success: false as const, error: "You do not have permission to reverse credit notes." };
    const supabase = await createClient();
    const result = await supabase.rpc("reverse_credit_note_atomic", { p_credit_note_id: parsed.data.credit_note_id, p_reason: parsed.data.reason });
    if (result.error || !result.data) throw result.error ?? new Error("Credit note was not reversed");
    revalidatePath(`/dispatches/${parsed.data.dispatch_id}`);
    revalidatePath("/invoices");
    revalidatePath("/payments");
    revalidatePath("/analytics");
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Could not reverse credit note") };
  }
}
