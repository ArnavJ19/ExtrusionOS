"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  SUBSCRIPTION_WRITE_COMMANDS, canRunDelivery, deliverySchema, digestListSchema, followListSchema, followStatusSchema, parseSubscriptionCommand, preferencesSchema, recipientsSchema, requestListSchema
} from "@/lib/workflow/subscriptions";

export type SubscriptionActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Invalid page", "You cannot open this kind of record", "Record is unavailable", "Choose at least one kind of update to follow", "A chosen kind of update does not apply to this record",
  "You can follow at most 200 records. Unfollow some first", "Choose immediate, hourly or daily digests, hours from 0 to 23, and quiet hours with a different start and end",
  "This kind of request does not apply to this record", "Say what you need (3 to 300 characters)", "Remind every 1 to 72 hours", "The chosen person cannot act on this request",
  "This is already done: nothing to request", "You already have an open request to this person for this record", "Request is unavailable", "This request is already closed"
];

// UPGRADE_EOS feature 48. Grouping, delivery, reminders and resolution happen in the database.
export async function subscriptionAction(input: unknown): Promise<SubscriptionActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = parseSubscriptionCommand(input);
    if (!parsed.success) return { success: false, error: parsed.error };
    const { command, ...payload } = parsed.data;
    if (context.dealerId || (command === "delivery.run" && !canRunDelivery(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("subscription_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Following records is not available on this database yet. The database upgrade must be applied first." };
      if (businessErrors.includes(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The notification request could not be completed. Refresh and retry." };
    }
    const data = command === "follow.status" ? followStatusSchema.parse(result.data)
      : command === "follow.list" ? followListSchema.parse(result.data)
      : command === "prefs.get" || command === "prefs.set" ? preferencesSchema.parse(result.data)
      : command === "digest.list" ? digestListSchema.parse(result.data)
      : command === "request.recipients" ? recipientsSchema.parse(result.data)
      : command === "request.list" ? requestListSchema.parse(result.data)
      : command === "delivery.run" ? deliverySchema.parse(result.data)
      : result.data;
    if (SUBSCRIPTION_WRITE_COMMANDS.includes(command)) {
      for (const path of ["/notifications", "/notifications/following", "/notifications/requests"]) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The notification request could not be completed. Check your session and retry." };
  }
}
