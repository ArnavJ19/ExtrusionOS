"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildProductionJobPcdaFields, chooseProductionSourceLine } from "@/lib/pcda/production";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { nextBusinessNumber } from "@/lib/utils/numbering";
import { productionJobSchema } from "@/lib/validations/schemas";

const productionStatusSchema = productionJobSchema.shape.status;

type SaveProductionJobInput = z.input<typeof productionJobSchema> & {
  editing_id?: string | null;
  selected_billet_ids?: string[];
};
type ProductionActionResult = { success: true; jobId?: string } | { success: false; error: string };

function revalidateProductionPaths(jobId?: string) {
  revalidatePath("/production");
  revalidatePath("/production/database");
  if (jobId) revalidatePath(`/production/${jobId}`);
}

async function loadProductionSourceLine(supabase: any, companyId: string, orderId: string, profileId: string) {
  const orderItems = await supabase
    .from("order_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("order_id", orderId)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (orderItems.error) throw orderItems.error;
  const orderLine = chooseProductionSourceLine(orderItems.data ?? [], profileId);
  if (orderLine) return orderLine;

  const order = await supabase.from("orders").select("id, quote_id").eq("company_id", companyId).eq("id", orderId).maybeSingle();
  if (order.error) throw order.error;
  if (!order.data?.quote_id) return null;
  const quoteItems = await supabase
    .from("quote_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("quote_id", order.data.quote_id)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (quoteItems.error) throw quoteItems.error;
  return chooseProductionSourceLine(quoteItems.data ?? [], profileId);
}

export async function saveProductionJobAction(input: SaveProductionJobInput): Promise<ProductionActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = input.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "production")) return { success: false, error: "You do not have permission to save production jobs." };

    const parsed = productionJobSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check production job details." };
    if (!parsed.data.die_id) return { success: false, error: "Production cannot be scheduled because no active die exists for this order/profile. Add the die in Die Master first." };

    const supabase = await createClient();
    const [orderResult, profileResult, dieResult, currentJobResult] = await Promise.all([
      supabase.from("orders").select("id").eq("company_id", context.companyId).eq("id", parsed.data.order_id).maybeSingle(),
      supabase.from("aluminium_profiles").select("id").eq("company_id", context.companyId).eq("id", parsed.data.profile_id).maybeSingle(),
      supabase.from("dies").select("id, profile_id, die_status").eq("company_id", context.companyId).eq("id", parsed.data.die_id).maybeSingle(),
      editingId ? supabase.from("production_jobs").select("*").eq("company_id", context.companyId).eq("id", editingId).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (orderResult.error) throw orderResult.error;
    if (profileResult.error) throw profileResult.error;
    if (dieResult.error) throw dieResult.error;
    if (currentJobResult.error) throw currentJobResult.error;
    if (!orderResult.data) return { success: false, error: "Selected order is not available for this company." };
    if (!profileResult.data) return { success: false, error: "Selected profile is not available for this company." };
    if (!dieResult.data || dieResult.data.profile_id !== parsed.data.profile_id) return { success: false, error: "Selected die does not match this profile." };
    if (["inactive", "dead", "blocked", "retired", "scrapped"].includes(String(dieResult.data.die_status ?? ""))) return { success: false, error: `Die is ${String(dieResult.data.die_status).replace(/_/g, " ")} and cannot be used for production.` };
    if (editingId && !currentJobResult.data) return { success: false, error: "Production job not found for this company." };

    const selectedBilletIds = Array.isArray(input.selected_billet_ids) ? input.selected_billet_ids.filter(Boolean) : [];
    if (Number(parsed.data.required_billet_count || 0) > 0 && selectedBilletIds.length === 0) {
      return { success: false, error: "Select at least one allocated billet for this production job. Partial production is allowed when billet supply is tight." };
    }

    const existingNumbers = editingId ? null : await supabase.from("production_jobs").select("job_number").eq("company_id", context.companyId);
    if (existingNumbers?.error) throw existingNumbers.error;
    const currentJob = currentJobResult.data;
    const jobNumber = editingId ? currentJob?.job_number : (parsed.data.job_number || nextBusinessNumber("J", (existingNumbers?.data ?? []).map((row: any) => row.job_number)));
    if (!jobNumber) return { success: false, error: "Could not identify the job number. Refresh and try again." };

    const sourceLine = await loadProductionSourceLine(supabase, context.companyId, parsed.data.order_id, parsed.data.profile_id);
    const payload = {
      ...parsed.data,
      machine_id: parsed.data.machine_id || null,
      planned_date: parsed.data.planned_date || null,
      length_per_piece_m: parsed.data.length_per_piece_m || sourceLine?.length_per_piece_m || null,
      shift: parsed.data.shift || null,
      operator_name: parsed.data.operator_name || null,
      remarks: parsed.data.remarks || null,
      ...buildProductionJobPcdaFields(sourceLine, context.companyId),
      company_id: context.companyId,
      job_number: jobNumber,
      created_by: currentJob?.created_by ?? context.userId
    };

    const result = editingId
      ? await supabase.from("production_jobs").update(payload).eq("id", editingId).eq("company_id", context.companyId).select("id").single()
      : await supabase.from("production_jobs").insert(payload).select("id").single();
    if (result.error || !result.data) throw result.error ?? new Error("Could not save production job");

    if (selectedBilletIds.length > 0) {
      const billetResult = await supabase
        .from("foundry_billets")
        .update({ production_job_id: result.data.id, status: payload.status === "completed" ? "consumed" : "issued", order_id: payload.order_id })
        .in("id", selectedBilletIds)
        .eq("company_id", context.companyId);
      if (billetResult.error) throw billetResult.error;
    }

    revalidateProductionPaths(result.data.id);
    return { success: true, jobId: result.data.id };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save production job") };
  }
}

export async function updateProductionJobStatusAction(jobId: string, status: string): Promise<ProductionActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "production")) return { success: false, error: "You do not have permission to update production jobs." };
    const parsedStatus = productionStatusSchema.safeParse(status);
    if (!parsedStatus.success) return { success: false, error: "Invalid production job status." };
    const supabase = await createClient();
    const result = await supabase
      .from("production_jobs")
      .update({ status: parsedStatus.data })
      .eq("id", jobId)
      .eq("company_id", context.companyId)
      .select("id")
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return { success: false, error: "Production job not found for this company." };
    revalidateProductionPaths(jobId);
    return { success: true, jobId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update production job status") };
  }
}
