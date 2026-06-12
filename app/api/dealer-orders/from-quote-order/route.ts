import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getErrorMessage } from "@/lib/utils/errors";

const schema = z.object({ order_id: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "dealer_orders")) return NextResponse.json({ error: "You do not have permission to create dealer orders." }, { status: 403 });

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order" }, { status: 400 });

    const supabase = createAdminClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, company_id, dealer_id, quote_id, order_number, priority, expected_dispatch_date, notes, created_by")
      .eq("company_id", context.companyId)
      .eq("id", parsed.data.order_id)
      .single();
    if (orderError || !order) return NextResponse.json({ error: getErrorMessage(orderError, "Order not found") }, { status: 404 });

    const { data: quote } = order.quote_id
      ? await supabase.from("quotes").select("dealer_id, created_by").eq("company_id", context.companyId).eq("id", order.quote_id).maybeSingle()
      : { data: null };

    if (context.dealerId) {
      const belongsToDealer = order.dealer_id === context.dealerId || quote?.dealer_id === context.dealerId;
      const createdByDealerUser = order.created_by === context.userId || quote?.created_by === context.userId;
      if (!belongsToDealer && !createdByDealerUser) return NextResponse.json({ error: "Dealer users can only link orders created from their own quotes or assigned to their dealership." }, { status: 403 });
    }

    const dealerId = order.dealer_id ?? quote?.dealer_id ?? context.dealerId;
    if (!dealerId) return NextResponse.json({ error: "Dealer assignment is required." }, { status: 400 });
    if (context.dealerId && dealerId !== context.dealerId) return NextResponse.json({ error: "Dealer users can only link their own orders." }, { status: 403 });

    if (order.dealer_id !== dealerId) {
      const stampOrder = await supabase.from("orders").update({ dealer_id: dealerId }).eq("company_id", context.companyId).eq("id", order.id);
      if (stampOrder.error) return NextResponse.json({ error: getErrorMessage(stampOrder.error, "Could not stamp dealer ownership on order") }, { status: 500 });
    }
    if (order.quote_id) {
      await supabase.from("quotes").update({ dealer_id: dealerId }).eq("company_id", context.companyId).eq("id", order.quote_id).is("dealer_id", null);
    }

    const existing = await supabase
      .from("dealer_orders")
      .select("id, order_number, status")
      .eq("company_id", context.companyId)
      .eq("linked_order_id", order.id)
      .maybeSingle();
    if (existing.error) return NextResponse.json({ error: getErrorMessage(existing.error, "Could not check dealer order") }, { status: 500 });
    if (existing.data) return NextResponse.json({ dealer_order: existing.data });

    const dealerOrderResult = await supabase
      .from("dealer_orders")
      .insert({
        company_id: context.companyId,
        dealer_id: dealerId,
        linked_order_id: order.id,
        quote_id: order.quote_id,
        order_number: order.order_number,
        created_by_dealer_user_id: context.userId,
        priority: order.priority ?? "normal",
        expected_delivery_date: order.expected_dispatch_date,
        notes: order.notes,
        status: "dealer_order_submitted"
      })
      .select("id, order_number, status")
      .single();
    if (dealerOrderResult.error || !dealerOrderResult.data) return NextResponse.json({ error: getErrorMessage(dealerOrderResult.error, "Could not create dealer order workflow record") }, { status: 500 });

    if (order.quote_id) {
      const { data: quoteItems, error: itemError } = await supabase
        .from("quote_items")
        .select("item_description, quantity_pieces, total_meters, billing_weight_kg, total_weight_kg, finishing_type, aluminium_profiles(profile_code, profile_name)")
        .eq("company_id", context.companyId)
        .eq("quote_id", order.quote_id)
        .order("created_at", { ascending: true });
      if (itemError) return NextResponse.json({ error: getErrorMessage(itemError, "Could not load quote items") }, { status: 500 });

      const items = (quoteItems ?? []).map((item: any) => ({
        company_id: context.companyId,
        dealer_order_id: dealerOrderResult.data.id,
        item_type: "profile",
        item_description: item.item_description || [item.aluminium_profiles?.profile_code, item.aluminium_profiles?.profile_name].filter(Boolean).join(" - ") || "Profile item",
        quantity: Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0) || Number(item.total_meters ?? item.quantity_pieces ?? 1),
        unit: Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0) > 0 ? "kg" : Number(item.total_meters ?? 0) > 0 ? "meters" : "pieces",
        finish: item.finishing_type ?? null
      }));
      if (items.length) {
        const insertItems = await supabase.from("dealer_order_items").insert(items);
        if (insertItems.error) return NextResponse.json({ error: getErrorMessage(insertItems.error, "Could not create dealer order items") }, { status: 500 });
      }
    }

    await supabase.from("dealer_order_status_history").insert({
      company_id: context.companyId,
      dealer_order_id: dealerOrderResult.data.id,
      new_status: "dealer_order_submitted",
      changed_by: context.userId,
      notes: "Created from dealer quote order"
    });

    return NextResponse.json({ dealer_order: dealerOrderResult.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not create dealer order workflow record") }, { status: 500 });
  }
}
