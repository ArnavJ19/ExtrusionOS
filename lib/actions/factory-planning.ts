"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildFactoryDeliveryProposal,
  factoryDeliveryDataSchema,
  factoryFinishingLeadTimeInputSchema,
  factoryMaintenanceBlockInputSchema,
  factoryPlanningSnapshotSchema,
  factoryShiftCapacityInputSchema,
  factoryVehicleInputSchema,
  factoryVehicleLoadInputSchema,
  factoryVehicleLoadSnapshotSchema,
  factoryVehicleSchema,
  scheduleMoveInputSchema
} from "@/lib/workflow/factory-planning";

const orderIdSchema = z.string().uuid().transform(value => value.toLowerCase());
const vehicleListInputSchema = z.object({
  load_id: z.string().uuid().nullable().optional().default(null),
  page: z.number().int().min(1).max(10000).optional().default(1),
  search: z.string().trim().max(80).optional().default("")
}).strict();
const deliveryProposalSchema = z.object({
  orderNumber: z.string(), proposalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), eligibleStockKg: z.number().finite().nonnegative(),
  remainingDispatchKg: z.number().finite().nonnegative(), productionCapacityKg: z.number().finite().nonnegative(), capacityExplanation: z.string(),
  assumptions: z.array(z.string()).max(20), missing: z.array(z.string()).max(30)
}).strict();
const loadSaveResultSchema = z.object({ success: z.literal(true), load: z.object({
  id: z.string().uuid(), vehicle_id: z.string().uuid(), registration_number: z.string(), vehicle_label: z.string(), load_date: z.string(),
  status: z.enum(["reviewed", "closed", "cancelled"]), capacity_kg: z.number().finite().positive(), total_weight_kg: z.number().finite().nonnegative(),
  item_count: z.number().int().nonnegative(), version: z.number().int().positive(), items: z.array(z.unknown()).max(500)
}).strict(), replayed: z.boolean() }).strict();

function canReadPlanning(role: string) {
  return ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"].includes(role);
}

function canWritePlanning(role: string) {
  return ["owner", "admin", "production_manager", "production", "factory_manager"].includes(role);
}

function canManagePlanningAssumptions(role: string) {
  return ["owner", "admin", "production_manager", "factory_manager"].includes(role);
}

function canManageVehicleLoads(role: string) {
  return ["owner", "admin", "factory_manager", "dispatch_manager", "dispatch"].includes(role);
}

function resultError(message: string) {
  return { success: false as const, error: message };
}

export async function getFactoryPlanningSnapshotAction(input?: { from_date?: string; through_date?: string }) {
  try {
    const context = await getSessionContext();
    if (context.dealerId || !canReadPlanning(context.role)) return resultError("You do not have permission to view factory planning.");
    const from = input?.from_date;
    const through = input?.through_date;
    const validDate = (value: string | undefined) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
    if (!validDate(from) || !validDate(through)) return resultError("Choose a valid factory planning window.");
    const supabase = await createClient();
    const result = await supabase.rpc("factory_planning_snapshot", { p_from: from ?? null, p_through: through ?? null });
    if (result.error) return resultError("The factory schedule and capacity assumptions could not be verified. Refresh to retry.");
    const parsed = factoryPlanningSnapshotSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.company_id !== context.companyId.toLowerCase()) return resultError("The factory planning snapshot returned an unexpected or cross-company result.");
    return { success: true as const, data: parsed.data };
  } catch {
    return resultError("The factory planning snapshot could not be loaded. Check your session and retry.");
  }
}

export async function saveFactoryShiftCapacityAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const parsed = factoryShiftCapacityInputSchema.safeParse(input);
    if (!parsed.success) return resultError(parsed.error.issues[0]?.message ?? "Check the shift capacity details.");
    if (context.dealerId || !canManagePlanningAssumptions(context.role)) return resultError("You do not have permission to configure factory shift capacity.");
    const supabase = await createClient();
    const result = await supabase.rpc("save_factory_shift_capacity", { p_payload: parsed.data });
    if (result.error) return resultError(result.error.code === "23P01" || result.error.code === "23514"
      ? result.error.message : "Shift capacity could not be saved. Refresh and review the machine settings.");
    revalidatePath("/production/capacity");
    revalidatePath("/production/schedule");
    const refreshed = await getFactoryPlanningSnapshotAction();
    return refreshed.success ? { success: true as const, data: refreshed.data } : resultError("Shift capacity was saved, but the refreshed schedule could not be loaded.");
  } catch {
    return resultError("Shift capacity could not be saved. Retry after checking your connection.");
  }
}

export async function createFactoryMaintenanceBlockAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const parsed = factoryMaintenanceBlockInputSchema.safeParse(input);
    if (!parsed.success) return resultError(parsed.error.issues[0]?.message ?? "Check the maintenance window.");
    if (context.dealerId || !canManagePlanningAssumptions(context.role)) return resultError("You do not have permission to add press maintenance windows.");
    const supabase = await createClient();
    const result = await supabase.rpc("create_factory_maintenance_block", { p_payload: parsed.data });
    if (result.error) return resultError(["23P01", "23514"].includes(result.error.code ?? "") ? result.error.message : "The maintenance block could not be saved.");
    revalidatePath("/production/capacity");
    revalidatePath("/production/schedule");
    const refreshed = await getFactoryPlanningSnapshotAction();
    return refreshed.success ? { success: true as const, data: refreshed.data } : resultError("The maintenance block was saved, but the refreshed schedule could not be loaded.");
  } catch {
    return resultError("The maintenance window could not be saved. Retry after checking your connection.");
  }
}

export async function saveFactoryFinishingLeadTimeAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const parsed = factoryFinishingLeadTimeInputSchema.safeParse(input);
    if (!parsed.success) return resultError(parsed.error.issues[0]?.message ?? "Check the finishing lead time.");
    if (context.dealerId || !canManagePlanningAssumptions(context.role)) return resultError("You do not have permission to configure finishing lead times.");
    const supabase = await createClient();
    const result = await supabase.rpc("save_factory_finishing_lead_time", { p_payload: parsed.data });
    if (result.error) return resultError("The finishing lead time could not be saved.");
    revalidatePath("/production/capacity");
    const refreshed = await getFactoryPlanningSnapshotAction();
    return refreshed.success ? { success: true as const, data: refreshed.data } : resultError("The lead time was saved, but its refreshed value could not be loaded.");
  } catch {
    return resultError("The finishing lead time could not be saved. Retry after checking your connection.");
  }
}

export async function moveFactoryProductionJobAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const parsed = scheduleMoveInputSchema.safeParse(input);
    if (!parsed.success) return resultError(parsed.error.issues[0]?.message ?? "Check the proposed press move.");
    if (context.dealerId || !canWritePlanning(context.role)) return resultError("You do not have permission to move production jobs.");
    const supabase = await createClient();
    const result = await supabase.rpc("commit_factory_schedule_move", { p_payload: parsed.data });
    if (result.error) return resultError(["40001", "23P01", "23514", "23505"].includes(result.error.code ?? "")
      ? result.error.message : "The schedule change could not be confirmed. Refresh the schedule and retry.");
    revalidatePath("/production/capacity");
    revalidatePath("/production/schedule");
    revalidatePath("/production");
    revalidatePath(`/production/${parsed.data.production_job_id}`);
    return { success: true as const, slotId: z.string().uuid().parse(result.data?.slot_id), replayed: result.data?.replayed === true };
  } catch {
    return resultError("The schedule change could not be confirmed. Refresh the schedule and retry.");
  }
}

export async function getFactoryDeliveryProposalAction(orderId: unknown) {
  try {
    const context = await getSessionContext();
    const parsedId = orderIdSchema.safeParse(orderId);
    if (!parsedId.success) return resultError("Choose an order before requesting a delivery proposal.");
    if (context.dealerId || !["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch"].includes(context.role)) {
      return resultError("You do not have permission to view a delivery proposal.");
    }
    const supabase = await createClient();
    const result = await supabase.rpc("factory_delivery_proposal_data", { p_order_id: parsedId.data });
    if (result.error) return resultError("Capacity and eligible-stock inputs could not be verified for this order.");
    const parsed = factoryDeliveryDataSchema.safeParse(result.data);
    if (!parsed.success || parsed.data.company_id !== context.companyId.toLowerCase()) return resultError("The delivery proposal inputs returned an unexpected or cross-company result.");
    const proposal = deliveryProposalSchema.safeParse(buildFactoryDeliveryProposal(parsed.data));
    return proposal.success ? { success: true as const, data: proposal.data } : resultError("The delivery proposal could not be validated.");
  } catch {
    return resultError("The delivery proposal could not be loaded. Check your session and retry.");
  }
}

export async function getFactoryVehicleLoadSnapshotAction(input: unknown = {}) {
  try {
    const context = await getSessionContext();
    const parsed = vehicleListInputSchema.safeParse(input);
    if (!parsed.success) return resultError("Check the vehicle-load search and page.");
    if (context.dealerId || !canManageVehicleLoads(context.role)) return resultError("You do not have permission to view vehicle load plans.");
    const supabase = await createClient();
    const result = await supabase.rpc("factory_vehicle_load_snapshot", {
      p_load_id: parsed.data.load_id, p_page: parsed.data.page, p_search: parsed.data.search
    });
    if (result.error) return resultError("Vehicle loads and eligible bundles could not be verified. Refresh to retry.");
    const data = factoryVehicleLoadSnapshotSchema.safeParse(result.data);
    if (!data.success || data.data.company_id !== context.companyId.toLowerCase()) return resultError("Vehicle-load data returned an unexpected or cross-company result.");
    return { success: true as const, data: data.data };
  } catch {
    return resultError("Vehicle loads could not be loaded. Check your session and retry.");
  }
}

export async function saveFactoryVehicleAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const parsed = factoryVehicleInputSchema.safeParse(input);
    if (!parsed.success) return resultError(parsed.error.issues[0]?.message ?? "Check the vehicle details.");
    if (context.dealerId || !["owner", "admin", "factory_manager", "dispatch_manager"].includes(context.role)) return resultError("You do not have permission to configure vehicle capacity.");
    const supabase = await createClient();
    const result = await supabase.rpc("save_factory_vehicle", { p_payload: parsed.data });
    if (result.error) return resultError(["23514", "23505"].includes(result.error.code ?? "") ? result.error.message : "The vehicle could not be saved.");
    const vehicle = factoryVehicleSchema.safeParse(result.data);
    if (!vehicle.success) return resultError("The saved vehicle returned an unexpected result.");
    revalidatePath("/dispatches/loads");
    const refreshed = await getFactoryVehicleLoadSnapshotAction();
    return refreshed.success ? { success: true as const, data: refreshed.data } : resultError("Vehicle capacity was saved, but the refreshed load list could not be loaded.");
  } catch {
    return resultError("The vehicle could not be saved. Retry after checking your connection.");
  }
}

export async function saveFactoryVehicleLoadAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const parsed = factoryVehicleLoadInputSchema.safeParse(input);
    if (!parsed.success) return resultError(parsed.error.issues[0]?.message ?? "Check the selected bundles and vehicle.");
    if (context.dealerId || !canManageVehicleLoads(context.role)) return resultError("You do not have permission to review vehicle loads.");
    const supabase = await createClient();
    const result = await supabase.rpc("save_factory_vehicle_load", { p_payload: parsed.data });
    if (result.error) return resultError(["40001", "23514", "23505", "23P01"].includes(result.error.code ?? "")
      ? result.error.message : "The vehicle-load review could not be confirmed. Refresh and try again.");
    const parsedResult = loadSaveResultSchema.safeParse({ success: true, ...result.data });
    if (!parsedResult.success) return resultError("The reviewed vehicle load returned an unexpected result.");
    revalidatePath("/dispatches/loads");
    revalidatePath("/dispatches");
    revalidatePath("/orders");
    return parsedResult.data;
  } catch {
    return resultError("The vehicle-load review could not be confirmed. Retry the same request to check its status.");
  }
}

export async function releaseFactoryVehicleLoadBundlesAction(input:unknown){
  try{const c=await getSessionContext();if(c.dealerId||!canManageVehicleLoads(c.role))return resultError("You do not have permission to release vehicle loads.");
    const p=z.object({request_id:z.string().uuid(),load_id:z.string().uuid(),expected_version:z.number().int().positive(),bundle_ids:z.array(z.string().uuid()).min(1).max(500),reason:z.string().trim().min(8).max(1000)}).strict().parse(input);
    const r=await(await createClient()).rpc("release_factory_vehicle_load_bundles",{p_payload:p});if(r.error)return resultError(r.error.message);
    const result=loadSaveResultSchema.parse({success:true,...r.data});revalidatePath("/dispatches/loads");return result;
  }catch{return resultError("Bundle release could not be confirmed. Reload the saved load or retry the same release identity.");}
}
