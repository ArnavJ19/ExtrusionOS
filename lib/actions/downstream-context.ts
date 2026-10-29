"use server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { downstreamContextRequest, downstreamContextSchema } from "@/lib/workflow/downstream-context";
export async function downstreamContextAction(input: unknown) {
  try {
    const context = await getSessionContext(), parsed = downstreamContextRequest.safeParse(input);
    if (!parsed.success || context.dealerId || !["owner","admin","sales","sales_manager","factory_manager","dispatch_manager","dispatch","inventory_manager","accounts","viewer"].includes(context.role))
      return { success: false as const, error: "Order delivery details are unavailable for this request." };
    const client = await createClient(), result = await client.rpc("downstream_dispatch_context", { p_order_id: parsed.data.order_id, p_dispatch_id: parsed.data.dispatch_id ?? null });
    if (result.error) return { success: false as const, error: "Order delivery details could not be verified. Retry the source check." };
    return { success: true as const, data: downstreamContextSchema.parse(result.data) };
  } catch { return { success: false as const, error: "Order delivery details are unavailable. Retry the source check." }; }
}
