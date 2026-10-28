"use server";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canManageCustomerRequirements, canReviewRequirements, customerRequirementCommandSchema } from "@/lib/workflow/customer-step-requirements";

export async function customerRequirementAction(input: unknown) {
  try {
    const c = await getSessionContext(); const parsed = customerRequirementCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Review the requirement details." };
    const { command, ...payload } = parsed.data;
    const permitted = "stage" in payload ? canReviewRequirements(c.role, payload.stage) : canManageCustomerRequirements(c.role);
    if (c.dealerId || !permitted) return { success: false as const, error: "You do not have permission for this work stage." };
    const client = await createClient(); const r = await client.rpc("customer_requirement_command", { p_command: command, p_payload: payload });
    if (r.error) return { success: false as const, error: ["P0001", "42501"].includes(r.error.code ?? "") && r.error.message.length < 240 ? r.error.message : "The customer requirements could not be confirmed. Reload before retrying." };
    if (!command.endsWith(".list") && !command.endsWith(".load")) { for (const path of ["/orders", "/customers"]) { try { revalidatePath(path, "layout"); } catch { /* The database already confirmed the write. */ } } }
    return { success: true as const, data: r.data as unknown };
  } catch { return { success: false as const, error: "The request could not be confirmed. Reload before retrying." }; }
}
