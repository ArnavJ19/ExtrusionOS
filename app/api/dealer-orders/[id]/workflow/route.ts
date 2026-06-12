import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const workflowSchema = z.object({
  status: z.enum(["dealer_order_submitted", "accepted_by_factory", "rejected_by_factory", "material_reserved", "production_scheduled", "in_production", "production_completed", "quality_check_pending", "quality_check_passed", "packed", "dispatched", "in_transit", "delivered_to_dealer", "pending_dealer_count", "received_confirmed", "discrepancy_reported", "recount_requested", "discrepancy_resolved", "closed", "cancelled"]).optional(),
  factory_committed_date: z.string().optional().nullable(),
  clarification_required: z.boolean().optional(),
  notes: z.string().optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getSessionContext();
    if (context.dealerId || !can(context.role, "update", "dealer_orders")) return NextResponse.json({ error: "Only factory users can update dealer order workflow status." }, { status: 403 });
    const { id } = await params;
    const parsed = workflowSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid workflow update" }, { status: 400 });

    const supabase = await createClient();
    const current = await supabase.from("dealer_orders").select("id, company_id, dealer_id, order_number, status, linked_order_id").eq("company_id", context.companyId).eq("id", id).single();
    if (current.error || !current.data) return NextResponse.json({ error: "Dealer order not found." }, { status: 404 });

    const update: Record<string, unknown> = { last_factory_update_at: new Date().toISOString() };
    if (parsed.data.status) update.status = parsed.data.status;
    if (parsed.data.factory_committed_date !== undefined) update.factory_committed_date = parsed.data.factory_committed_date || null;
    if (parsed.data.clarification_required === true) {
      update.status = "rejected_by_factory";
      update.clarification_required_at = new Date().toISOString();
      update.clarification_resolved_at = null;
    }
    if (parsed.data.clarification_required === false) update.clarification_resolved_at = new Date().toISOString();

    const result = await supabase.from("dealer_orders").update(update).eq("company_id", context.companyId).eq("id", id).select("id, order_number, status, dealer_id, factory_committed_date").single();
    if (result.error || !result.data) return NextResponse.json({ error: getErrorMessage(result.error, "Could not update dealer order workflow") }, { status: 500 });

    const newStatus = String(update.status ?? current.data.status);
    await supabase.from("dealer_order_status_history").insert({
      company_id: context.companyId,
      dealer_order_id: id,
      previous_status: current.data.status,
      new_status: newStatus,
      changed_by: context.userId,
      notes: parsed.data.notes ?? null
    });

    await supabase.from("notifications").insert({
      company_id: context.companyId,
      dealer_id: current.data.dealer_id,
      recipient_role: "dealer_admin",
      notification_type: parsed.data.clarification_required ? "dealer_order_clarification_required" : "dealer_order_status_changed",
      severity: parsed.data.clarification_required ? "warning" : "info",
      title: parsed.data.clarification_required ? "Factory needs clarification" : "Dealer order status updated",
      body: parsed.data.clarification_required ? `${current.data.order_number}: ${parsed.data.notes ?? "Please clarify order details."}` : `${current.data.order_number} is now ${newStatus.replaceAll("_", " ")}.`,
      related_entity_type: "dealer_order",
      related_entity_id: id,
      entity_reference: current.data.order_number,
      action_link: `/dealer-orders/${id}`,
      created_by: context.userId
    });

    if (parsed.data.clarification_required) {
      const dealerAdmin = await supabase.from("app_users").select("id").eq("company_id", context.companyId).eq("dealer_id", current.data.dealer_id).eq("role", "dealer_admin").eq("is_active", true).limit(1).maybeSingle();
      await supabase.from("tasks").insert({
        company_id: context.companyId,
        dealership_id: current.data.dealer_id,
        task_type: "dealer_order_clarification",
        title: `Clarify ${current.data.order_number}`,
        description: parsed.data.notes ?? "Factory needs clarification before proceeding.",
        priority: "urgent",
        status: "open",
        assigned_to: dealerAdmin.data?.id ?? null,
        related_entity_type: "dealer_order",
        related_entity_id: id,
        created_by: context.userId,
        assigned_by_user_id: context.userId,
        due_date: new Date().toISOString().slice(0, 10)
      });
    }

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "dealer_order_status_updated",
      moduleName: "dealer_orders",
      entityType: "dealer_order",
      entityId: id,
      entityReferenceNumber: current.data.order_number,
      previousValue: { status: current.data.status },
      newValue: update as Record<string, unknown>,
      changeSummary: `${current.data.order_number} moved to ${newStatus}`
    });

    return NextResponse.json({ dealer_order: result.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Dealer order workflow update failed") }, { status: 500 });
  }
}
