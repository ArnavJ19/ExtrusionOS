import type { SupabaseClient } from "@supabase/supabase-js";

export async function logAuditEvent(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("audit_logs").insert({
    company_id: input.companyId,
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata_json: input.metadata ?? {}
  });

  return { error };
}

export type EnterpriseAuditInput = {
  companyId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  actorDealerId?: string | null;
  actionType: string;
  moduleName: string;
  entityType: string;
  entityId?: string | null;
  entityReferenceNumber?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  changeSummary?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceSessionId?: string | null;
  status?: "success" | "failed";
  reason?: string | null;
  relatedOrderId?: string | null;
  relatedQuoteId?: string | null;
  relatedInventoryId?: string | null;
  relatedShipmentId?: string | null;
};

export async function logEnterpriseAuditEvent(supabase: SupabaseClient, input: EnterpriseAuditInput) {
  const { data, error } = await supabase.from("audit_logs_enterprise").insert({
    company_id: input.companyId,
    actor_user_id: input.actorUserId ?? null,
    actor_name: input.actorName ?? null,
    actor_role: input.actorRole ?? null,
    actor_company_id: input.companyId,
    actor_dealer_id: input.actorDealerId ?? null,
    action_type: input.actionType,
    module_name: input.moduleName,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    entity_reference_number: input.entityReferenceNumber ?? null,
    previous_value: input.previousValue ?? {},
    new_value: input.newValue ?? {},
    change_summary: input.changeSummary ?? null,
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
    device_session_id: input.deviceSessionId ?? null,
    status: input.status ?? "success",
    reason: input.reason ?? null,
    related_order_id: input.relatedOrderId ?? null,
    related_quote_id: input.relatedQuoteId ?? null,
    related_inventory_id: input.relatedInventoryId ?? null,
    related_shipment_id: input.relatedShipmentId ?? null
  }).select("id").single();

  if (error) {
    // Log audit failure server-side but do not block business operations
    console.error(`[AUDIT_LOG_FAILURE] ${input.actionType} on ${input.entityType}/${input.entityId}: ${error.message}`);
  }

  return { data, error };
}
