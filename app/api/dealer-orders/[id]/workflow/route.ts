import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

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
    const factoryCommittedDate = parsed.data.factory_committed_date === undefined
      && parsed.data.status === "accepted_by_factory"
      ? getBusinessDateBoundaries().today
      : parsed.data.factory_committed_date ?? null;
    const result = await supabase.rpc("transition_dealer_order_atomic", {
      p_dealer_order_id: id,
      p_status: parsed.data.status ?? null,
      p_factory_committed_date: factoryCommittedDate,
      p_clarification_required: parsed.data.clarification_required ?? false,
      p_notes: parsed.data.notes ?? null
    });
    if (result.error || !result.data) {
      const message = getErrorMessage(result.error, "Could not update dealer order workflow");
      const status = result.error?.code === "42501" ? 403 : result.error?.code === "23514" ? 409 : 500;
      return NextResponse.json({ error: message }, { status });
    }

    return NextResponse.json({ dealer_order: result.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Dealer order workflow update failed") }, { status: 500 });
  }
}
