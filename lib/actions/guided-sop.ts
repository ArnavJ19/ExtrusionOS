"use server";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { assuranceCommandSchema, guidedCommandSchema } from "@/lib/workflow/guided-sop";

async function execute(input: unknown, assurance: boolean) {
  try {
    const context = await getSessionContext();
    const parsed = assurance ? assuranceCommandSchema.safeParse(input) : guidedCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Review the details." };
    const { command, ...payload } = parsed.data;
    const read = command.endsWith(".load") || command.endsWith(".list") || command === "review.queue";
    if (context.dealerId || context.role.startsWith("dealer_") || !can(context.role, "read", "tasks") || (!read && context.role === "viewer")) return { success: false as const, error: "You do not have permission for this action." };
    const client = await createClient();
    const result = await client.rpc(assurance ? "sop_assurance_command" : "guided_sop_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const msg = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(result.error.code ?? "")) return { success: false as const, error: "This procedure is unavailable. Contact your administrator." };
      if (["P0001", "42501", "23514"].includes(result.error.code ?? "") && msg.length < 240 && !/constraint|relation|column|syntax|permission denied/i.test(msg)) return { success: false as const, error: msg };
      return { success: false as const, error: "The change could not be confirmed. Reload the record before retrying." };
    }
    if (!read) { try { revalidatePath("/tasks", "layout"); } catch { /* The database already confirmed the write. */ } }
    return { success: true as const, data: result.data as unknown };
  } catch { return { success: false as const, error: "The request could not be confirmed. Reload before retrying." }; }
}
export async function guidedSopAction(input: unknown) { return execute(input, false); }
export async function sopAssuranceAction(input: unknown) { return execute(input, true); }
