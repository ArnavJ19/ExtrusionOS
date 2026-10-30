"use server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { masterCleanupSchema } from "@/lib/workflow/master-cleanup";
import { getErrorMessage } from "@/lib/utils/errors";
export async function masterCleanupAction(input: unknown) {
  try {
    const context = await getSessionContext();
    if (context.dealerId || !["owner", "admin"].includes(context.role)) return { success: false as const, error: "Only company administrators can consolidate masters." };
    const parsed = masterCleanupSchema.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the master comparison." };
    const { command, ...payload } = parsed.data;
    const result = await (await createClient()).rpc("master_cleanup_command", { p_command: command, p_payload: payload });
    if (result.error) throw result.error;
    return { success: true as const, data: result.data as Record<string, any> };
  } catch (error) { return { success: false as const, error: getErrorMessage(error, "The consolidation could not be confirmed. Reload its review queue.") }; }
}
