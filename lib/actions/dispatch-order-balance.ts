"use server";

import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadDispatchPackingTotals } from "@/lib/dispatches/packing-history";

const quantity = z.union([z.number(), z.string().trim().min(1)]).transform(Number)
  .refine((value) => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000)));
const item = z.object({ id: z.string().uuid(), quantity_pieces: quantity.refine(Number.isSafeInteger), total_meters: quantity });
const header = z.object({ id: z.string().uuid(), order_number: z.string().nullable(), customer_name: z.string().nullable(), company_name: z.string().nullable(), current_stage: z.string() });

export async function dispatchOrderBalanceAction(input: string) {
  try {
    const context = await getSessionContext();
    if (context.dealerId || ["dealer_admin", "dealer_staff"].includes(context.role) || !can(context.role, "create", "dispatches")) {
      return { success: false as const, error: "You do not have permission to review dispatch quantities." };
    }
    const orderId = z.string().uuid().parse(input);
    const supabase = await createClient();
    const orderResult = await supabase.from("orders_authorized")
      .select("id, order_number, customer_name, company_name, current_stage")
      .eq("company_id", context.companyId).eq("id", orderId).maybeSingle();
    if (orderResult.error) throw orderResult.error;
    const order = header.parse(orderResult.data);
    if (["cancelled", "delivered"].includes(order.current_stage)) {
      return { success: false as const, error: "This order is closed for dispatch. Select a current order." };
    }

    let expected: number | null = null;
    let previousId = "";
    let pieces = 0;
    let milliMetres = 0;
    for (let offset = 0; ;) {
      const result = await supabase.from("order_items_authorized")
        .select("id, quantity_pieces, total_meters", { count: "exact" })
        .eq("company_id", context.companyId).eq("order_id", orderId)
        .order("id", { ascending: true }).range(offset, offset + 199);
      if (result.error) throw result.error;
      const count = result.count;
      if (!Array.isArray(result.data) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 10000
        || (expected !== null && expected !== count) || result.data.length !== Math.min(200, count - offset)) {
        throw new Error("Incomplete order quantities");
      }
      expected = count;
      for (const value of result.data) {
        const row = item.parse(value);
        if (row.id <= previousId) throw new Error("Conflicting order lines");
        previousId = row.id;
        pieces += row.quantity_pieces;
        milliMetres += Math.round(row.total_meters * 1000);
        if (![pieces, milliMetres].every(Number.isSafeInteger)) throw new Error("Unsupported order quantities");
      }
      offset += result.data.length;
      if (offset === count) break;
    }
    const packing = await loadDispatchPackingTotals(supabase, context.companyId, orderId, null);
    const shipped = [...packing.values()].reduce((sum, row) => ({ pieces: sum.pieces + row.pieces, milliMetres: sum.milliMetres + Math.round(row.lengthM * 1000) }), { pieces: 0, milliMetres: 0 });
    if (![shipped.pieces, shipped.milliMetres].every(Number.isSafeInteger)) throw new Error("Unsupported shipped quantities");
    return { success: true as const, balance: {
      orderId, orderLabel: `${order.order_number || "Order"} - ${order.company_name || order.customer_name || "Customer"}`,
      ordered: { pieces, metres: milliMetres / 1000 }, shipped: { pieces: shipped.pieces, metres: shipped.milliMetres / 1000 },
    } };
  } catch {
    return { success: false as const, error: "The complete order and shipped quantities could not be verified. Check the order's pieces and metres, then review dispatch again." };
  }
}
