import type { SupabaseClient } from "@supabase/supabase-js";
import { logEnterpriseAuditEvent } from "./audit";
export { calculateDifference, canAccessDealerRecord, classifyReceiptLine } from "./dealer-workflow-rules";

export type ReceiptLineInput = {
  shipmentItemId: string;
  expectedQuantity: number;
  reportedReceivedQuantity: number;
  inventoryItemId: string;
  unit: string;
  notes?: string | null;
};

export type WorkflowActor = {
  userId: string;
  name?: string | null;
  role: string;
  companyId: string;
  dealerId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceSessionId?: string | null;
};

export async function submitDealerReceipt(
  supabase: SupabaseClient,
  input: {
    actor: WorkflowActor;
    dealerId: string;
    shipmentId: string;
    dealerOrderId?: string | null;
    lines: ReceiptLineInput[];
    notes?: string | null;
  }
) {
  const { data, error } = await supabase.rpc("submit_dealer_receipt_atomic", {
    p_shipment_id: input.shipmentId,
    p_dealer_id: input.dealerId,
    p_dealer_order_id: input.dealerOrderId ?? null,
    p_notes: input.notes ?? null,
    p_lines: input.lines,
    p_ip_address: input.actor.ipAddress ?? null,
    p_user_agent: input.actor.userAgent ?? null,
    p_device_session_id: input.actor.deviceSessionId ?? null
  });
  if (error) return { error };
  return { data };
}

export async function submitDiscrepancyRecount(
  supabase: SupabaseClient,
  input: { actor: WorkflowActor; discrepancyId: string; recountQuantity: number; expectedQuantity: number; notes?: string | null }
) {
  const status = input.recountQuantity === input.expectedQuantity ? "resolved" : "recount_completed";
  const recountResult = await supabase.from("discrepancy_recounts").insert({
    company_id: input.actor.companyId,
    discrepancy_id: input.discrepancyId,
    recount_quantity: input.recountQuantity,
    recounted_by_user_id: input.actor.userId,
    recounted_by_name: input.actor.name ?? null,
    recounted_by_role: input.actor.role,
    notes: input.notes ?? null,
    ip_address: input.actor.ipAddress ?? null,
    user_agent: input.actor.userAgent ?? null,
    device_session_id: input.actor.deviceSessionId ?? null
  }).select("id").single();
  if (recountResult.error) return { error: recountResult.error };

  const updateResult = await supabase.from("inventory_discrepancies").update({
    recount_quantity: input.recountQuantity,
    status,
    resolved_at: status === "resolved" ? new Date().toISOString() : null,
    resolved_by: status === "resolved" ? input.actor.userId : null,
    resolution_reason: status === "resolved" ? "dealer_counting_error" : null,
    resolution_notes: status === "resolved" ? "Recount matched factory dispatched quantity" : null
  }).eq("id", input.discrepancyId).eq("company_id", input.actor.companyId);
  if (updateResult.error) return { error: updateResult.error };

  await logEnterpriseAuditEvent(supabase, {
    companyId: input.actor.companyId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    actorDealerId: input.actor.dealerId,
    actionType: "recount_completed",
    moduleName: "dealer_inventory",
    entityType: "inventory_discrepancy",
    entityId: input.discrepancyId,
    newValue: { recountQuantity: input.recountQuantity, expectedQuantity: input.expectedQuantity, status },
    changeSummary: status === "resolved" ? "Recount resolved discrepancy" : "Recount still differs from factory quantity",
    ipAddress: input.actor.ipAddress,
    userAgent: input.actor.userAgent,
    deviceSessionId: input.actor.deviceSessionId
  });

  return { data: { status, recountId: recountResult.data?.id } };
}
