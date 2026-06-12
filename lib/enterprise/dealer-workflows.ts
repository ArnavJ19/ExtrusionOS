import type { SupabaseClient } from "@supabase/supabase-js";
import { logEnterpriseAuditEvent } from "./audit";
import { calculateDifference, classifyReceiptLine } from "./dealer-workflow-rules";
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
  const hasMismatch = input.lines.some((line) => classifyReceiptLine(line.expectedQuantity, line.reportedReceivedQuantity) === "discrepancy_reported");
  const receiptStatus = hasMismatch ? "discrepancy_reported" : "confirmed";

  const audit = await logEnterpriseAuditEvent(supabase, {
    companyId: input.actor.companyId,
    actorUserId: input.actor.userId,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    actorDealerId: input.actor.dealerId,
    actionType: hasMismatch ? "dealer_reported_quantity_mismatch" : "dealer_confirmed_receipt",
    moduleName: "dealer_inventory",
    entityType: "shipment",
    entityId: input.shipmentId,
    changeSummary: hasMismatch ? "Dealer receipt submitted with quantity mismatch" : "Dealer receipt confirmed",
    newValue: { lines: input.lines },
    ipAddress: input.actor.ipAddress,
    userAgent: input.actor.userAgent,
    deviceSessionId: input.actor.deviceSessionId,
    relatedShipmentId: input.shipmentId
  });
  if (audit.error) return { error: audit.error };

  const receiptResult = await supabase.from("dealer_receipts").insert({
    company_id: input.actor.companyId,
    dealer_id: input.dealerId,
    shipment_id: input.shipmentId,
    received_by_user_id: input.actor.userId,
    received_by_name: input.actor.name ?? null,
    received_by_role: input.actor.role,
    status: receiptStatus,
    notes: input.notes ?? null,
    ip_address: input.actor.ipAddress ?? null,
    user_agent: input.actor.userAgent ?? null,
    device_session_id: input.actor.deviceSessionId ?? null
  }).select("id").single();
  if (receiptResult.error || !receiptResult.data) return { error: receiptResult.error };

  const receiptItems = input.lines.map((line) => ({
    company_id: input.actor.companyId,
    dealer_receipt_id: receiptResult.data.id,
    shipment_item_id: line.shipmentItemId,
    expected_quantity: line.expectedQuantity,
    reported_received_quantity: line.reportedReceivedQuantity,
    status: classifyReceiptLine(line.expectedQuantity, line.reportedReceivedQuantity),
    notes: line.notes ?? null
  }));
  const receiptItemsResult = await supabase.from("dealer_receipt_items").insert(receiptItems);
  if (receiptItemsResult.error) return { error: receiptItemsResult.error };

  for (const line of input.lines) {
    const lineStatus = classifyReceiptLine(line.expectedQuantity, line.reportedReceivedQuantity);
    await supabase.from("shipment_items").update({ status: lineStatus }).eq("id", line.shipmentItemId).eq("company_id", input.actor.companyId);

    if (lineStatus === "received_confirmed") {
      await supabase.from("inventory_transactions").insert({
        company_id: input.actor.companyId,
        inventory_item_id: line.inventoryItemId,
        item_type: "other",
        quantity: line.reportedReceivedQuantity,
        unit: line.unit,
        inventory_state: "dealer_inventory_on_hand",
        from_owner_type: "dealer",
        from_owner_id: input.dealerId,
        to_owner_type: "dealer",
        to_owner_id: input.dealerId,
        dealer_order_id: input.dealerOrderId ?? null,
        shipment_id: input.shipmentId,
        created_by_user_id: input.actor.userId,
        created_by_role: input.actor.role,
        reason: "Dealer confirmed receipt",
        status: "posted",
        audit_log_id: audit.data?.id ?? null
      });
    } else {
      await supabase.from("inventory_discrepancies").insert({
        company_id: input.actor.companyId,
        dealer_id: input.dealerId,
        dealer_order_id: input.dealerOrderId ?? null,
        shipment_id: input.shipmentId,
        shipment_item_id: line.shipmentItemId,
        expected_quantity: line.expectedQuantity,
        reported_quantity: line.reportedReceivedQuantity,
        difference_quantity: calculateDifference(line.expectedQuantity, line.reportedReceivedQuantity),
        status: "open",
        reported_by_user_id: input.actor.userId,
        reported_by_name: input.actor.name ?? null,
        reported_by_role: input.actor.role
      });
    }
  }

  await supabase.from("shipments").update({ status: hasMismatch ? "discrepancy_reported" : "received_confirmed" }).eq("id", input.shipmentId).eq("company_id", input.actor.companyId);

  return { data: { receiptId: receiptResult.data.id, status: receiptStatus } };
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
