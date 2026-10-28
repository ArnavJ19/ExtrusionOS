"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RATE_WRITE_COMMANDS, canApproveRates, canReadRates, canWriteRates, parseCostingRateCommand, quoteRateCheckSchema, rateListSchema, rateLookupSchema, rateReviewSchema } from "@/lib/workflow/costing-rates";

export type CostingRateActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Customer is unavailable", "Only a draft rate can be edited", "Enter a positive rate, a valid start (and optional end) date, and a scope that matches the rate type",
  "Rate is unavailable", "Only a draft rate can be approved", "Another person must approve a rate you entered",
  "Record why the rate is withdrawn (3 to 300 characters)", "This rate is already withdrawn",
  "This rate is bound to issued quotations. End it with a newer approved rate instead of withdrawing it", "Quotation is unavailable", "Invalid rate list request"
];

// UPGRADE_EOS feature 85. Approval, periods, binding and the rate check are enforced by the database.
export async function costingRateAction(input: unknown): Promise<CostingRateActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = parseCostingRateCommand(input);
    if (!parsed.success) return { success: false, error: parsed.error };
    const { command, ...payload } = parsed.data;
    const allowed = command === "rates.approve" ? canApproveRates(context.role) : RATE_WRITE_COMMANDS.includes(command) ? canWriteRates(context.role) : canReadRates(context.role);
    if (context.dealerId || !allowed) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("costing_rate_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Approved costing rates are not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message) || /^A rate for the same scope already starts on or after \d{4}-\d{2}-\d{2}\. Withdraw it or choose a later start$/.test(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The costing rate request could not be completed. Refresh and retry." };
    }
    const data = command === "rates.list" ? rateListSchema.parse(result.data)
      : command === "rates.lookup" ? rateLookupSchema.parse(result.data)
      : command === "rates.review" ? rateReviewSchema.parse(result.data)
      : command === "quote.check" ? quoteRateCheckSchema.parse(result.data)
      : result.data;
    if (RATE_WRITE_COMMANDS.includes(command)) {
      try { revalidatePath("/quotes/rates"); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The costing rate request could not be completed. Check your session and retry." };
  }
}
