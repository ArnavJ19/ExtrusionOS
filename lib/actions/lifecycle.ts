"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canReadLifecycle, canUseLifecycleAction, lifecycleCommandSchema, parseLifecycleData, type LifecycleResult } from "@/lib/workflow/lifecycle";

export async function lifecycleAction(input: unknown): Promise<LifecycleResult> {
  let submitted = false;
  let finalizing = false;
  try {
    const parsed = lifecycleCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the request details." };
    const context = await getSessionContext();
    const { command, ...payload } = parsed.data;
    if (context.dealerId || !canReadLifecycle(context.role) || ("view" in parsed.data && !canReadLifecycle(context.role, parsed.data.view))
      || (parsed.data.command === "preview" && !canUseLifecycleAction(context.role, parsed.data.mutation.action))) {
      return { success: false, error: "This action is not permitted for your current session." };
    }
    finalizing = ["commit", "preview", "abandon"].includes(command);
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("lifecycle_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Order lifecycle workflows require the November batch 6 database upgrade. Existing workflows remain available." };
      if (code === "42501") return { success: false, error: "This record or action is not available to your current session." };
      // Only messages intentionally raised by this module are safe to show.
      if (code === "P0001" && result.error.message.startsWith("NOV: ")) return { success: false, error: result.error.message.slice(5) };
      if (["23505", "23514", "23503", "22P02", "22007", "22008", "22003"].includes(code)) return { success: false, error: "The details conflict with current records. Reload the source and review the action again." };
      return { success: false, uncertain: finalizing, error: finalizing ? "Confirmation is unavailable. Check the original request before submitting another action." : "Current information could not be loaded. Retry this read." };
    }
    const data = parseLifecycleData(command, result.data);
    if (command === "commit") {
      for (const path of ["/tasks/lifecycle", "/tasks", "/orders", "/production", "/dispatches", "/inventory", "/quality"]) {
        try { revalidatePath(path); } catch { /* The database outcome remains authoritative. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: finalizing && submitted, error: finalizing && submitted ? "Confirmation is unavailable. Check the original request before submitting another action." : "The request could not be completed. Check your session and retry this read." };
  }
}
