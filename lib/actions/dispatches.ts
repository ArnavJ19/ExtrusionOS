"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildPackingListItems } from "@/lib/pcda/dispatch";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { nextBusinessNumber } from "@/lib/utils/numbering";
import { dispatchSchema } from "@/lib/validations/schemas";

const deliveryStatusSchema = dispatchSchema.shape.delivery_status;

type SaveDispatchInput = z.input<typeof dispatchSchema> & { editing_id?: string | null };
type DispatchActionResult = { success: true; dispatchId?: string } | { success: false; error: string };

function revalidateDispatchPaths(dispatchId?: string, orderId?: string) {
  revalidatePath("/dispatches");
  revalidatePath("/dispatches/database");
  revalidatePath("/orders");
  revalidatePath("/orders/database");
  if (dispatchId) revalidatePath(`/dispatches/${dispatchId}`);
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

function orderStageForDelivery(status: string) {
  if (status === "delivered") return "delivered";
  if (["dispatched", "in_transit"].includes(status)) return "dispatched";
  return null;
}

async function loadDispatchSourceLines(supabase: any, companyId: string, orderId: string) {
  const productionJobs = await supabase
    .from("production_jobs")
    .select("*")
    .eq("company_id", companyId)
    .eq("order_id", orderId)
    .eq("status", "completed")
    .order("updated_at", { ascending: false });
  if (productionJobs.error) throw productionJobs.error;
  const completedJobs = (productionJobs.data ?? []).filter((job: any) => job.profile_id && Number(job.actual_quantity_kg ?? job.planned_quantity_kg ?? 0) > 0);
  if (completedJobs.length) return completedJobs;

  const orderItems = await supabase
    .from("order_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (orderItems.error) throw orderItems.error;
  return (orderItems.data ?? []).filter((item: any) => item.profile_id && Number(item.total_weight_kg ?? item.quantity_kg ?? item.billing_weight_kg ?? 0) > 0);
}

export async function saveDispatchAction(input: SaveDispatchInput): Promise<DispatchActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = input.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "dispatches")) return { success: false, error: "You do not have permission to save dispatches." };

    const parsed = dispatchSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check dispatch details." };

    const supabase = await createClient();
    const [orderResult, currentDispatchResult] = await Promise.all([
      supabase.from("orders").select("id").eq("company_id", context.companyId).eq("id", parsed.data.order_id).maybeSingle(),
      editingId ? supabase.from("dispatches").select("*").eq("company_id", context.companyId).eq("id", editingId).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (orderResult.error) throw orderResult.error;
    if (currentDispatchResult.error) throw currentDispatchResult.error;
    if (!orderResult.data) return { success: false, error: "Selected order is not available for this company." };
    if (editingId && !currentDispatchResult.data) return { success: false, error: "Dispatch not found for this company." };

    const existingNumbers = editingId ? null : await supabase.from("dispatches").select("dispatch_number").eq("company_id", context.companyId);
    if (existingNumbers?.error) throw existingNumbers.error;
    const currentDispatch = currentDispatchResult.data;
    const dispatchNumber = editingId ? currentDispatch?.dispatch_number : nextBusinessNumber("D", (existingNumbers?.data ?? []).map((dispatch: any) => dispatch.dispatch_number).filter(Boolean));
    if (!dispatchNumber) return { success: false, error: "Could not identify the dispatch number. Refresh and try again." };

    const payload = {
      ...parsed.data,
      transporter_name: parsed.data.transporter_name || null,
      vehicle_number: parsed.data.vehicle_number || null,
      driver_name: parsed.data.driver_name || null,
      driver_phone: parsed.data.driver_phone || null,
      eway_bill_number: parsed.data.eway_bill_number || null,
      lr_number: parsed.data.lr_number || null,
      proof_of_delivery_url: parsed.data.proof_of_delivery_url || null,
      packing_list_url: parsed.data.packing_list_url || null,
      remarks: parsed.data.remarks || null,
      company_id: context.companyId,
      dispatch_number: dispatchNumber,
      created_by: currentDispatch?.created_by ?? context.userId
    };
    const result = editingId
      ? await supabase.from("dispatches").update(payload).eq("id", editingId).eq("company_id", context.companyId).select("id").single()
      : await supabase.from("dispatches").insert(payload).select("id").single();
    if (result.error || !result.data) throw result.error ?? new Error("Could not save dispatch");

    const dispatchId = result.data.id;
    if (editingId) {
      const deleteLines = await supabase.from("packing_list_items").delete().eq("dispatch_id", dispatchId).eq("company_id", context.companyId);
      if (deleteLines.error) throw deleteLines.error;
    }
    const sourceLines = await loadDispatchSourceLines(supabase, context.companyId, parsed.data.order_id);
    if (sourceLines.length) {
      const packingRows = buildPackingListItems(sourceLines, dispatchId, dispatchNumber, context.companyId);
      const packingResult = await supabase.from("packing_list_items").insert(packingRows);
      if (packingResult.error) throw packingResult.error;
    }

    const nextStage = orderStageForDelivery(parsed.data.delivery_status);
    if (nextStage) {
      const orderUpdate = await supabase.from("orders").update({ current_stage: nextStage }).eq("id", parsed.data.order_id).eq("company_id", context.companyId);
      if (orderUpdate.error) throw orderUpdate.error;
    }

    revalidateDispatchPaths(dispatchId, parsed.data.order_id);
    return { success: true, dispatchId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save dispatch") };
  }
}

export async function updateDeliveryStatusAction(dispatchId: string, status: string): Promise<DispatchActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "dispatches")) return { success: false, error: "You do not have permission to update dispatches." };
    const parsedStatus = deliveryStatusSchema.safeParse(status);
    if (!parsedStatus.success) return { success: false, error: "Invalid delivery status." };

    const supabase = await createClient();
    const updateResult = await supabase
      .from("dispatches")
      .update({ delivery_status: parsedStatus.data })
      .eq("id", dispatchId)
      .eq("company_id", context.companyId)
      .select("id, order_id")
      .maybeSingle();
    if (updateResult.error) throw updateResult.error;
    if (!updateResult.data) return { success: false, error: "Dispatch not found for this company." };

    const nextStage = orderStageForDelivery(parsedStatus.data);
    if (nextStage) {
      const orderUpdate = await supabase.from("orders").update({ current_stage: nextStage }).eq("id", updateResult.data.order_id).eq("company_id", context.companyId);
      if (orderUpdate.error) throw orderUpdate.error;
    }
    revalidateDispatchPaths(dispatchId, updateResult.data.order_id);
    return { success: true, dispatchId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update delivery status") };
  }
}
