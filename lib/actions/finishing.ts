"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const finishingTransitionSchema = z.object({
  job_id: z.string().uuid("Select a finishing job"),
  status: z.enum(["sent_to_vendor", "in_process", "received", "rejected", "completed"]),
  vendor_id: z.string().uuid("Select a finishing vendor").optional().nullable().or(z.literal("")),
  sent_date: z.string().optional().nullable(),
  received_date: z.string().optional().nullable(),
  output_weight_kg: z.coerce.number().nonnegative("Accepted output cannot be negative").optional().nullable(),
  rejection_weight_kg: z.coerce.number().nonnegative("Rejected weight cannot be negative").optional().nullable(),
  remarks: z.string().trim().max(2000, "Remarks are too long").optional().nullable()
});

type FinishingActionResult =
  | { success: true; jobId: string }
  | { success: false; error: string };

const finishingRetrySchema = z.object({
  rejected_job_id: z.string().uuid("Select a rejected finishing job"),
  planned_date: z.string().min(1, "Retry planned date is required"),
  remarks: z.string().trim().max(2000, "Corrective instruction is too long").optional().nullable()
});

export async function transitionFinishingJobAction(
  input: z.input<typeof finishingTransitionSchema>
): Promise<FinishingActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "production")) {
      return { success: false, error: "You do not have permission to update finishing jobs." };
    }

    const parsed = finishingTransitionSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Please check finishing details." };
    }
    if (parsed.data.status === "rejected" && Number(parsed.data.rejection_weight_kg ?? 0) <= 0) {
      return { success: false, error: "Enter the rejected weight before rejecting finishing output." };
    }
    if (parsed.data.status === "rejected" && !parsed.data.remarks?.trim()) {
      return { success: false, error: "Record the rejection reason before rejecting finishing output." };
    }

    const supabase = await createClient();
    const result = await supabase.rpc("transition_finishing_job_atomic", {
      p_job_id: parsed.data.job_id,
      p_status: parsed.data.status,
      p_vendor_id: parsed.data.vendor_id || null,
      p_sent_date: parsed.data.sent_date || null,
      p_received_date: parsed.data.received_date || null,
      p_output_weight_kg: parsed.data.output_weight_kg ?? null,
      p_rejection_weight_kg: parsed.data.rejection_weight_kg ?? null,
      p_remarks: parsed.data.remarks || null
    });
    if (result.error || !result.data) {
      throw result.error ?? new Error("Could not update finishing job");
    }

    revalidatePath("/production/finishing");
    revalidatePath("/production");
    revalidatePath("/packaging");
    revalidatePath("/quality");
    return { success: true, jobId: String(result.data) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update finishing job") };
  }
}
export async function retryRejectedFinishingJobAction(
  input: z.input<typeof finishingRetrySchema>
): Promise<FinishingActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "production")) {
      return { success: false, error: "You do not have permission to retry finishing jobs." };
    }
    const parsed = finishingRetrySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Please check retry details." };
    }

    const supabase = await createClient();
    const result = await supabase.rpc("retry_rejected_finishing_job_atomic", {
      p_rejected_job_id: parsed.data.rejected_job_id,
      p_planned_date: parsed.data.planned_date,
      p_remarks: parsed.data.remarks || null
    });
    if (result.error || !result.data) {
      throw result.error ?? new Error("Could not create finishing retry");
    }

    revalidatePath("/production/finishing");
    revalidatePath("/production");
    return { success: true, jobId: String(result.data) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not create finishing retry") };
  }
}
