"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildProductionJobPcdaFields, chooseProductionSourceLine } from "@/lib/pcda/production";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { productionJobSchema } from "@/lib/validations/schemas";

const productionStatusSchema = productionJobSchema.shape.status;
const completeProductionJobSchema = z.object({
  job_id: z.string().uuid("Select a production job"),
  actual_weight_kg: z.coerce.number().positive("Actual output weight must be greater than zero"),
  actual_pieces: z.coerce.number().int().nonnegative("Actual pieces cannot be negative"),
  actual_meters: z.coerce.number().nonnegative("Actual metres cannot be negative").optional().nullable(),
  scrap_weight_kg: z.coerce.number().nonnegative("Scrap weight cannot be negative").default(0),
  remarks: z.string().trim().max(2000, "Completion remarks are too long").optional().nullable()
});
const scheduleSlotStatusSchema = z.enum(["draft", "scheduled"]);
const assignPressSchema = z.object({
  production_job_id: z.string().uuid("Select a production job"),
  machine_id: z.string().uuid("Select an extrusion press"),
  planned_start_at: z.string().min(1, "Planned start is required"),
  planned_end_at: z.string().min(1, "Planned end is required"),
  shift: z.string().trim().optional().nullable(),
  sequence_number: z.coerce.number().int().nonnegative().default(0),
  capacity_kg: z.coerce.number().nonnegative().optional().nullable()
});
const scheduleSlotSchema = assignPressSchema.extend({
  id: z.string().uuid().optional().nullable(),
  status: scheduleSlotStatusSchema.default("scheduled")
});
const billetAllocationSchema = z.object({
  billet_id: z.string().uuid("Select a billet"),
  order_id: z.string().uuid("Select an order")
});

type SaveProductionJobInput = z.input<typeof productionJobSchema> & {
  editing_id?: string | null;
  selected_billet_ids?: string[];
};
type ProductionActionResult = { success: true; jobId?: string; slotId?: string; requirementId?: string } | { success: false; error: string };

function revalidateProductionPaths(jobId?: string) {
  revalidatePath("/production");
  revalidatePath("/production/database");
  revalidatePath("/production/schedule");
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

function isUsableDieStatus(status: unknown) {
  return !["inactive", "dead", "blocked", "retired", "scrapped", "under_maintenance"].includes(String(status ?? ""));
}

function isAvailablePressStatus(status: unknown) {
  return ["active", "operational", "idle"].includes(String(status ?? ""));
}

function isOpenOrderStage(stage: unknown) {
  return !["closed", "cancelled", "dispatched", "delivered"].includes(String(stage ?? ""));
}

async function validateMachineForPlanning(supabase: any, companyId: string, machineId?: string | null) {
  if (!machineId) return null;
  const result = await supabase
    .from("machines")
    .select("id, machine_type, status, is_active, press_capacity_ton")
    .eq("company_id", companyId)
    .eq("id", machineId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return { error: "Selected press is not available for this company." };
  if (result.data.machine_type !== "extrusion_press") return { error: "Selected machine is not an extrusion press." };
  if (result.data.is_active === false || !isAvailablePressStatus(result.data.status)) return { error: "Selected extrusion press is not available for planning." };
  return { machine: result.data };
}

async function validateSelectedBillets(supabase: any, companyId: string, orderId: string, jobId: string | null, selectedBilletIds: string[]) {
  if (!selectedBilletIds.length) return null;
  const billetsResult = await supabase
    .from("foundry_billets")
    .select("id, order_id, status, production_job_id, alloy, billet_diameter_inch, allocation_requirement_id, order_billet_requirements(order_id, alloy, billet_diameter_inch, status)")
    .eq("company_id", companyId)
    .in("id", selectedBilletIds);
  if (billetsResult.error) throw billetsResult.error;
  const billets = billetsResult.data ?? [];
  if (billets.length !== selectedBilletIds.length) return { error: "One or more selected billets are not available for this company." };

  const invalid = billets.find((billet: any) => {
    const requirement = Array.isArray(billet.order_billet_requirements) ? billet.order_billet_requirements[0] : billet.order_billet_requirements;
    if (billet.order_id !== orderId) return true;
    if (!["allocated", "issued"].includes(String(billet.status))) return true;
    if (billet.production_job_id && billet.production_job_id !== jobId) return true;
    if (requirement?.order_id && requirement.order_id !== orderId) return true;
    if (requirement?.status === "cancelled") return true;
    if (requirement?.alloy && String(requirement.alloy).toLowerCase() !== String(billet.alloy ?? "").toLowerCase()) return true;
    if (requirement?.billet_diameter_inch && Number(requirement.billet_diameter_inch) !== Number(billet.billet_diameter_inch)) return true;
    return false;
  });
  if (invalid) return { error: "Selected billets must be allocated to this order, compatible with its alloy/diameter requirement, and not issued to another job." };
  return { billets };
}

// Ensures the chosen profile is one the order was actually placed for, preserving
// quote -> order -> production traceability. The profile is accepted if it matches
// the order's direct production_profile_id, or if an order_items line exists for it.
// Legacy/unconstrained orders (no production_profile_id and no order_items) are allowed.
async function validateProfileBelongsToOrder(
  supabase: any,
  companyId: string,
  orderId: string,
  profileId: string,
  productionProfileId: string | null
) {
  if (productionProfileId && productionProfileId === profileId) return null;

  const matchingItems = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("order_id", orderId)
    .eq("profile_id", profileId);
  if (matchingItems.error) throw matchingItems.error;
  if ((matchingItems.count ?? 0) > 0) return null;

  // Profile is not on this order. Block only if the order is constrained
  // (has a production_profile_id set and/or any order_items).
  if (productionProfileId) {
    return { error: "Selected profile is not part of this order. Choose a profile that the order was placed for." };
  }
  const anyItems = await supabase
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("order_id", orderId);
  if (anyItems.error) throw anyItems.error;
  if ((anyItems.count ?? 0) > 0) {
    return { error: "Selected profile is not part of this order. Choose a profile that the order was placed for." };
  }
  return null;
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
    const [orderResult, profileResult, dieResult, machineValidation, currentJobResult] = await Promise.all([
      supabase.from("orders").select("id, current_stage, production_profile_id").eq("company_id", context.companyId).eq("id", parsed.data.order_id).maybeSingle(),
      supabase.from("aluminium_profiles").select("id, is_active").eq("company_id", context.companyId).eq("id", parsed.data.profile_id).maybeSingle(),
      supabase.from("dies").select("id, profile_id, die_status").eq("company_id", context.companyId).eq("id", parsed.data.die_id).maybeSingle(),
      validateMachineForPlanning(supabase, context.companyId, parsed.data.machine_id),
      editingId ? supabase.from("production_jobs").select("*").eq("company_id", context.companyId).eq("id", editingId).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (orderResult.error) throw orderResult.error;
    if (profileResult.error) throw profileResult.error;
    if (dieResult.error) throw dieResult.error;
    if (currentJobResult.error) throw currentJobResult.error;
    if (!orderResult.data) return { success: false, error: "Selected order is not available for this company." };
    if (!isOpenOrderStage(orderResult.data.current_stage)) return { success: false, error: "Selected order is not open for production planning." };
    if (!profileResult.data) return { success: false, error: "Selected profile is not available for this company." };
    if (profileResult.data.is_active === false) return { success: false, error: "Selected profile is inactive and cannot be planned for production." };
    if (!dieResult.data || dieResult.data.profile_id !== parsed.data.profile_id) return { success: false, error: "Selected die does not match this profile." };
    if (!isUsableDieStatus(dieResult.data.die_status)) return { success: false, error: `Die is ${String(dieResult.data.die_status).replace(/_/g, " ")} and cannot be used for production.` };
    if (machineValidation?.error) return { success: false, error: machineValidation.error };
    if (editingId && !currentJobResult.data) return { success: false, error: "Production job not found for this company." };

    const profileValidation = await validateProfileBelongsToOrder(
      supabase,
      context.companyId,
      parsed.data.order_id,
      parsed.data.profile_id,
      orderResult.data.production_profile_id ?? null
    );
    if (profileValidation?.error) return { success: false, error: profileValidation.error };

    const selectedBilletIds = Array.isArray(input.selected_billet_ids) ? [...new Set(input.selected_billet_ids.filter(Boolean))] : [];
    if (Number(parsed.data.required_billet_count || 0) > 0 && selectedBilletIds.length === 0) {
      return { success: false, error: "Select at least one allocated billet for this production job. Partial production is allowed when billet supply is tight." };
    }
    const billetValidation = await validateSelectedBillets(supabase, context.companyId, parsed.data.order_id, editingId, selectedBilletIds);
    if (billetValidation?.error) return { success: false, error: billetValidation.error };

    const currentJob = currentJobResult.data;
    const jobNumber = editingId ? currentJob?.job_number : (parsed.data.job_number || null);

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
      job_number: jobNumber,
      created_by: currentJob?.created_by ?? context.userId
    };

    const result = await supabase.rpc("save_production_job_atomic", {
      p_job_id: editingId,
      p_job: payload,
      p_billet_ids: selectedBilletIds
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not save production job");
    const jobId = String(result.data);
    revalidateProductionPaths(jobId);
    return { success: true, jobId };
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
    if (parsedStatus.data === "completed") return { success: false, error: "Use the actual output form to complete production." };
    const supabase = await createClient();
    const existingJob = await supabase
      .from("production_jobs")
      .select("id, status, planned_quantity_kg, actual_quantity_kg, machine_id, die_id, order_id")
      .eq("id", jobId)
      .eq("company_id", context.companyId)
      .maybeSingle();
    if (existingJob.error) throw existingJob.error;
    if (!existingJob.data) return { success: false, error: "Production job not found for this company." };
    if (parsedStatus.data === "ready" && !existingJob.data.machine_id) return { success: false, error: "Assign an available extrusion press before marking this job ready." };

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

export async function completeProductionJobAction(
  input: z.input<typeof completeProductionJobSchema>
): Promise<ProductionActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "production")) {
      return { success: false, error: "You do not have permission to complete production jobs." };
    }
    const parsed = completeProductionJobSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Please check actual production output." };
    }

    const supabase = await createClient();
    const result = await supabase.rpc("complete_production_job_atomic", {
      p_job_id: parsed.data.job_id,
      p_actual_weight_kg: parsed.data.actual_weight_kg,
      p_actual_pieces: parsed.data.actual_pieces,
      p_actual_meters: parsed.data.actual_meters ?? null,
      p_scrap_weight_kg: parsed.data.scrap_weight_kg,
      p_remarks: parsed.data.remarks || null
    });
    if (result.error || !result.data) {
      throw result.error ?? new Error("Could not complete production job");
    }

    revalidateProductionPaths(parsed.data.job_id);
    revalidatePath("/production/finishing");
    revalidatePath("/packaging");
    revalidatePath("/quality");
    return { success: true, jobId: parsed.data.job_id };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not complete production job") };
  }
}

export async function saveProductionScheduleSlotAction(input: z.input<typeof scheduleSlotSchema>): Promise<ProductionActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "production")) return { success: false, error: "You do not have permission to schedule production jobs." };
    const parsed = scheduleSlotSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check schedule details." };

    const supabase = await createClient();
    const [jobResult, machineValidation] = await Promise.all([
      supabase
        .from("production_jobs")
        .select("id, order_id, profile_id, die_id, status, planned_quantity_kg, order:orders(current_stage), die:dies(profile_id, die_status)")
        .eq("company_id", context.companyId)
        .eq("id", parsed.data.production_job_id)
        .maybeSingle(),
      validateMachineForPlanning(supabase, context.companyId, parsed.data.machine_id)
    ]);
    if (jobResult.error) throw jobResult.error;
    if (!jobResult.data) return { success: false, error: "Production job not found for this company." };
    if (machineValidation?.error) return { success: false, error: machineValidation.error };
    const order = Array.isArray(jobResult.data.order) ? jobResult.data.order[0] : jobResult.data.order;
    const die = Array.isArray(jobResult.data.die) ? jobResult.data.die[0] : jobResult.data.die;
    if (!isOpenOrderStage(order?.current_stage)) return { success: false, error: "This order is not open for press scheduling." };
    if (!die || die.profile_id !== jobResult.data.profile_id || !isUsableDieStatus(die.die_status)) return { success: false, error: "This job does not have a usable die for press scheduling." };
    if (new Date(parsed.data.planned_end_at).getTime() <= new Date(parsed.data.planned_start_at).getTime()) {
      return { success: false, error: "Planned end must be after planned start." };
    }

    const payload = {
      production_job_id: parsed.data.production_job_id,
      machine_id: parsed.data.machine_id,
      planned_start_at: parsed.data.planned_start_at,
      planned_end_at: parsed.data.planned_end_at,
      shift: parsed.data.shift || null,
      sequence_number: parsed.data.sequence_number,
      capacity_kg: parsed.data.capacity_kg ?? jobResult.data.planned_quantity_kg ?? null,
      status: parsed.data.status
    };

    const result = await supabase.rpc("save_production_schedule_slot_atomic", {
      p_slot_id: parsed.data.id || null,
      p_slot: payload
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not save schedule slot");

    revalidateProductionPaths(parsed.data.production_job_id);
    return { success: true, jobId: parsed.data.production_job_id, slotId: String(result.data) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save production schedule") };
  }
}

export async function assignProductionJobToPressAction(input: z.input<typeof assignPressSchema>): Promise<ProductionActionResult> {
  return saveProductionScheduleSlotAction({ ...input, status: "scheduled" });
}

export async function releaseProductionJobToPressAction(slotId: string): Promise<ProductionActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "production")) return { success: false, error: "You do not have permission to release production jobs." };
    const parsedId = z.string().uuid().safeParse(slotId);
    if (!parsedId.success) return { success: false, error: "Invalid production schedule slot." };
    const supabase = await createClient();
    const result = await supabase.rpc("release_production_schedule_slot_atomic", { p_slot_id: parsedId.data });
    if (result.error || !result.data) throw result.error ?? new Error("Could not release production schedule slot");
    const productionJobId = String(result.data);

    revalidateProductionPaths(productionJobId);
    return { success: true, jobId: productionJobId, slotId: parsedId.data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not release production job to press") };
  }
}

export async function allocateBilletToOrderAction(input: z.input<typeof billetAllocationSchema>): Promise<ProductionActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "foundry")) return { success: false, error: "You do not have permission to allocate billets." };
    const parsed = billetAllocationSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check billet allocation details." };
    const supabase = await createClient();
    const result = await supabase.rpc("allocate_billet_to_order", { p_billet_id: parsed.data.billet_id, p_order_id: parsed.data.order_id });
    if (result.error) throw result.error;
    revalidatePath("/foundry");
    revalidatePath("/foundry/billets");
    revalidatePath(`/orders/${parsed.data.order_id}`);
    return { success: true, requirementId: result.data as string };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not allocate billet") };
  }
}

export async function reallocateBilletToOrderAction(input: z.input<typeof billetAllocationSchema>): Promise<ProductionActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "foundry")) return { success: false, error: "You do not have permission to reallocate billets." };
    const parsed = billetAllocationSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check billet allocation details." };
    const supabase = await createClient();
    const result = await supabase.rpc("reallocate_billet_to_order", { p_billet_id: parsed.data.billet_id, p_order_id: parsed.data.order_id });
    if (result.error) throw result.error;
    revalidatePath("/foundry");
    revalidatePath("/foundry/billets");
    revalidatePath(`/orders/${parsed.data.order_id}`);
    return { success: true, requirementId: result.data as string };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not reallocate billet") };
  }
}
