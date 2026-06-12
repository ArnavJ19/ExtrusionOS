import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { submitDealerReceipt } from "@/lib/enterprise/dealer-workflows";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const receiptSchema = z.object({
  dealer_id: z.string().uuid(),
  shipment_id: z.string().uuid(),
  dealer_order_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(z.object({
    shipmentItemId: z.string().uuid(),
    expectedQuantity: z.number().nonnegative(),
    reportedReceivedQuantity: z.number().nonnegative(),
    inventoryItemId: z.string().uuid(),
    unit: z.string(),
    notes: z.string().optional().nullable()
  })).min(1)
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "approve", "dealer_inventory")) return NextResponse.json({ error: "You do not have permission to receive dealer inventory." }, { status: 403 });
    const parsed = receiptSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid receipt" }, { status: 400 });
    if (context.dealerId && parsed.data.dealer_id !== context.dealerId) return NextResponse.json({ error: "Dealer users can only receive their own shipments." }, { status: 403 });

    const supabase = await createClient();
    const shipmentResult = await supabase
      .from("shipments")
      .select("id, dealer_id, status")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.shipment_id)
      .single();
    if (shipmentResult.error || !shipmentResult.data) {
      return NextResponse.json({ error: "Shipment not found." }, { status: 404 });
    }
    if (shipmentResult.data.dealer_id !== parsed.data.dealer_id) {
      return NextResponse.json({ error: "Dealer mismatch for shipment receipt." }, { status: 400 });
    }
    if (["received_confirmed", "discrepancy_reported"].includes(shipmentResult.data.status)) {
      return NextResponse.json({ error: "Receipt already submitted for this shipment." }, { status: 409 });
    }

    const shipmentItemsResult = await supabase
      .from("shipment_items")
      .select("id, expected_quantity, inventory_item_id, unit")
      .eq("company_id", context.companyId)
      .eq("shipment_id", parsed.data.shipment_id);
    if (shipmentItemsResult.error) {
      return NextResponse.json({ error: getErrorMessage(shipmentItemsResult.error, "Could not validate shipment items") }, { status: 500 });
    }

    const shipmentItems = shipmentItemsResult.data ?? [];
    const shipmentItemsById = new Map(shipmentItems.map((item) => [item.id, item]));
    const requestItemIds = new Set<string>();
    const validatedLines: typeof parsed.data.lines = [];

    for (const line of parsed.data.lines) {
      if (requestItemIds.has(line.shipmentItemId)) {
        return NextResponse.json({ error: "Duplicate shipment item in receipt payload." }, { status: 400 });
      }
      requestItemIds.add(line.shipmentItemId);
      const source = shipmentItemsById.get(line.shipmentItemId);
      if (!source) {
        return NextResponse.json({ error: "Receipt line does not belong to the shipment." }, { status: 400 });
      }
      if (Number(source.expected_quantity) !== Number(line.expectedQuantity)) {
        return NextResponse.json({ error: "Expected quantity does not match shipment line." }, { status: 400 });
      }
      if (!source.inventory_item_id) {
        return NextResponse.json({ error: "Shipment line is missing inventory linkage." }, { status: 400 });
      }
      if (!source.unit) {
        return NextResponse.json({ error: "Shipment line is missing unit." }, { status: 400 });
      }
      if (source.inventory_item_id !== line.inventoryItemId) {
        return NextResponse.json({ error: "Inventory item does not match shipment line." }, { status: 400 });
      }
      if (source.unit !== line.unit) {
        return NextResponse.json({ error: "Unit does not match shipment line." }, { status: 400 });
      }
      validatedLines.push({
        shipmentItemId: source.id,
        expectedQuantity: Number(source.expected_quantity),
        reportedReceivedQuantity: line.reportedReceivedQuantity,
        inventoryItemId: source.inventory_item_id,
        unit: source.unit,
        notes: line.notes
      });
    }

    if (!validatedLines.length) {
      return NextResponse.json({ error: "At least one shipment line is required." }, { status: 400 });
    }

    const result = await submitDealerReceipt(supabase, {
      actor: {
        userId: context.userId,
        name: context.fullName ?? context.email,
        role: context.role,
        companyId: context.companyId,
        dealerId: context.dealerId,
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent")
      },
      dealerId: shipmentResult.data.dealer_id,
      shipmentId: parsed.data.shipment_id,
      dealerOrderId: parsed.data.dealer_order_id,
      lines: validatedLines,
      notes: parsed.data.notes
    });
    if (result.error) return NextResponse.json({ error: getErrorMessage(result.error, "Could not submit receipt") }, { status: 500 });
    return NextResponse.json(result.data);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Receipt submission failed") }, { status: 500 });
  }
}
