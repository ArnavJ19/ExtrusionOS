"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canReadControl, canUseControlAction, controlCommandSchema, ledgerSchema, parseControlData, type ControlResult, type FulfilmentLedger } from "@/lib/workflow/operations-control";
import { z } from "zod";

export async function controlAction(input: unknown): Promise<ControlResult> {
  let submitted = false;
  let finalizing = false;
  try {
    const parsed = controlCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Review the request details." };
    const context = await getSessionContext();
    const { command, ...payload } = parsed.data;
    if (context.dealerId || !canReadControl(context.role) || ("view" in parsed.data && !canReadControl(context.role, parsed.data.view))
      || (parsed.data.command === "preview" && !canUseControlAction(context.role, parsed.data.mutation.action))) {
      return { success: false, error: "This action is not permitted for your current session." };
    }
    finalizing = ["commit", "preview", "abandon"].includes(command);
    const supabase = await createClient();
    submitted = true;
    const result = await supabase.rpc("control_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Operational controls require the November batch 4 database upgrade. Existing workflows remain available." };
      if (code === "42501") return { success: false, error: "This record or action is not available to your current session." };
      // Only messages intentionally raised by this module are safe to show.
      if (code === "P0001" && result.error.message.startsWith("NOV: ")) return { success: false, error: result.error.message.slice(5) };
      if (["23505", "23514", "23503", "22P02", "22007", "22008", "22003"].includes(code)) return { success: false, error: "The details conflict with current records. Reload the source and review the action again." };
      return { success: false, uncertain: finalizing, error: finalizing ? "Confirmation is unavailable. Check the original request before submitting another action." : "Current information could not be loaded. Retry this read." };
    }
    const data = parseControlData(command, result.data);
    if (command === "commit") {
      for (const path of ["/tasks/control", "/tasks", "/orders", "/production", "/vendors/purchasing", "/tasks/approvals", "/tasks/procedures", "/tasks/handoffs"]) {
        try { revalidatePath(path); } catch { /* The database outcome remains authoritative. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, uncertain: finalizing && submitted, error: finalizing && submitted ? "Confirmation is unavailable. Check the original request before submitting another action." : "The request could not be completed. Check your session and retry this read." };
  }
}

/** NOV-005: read-only fulfilment ledger for the order page. */
export async function orderLedgerAction(input: unknown): Promise<ControlResult<FulfilmentLedger>> {
  try {
    const parsed = z.object({ order_id: z.string().uuid() }).strict().safeParse(input);
    const context = await getSessionContext();
    if (!parsed.success || context.dealerId || !canReadControl(context.role, "ledger")) return { success: false, error: "The order ledger is unavailable for this request." };
    const result = await (await createClient()).rpc("order_fulfilment_ledger", { p_order_id: parsed.data.order_id });
    if (result.error) {
      if (["PGRST202", "42883"].includes(result.error.code ?? "")) return { success: false, unavailable: true, error: "The fulfilment ledger requires the November batch 4 database upgrade." };
      return { success: false, error: "The fulfilment ledger could not be verified. Refresh before relying on these balances." };
    }
    return { success: true, data: ledgerSchema.parse(result.data) };
  } catch {
    return { success: false, error: "The fulfilment ledger could not be verified. Refresh before relying on these balances." };
  }
}
