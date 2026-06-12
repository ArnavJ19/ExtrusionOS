import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { nextBusinessNumber } from "@/lib/utils/numbering";

const dealerOrderSchema = z.object({
  dealer_id: z.string().uuid().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  delivery_address: z.string().optional(),
  expected_delivery_date: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    inventory_item_id: z.string().uuid().optional().nullable(),
    item_type: z.enum(["profile", "hardware", "accessory", "glass", "gasket", "fastener", "other"]),
    item_description: z.string().min(2),
    quantity: z.number().positive(),
    unit: z.enum(["pieces", "meters", "kg", "set", "box"]),
    finish: z.string().optional().nullable(),
    size_description: z.string().optional().nullable(),
    system_type: z.string().optional().nullable()
  })).min(1)
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "dealer_orders")) return NextResponse.json({ error: "You do not have permission to create dealer orders." }, { status: 403 });
    const parsed = dealerOrderSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid dealer order" }, { status: 400 });

    const dealerId = parsed.data.dealer_id ?? context.dealerId;
    if (!dealerId) return NextResponse.json({ error: "Dealer assignment is required." }, { status: 400 });
    if (context.dealerId && dealerId !== context.dealerId) return NextResponse.json({ error: "Dealer users can only create orders for their own dealership." }, { status: 403 });

    const supabase = await createClient();
    const existingNumbers = await supabase.from("dealer_orders").select("order_number").eq("company_id", context.companyId);
    if (existingNumbers.error) return NextResponse.json({ error: getErrorMessage(existingNumbers.error, "Could not generate order number") }, { status: 500 });
    const orderNumber = nextBusinessNumber("DO", (existingNumbers.data ?? []).map((r: any) => r.order_number));
    const orderResult = await supabase.from("dealer_orders").insert({
      company_id: context.companyId,
      dealer_id: dealerId,
      order_number: orderNumber,
      created_by_dealer_user_id: context.userId,
      priority: parsed.data.priority,
      delivery_address: parsed.data.delivery_address ?? null,
      expected_delivery_date: parsed.data.expected_delivery_date ?? null,
      notes: parsed.data.notes ?? null,
      status: "dealer_order_submitted"
    }).select("id, order_number, status").single();
    if (orderResult.error || !orderResult.data) return NextResponse.json({ error: getErrorMessage(orderResult.error, "Could not create dealer order") }, { status: 500 });

    const items = parsed.data.items.map((item) => ({ ...item, company_id: context.companyId, dealer_order_id: orderResult.data.id }));
    const itemsResult = await supabase.from("dealer_order_items").insert(items);
    if (itemsResult.error) return NextResponse.json({ error: getErrorMessage(itemsResult.error, "Could not add dealer order items") }, { status: 500 });

    await supabase.from("dealer_order_status_history").insert({
      company_id: context.companyId,
      dealer_order_id: orderResult.data.id,
      new_status: "dealer_order_submitted",
      changed_by: context.userId,
      notes: parsed.data.notes ?? null
    });

    await supabase.from("notifications").insert({
      company_id: context.companyId,
      dealer_id: dealerId,
      recipient_role: "factory_manager",
      notification_type: "dealer_order_submitted",
      severity: "info",
      title: "New dealer order submitted",
      body: `${orderNumber} is waiting for factory review.`,
      related_entity_type: "dealer_order",
      related_entity_id: orderResult.data.id,
      entity_reference: orderNumber,
      action_link: `/dealer-orders/${orderResult.data.id}`,
      created_by: context.userId
    });

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "dealer_order_submitted",
      moduleName: "dealer_orders",
      entityType: "dealer_order",
      entityId: orderResult.data.id,
      entityReferenceNumber: orderNumber,
      newValue: parsed.data,
      changeSummary: `${orderNumber} submitted by dealer user`
    });

    return NextResponse.json({ order: orderResult.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Dealer order creation failed") }, { status: 500 });
  }
}
