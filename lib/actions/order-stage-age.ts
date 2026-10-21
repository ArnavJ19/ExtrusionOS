"use server";

import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { currentStageEntry, type StageTiming } from "@/lib/workflow/stage-age";

export async function orderStageAgeAction(input: string[]): Promise<{ rows: StageTiming[]; error?: string }> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "read", "orders") || context.dealerId || ["dealer_admin", "dealer_staff"].includes(context.role)) throw new Error("Denied");
    const ids = z.array(z.string().uuid()).max(10).parse(input);
    if (!ids.length) return { rows: [] };
    const supabase = await createClient();
    const orders = await supabase.from("orders_authorized").select("id, order_number, current_stage, expected_dispatch_date").eq("company_id", context.companyId).in("id", [...new Set(ids)]).limit(10);
    if (orders.error || !Array.isArray(orders.data)) throw new Error("Unavailable");
    const rows = await Promise.all(orders.data.map(async (order): Promise<StageTiming> => {
      const history = await supabase.from("order_stage_history").select("stage, changed_at").eq("company_id", context.companyId).eq("order_id", order.id).order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(50);
      const events = history.data;
      const enteredAt = !history.error && Array.isArray(events) ? currentStageEntry(order.current_stage, events, events.length === 50) : null;
      return { id: order.id, label: order.order_number || "Order", stage: order.current_stage, enteredAt, dueDate: order.expected_dispatch_date ?? null, reason: history.error ? "Stage history unavailable" : !enteredAt ? "Current stage entry cannot be established from recorded history" : undefined };
    }));
    return { rows };
  } catch { return { rows: [], error: "Stage history is unavailable. Retry when your connection and account access are available." }; }
}
