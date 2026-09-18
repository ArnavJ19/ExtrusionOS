import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

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
    const orderResult = await supabase.rpc("create_dealer_order_atomic", {
      p_dealer_id: dealerId,
      p_priority: parsed.data.priority,
      p_delivery_address: parsed.data.delivery_address ?? null,
      p_expected_delivery_date: parsed.data.expected_delivery_date ?? null,
      p_notes: parsed.data.notes ?? null,
      p_items: parsed.data.items
    });
    if (orderResult.error || !orderResult.data) {
      const message = getErrorMessage(orderResult.error, "Could not create dealer order");
      return NextResponse.json({ error: message }, { status: orderResult.error?.code === "42501" ? 403 : 500 });
    }

    return NextResponse.json({ order: orderResult.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Dealer order creation failed") }, { status: 500 });
  }
}
