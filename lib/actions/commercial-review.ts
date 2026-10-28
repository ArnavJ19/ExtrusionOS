"use server";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { commercialReviewCommandSchema, commercialReviewSchema, conversionResultSchema } from "@/lib/workflow/commercial-review";

export async function commercialReviewAction(input: unknown) {
  try {
    const context = await getSessionContext();
    const request = commercialReviewCommandSchema.safeParse(input);
    if (!request.success) return { success: false as const, error: "Check the quotation review request." };
    if (context.dealerId || !["owner", "admin", "sales", "sales_manager", "accounts", "viewer"].includes(context.role)
      || (request.data.command === "quote.convert" && !["owner", "admin", "sales", "sales_manager"].includes(context.role))) {
      return { success: false as const, error: "This action is not permitted for your role." };
    }
    const { command, ...payload } = request.data;
    const supabase = await createClient();
    const result = await supabase.rpc("commercial_review_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const known = ["Quotation is unavailable", "Only customer-approved quotations can be converted", "That request identity was used for different details",
        "The quotation changed. Review the current version before conversion", "Complete the costing of every quotation line",
        "Commercial totals do not reconcile. Revise the quotation before conversion", "Every quote line requires an approved drawing before conversion"];
      return { success: false as const, error: known.includes(result.error.message) ? result.error.message : "The quotation review is unavailable. Refresh and retry the same request." };
    }
    if (command === "quote.review") return { success: true as const, kind: "review" as const, data: commercialReviewSchema.parse(result.data) };
    const data = conversionResultSchema.parse(result.data);
    for (const path of ["/quotes", `/quotes/${payload.quote_id}`, "/orders", `/orders/${data.order_id}`]) {
      try { revalidatePath(path); } catch { /* The database confirmation remains authoritative. */ }
    }
    return { success: true as const, kind: "conversion" as const, data };
  } catch {
    return { success: false as const, error: "The quotation review could not be confirmed. Retry with the same request identity." };
  }
}
