"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { foundryBatchSchema } from "@/lib/validations/schemas";

type SaveFoundryBatchInput = {
  [key: string]: unknown;
  editing_id?: string | null;
};

type FoundryBatchActionResult =
  | { success: true; batchId: string }
  | { success: false; error: string };

function revalidateFoundryPaths(batchId?: string) {
  revalidatePath("/foundry");
  revalidatePath("/foundry/database");
  revalidatePath("/foundry/billets");
  revalidatePath("/foundry/scrap");
  revalidatePath("/foundry/external-sources");
  if (batchId) revalidatePath(`/foundry/${batchId}`);
}

export async function saveFoundryBatchAction(input: SaveFoundryBatchInput): Promise<FoundryBatchActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = typeof input.editing_id === "string" ? input.editing_id : null;
    if (!can(context.role, editingId ? "update" : "create", "foundry")) {
      return { success: false, error: "You do not have permission to save foundry batches." };
    }

    const parsed = foundryBatchSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(" ") || "Please check foundry batch details." };
    }
    if (!editingId && parsed.data.status !== "planned") {
      return { success: false, error: "New foundry batches must start as planned." };
    }

    const supabase = await createClient();
    const payload = {
      ...parsed.data,
      scrap_id: parsed.data.scrap_id || null,
      external_source_id: parsed.data.external_source_id || null,
      company_id: context.companyId,
      ...(editingId ? {} : { created_by: context.userId })
    };

    if (editingId) {
      const result = await supabase
        .from("foundry_batches")
        .update(payload)
        .eq("company_id", context.companyId)
        .eq("id", editingId)
        .select("id")
        .single();
      if (result.error || !result.data) throw result.error ?? new Error("Could not update foundry batch.");
      const batchId = String(result.data.id);
      revalidateFoundryPaths(batchId);
      return { success: true, batchId };
    }

    const insertPayload = { ...payload };
    delete (insertPayload as Record<string, unknown>).batch_number;
    const result = await supabase.from("foundry_batches").insert(insertPayload).select("id").single();
    if (result.error || !result.data) throw result.error ?? new Error("Could not create foundry batch.");
    const batchId = String(result.data.id);
    revalidateFoundryPaths(batchId);
    return { success: true, batchId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save foundry batch") };
  }
}
