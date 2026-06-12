import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const schema = z.object({ comment_text: z.string().trim().min(1), visibility: z.enum(["dealer_factory", "factory_only"]).default("dealer_factory") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await getSessionContext();
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid comment" }, { status: 400 });
    if (context.dealerId && parsed.data.visibility === "factory_only") return NextResponse.json({ error: "Dealers cannot create factory-only comments." }, { status: 403 });

    const supabase = await createClient();
    const order = await supabase.from("dealer_orders").select("id, dealer_id, order_number").eq("company_id", context.companyId).eq("id", id).single();
    if (order.error || !order.data) return NextResponse.json({ error: "Dealer order not found." }, { status: 404 });
    if (context.dealerId && order.data.dealer_id !== context.dealerId) return NextResponse.json({ error: "You can only comment on your own dealer orders." }, { status: 403 });

    const result = await supabase.from("dealer_order_comments").insert({
      company_id: context.companyId,
      dealer_order_id: id,
      comment_text: parsed.data.comment_text,
      visibility: parsed.data.visibility,
      created_by: context.userId,
      created_by_role: context.role
    }).select("*").single();
    if (result.error || !result.data) return NextResponse.json({ error: getErrorMessage(result.error, "Could not add comment") }, { status: 500 });

    await supabase.from("notifications").insert({
      company_id: context.companyId,
      dealer_id: order.data.dealer_id,
      recipient_role: context.dealerId ? "factory_manager" : "dealer_admin",
      notification_type: "dealer_order_comment",
      severity: "info",
      title: `New comment on ${order.data.order_number}`,
      body: parsed.data.comment_text.slice(0, 240),
      related_entity_type: "dealer_order",
      related_entity_id: id,
      entity_reference: order.data.order_number,
      action_link: `/dealer-orders/${id}`,
      created_by: context.userId
    });

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "dealer_order_comment_added",
      moduleName: "dealer_orders",
      entityType: "dealer_order",
      entityId: id,
      entityReferenceNumber: order.data.order_number,
      newValue: { visibility: parsed.data.visibility, comment: parsed.data.comment_text },
      changeSummary: `Comment added on ${order.data.order_number}`
    });

    return NextResponse.json({ comment: result.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Comment creation failed") }, { status: 500 });
  }
}
