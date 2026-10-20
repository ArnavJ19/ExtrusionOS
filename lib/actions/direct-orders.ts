"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { canCreateDirectOrder, directOrderSchema, type DirectOrderInput, type DirectOrderCustomer, type DirectOrderProfile } from "@/lib/orders/direct-order";

export async function searchDirectOrderOptionsAction(kind: "customer" | "profile", search: string): Promise<
  { success: true; customers?: DirectOrderCustomer[]; profiles?: DirectOrderProfile[] } | { success: false; error: string }
> {
  try {
    const context = await getSessionContext();
    if (!canCreateDirectOrder(context.role, context.dealerId)) return { success: false, error: "Direct priced orders require an owner, admin or sales role." };
    if (!["customer", "profile"].includes(kind) || typeof search !== "string" || search.length > 100) return { success: false, error: "Enter a shorter search." };
    const supabase = await createClient();
    const term = search.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    if (kind === "customer") {
      const result = await supabase.from("customers").select("id, customer_name, company_name")
        .eq("company_id", context.companyId).is("deleted_at", null).ilike("customer_name", `%${term}%`)
        .order("customer_name").order("id").range(0, 24);
      if (result.error) throw result.error;
      return { success: true, customers: result.data ?? [] };
    }
    const result = await supabase.from("aluminium_profiles")
      .select("id, profile_code, profile_name, section_weight_kg_per_m, hsn_code")
      .eq("company_id", context.companyId).eq("is_active", true).is("deleted_at", null).ilike("profile_code", `%${term}%`)
      .order("profile_code").order("id").range(0, 24);
    if (result.error) throw result.error;
    return { success: true, profiles: result.data ?? [] };
  } catch (error) { return { success: false, error: getErrorMessage(error, "Order options could not be loaded.") }; }
}

export async function createDirectOrderAction(input: DirectOrderInput): Promise<
  { success: true; orderId: string } | { success: false; error: string }
> {
  try {
    const context = await getSessionContext();
    if (!canCreateDirectOrder(context.role, context.dealerId)) return { success: false, error: "Direct priced orders require an owner, admin or sales role." };
    const parsed = directOrderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the order details and priced lines." };
    const supabase = await createClient();
    const result = await supabase.rpc("create_direct_order_atomic", {
      p_order: parsed.data.order, p_items: parsed.data.items, p_idempotency_key: parsed.data.idempotency_key
    });
    if (result.error) {
      if (["PGRST202", "42883"].includes(result.error.code)) return { success: false, error: "Direct order entry is unavailable. Ask the owner to review the order workflow setup." };
      throw result.error;
    }
    if (!z.string().uuid().safeParse(result.data).success) throw new Error("The order confirmation is unavailable. Retry the same details to check the result.");
    for (const path of ["/orders", "/orders/database", "/production/consolidation", `/orders/${result.data}`]) revalidatePath(path);
    return { success: true, orderId: result.data };
  } catch (error) { return { success: false, error: getErrorMessage(error, "Could not create the direct order. Retry the same details to check the result.") }; }
}
